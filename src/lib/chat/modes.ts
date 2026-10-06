/**
 * Which answer modes a visitor is offered. A pure function of what the
 * browser reports, so every device class can be tested without a browser.
 */

export interface Capabilities {
  /** `DEVICE_MODE` from src/data/chat.ts. */
  deviceMode: 'off' | 'builtin' | 'all';
  /** Was `PUBLIC_CHAT_ENDPOINT` set at build time? */
  hasEndpoint: boolean;
  /** `LanguageModel.availability()` returned "available". */
  builtinAvailable: boolean;
  /** `navigator.gpu` exists and returned an adapter. */
  gpuAdapter: boolean;
  /** The adapter has the `shader-f16` feature. */
  shaderF16: boolean;
  userAgent: string;
  platform: string;
  /** `navigator.userAgentData?.mobile` */
  uaMobile?: boolean;
  maxTouchPoints: number;
  /** `matchMedia('(pointer: fine)')` matches. */
  pointerFine: boolean;
  saveData?: boolean;
  /** `navigator.connection?.effectiveType` */
  effectiveType?: string;
  /** `navigator.deviceMemory`, in GB. */
  deviceMemory?: number;
  /** Free storage quota in bytes, from `navigator.storage.estimate()`. */
  quotaFree?: number;
  /** Download size per variant of the on-device model. */
  modelBytes: { q4f16: number; q4: number };
}

export interface Offer {
  quotes: true;
  cloud: boolean;
  /** The browser's built-in model: no download. */
  builtin: boolean;
  /** The downloadable model and the variant this device can run, or false. */
  webgpu: false | 'q4f16' | 'q4';
  /** May "Smarter search" (a 30 MB download) be suggested? */
  semantic: boolean;
}

export function isMobile(caps: Pick<Capabilities, 'uaMobile' | 'userAgent' | 'platform' | 'maxTouchPoints' | 'pointerFine'>): boolean {
  if (caps.uaMobile === true) return true;
  if (/iPhone|iPad|Android/i.test(caps.userAgent)) return true;
  // An iPad asking for the desktop site reports itself as a Mac, with a touch screen.
  if (caps.platform === 'MacIntel' && caps.maxTouchPoints > 1) return true;
  return !caps.pointerFine;
}

export function offerModes(caps: Capabilities): Offer {
  const metered = caps.saveData === true;
  const slow = /^(?:slow-)?2g$|^3g$/.test(caps.effectiveType ?? '');
  let webgpu: Offer['webgpu'] = false;
  if (caps.deviceMode === 'all' && caps.gpuAdapter && !metered && !slow && (caps.deviceMemory === undefined || caps.deviceMemory >= 8)) {
    // Float32 activations avoid depending on half-precision shader quality.
    // Capability checks apply to phones and PCs alike; loading still runs a quality probe.
    const variant = 'q4';
    if (caps.quotaFree !== undefined && caps.quotaFree >= 2 * caps.modelBytes[variant]) webgpu = variant;
  }
  return {
    quotes: true,
    cloud: caps.hasEndpoint,
    builtin: caps.deviceMode !== 'off' && caps.builtinAvailable,
    webgpu,
    semantic: !metered && !slow,
  };
}
