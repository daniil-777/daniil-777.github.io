import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEVICE_MODE, LOCAL_LLM } from '../../src/data/chat.ts';
import { isMobile, offerModes, type Capabilities } from '../../src/lib/chat/modes.ts';

const GB = 1024 ** 3;
/** A desktop Chrome with a capable GPU, everything allowed. */
const desktop: Capabilities = {
  deviceMode: 'all',
  hasEndpoint: true,
  builtinAvailable: true,
  gpuAdapter: true,
  shaderF16: true,
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36',
  platform: 'MacIntel',
  uaMobile: false,
  maxTouchPoints: 0,
  pointerFine: true,
  saveData: false,
  effectiveType: '4g',
  deviceMemory: 8,
  quotaFree: 50 * GB,
  modelBytes: LOCAL_LLM.bytes,
};
const offer = (patch: Partial<Capabilities> = {}) => offerModes({ ...desktop, ...patch });

describe('offerModes', () => {
  it('ships with on-device generation switched off', () => assert.equal(DEVICE_MODE, 'off'));

  it('offers everything to a capable desktop when the owner allows it', () => {
    assert.deepEqual(offer(), { quotes: true, cloud: true, builtin: true, webgpu: 'q4f16', semantic: true });
  });

  it('offers no on-device generation while the mode is off, whatever the device', () => {
    const off = offer({ deviceMode: 'off' });
    assert.equal(off.builtin, false);
    assert.equal(off.webgpu, false);
    assert.equal(off.quotes, true);
  });

  it('offers only the built-in model in `builtin` mode', () => {
    assert.deepEqual([offer({ deviceMode: 'builtin' }).builtin, offer({ deviceMode: 'builtin' }).webgpu], [true, false]);
    assert.equal(offer({ deviceMode: 'builtin', builtinAvailable: false }).builtin, false);
  });

  it('offers the cloud only when an endpoint was configured', () => assert.equal(offer({ hasEndpoint: false }).cloud, false));

  const phones: [string, Partial<Capabilities>][] = [
    ['an iPhone', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1', platform: 'iPhone', maxTouchPoints: 5, pointerFine: false, uaMobile: undefined }],
    ['an iPad reporting as a Mac', { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/19.0 Safari/605.1.15', platform: 'MacIntel', maxTouchPoints: 5, pointerFine: false, uaMobile: undefined }],
    ['an Android phone', { userAgent: 'Mozilla/5.0 (Linux; Android 16; Pixel 10) AppleWebKit/537.36 Chrome/154.0.0.0 Mobile Safari/537.36', platform: 'Linux armv81', uaMobile: true, maxTouchPoints: 5, pointerFine: false }],
    ['an Android tablet with a mouse', { userAgent: 'Mozilla/5.0 (Linux; Android 16; Tablet) AppleWebKit/537.36 Chrome/154.0.0.0 Safari/537.36', platform: 'Linux armv81', pointerFine: true }],
    ['a touch-only device', { pointerFine: false }],
  ];
  for (const [name, patch] of phones) {
    it(`never offers on-device generation on ${name}`, () => {
      assert.equal(isMobile({ ...desktop, ...patch }), true);
      assert.equal(offer(patch).webgpu, false);
      assert.equal(offer(patch).builtin, false);
      assert.equal(offer(patch).quotes, true);
    });
  }

  it('does not offer the downloadable model in Firefox', () => {
    assert.equal(offer({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0', platform: 'Linux x86_64', uaMobile: undefined }).webgpu, false);
  });

  it('respects Save-Data and slow connections', () => {
    assert.deepEqual([offer({ saveData: true }).webgpu, offer({ saveData: true }).semantic], [false, false]);
    for (const effectiveType of ['slow-2g', '2g', '3g']) assert.equal(offer({ effectiveType }).semantic, false, effectiveType);
    assert.equal(offer({ effectiveType: undefined, saveData: undefined }).semantic, true);
  });

  it('needs 8 GB of memory, where the browser reports it', () => {
    assert.equal(offer({ deviceMemory: 4 }).webgpu, false);
    assert.equal(offer({ deviceMemory: undefined }).webgpu, 'q4f16');
  });

  it('needs free storage for twice the model, and a known quota', () => {
    assert.equal(offer({ quotaFree: 2 * LOCAL_LLM.bytes.q4f16 }).webgpu, 'q4f16');
    assert.equal(offer({ quotaFree: 2 * LOCAL_LLM.bytes.q4f16 - 1 }).webgpu, false);
    assert.equal(offer({ quotaFree: undefined }).webgpu, false);
  });

  it('falls back to the q4 weights without shader-f16, and needs a GPU adapter at all', () => {
    assert.equal(offer({ shaderF16: false }).webgpu, 'q4');
    assert.equal(offer({ shaderF16: false, quotaFree: 2 * LOCAL_LLM.bytes.q4 - 1 }).webgpu, false);
    assert.equal(offer({ gpuAdapter: false }).webgpu, false);
  });
});
