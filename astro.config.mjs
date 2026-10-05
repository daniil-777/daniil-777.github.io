// @ts-check
import { defineConfig } from 'astro/config';
import { defaultClientConditions } from 'vite';

export default defineConfig({
  site: 'https://demtsev.com',
  // `dist/` in this folder already holds unrelated build artefacts, and
  // Astro empties its output directory on every build.
  outDir: './build',
  trailingSlash: 'always',
  build: {
    inlineStylesheets: 'auto',
  },
  devToolbar: { enabled: false },
  // A build writes hundreds of files; the dev server has no reason to react to them.
  vite: {
    server: { watch: { ignored: ['**/build/**'] } },
    // The assistant's optional on-device models run in a module worker. The extra
    // condition makes onnxruntime-web load its wasm from the CDN; without it a
    // 27 MB binary nobody requests is copied into the build.
    worker: { format: 'es' },
    environments: { client: { resolve: { conditions: ['onnxruntime-web-use-extern-wasm', ...defaultClientConditions] } } },
  },
});
