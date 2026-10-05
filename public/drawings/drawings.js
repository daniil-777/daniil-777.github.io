/* Compact port of the Pixel Morph drawing decoder for the portfolio's About preview: one model,
   six objects, dots only, a 192-px field and a capped keyframe rate, so it stays light beside the 3D one. */
(function () {
  'use strict';
  const qs = new URLSearchParams(location.search);
  const session = qs.get('session') || '';
  const embedded = parent !== window;
  const CHANNEL = 'portfolio-drawing';
  const post = (type, extra = {}) => { if (embedded) parent.postMessage({ channel: CHANNEL, session, type, ...extra }, location.origin); };
  document.documentElement.dataset.theme = qs.get('theme') === 'dark' ? 'dark' : 'light';

  // 'pixels' (default): the decoded colour averaged into a coarse grid of flat pixels, inked where contours run; no contour
  // detection or dot stamping, and a smaller field. 'dots': the original dot drawing.
  const MODE = qs.get('mode') === 'dots' ? 'dots' : 'pixels';
  const PIX = Math.min(64, Math.max(16, parseInt(qs.get('pix') || '', 10) || 32)); // pixels across the image
  const FIELD = MODE === 'pixels' ? (qs.get('field') === '192' ? 192 : 128) : 192; // decoded field (native 384: 1/9 or 1/4 of the work)
  const KEY_MS = 90;            // at most ~11 keyframes a second; frames in between are interpolated
  const DRAW_MS = 32;           // at most ~30 drawn frames a second
  const MAX_CANVAS = 2 * FIELD; // dots are stamped at device resolution, up to this size
  const TONE = Math.min(1, Math.max(0, parseFloat(qs.get('tone') ?? '') || 0.3)), INK = 1.25, SEG_SECONDS = 2.6, DRIFT_REL = 0.1, SWEEP_W = 0.35;
  const SPEED = Math.min(2, Math.max(0.2, parseFloat(qs.get('speed') || '') || 0.8));
  const BLUR64 = 1.4, TAU64 = 0.006, TAU_MIN64 = 0.0008, LOOSE_PX = 2.5, LOOSE_MAX_PX = 4.0, TARGET64 = 0.03, WEAK = 0.4;

  // The same pinned TensorFlow.js files as the 3D preview, so a visitor's cache serves both.
  const CDN = 'https://cdn.jsdelivr.net/npm/@tensorflow/';
  const TF = {
    core: [CDN + 'tfjs-core@4.22.0/dist/tf-core.min.js', 'sha384-ZVckeGw84RpbmPMzx1s9LFUqIaeIsG46rmlH/HynDuJikkmGLnTDnEmT0CrKI6Yi'],
    webgpu: [CDN + 'tfjs-backend-webgpu@4.22.0/dist/tf-backend-webgpu.min.js', 'sha384-0cz8Hmjyhn7MyeyzI7MSTOuEdxiSNiwpDDPakM6XjdtC/Fb5/qRxkmLrTJROQqjQ'],
    webgl: [CDN + 'tfjs-backend-webgl@4.22.0/dist/tf-backend-webgl.min.js', 'sha384-PAbE0QuTSZkDuS/hX4MEx1MZ0Nwd+mkb2Znz35ZqGDjb36klpR8/mCpykhdd7uHW'],
  };
  const loadScript = ([src, integrity]) => new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src; script.integrity = integrity; script.crossOrigin = 'anonymous';
    script.onload = resolve; script.onerror = () => reject(new Error('could not load ' + src));
    document.head.append(script);
  });
  // Model files, TensorFlow.js and its backend all download in parallel.
  const get = (name) => fetch('model/' + name).then((response) => { if (!response.ok) throw new Error(name + ' ' + response.status); return response; });
  const files = { meta: get('meta.json').then((r) => r.json()), decoder: get('decoder.bin.gz').then((r) => r.arrayBuffer()), a0: get('anchors-0.bin.gz').then((r) => r.arrayBuffer()) };
  for (const promise of Object.values(files)) promise.catch(() => {});
  const firstBackend = navigator.gpu && qs.get('backend') !== 'webgl' ? 'webgpu' : 'webgl'; // touch devices ask for WebGL: its texture pool is capped
  const preload = document.createElement('link');
  preload.rel = 'preload'; preload.as = 'script'; preload.href = TF[firstBackend][0]; preload.integrity = TF[firstBackend][1]; preload.crossOrigin = 'anonymous';
  document.head.append(preload);
  const tfReady = loadScript(TF.core);
  tfReady.catch(() => {});

  // ---- host protocol (same shape as the 3D preview's)
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let hostVisible = !embedded, paused = false, disposed = false, failed = false, skip = false, wake = () => {}, repaint = () => {};
  const setPaused = (value) => { paused = value; post('playback', { paused }); wake(); };
  addEventListener('message', (event) => {
    if (disposed || event.source !== parent || event.origin !== location.origin) return;
    const data = event.data;
    if (!data || data.channel !== CHANNEL || data.session !== session) return;
    if (data.type === 'visibility') { hostVisible = data.active === true; wake(); }
    if (data.type === 'toggle') setPaused(!paused);
    if (data.type === 'next') skip = true;
    if (data.type === 'theme') { document.documentElement.dataset.theme = data.theme === 'dark' ? 'dark' : 'light'; repaint(); }
    if (data.type === 'dispose') dispose();
  });
  document.addEventListener('visibilitychange', () => wake());
  reduced.addEventListener('change', () => { if (reduced.matches && !paused) setPaused(true); });
  function fail(error) {
    if (failed || disposed) return;
    failed = true; console.error(error); post('error');
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    try { if (window.tf?.getBackend() === 'webgl') window.tf.backend().gpgpu.gl.getExtension('WEBGL_lose_context')?.loseContext(); } catch {}
    try { if (window.tf?.getBackend() === 'webgpu') window.tf.backend().device.destroy(); } catch {}
  }
  addEventListener('pagehide', dispose);

  const f16 = (h) => {
    const e = (h >> 10) & 0x1f, m = h & 0x3ff, s = h & 0x8000 ? -1 : 1;
    return e === 0 ? s * m * 5.960464477539063e-8 : e === 31 ? (m ? NaN : s * Infinity) : s * (1 + m / 1024) * Math.pow(2, e - 15);
  };
  async function unpack(buffer) { // servers that already inflated the gzip pass through
    const head = new Uint8Array(buffer, 0, 2);
    if (head[0] !== 0x1f || head[1] !== 0x8b) return buffer;
    return new Response(new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  }
  // Integer-hash noise in [0, 1): the stipple threshold without the original's noise table.
  const noise = (x, y) => { let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1); h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d); return ((h ^ (h >>> 12)) >>> 0) / 4294967296; };

  async function start() {
    await tfReady;
    const tf = window.tf;
    let ok = false;
    if (firstBackend === 'webgpu') try { await loadScript(TF.webgpu); ok = await tf.setBackend('webgpu'); } catch { ok = false; }
    if (!ok) {
      await loadScript(TF.webgl);
      try { tf.env().set('WEBGL_FORCE_F16_TEXTURES', true); tf.env().set('WEBGL_DELETE_TEXTURE_THRESHOLD', 32 * 1048576); } catch {}
      ok = await tf.setBackend('webgl');
    }
    if (!ok) throw new Error('no GPU backend');
    await tf.ready();
    if (disposed) return;
    try { tf.backend().gpgpu?.gl.canvas.addEventListener('webglcontextlost', (event) => { event.preventDefault(); fail(new Error('WebGL context lost')); }); } catch {}

    // ---- model: int8 / fp16 conv decoder over a 48x48 grid of PCA-coded cells
    const meta = await files.meta;
    if (meta.format !== 'pm2') throw new Error('unexpected model format');
    const dbuf = await unpack(await files.decoder);
    const a0 = await unpack(await files.a0);
    const names = meta.names, G = meta.grid, CODE = meta.code, NATIVE = meta.size, dmax = meta.dmax, S = FIELD, HS = S >> 1;
    const OUTS = meta.outputs, DIST_CH = OUTS.indexOf('dist'), R_CH = OUTS.indexOf('r');
    const layers = meta.decoder.layers.map((l) => {
      if (l.type === 'up') return { up: true };
      if (l.type === 'save' || l.type === 'addrelu') return { [l.type]: true };
      const n = l.kh * l.kw * l.cin * l.cout, w = new Float32Array(n);
      if (l.dtype === 'f16') { const h = new Uint16Array(dbuf, l.w, n); for (let j = 0; j < n; j++) w[j] = f16(h[j]); }
      else { const q = new Int8Array(dbuf, l.q, n), sc = Float32Array.from(new Uint16Array(dbuf, l.s, l.cout), f16); for (let j = 0; j < n; j++) w[j] = q[j] * sc[j % l.cout]; }
      return { W: tf.tensor4d(w, [l.kh, l.kw, l.cin, l.cout]), B: tf.tensor1d(Float32Array.from(new Uint16Array(dbuf, l.b, l.cout), f16)), act: l.act };
    });
    const K = meta.pca.k, D = G * G * K;
    const basis = tf.tensor2d(Float32Array.from(new Uint16Array(dbuf, meta.pca.basis, K * CODE), f16), [K, CODE]);
    const pmean = tf.tensor1d(Float32Array.from(new Uint16Array(dbuf, meta.pca.mean, CODE), f16));

    // ---- anchors ('PMA2' | n k g 0 | classes | fp16 scales | int8 codes) with 5x5 block signatures for the walk
    const SB = 8, SG = Math.max(1, Math.floor(G / SB));
    function signature(z) {
      const s = new Float32Array(SG * SG * K);
      for (let gy = 0; gy < G; gy++) for (let gx = 0; gx < G; gx++) {
        const o = (gy * G + gx) * K, so = (Math.min(SG - 1, (gy / SB) | 0) * SG + Math.min(SG - 1, (gx / SB) | 0)) * K;
        for (let k = 0; k < K; k++) s[so + k] += z[o + k];
      }
      return s;
    }
    const flat = [];
    {
      const dv = new DataView(a0);
      if (String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3)) !== 'PMA2') throw new Error('bad anchor chunk');
      const n = dv.getUint16(4, true), k = dv.getUint16(6, true), g = dv.getUint16(8, true), d = g * g * k;
      if (k !== K || g !== G) throw new Error('anchor chunk does not match the model');
      let o = 12; const cls = new Uint8Array(a0, o, n); o += n; o += o & 1;
      const sc = new Uint16Array(a0, o, n); o += 2 * n; const q = new Int8Array(a0, o, n * d);
      for (let i = 0; i < n; i++) { const s = f16(sc[i]), z = new Float32Array(d); for (let j = 0; j < d; j++) z[j] = q[i * d + j] * s; flat.push({ c: cls[i], z, id: i, sig: signature(z) }); }
    }
    let sumSq = 0; for (const w of flat) for (let i = 0; i < D; i++) sumSq += w.z[i] * w.z[i];
    const DRIFT = DRIFT_REL * Math.sqrt(sumSq / (flat.length * D));

    // ---- one decode: code grid -> [distance field S*S | colour at half resolution]
    const work = new Float32Array(S * S + HS * HS * 3), dist = work.subarray(0, S * S), col = work.subarray(S * S);
    function decode(z) {
      return tf.tidy(() => {
        let h = tf.reshape(tf.add(tf.matMul(tf.tensor2d(z, [G * G, K]), basis), pmean), [1, G, G, CODE]);
        h = tf.image.resizeBilinear(h, [S / 8, S / 8], true);
        let skipT = null;
        for (const l of layers) {
          if (l.save) skipT = h;
          else if (l.addrelu) h = tf.relu(tf.add(h, skipT));
          else h = l.up ? tf.image.resizeNearestNeighbor(h, [h.shape[1] * 2, h.shape[2] * 2]) : tf.fused.conv2d({ x: h, filter: l.W, strides: 1, pad: 'same', bias: l.B, activation: l.act });
        }
        const d = tf.reshape(tf.slice(h, [0, 0, 0, DIST_CH], [1, S, S, 1]), [S * S]);
        return tf.concat([d, tf.reshape(tf.avgPool(tf.slice(h, [0, 0, 0, R_CH], [1, S, S, 3]), 2, 2, 'valid'), [HS * HS * 3])]);
      });
    }

    // ---- canvas: dots stamped at device resolution into one ImageData
    const view = document.getElementById('c'), ctx = view.getContext('2d', { alpha: false });
    let W = 0, img = null, g8 = null, g32 = null;
    if (MODE === 'pixels') view.classList.add('pixels');
    function fit() {
      if (MODE === 'pixels') { if (W !== PIX) { W = view.width = view.height = PIX; img = ctx.createImageData(W, W); g8 = img.data; g32 = new Uint32Array(g8.buffer); lastSig = ''; } return; }
      const px = Math.max(64, Math.min(MAX_CANVAS, Math.round(Math.min(innerWidth, innerHeight) * (devicePixelRatio || 1))));
      if (px === W) return;
      W = view.width = view.height = px; img = ctx.createImageData(W, W); g8 = img.data; g32 = new Uint32Array(g8.buffer); lastSig = '';
    }
    addEventListener('resize', fit);

    // ---- contours: Steger valley detector with hysteresis on the blurred distance field
    const tmp = new Float32Array(S * S), blur = new Float32Array(S * S), curv = new Float32Array(S * S), offX = new Float32Array(S * S), offY = new Float32Array(S * S);
    const stack = new Int32Array(S * S), lineMask = new Uint8Array(S * S), curvHist = new Uint32Array(1024), tone = new Float32Array(HS * HS);
    const sigma = BLUR64 * S / NATIVE, kr = Math.max(1, Math.ceil(sigma * 2.5)), kern = new Float32Array(2 * kr + 1);
    { let sum = 0; for (let i = -kr; i <= kr; i++) sum += kern[i + kr] = Math.exp(-i * i / (2 * sigma * sigma)); for (let i = 0; i < kern.length; i++) kern[i] /= sum; }
    function gaussBlur(src) {
      const T = 2 * kr + 1, mir = (v) => (v < 0 ? -v : v >= S ? 2 * S - 2 - v : v);
      for (let y = 0; y < S; y++) { const row = y * S; for (let x = 0; x < S; x++) { let acc = 0; for (let i = 0; i < T; i++) acc += src[row + mir(x + i - kr)] * kern[i]; tmp[row + x] = acc; } }
      for (let y = 0; y < S; y++) {
        const row = y * S; blur.fill(0, row, row + S);
        for (let i = 0; i < T; i++) { const w = kern[i], sr = mir(y + i - kr) * S; for (let x = 0; x < S; x++) blur[row + x] += tmp[sr + x] * w; }
      }
      return blur;
    }
    function detectLines(detail) {
      const sc = S / NATIVE, b = gaussBlur(dist), scale2 = sc * sc;
      const tauMax = TAU64 / scale2, tauMin = TAU_MIN64 / scale2, looseMax = LOOSE_MAX_PX / dmax, loose = LOOSE_PX / dmax;
      curvHist.fill(0); let nCand = 0;
      for (let y = 1; y < S - 1; y++) for (let x = 1; x < S - 1; x++) {
        const i = y * S + x, v = b[i]; curv[i] = 0;
        if (v >= looseMax || v >= 0.99) continue;
        const l = b[i - 1], r = b[i + 1], u = b[i - S], dn = b[i + S];
        const vx = (r - l) / 2, vy = (dn - u) / 2, vxx = r - 2 * v + l, vyy = dn - 2 * v + u;
        const vxy = (b[i + S + 1] - b[i + S - 1] - b[i - S + 1] + b[i - S - 1]) / 4;
        const disc = Math.sqrt(Math.max((vxx - vyy) * (vxx - vyy) / 4 + vxy * vxy, 0)), l1 = (vxx + vyy) / 2 + disc;
        if (l1 <= tauMin) continue;
        let ex, ey;
        if (Math.abs(vxy) > 1e-9) { ex = vxy; ey = l1 - vxx; } else if (vxx >= vyy) { ex = 1; ey = 0; } else { ex = 0; ey = 1; }
        const n = Math.sqrt(ex * ex + ey * ey) || 1; ex /= n; ey /= n;
        const t = -(vx * ex + vy * ey) / l1;
        if (Math.abs(t * ex) <= 0.5 && Math.abs(t * ey) <= 0.5) {
          curv[i] = l1; nCand++; offX[i] = t * ex; offY[i] = t * ey;
          let h = ((l1 - tauMin) / (tauMax - tauMin) * 1023) | 0; if (h > 1023) h = 1023; curvHist[h]++;
        }
      }
      const k = Math.round(TARGET64 * detail * NATIVE * NATIVE * sc);
      let acc = 0, h = 1023; for (; h > 0; h--) { acc += curvHist[h]; if (acc >= k) break; }
      const tau = nCand > k ? tauMin + h / 1023 * (tauMax - tauMin) : tauMin, bound = tau > tauMin * 1.5 ? loose : looseMax, weakTau = tau * WEAK;
      let sp = 0;
      for (let i = 0; i < S * S; i++) {
        if (b[i] >= bound || curv[i] <= weakTau) { lineMask[i] = 0; continue; }
        if (curv[i] > tau) { lineMask[i] = 1; stack[sp++] = i; } else lineMask[i] = 2;
      }
      while (sp > 0) {
        const i = stack[--sp], x = i % S, y = (i - x) / S;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= S || yy >= S) continue;
          const j = yy * S + xx; if (lineMask[j] === 2) { lineMask[j] = 1; stack[sp++] = j; }
        }
      }
      for (let i = 0; i < S * S; i++) if (lineMask[i] === 2) lineMask[i] = 0;
    }
    // tone: luminance of the decoded colour, stretched to its 2..98 % range with a moderate mean darkness
    const toneHist = new Uint32Array(64);
    function autoLevels() {
      const n = HS * HS; toneHist.fill(0);
      for (let i = 0; i < n; i++) { tone[i] = 0.299 * col[3 * i] + 0.587 * col[3 * i + 1] + 0.114 * col[3 * i + 2]; let b = (tone[i] * 64) | 0; b = b < 0 ? 0 : b > 63 ? 63 : b; toneHist[b]++; }
      let acc = 0, lo = 0, hi = 63;
      for (; lo < 63; lo++) { acc += toneHist[lo]; if (acc > 0.02 * n) break; }
      acc = 0; for (; hi > 0; hi--) { acc += toneHist[hi]; if (acc > 0.02 * n) break; }
      const a = lo / 64, span = Math.max(0.12, (hi + 1) / 64 - a); let dsum = 0;
      for (let i = 0; i < n; i++) { let v = (tone[i] - a) / span; v = v < 0 ? 0 : v > 1 ? 1 : v; tone[i] = v; dsum += 1 - v; }
      const m = dsum / n;
      if (m > 0.42) { const g = Math.log(0.42) / Math.log(m); for (let i = 0; i < n; i++) tone[i] = 1 - Math.pow(1 - tone[i], g); }
    }
    // ---- dots: anti-aliased discs min-composited over white, coverage masks cached per radius and sub-pixel offset
    const DOT_SUB = 4, DOT_RQ = 32, masks = new Map(), dotC = [0, 0, 0];
    function dotMask(rq, sx, sy) {
      const key = (rq * DOT_SUB + sx) * DOT_SUB + sy; let m = masks.get(key);
      if (!m) {
        const r = rq / DOT_RQ, fx = (sx + 0.5) / DOT_SUB, fy = (sy + 0.5) / DOT_SUB, e = Math.ceil(r + 1), n = 2 * e + 1, cov = new Uint8Array(n * n);
        for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
          const dx = i - e + 0.5 - fx, dy = j - e + 0.5 - fy; let c = r + 0.5 - Math.sqrt(dx * dx + dy * dy); c = c < 0 ? 0 : c > 1 ? 1 : c; cov[j * n + i] = Math.round(c * 255);
        }
        m = { e, n, cov }; masks.set(key, m);
      }
      return m;
    }
    function stampDot(cx, cy, r, cr, cg, cb) {
      const bx = Math.floor(cx), by = Math.floor(cy), sx = Math.min(DOT_SUB - 1, ((cx - bx) * DOT_SUB) | 0), sy = Math.min(DOT_SUB - 1, ((cy - by) * DOT_SUB) | 0);
      const m = dotMask(Math.max(1, Math.round(r * DOT_RQ)), sx, sy), e = m.e, n = m.n, cov = m.cov, ir = 255 - cr, ig = 255 - cg, ib = 255 - cb;
      for (let j = 0; j < n; j++) {
        const py = by - e + j; if (py < 0 || py >= W) continue;
        const i0 = Math.max(0, e - bx), i1 = Math.min(n, W - bx + e); let o = (py * W + bx - e + i0) * 4;
        for (let i = i0; i < i1; i++, o += 4) {
          const c = cov[j * n + i]; if (!c) continue;
          const vr = 255 - ((ir * c * 257 + 32768) >> 16), vg = 255 - ((ig * c * 257 + 32768) >> 16), vb = 255 - ((ib * c * 257 + 32768) >> 16);
          if (vr < g8[o]) g8[o] = vr; if (vg < g8[o + 1]) g8[o + 1] = vg; if (vb < g8[o + 2]) g8[o + 2] = vb;
        }
      }
    }
    function dotColour(x, y) { // scene colour, saturation boosted and lightness capped so dots show on white
      let hx = (x * 0.5) | 0, hy = (y * 0.5) | 0; if (hx >= HS) hx = HS - 1; if (hy >= HS) hy = HS - 1;
      const ci = (hy * HS + hx) * 3; let r = col[ci], g = col[ci + 1], b = col[ci + 2];
      const m = (r + g + b) / 3; r = m + 2 * (r - m); g = m + 2 * (g - m); b = m + 2 * (b - m);
      const L = 0.299 * r + 0.587 * g + 0.114 * b; if (L > 0.6) { const k = 0.6 / L; r *= k; g *= k; b *= k; }
      dotC[0] = Math.min(255, Math.max(0, r * 255)); dotC[1] = Math.min(255, Math.max(0, g * 255)); dotC[2] = Math.min(255, Math.max(0, b * 255));
    }
    const sp = Math.max(1.4, 2 * S / NATIVE), gw = Math.ceil(S / sp) + 1, occ = new Uint8Array(gw * gw), dotsX = new Float32Array(gw * gw), dotsY = new Float32Array(gw * gw);
    const POW14 = new Float32Array(256); for (let q = 0; q < 256; q++) POW14[q] = TONE * Math.pow(q / 255, 1.4);
    // pixels: per block, the mean colour (saturated, posterised to LEVELS steps) darkened by how much contour ink it holds
    const LEVELS = 6, INK_PX = 0.55, SAT = 1.7, block = new Float32Array(PIX * PIX * 4);
    function renderPixels() {
      for (let by = 0; by < PIX; by++) {
        const y0 = Math.floor(by * S / PIX), y1 = Math.floor((by + 1) * S / PIX);
        for (let bx = 0; bx < PIX; bx++) {
          const x0 = Math.floor(bx * S / PIX), x1 = Math.floor((bx + 1) * S / PIX);
          let r = 0, g = 0, b = 0, ink = 0, n = 0;
          for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
            const d = dist[y * S + x], ci = ((y >> 1) * HS + (x >> 1)) * 3;
            r += col[ci]; g += col[ci + 1]; b += col[ci + 2]; ink += d < 0 ? 1 : d > 1 ? 0 : 1 - d; n++;
          }
          const o = (by * PIX + bx) * 4; block[o] = r / n; block[o + 1] = g / n; block[o + 2] = b / n; block[o + 3] = ink / n;
        }
      }
      // contrast: stretch the frame's luminance to its own range (the decoded colour is pale), keeping the white paper white
      let lo = 1, hi = 0;
      for (let o = 0; o < block.length; o += 4) { const L = 0.299 * block[o] + 0.587 * block[o + 1] + 0.114 * block[o + 2]; if (L < lo) lo = L; if (L > hi) hi = L; }
      const span = Math.max(0.25, hi - lo), q = (v) => Math.round((v < 0 ? 0 : v > 1 ? 1 : v) * (LEVELS - 1)) * 255 / (LEVELS - 1);
      const dark = document.documentElement.dataset.theme === 'dark';
      for (let o = 0; o < block.length; o += 4) {
        const k = 1 - INK_PX * Math.min(1, Math.max(0, 3 * block[o + 3] - 0.35)), m = (block[o] + block[o + 1] + block[o + 2]) / 3;
        for (let c = 0; c < 3; c++) g8[o + c] = q(((m + SAT * (block[o + c] - m)) - lo) / span * k);
        if (dark && g8[o] === 255 && g8[o + 1] === 255 && g8[o + 2] === 255) g8[o] = g8[o + 1] = g8[o + 2] = 0; // paper follows the page
        g8[o + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
    }
    function render() {
      if (MODE === 'pixels') return renderPixels();
      autoLevels(); detectLines(INK);
      g32.fill(0xffffffff); occ.fill(0);
      const sc = W / S, r = 0.42 * sp * sc, minD2 = sp * sp * 0.8;
      const tryDot = (x, y, fx, fy, rr) => { // one dot unless another sits within the spacing radius
        const gx = (x / sp) | 0, gy = (y / sp) | 0;
        for (let j = Math.max(0, gy - 1); j <= Math.min(gw - 1, gy + 1); j++) for (let i = Math.max(0, gx - 1); i <= Math.min(gw - 1, gx + 1); i++) {
          const k = j * gw + i; if (!occ[k]) continue;
          const dx = dotsX[k] - x, dy = dotsY[k] - y; if (dx * dx + dy * dy < minD2) return;
        }
        const k = gy * gw + gx; occ[k] = 1; dotsX[k] = x; dotsY[k] = y;
        dotColour(fx, fy); stampDot(fx * sc, fy * sc, rr, dotC[0], dotC[1], dotC[2]);
      };
      for (let y = 1; y < S - 1; y++) for (let x = 1; x < S - 1; x++) { const i = y * S + x; if (lineMask[i]) tryDot(x, y, x + 0.5 + offX[i], y + 0.5 + offY[i], r); }
      const rt = r * 0.9;
      for (let y = 1; y < S - 1; y++) for (let x = 1; x < S - 1; x++) { // darkness^1.4 against gradient noise, jittered
        let dark = 1 - tone[(y >> 1) * HS + (x >> 1)]; dark = dark < 0 ? 0 : dark > 1 ? 1 : dark;
        if (POW14[(dark * 255 + 0.5) | 0] <= noise(x, y)) continue;
        tryDot(x, y, x + 0.5 + (noise(x + 31, y + 17) - 0.5) * 0.9, y + 0.5 + (noise(x + 7, y + 41) - 0.5) * 0.9, rt * (0.7 + 0.5 * dark));
      }
      ctx.putImageData(img, 0, 0);
    }

    // ---- endless walk: Catmull-Rom spline through the objects' codes, a soft wavy sweep between them, a light breathing drift
    const CLASS_SIM = Array.isArray(meta.class_sim) ? meta.class_sim : null, visited = [];
    const sigDist = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) { const t = a[i] - b[i]; s += t * t; } return s; };
    function pickWaypoint(from) {
      let w;
      if (!from) w = flat[(Math.random() * flat.length) | 0];
      else {
        let pool = flat.filter((x) => !visited.includes(x.id) && x.id !== from.id); if (!pool.length) pool = flat.filter((x) => x.id !== from.id); if (!pool.length) pool = flat;
        let cand = Math.random() < 0.75 ? pool.filter((x) => x.c === from.c) : [];
        if (!cand.length) { // leave the class for one of its two closest classes (CLIP similarity)
          const order = CLASS_SIM ? CLASS_SIM[from.c].map((v, j) => [v, j]).filter((p) => p[1] !== from.c && pool.some((x) => x.c === p[1])).sort((a, b) => b[0] - a[0]).slice(0, 2).map((p) => p[1]) : null;
          cand = order ? pool.filter((x) => order.includes(x.c)) : pool;
          if (!cand.length) cand = pool;
        }
        const near = cand.map((x) => [sigDist(from.sig, x.sig), x]).sort((p, q) => p[0] - q[0]).slice(0, 4); w = near[(Math.random() * near.length) | 0][1];
      }
      visited.push(w.id); if (visited.length > flat.length >> 1) visited.shift();
      return w;
    }
    const wps = [pickWaypoint(null)]; for (let i = 0; i < 3; i++) wps.push(pickWaypoint(wps[wps.length - 1]));
    const zBuf = new Float32Array(D);
    let segT = 0, segN = 0, sweepSeg = -1, sweepOrder = null;
    function sweepField() {
      const th = Math.random() * 6.283185, cx = Math.cos(th), cy = Math.sin(th), f1 = 1 + 2 * Math.random(), f2 = 1 + 2 * Math.random(), ph1 = 6.283185 * Math.random(), ph2 = 6.283185 * Math.random();
      const o = new Float32Array(G * G); let lo = 1e9, hi = -1e9;
      for (let gy = 0; gy < G; gy++) for (let gx = 0; gx < G; gx++) {
        const u = (gx + 0.5) / G - 0.5, v = (gy + 0.5) / G - 0.5;
        const p = u * cx + v * cy + 0.06 * (Math.sin(f1 * 6.283185 * (u * cy - v * cx) + ph1) + Math.sin(f2 * 6.283185 * (u + v) + ph2));
        o[gy * G + gx] = p; lo = Math.min(lo, p); hi = Math.max(hi, p);
      }
      for (let c = 0; c < o.length; c++) o[c] = (o[c] - lo) / (hi - lo); return o;
    }
    function spline(t, breathe, tsec) {
      const p0 = wps[0].z, p1 = wps[1].z, p2 = wps[2].z, p3 = wps[3].z;
      if (sweepSeg !== segN) { sweepOrder = sweepField(); sweepSeg = segN; }
      const tt = t * (1 + SWEEP_W);
      for (let c = 0, NC = G * G; c < NC; c++) {
        let tc = (tt - sweepOrder[c]) / SWEEP_W; tc = tc < 0 ? 0 : tc > 1 ? 1 : tc; tc = tc * tc * (3 - 2 * tc);
        const c2 = tc * tc, c3 = c2 * tc, o = c * K; let n1 = 0, n2 = 0, nm = 0;
        for (let i = o; i < o + K; i++) {
          const v = 0.5 * (2 * p1[i] + (-p0[i] + p2[i]) * tc + (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * c2 + (-p0[i] + 3 * p1[i] - 3 * p2[i] + p3[i]) * c3);
          zBuf[i] = v; n1 += p1[i] * p1[i]; n2 += p2[i] * p2[i]; nm += v * v;
        }
        if (tc > 0 && tc < 1) { const s = Math.min(2, ((1 - tc) * Math.sqrt(n1) + tc * Math.sqrt(n2)) / (Math.sqrt(nm) + 1e-6)); for (let i = o; i < o + K; i++) zBuf[i] *= s; }
        for (let i = o; i < o + K; i++) zBuf[i] += breathe * (Math.sin(0.31 * tsec + i) + Math.sin(0.17 * tsec + 2 * i) + Math.sin(0.11 * tsec + 3 * i)) / 3;
      }
      return zBuf;
    }
    const ease = (t) => t * t * t * (t * (t * 6 - 15) + 10);

    // ---- loop: one keyframe on the GPU at a time, frames in between interpolated; idle while hidden, paused or offscreen
    let keys = [], inFlight = 0, lastKick = 0, decEMA = 80, keyId = 0, lastSig = '', lastDraw = 0, raf = 0, ready = false;
    const running = () => !disposed && !failed && !paused && hostVisible && !document.hidden;
    function kick(now) {
      if (inFlight || now - lastKick < KEY_MS) return;
      const dt = lastKick ? Math.min((now - lastKick) / 1000, 0.25) : 0; lastKick = now;
      segT += dt * SPEED * (skip ? 8 : 1) / SEG_SECONDS;
      while (segT >= 1) { segT -= 1; segN++; wps.shift(); wps.push(pickWaypoint(wps[2])); skip = false; }
      const mid = 1 - Math.abs(2 * segT - 1), t0 = performance.now();
      const out = decode(spline(ease(segT), DRIFT * (0.4 + 0.6 * mid), now / 1000));
      inFlight++;
      out.data().then((f) => {
        decEMA = 0.85 * decEMA + 0.15 * (performance.now() - t0);
        const key = { id: ++keyId, t: now, f }; let j = keys.length;
        while (j > 0 && keys[j - 1].t > key.t) j--; keys.splice(j, 0, key); if (keys.length > 4) keys.shift();
      }, fail).finally(() => { out.dispose(); inFlight--; });
    }
    function frame(now) {
      raf = 0;
      if (!running()) return;
      raf = requestAnimationFrame(frame);
      kick(now);
      if (!keys.length || now - lastDraw < DRAW_MS) return;
      const tp = now - Math.min(400, decEMA * 1.3 + 16);
      let i = keys.length - 1; while (i > 0 && keys[i].t > tp) i--;
      const a = keys[i], b = keys[i + 1], al = b ? Math.min(1, Math.max(0, (tp - a.t) / (b.t - a.t))) : 0;
      const sig = a.id + ':' + (b ? b.id : 0) + ':' + al.toFixed(3) + ':' + W;
      if (sig === lastSig) return;
      lastSig = sig; lastDraw = now;
      if (!b || al <= 0) work.set(a.f); else { const fa = a.f, fb = b.f; for (let j = 0; j < work.length; j++) work[j] = fa[j] + (fb[j] - fa[j]) * al; }
      render();
      if (!ready) {
        ready = true;
        if (reduced.matches && qs.get('play') !== '1') paused = true;
        post('ready', { paused });
      }
    }
    repaint = () => { if (MODE === 'pixels' && ready) render(); };
    wake = () => { if (!raf && running()) { lastKick = 0; raf = requestAnimationFrame(frame); } };
    fit();
    wake();
    window.__pd = { get ready() { return ready; }, get keyMs() { return decEMA; }, get backend() { return tf.getBackend(); }, get paused() { return paused; } };
  }
  start().catch(fail);
})();
