/** Isolated local Chromium/CDP helper for screenshots and browser checks, with no profile access. */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';

export async function startBrowser(url, options = {}) {
  const profile = await mkdtemp(join(tmpdir(), 'chronos-browser-'));
  const chrome = options.chrome ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const browser = spawn(chrome, ['--headless=new', '--no-first-run', '--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${profile}`, url], { stdio: 'ignore' });
  let socket;
  const close = async () => { socket?.close(); browser.kill(); await new Promise(r => setTimeout(r, 100)); await rm(profile, { recursive: true, force: true }); };
  try {
    let port;
    for (let attempt = 0; attempt < 200; attempt++) {
      try { port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break; }
      catch { await new Promise(r => setTimeout(r, 50)); }
    }
    if (!port) throw new Error('Chrome debugging endpoint unavailable');
    const tabs = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    const tab = tabs.find(t => t.type === 'page');
    socket = new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    let sequence = 0;
    const pending = new Map();
    socket.onmessage = event => {
      const message = JSON.parse(event.data);
      if (message.id && pending.has(message.id)) {
        const { resolve, reject, timer } = pending.get(message.id); pending.delete(message.id); clearTimeout(timer);
        if (message.error) reject(new Error(JSON.stringify(message.error))); else resolve(message.result);
      }
    };
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timed out: ${method}`)); }, 60000);
      pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
    });
    await send('Page.enable');
    await send('Runtime.enable');
    if (options.width) await send('Emulation.setDeviceMetricsOverride', { width: options.width, height: options.height ?? 900, deviceScaleFactor: options.deviceScaleFactor ?? 1, mobile: options.mobile ?? false });
    const evaluate = async expression => {
      const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    return { send, evaluate, screenshot: async () => Buffer.from((await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })).data, 'base64'), close };
  } catch (error) { await close(); throw error; }
}
