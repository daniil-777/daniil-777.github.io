// Morph 3D v2 decoder family (m3d_model.DecoderV2: attention trunk, 1x1 or 3x3 128^2 stage, 256^2 detail plane,
// deeper / product MLP, separate colour stream; m3d3_model.DecoderA3 = arch3: 64^2 latent, the detail stage on the colour
// planes too, meta.dec.cdetail) in TensorFlow.js, plus one generated WebGPU kernel for the grid.
// Weights in the m3d_export2.py / m3d3_codec.py layout. Same interface as M.Model (anchors, compose, planes -> one
// tensor, grid, gridGPU): P is [3, R, R, hid + chc], geometry features first, then colour features with the global
// palette folded into the xy plane (the colour stream sums the three planes, so a constant on one plane is exact after
// bilinear sampling).
(function (M) {
  'use strict';
  M.Model2 = class extends M.Model {
    constructor(meta, raw) {
      super(meta, raw);
      this.D = meta.dec; this.hid = meta.hid; this.chc = meta.dec.chc; this.CH = meta.hid + meta.dec.chc;
      // colour detail runs at the geometry detail's 8L (P is one tensor); DecoderA3 only exports it with a colour stream
      if (this.D.cdetail && !(this.D.detail && this.chc)) throw new Error('meta.dec.cdetail needs dec.detail and a colour stream');
    }

    lin(t, k, act) { return tf.fused.matMul({ a: t, b: this.W[k + '.w'], bias: this.W[k + '.b'], activation: act || 'linear' }); }

    // WebGL convolves through im2col, k*k*Cin floats per output pixel, and TF.js keeps each texture shape pooled (arch3:
    // 300 MB for a 4L plane, 230 MB over the decoder). One plane at a time in row bands of at most L^2 pixels, every 3x3
    // convolution here shares two im2col textures of ~20 MB. A band reads its neighbour rows, and zeros only past the
    // image as 'same' padding does, so the values are unchanged.
    conv(x, k, act) {
      const w = this.W[k + '.w'], [n, H, Wd] = x.shape, rows = Math.max(1, Math.floor(this.meta.lat ** 2 / Wd));
      if (!this.perPlane || w.shape[0] !== 3 || (n === 1 && rows >= H)) return super.conv(x, k, act);
      const per = Math.ceil(H / rows), bands = [];
      for (let p = 0; p < n; p++) for (let r0 = 0; r0 < H; r0 += rows) {
        const r1 = Math.min(H, r0 + rows), a = Math.max(0, r0 - 1), b = Math.min(H, r1 + 1);
        bands.push(tf.tidy(() => tf.fused.conv2d({ x: tf.slice(x, [p, a, 0, 0], [1, b - a, Wd, -1]), filter: w, strides: 1,
          pad: [[0, 0], [a + 1 - r0, r1 + 1 - b], [1, 1], [0, 0]], bias: this.W[k + '.b'], activation: act || 'linear' })));
      }
      const y = tf.tidy(() => {
        const planes = Array.from({ length: n }, (_, p) => (per > 1 ? tf.concat(bands.slice(p * per, (p + 1) * per), 1) : bands[p]));
        return n > 1 ? tf.concat(planes, 0) : planes[0];
      });
      tf.dispose(bands);
      return y;
    }

    exchange(x) {                            // as M.Model's, its full-size intermediates freed as they are summed
      const W = this.W, [R, C] = [x.shape[1], x.shape[3]];
      const s = tf.tidy(() => {
        const [xy, xz, yz] = tf.split(x, 3, 0).map((t) => tf.reshape(t, [R, R, C]));
        const mm = (v, k) => tf.matMul(v, W[k]);
        const along = (v, h) => tf.reshape(v, h ? [1, R, 1, C] : [1, 1, R, C]);
        const a = tf.concat([along(mm(tf.mean(xz, 1), 'ex.wa'), 1), along(mm(tf.mean(xy, 1), 'ex.wa'), 1), along(mm(tf.mean(xy, 0), 'ex.wa'), 1)], 0);
        const b = tf.concat([along(mm(tf.mean(yz, 1), 'ex.wb'), 0), along(mm(tf.mean(yz, 0), 'ex.wb'), 0), along(mm(tf.mean(xz, 0), 'ex.wb'), 0)], 0);
        const own = tf.tidy(() => tf.add(tf.reshape(tf.matMul(tf.reshape(x, [3 * R * R, C]), W['ex.w0']), [3, R, R, C]), W['ex.b']));
        return tf.add(own, tf.add(a, b));
      });
      const y = tf.tidy(() => tf.add(x, tf.relu(s)));
      s.dispose();
      return y;
    }

    res(x, k) {                              // as M.Model's, the first conv's output and the sum freed once consumed
      const r = tf.tidy(() => this.conv(this.conv(x, k + '.c1', 'relu'), k + '.c2'));
      const y = tf.tidy(() => tf.relu(tf.add(x, r)));
      r.dispose();
      return y;
    }

    // per-pixel linear layer on one plane [1, r, r, cin] -> [1, r, r, cout] (the grouped 1x1 heads, the detail pw)
    pix(t, k, act) { const [, r, s, c] = t.shape; return tf.reshape(this.lin(tf.reshape(t, [r * s, c]), k, act), [1, r, s, -1]); }

    // the detail stage on plane p, u [1, 8L, 8L, C] already bilinear x2: u + pw(relu(depthwise 3x3 (u))) -- geometry
    // (dw, pw: m3d_model.DecoderV2) and colour (cdw, cpw: m3d3_model.DecoderA3). Consumes u; the depthwise output is
    // freed once pw has read it, so at most three 8L^2 tensors exist at a time (arch3 geometry: 67 MB each)
    detail(u, p, dw, pw) {
      const r = tf.tidy(() => this.pix(tf.fused.depthwiseConv2d({ x: u, filter: this.W[dw + p + '.w'], strides: 1, pad: 'same',
        bias: this.W[dw + p + '.b'], activation: 'relu' }), pw + p));
      const y = tf.add(u, r);
      tf.dispose([u, r]);
      return y;
    }

    // TokenMixer: 2x2-merged tokens of all three planes, pre-norm attention blocks, 1x1 unmerge + pixel shuffle, residual
    mixer(x) {
      const W = this.W, L = this.meta.lat, l = L / 2, d = this.D.d, T = 3 * l * l, h = this.meta.heads, dh = d / h, c = x.shape[3];
      const ln = (t, k) => {
        const m = tf.moments(t, -1, true);
        return tf.add(tf.mul(tf.mul(tf.sub(t, m.mean), tf.rsqrt(tf.add(m.variance, this.meta.ln_eps))), W[k + '.g']), W[k + '.b']);
      };
      let t = tf.add(tf.reshape(tf.conv2d(x, W['mix.merge.w'], 2, 'valid'), [T, d]), tf.add(W['mix.merge.b'], W['mix.pos']));
      for (let b = 0; b < this.D.blocks; b++) {
        const k = 'mix.' + b + '.';
        const qkv = tf.transpose(tf.reshape(this.lin(ln(t, k + 'n1'), k + 'qkv'), [T, 3, h, dh]), [1, 2, 0, 3]);   // [3, h, T, dh]
        const [q, kk, v] = tf.split(qkv, 3, 0).map((a) => tf.reshape(a, [h, T, dh]));
        const att = tf.softmax(tf.mul(tf.matMul(q, kk, false, true), 1 / Math.sqrt(dh)));
        t = tf.add(t, this.lin(tf.reshape(tf.transpose(tf.matMul(att, v), [1, 0, 2]), [T, d]), k + 'proj'));
        t = tf.add(t, this.lin(this.lin(ln(t, k + 'n2'), k + 'fc1', 'relu'), k + 'fc2'));
      }
      // unmerge channels come in depthToSpace order (k * c + ch, k = 2 i + j); the shuffle as a rank-4 transpose, which
      // every backend has: [3l, l, (i), (j, ch)] -> [3l, (i), l, (j, ch)] -> [3, 2l, 2l, c]
      const u = tf.reshape(this.lin(t, 'mix.unmerge'), [3 * l, l, 2, 2 * c]);
      return tf.add(x, tf.reshape(tf.transpose(u, [0, 2, 1, 3]), [3, L, L, c]));
    }

    // z [3, L, L, cz] -> P [3, planes_res, planes_res, hid + chc]; with size, P as tf.image.resizeBilinear(P, [size, size],
    // true) would make it, each plane's channels resampled as soon as they exist, so the planes_res^2 planes (arch3:
    // 240 MB) never exist together; with an array of sizes, one P per size from the same pass. Every step frees its input
    // once the next exists, and after the last step that mixes the planes they go one at a time. TF.js keeps freed GPU
    // memory pooled by exact size, so what a keyframe holds is the sum over sizes of how many are alive at once: when the
    // tidy held every intermediate to the end, that was 1.5 GB on WebGPU and 2.3 GB on WebGL for arch3. The tidy now only
    // cleans up after an error. Same ops on the same inputs, so the same values.
    planes(z, size) {
      const sizes = [size].flat();
      const P = tf.tidy(() => {
        const W = this.W, D = this.D, L = this.meta.lat, chc = this.chc, R2 = 8 * L;
        const step = (x, f) => { const y = tf.tidy(() => f(x)); x.dispose(); return y; };      // f(x), x released
        const rs = (t) => {                  // t at every requested size (t itself at its own), t released after
          const out = sizes.map((s) => (s && s !== t.shape[1] ? tf.tidy(() => tf.image.resizeBilinear(t, [s, s], true)) : t));
          if (!out.includes(t)) t.dispose();
          return out;
        };
        let x = tf.tidy(() => tf.relu(tf.add(tf.conv2d(z, W['inp.w'], 1, 'same'), this.inpBias)));
        x = step(x, (t) => this.exchange(t));
        x = step(x, (t) => this.res(t, 'res0'));
        if (D.blocks) x = step(x, (t) => this.mixer(t));
        const pal = chc && D.pal ? tf.tidy(() => tf.reshape(this.lin(tf.reshape(tf.mean(x, [0, 1, 2]), [1, -1]), 'pal'), [1, 1, 1, chc])) : null;
        const pl = tf.split(x, 3, 0);
        x.dispose();
        // plane p: the 2L and 4L stages; geometry head (1x1) [-> bilinear x2 -> detail]; colour head [+ palette, xy plane]
        // [-> bilinear x2] [-> colour detail (cdetail), the palette after it]; then its geometry and colour channels side by side
        const out = pl.map((t, p) => {
          let f = step(t, (t) => this.conv(tf.image.resizeNearestNeighbor(t, [2 * L, 2 * L]), 'up1', 'relu'));
          f = step(f, (t) => this.res(t, 'res1'));
          f = step(f, (t) => (D.hi === 'conv3' ? this.conv(tf.image.resizeNearestNeighbor(t, [4 * L, 4 * L]), 'up2', 'relu')
            : this.res(this.conv(tf.image.resizeBilinear(t, [4 * L, 4 * L], true), 'up2', 'relu'), 'res2')));
          let g = tf.tidy(() => this.pix(f, 'head' + p)), c = chc ? tf.tidy(() => this.pix(f, 'chead' + p)) : null;
          f.dispose();
          if (D.detail) g = this.detail(step(g, (t) => tf.image.resizeBilinear(t, [R2, R2], true)), p, 'dw', 'pw');
          const gs = rs(g);
          if (!c) return gs;
          const pp = pal && p === 0 ? pal : null;
          if (pp && !D.cdetail) c = step(c, (t) => tf.add(t, pp));
          if (D.detail) c = step(c, (t) => tf.image.resizeBilinear(t, [R2, R2], true));
          if (D.cdetail) { c = this.detail(c, p, 'cdw', 'cpw'); if (pp) c = step(c, (t) => tf.add(t, pp)); }
          const cs = rs(c), ys = gs.map((g, i) => tf.tidy(() => tf.concat([g, cs[i]], 3)));
          tf.dispose([...gs, ...cs]);
          return ys;
        });
        const P = sizes.map((_, i) => tf.concat(out.map((o) => o[i]), 0));
        tf.dispose(out.flat());
        return P;
      });
      return Array.isArray(size) ? P : P[0];
    }

    // Dense grid x_i = -1 + 2i/(R-1) -> {sdf [R^3] (x slowest, z fastest), rgb [Rc^3 x 3] at every 2nd point}; TF.js ops
    // only, so it runs on every backend (the WebGL fallback and the reference for the WebGPU kernel).
    async grid(P, R, budget = 6e6) {
      const W = this.W, D = this.D, H = this.hid, C = this.chc, CH = this.CH, OG = C ? 1 : 4;
      const parts = tf.tidy(() => {
        const Pr = R === P.shape[1] ? P : tf.image.resizeBilinear(P, [R, R], true);
        const pl = tf.split(Pr, 3, 0), [gxy, gxz, gyz] = pl.map((t) => tf.slice(t, [0, 0, 0, 0], [1, R, R, H]));
        const mlp = (h) => {
          for (let l = 0; l < D.mlp_layers; l++) h = this.lin(h, 'hidden' + l, 'relu');
          return this.lin(h, 'out_g');
        };
        const yzb = D.prod ? gyz : tf.add(gyz, W['b1']);
        let n = Math.max(2, Math.floor(budget / (R * R * H))); n -= n % 2;
        const sd = [], cl = [];
        for (let i0 = 0; i0 < R; i0 += n) {
          const m = Math.min(n, R - i0);
          const a = tf.reshape(tf.slice(gxy, [0, i0, 0, 0], [1, m, R, H]), [m, R, 1, H]);
          const b = tf.reshape(tf.slice(gxz, [0, i0, 0, 0], [1, m, R, H]), [m, 1, R, H]);
          const h = D.prod
            ? tf.relu(tf.add(this.lin(tf.reshape(tf.add(tf.add(tf.add(a, b), gyz), tf.mul(tf.mul(a, b), gyz)), [m * R * R, H]), 'first'), W['b1']))
            : tf.reshape(tf.relu(tf.add(tf.add(a, b), yzb)), [m * R * R, H]);
          const o = tf.reshape(mlp(h), [m, R, R, OG]);
          sd.push(tf.slice(o, [0, 0, 0, 0], [m, R, R, 1]));
          if (!C) cl.push(tf.stridedSlice(o, [0, 0, 0, 1], [m, R, R, 4], [2, 2, 2, 1]));
        }
        if (C) {                             // colour stream on the stride-2 points only
          const [cxy, cxz, cyz] = pl.map((t) => tf.stridedSlice(t, [0, 0, 0, H], [1, R, R, CH], [1, 2, 2, 1])), Rc = cxy.shape[1];
          const hc = tf.relu(tf.add(tf.add(tf.reshape(cxy, [Rc, Rc, 1, C]), tf.reshape(cxz, [Rc, 1, Rc, C])), cyz));
          cl.push(tf.reshape(this.lin(this.lin(tf.reshape(hc, [-1, C]), 'c2', 'relu'), 'c3'), [Rc, Rc, Rc, 3]));
        }
        return [tf.concat(sd, 0), tf.concat(cl, 0)];
      });
      const [sdf, rgb] = await Promise.all(parts.map((t) => t.data()));
      const Rc = parts[1].shape[1];
      tf.dispose(parts);
      return { sdf, rgb, R, Rc };
    }

    // this model's per-point field in WGSL for M.Model.gridGPU (sizes and weight offsets baked in): the geometry MLP -> sdf,
    // and the colour stream only where colour is asked for (every 2nd grid point); returns (sdf, r, g, b)
    gpuField() {
      const H = this.hid, C = this.chc, D = this.D, OG = C ? 1 : 4;
      const keys = ['b1'].concat(D.prod ? ['first.w', 'first.b'] : [],
        ...Array.from({ length: D.mlp_layers }, (_, l) => ['hidden' + l + '.w', 'hidden' + l + '.b']), ['out_g.w', 'out_g.b'],
        C ? ['c2.w', 'c2.b', 'c3.w', 'c3.b'] : []);
      const off = {}; let n = 0;
      for (const k of keys) { off[k] = n; n += this.F[k].length; }
      const weights = new Float32Array(n);
      for (const k of keys) weights.set(this.F[k], off[k]);
      const o = (k) => off[k] + 'u';
      let body = D.prod
        ? `for (var n = 0u; n < H; n++) { let x = P[a + n]; let y = P[b + n]; let z = P[c + n]; t[n] = x + y + z + x * y * z; }
            for (var m = 0u; m < H; m++) { var s = Wt[${o('first.b')} + m] + Wt[${o('b1')} + m];
              for (var n = 0u; n < H; n++) { s += t[n] * Wt[${o('first.w')} + n * H + m]; } h[m] = max(s, 0.0); }`
        : `for (var n = 0u; n < H; n++) { h[n] = max(P[a + n] + P[b + n] + P[c + n] + Wt[${o('b1')} + n], 0.0); }`;
      for (let l = 0; l < D.mlp_layers; l++) body += `
            for (var n = 0u; n < H; n++) { t[n] = h[n]; }
            for (var m = 0u; m < H; m++) { var s = Wt[${o('hidden' + l + '.b')} + m];
              for (var n = 0u; n < H; n++) { s += t[n] * Wt[${o('hidden' + l + '.w')} + n * H + m]; } h[m] = max(s, 0.0); }`;
      body += OG === 1
        ? `var sd = Wt[${o('out_g.b')}]; for (var n = 0u; n < H; n++) { sd += h[n] * Wt[${o('out_g.w')} + n]; }`
        : `var ov = vec4<f32>(Wt[${o('out_g.b')}], Wt[${o('out_g.b')} + 1u], Wt[${o('out_g.b')} + 2u], Wt[${o('out_g.b')} + 3u]);
            for (var n = 0u; n < H; n++) { let q = ${o('out_g.w')} + n * 4u; ov += h[n] * vec4<f32>(Wt[q], Wt[q + 1u], Wt[q + 2u], Wt[q + 3u]); }
            let sd = ov.x;`;
      const colour = C
        ? `if (!colour) { return vec4<f32>(sd, 0.5, 0.5, 0.5); }
            var hc: array<f32, ${C}>;
            for (var q = 0u; q < ${C}u; q++) { hc[q] = max(P[a + H + q] + P[b + H + q] + P[c + H + q], 0.0); }
            var rgb = vec3<f32>(Wt[${o('c3.b')}], Wt[${o('c3.b')} + 1u], Wt[${o('c3.b')} + 2u]);
            for (var m = 0u; m < 32u; m++) { var s = Wt[${o('c2.b')} + m];
              for (var q = 0u; q < ${C}u; q++) { s += hc[q] * Wt[${o('c2.w')} + q * 32u + m]; }
              s = max(s, 0.0); let w = ${o('c3.w')} + m * 3u; rgb += s * vec3<f32>(Wt[w], Wt[w + 1u], Wt[w + 2u]); }
            return vec4<f32>(sd, rgb);`
        : 'return vec4<f32>(sd, ov.yzw);';
      return { CH: this.CH, weights, code: `
        const H = ${H}u;
        fn field(a: u32, b: u32, c: u32, colour: bool) -> vec4<f32> {
          var h: array<f32, ${H}>; var t: array<f32, ${H}>;
          ${body}
          ${colour}
        }` };
    }
  };

  // the right runtime for an export: v2 exports say so in meta.json (arch 'v2', format 'm3d2'); everything else is v1
  M.createModel = (meta, raw) => (meta.arch === 'v2' ? new M.Model2(meta, raw) : new M.Model(meta, raw));
})(window.M3D = window.M3D || {});
