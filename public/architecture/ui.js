/* Compact portfolio UI for the original Pixel Morph neural renderer. */
(function (M) {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const qs = new URLSearchParams(location.search);
  const session = qs.get('session') || '';
  const explicitPlay = qs.get('play') === '1';
  const embedded = parent !== window;
  window.__HOST_VISIBLE = !embedded;
  const post = (type, extra = {}) => { if (embedded) parent.postMessage({ channel: 'portfolio-architecture', session, type, ...extra }, location.origin); };
  let disposed = false;
  const visibility = (active) => { window.__HOST_VISIBLE = active; if (M.app) M.app.st.hostVisible = active; };
  addEventListener('message', (event) => {
    if (disposed || event.source !== parent || event.origin !== location.origin) return;
    const data = event.data;
    if (!data || data.channel !== 'portfolio-architecture' || data.session !== session) return;
    if (data.type === 'visibility') visibility(data.active === true);
    if (data.type === 'focus') $('c')?.focus();
    if (data.type === 'toggle' && M.app) M.app.setPaused(!M.app.paused);
    if (data.type === 'next' && M.app) M.app.next();
    if (data.type === 'theme') {
      const dark = data.theme === 'dark';
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
      if (M.app) M.app.R3.paper = dark ? [0, 0, 0] : [1, 1, 1];
      // An unchanged paused frame needs one repaint for a changed background.
      if (M.app) M.app.lastA = null;
    }
    if (data.type === 'dispose') dispose();
  });
  function dispose() {
    if (disposed) return;
    disposed = true;
    visibility(false);
    clearInterval(watch);
    if (M.app) M.app.st.failed = true;
    try { M.app?.R3.gl.getExtension('WEBGL_lose_context')?.loseContext(); } catch {}
    try { if (window.tf?.getBackend() === 'webgpu') window.tf.backend().device.destroy(); } catch {}
  }
  addEventListener('pagehide', dispose);
  const watch = setInterval(() => {
    if (window.__m3d?.failed) { post('error'); clearInterval(watch); }
  }, 250);
  const rm = matchMedia('(prefers-reduced-motion: reduce)');

  M.UI = class {
    constructor(app) {
      this.app = app;
      this.sources = [];
      this.lastCredit = '';
      this.reportAt = 0;
      app.st.hostVisible = window.__HOST_VISIBLE;
      app.cam.dist = 3.5;
      app.R3.paper = document.documentElement.dataset.theme === 'dark' ? [0, 0, 0] : [1, 1, 1];
      for (const [index, anchor] of app.meta.anchors.entries()) {
        const option = document.createElement('option');
        option.value = index;
        option.textContent = anchor.label[0].toUpperCase() + anchor.label.slice(1);
        $('building').append(option);
      }
      $('building').value = app.walker.cur;
      $('building').addEventListener('change', () => app.travel(Number($('building').value)));
      $('next').addEventListener('click', () => app.next());
      $('pause').addEventListener('click', () => app.setPaused(!app.paused));
      app.onpause = (paused) => { $('pause').textContent = paused ? 'Resume' : 'Pause'; $('pause').setAttribute('aria-pressed', String(paused)); post('playback', { paused }); };
      this.rotating = !rm.matches || explicitPlay;
      if (!this.rotating) app.setSpin(0);
      else if (qs.get('compact') === '1') app.setSpin(.6);
      $('rotate').setAttribute('aria-pressed', String(this.rotating));
      $('rotate').addEventListener('click', () => { this.rotating = !this.rotating; app.setSpin(this.rotating ? 1 : 0); $('rotate').setAttribute('aria-pressed', String(this.rotating)); });
      $('hd').addEventListener('click', () => { app.setHD(!app.hd); $('hd').setAttribute('aria-pressed', String(app.hd)); });
      $('save').addEventListener('click', () => app.savePNG('daniil-emtsev-neural-architecture.png'));
      $('c').addEventListener('keydown', (event) => {
        const key = event.key;
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '-', ' '].includes(key)) return;
        event.preventDefault();
        if (key === ' ') app.setPaused(!app.paused);
        if (key === 'ArrowLeft') app.cam.az -= .15;
        if (key === 'ArrowRight') app.cam.az += .15;
        if (key === 'ArrowUp') app.cam.el = Math.min(1.2, app.cam.el + .1);
        if (key === 'ArrowDown') app.cam.el = Math.max(-.2, app.cam.el - .1);
        if (key === '+') app.cam.dist = Math.max(2.6, app.cam.dist - .3);
        if (key === '-') app.cam.dist = Math.min(7, app.cam.dist + .3);
      });
      window.__M3D_FETCH.sources.then((sources) => { this.sources = sources; this.lastCredit = ''; }).catch(() => {});
      rm.addEventListener('change', () => { if (rm.matches) app.setPaused(true); });
    }
    style() { return 'lit'; }
    firstFrame() {
      for (const element of document.querySelectorAll('button,select')) element.disabled = false;
      if (rm.matches && !explicitPlay) this.app.setPaused(true);
      post('ready', { paused: this.app.paused });
    }
    frame(shown) {
      const app = this.app;
      const indices = [...new Set([...shown.A.spec.terms, ...shown.B.spec.terms].map(([index]) => index))];
      const signature = indices.join(',');
      $('label').textContent = shown.A.spec.label;
      if (signature !== this.lastCredit) {
        this.lastCredit = signature;
        $('credit').replaceChildren();
        for (const index of indices) {
          const source = this.sources[index];
          if (!source) continue;
          const link = document.createElement('a');
          link.textContent = `${source.name} — ${source.author} (CC BY)`;
          if (/^https:\/\/sketchfab\.com\/3d-models\/[a-f0-9]+$/i.test(source.url)) link.href = source.url;
          link.target = '_blank'; link.rel = 'noopener';
          if ($('credit').childNodes.length) $('credit').append(' · ');
          $('credit').append(link);
        }
      }
      if (performance.now() > this.reportAt) {
        this.reportAt = performance.now() + 1000;
        $('metrics').textContent = app.paused ? `Paused · ${app.st.backend === 'webgpu' ? 'WebGPU' : 'WebGL'}` : `${app.st.fps} fps · ${app.st.backend === 'webgpu' ? 'WebGPU' : 'WebGL'}`;
      }
    }
  };
})(window.M3D = window.M3D || {});
