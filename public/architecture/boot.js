/* Model downloads start only when this opt-in document is mounted. */
(function () {
  'use strict';
  const qs = new URLSearchParams(location.search);
  if (qs.get('compact') === '1') document.documentElement.dataset.compact = 'true';
  document.documentElement.dataset.theme = qs.get('theme') === 'dark' ? 'dark' : 'light';
  const cdn = 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-backend-';
  window.__M3D_BE = {
    webgpu: [cdn + 'webgpu@4.22.0/dist/tf-backend-webgpu.min.js', 'sha384-0cz8Hmjyhn7MyeyzI7MSTOuEdxiSNiwpDDPakM6XjdtC/Fb5/qRxkmLrTJROQqjQ'],
    webgl: [cdn + 'webgl@4.22.0/dist/tf-backend-webgl.min.js', 'sha384-PAbE0QuTSZkDuS/hX4MEx1MZ0Nwd+mkb2Znz35ZqGDjb36klpR8/mCpykhdd7uHW'],
  };
  // the backend m3d-app.js will try first downloads now, beside tf-core and the model, instead of after them
  const first = window.__M3D_BE[navigator.gpu && qs.get('backend') !== 'webgl' ? 'webgpu' : 'webgl'], hint = document.createElement('link');
  Object.assign(hint, { rel: 'preload', as: 'script', href: first[0], integrity: first[1], crossOrigin: 'anonymous' });
  document.head.append(hint);
  window.__tfLoadError = null;
  const progress = window.__M3D_PROG = { got: 0, total: 0 };
  const get = async (name, json = false) => {
    const response = await fetch('model/' + name);
    if (!response.ok) throw new Error('The model download failed: ' + response.status);
    const size = Number(response.headers.get('content-length')) || 0;
    progress.total += size;
    const buffer = await response.arrayBuffer();
    progress.got += buffer.byteLength;
    return json ? JSON.parse(new TextDecoder().decode(buffer)) : buffer;
  };
  window.__M3D_FETCH = { dir: 'model', meta: get('meta.json', true), decoder: get('decoder.bin.gz'), a0: get('anchors-0.bin.gz'), map: get('map.json', true), sources: get('sources.json', true) };
  for (const promise of Object.values(window.__M3D_FETCH)) if (promise?.catch) promise.catch(() => {});
})();
