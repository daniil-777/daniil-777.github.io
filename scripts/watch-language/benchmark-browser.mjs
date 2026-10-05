/** Real Chromium/WASM numerical benchmark; no browser framework dependency or cloud calls. */
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => v.startsWith('--') ? [...a, [v.slice(2), all[i + 1]]] : a, []));
const modelDir = resolve(args.model ?? '/tmp/chronos-language-feasibility');
const runtimeDir = resolve(args.runtime ?? 'node_modules/onnxruntime-web/dist');
const chrome = args.chrome ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const runtimeAssets = await Promise.all(['ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm'].map(async name => {
  const bytes = await readFile(join(runtimeDir, name)); return { name, sha256: createHash('sha256').update(bytes).digest('hex') };
}));
const html = `<!doctype html><title>Chronos browser numerical benchmark</title><script type="module">
import * as ort from '/runtime/ort.wasm.min.mjs';
window.result = (async () => {
ort.env.wasm.numThreads = 1; ort.env.wasm.proxy = false; ort.env.wasm.wasmPaths = '/runtime/';
const start = performance.now();
const runtimeAssets=${JSON.stringify(runtimeAssets)};
const checked=await Promise.all(runtimeAssets.map(async a=>{const bytes=await(await fetch('/runtime/'+a.name)).arrayBuffer();const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');if(hash!==a.sha256)throw Error('WASM runtime hash mismatch');return bytes;}));
ort.env.wasm.wasmPaths={mjs:new URL('/runtime/ort-wasm-simd-threaded.mjs',location.href).href};ort.env.wasm.wasmBinary=checked[1];
const bytes = await (await fetch('/model/model.fp32.onnx')).arrayBuffer();
const fixtures = await (await fetch('/model/parity-fixtures.json')).json();
const session = await ort.InferenceSession.create(bytes, {executionProviders:['wasm'],graphOptimizationLevel:'all'});
ort.env.wasm.wasmBinary=undefined;
const coldLoadMs = performance.now()-start;
let maximumError=0,greedyParity=true,cases=0; const timings=[];
for (const fixture of fixtures) {
 let input=fixture.inputIds,position=0;
 let past=new ort.Tensor('float32',new Float32Array(0),[4,2,1,2,0,32]);
 for (const reference of fixture.steps) {
  const ids=new ort.Tensor('int64',BigInt64Array.from(input,BigInt),[1,input.length]);
  const positions=new ort.Tensor('int64',BigInt64Array.from(input,(_,i)=>BigInt(position+i)),[1,input.length]);
  const maskData=new Float32Array(position+input.length).fill(1);
  if(fixture.paddingIndex!==null)maskData[fixture.paddingIndex]=0;
  const mask=new ort.Tensor('float32',maskData,[1,maskData.length]);
  const then=performance.now(); const output=await session.run({input_ids:ids,position_ids:positions,attention_mask:mask,past});
  timings.push(performance.now()-then);
  ids.dispose();positions.dispose();mask.dispose();past.dispose();past=output.present;
  const logits=output.logits.data.slice(-4096); let chosen=0;
  for(let i=0;i<4096;i++){maximumError=Math.max(maximumError,Math.abs(logits[i]-reference.lastLogits[i]));if(logits[i]>logits[chosen])chosen=i;}
  greedyParity &&= chosen===reference.tokenId;cases++;output.logits.dispose();
  position+=input.length;input=[chosen];
 }
 past.dispose();
}
await session.release();
return {passed:maximumError<0.0002&&greedyParity,absoluteTolerance:0.0002,runtimeVersion:'1.23.0',backend:'single-threaded CPU/WASM',runtimeHashesVerified:true,cases,maximumError,greedyParity,coldLoadMs,runMs:timings,modelBytes:bytes.byteLength,userAgent:navigator.userAgent,hardwareConcurrency:navigator.hardwareConcurrency,jsHeap:performance.memory?{used:performance.memory.usedJSHeapSize,total:performance.memory.totalJSHeapSize}:null,residentMemory:'Not measurable using standard browser APIs; JS heap excludes WASM and total resident memory.',gpuMlBytes:0};
})();
</script>`;
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/') { res.setHeader('Content-Type', 'text/html'); res.end(html); return; }
    const root = url.pathname.startsWith('/runtime/') ? runtimeDir : modelDir;
    const basename = url.pathname.split('/').at(-1);
    if (!basename || basename.includes('..')) throw Error('Invalid path');
    const bytes = await readFile(join(root, basename));
    res.setHeader('Content-Type', extname(basename) === '.wasm' ? 'application/wasm' : extname(basename) === '.mjs' ? 'application/javascript' : 'application/octet-stream');
    res.end(bytes);
  } catch { res.statusCode = 404; res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const profile = await mkdtemp(join(tmpdir(), 'chronos-browser-bench-'));
const browser = spawn(chrome, ['--headless=new', '--no-first-run', '--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${profile}`, `http://127.0.0.1:${port}/`], {stdio:'ignore'});
let socket;
try {
  let debugging;
  for(let i=0;i<200;i++) {
    try { debugging=(await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]; break; } catch { await new Promise(r=>setTimeout(r,50)); }
  }
  if(!debugging) throw Error('Chrome debugging endpoint unavailable');
  const tabs=await(await fetch(`http://127.0.0.1:${debugging}/json`)).json();
  const page=tabs.find(tab=>tab.type==='page');
  socket=new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r,j)=>{socket.onopen=r;socket.onerror=j;});
  let sequence=0; const pending=new Map();
  socket.onmessage=event=>{const msg=JSON.parse(event.data);if(msg.id&&pending.has(msg.id)){pending.get(msg.id)(msg);pending.delete(msg.id);}};
  const send=(method,params)=>new Promise(r=>{const id=++sequence;pending.set(id,r);socket.send(JSON.stringify({id,method,params}));});
  let ready=false;
  for(let attempt=0;attempt<200;attempt++) {
    const probe=await send('Runtime.evaluate',{expression:"typeof window.result !== 'undefined'",returnByValue:true});
    if(probe.result.result.value){ready=true;break;}
    await new Promise(r=>setTimeout(r,25));
  }
  if(!ready)throw Error('Benchmark page did not initialize');
  const result=await send('Runtime.evaluate',{expression:'window.result',awaitPromise:true,returnByValue:true});
  if(result.result.exceptionDetails)throw Error(JSON.stringify(result.result.exceptionDetails));
  const measured=result.result.result.value;
  const report={...measured,chromeVersion:execFileSync(chrome,['--version'],{encoding:'utf8'}).trim(),os:process.platform,architecture:process.arch,method:'Headless isolated Chrome profile; one WASM session; 15 cached-token parity runs. Not representative mobile hardware.'};
  if(args.output)await import('node:fs/promises').then(fs=>fs.writeFile(args.output,JSON.stringify(report,null,2)+'\n'));
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
  if(!report.passed)process.exitCode=1;
}finally{socket?.close();browser.kill();server.close();setTimeout(()=>rm(profile,{recursive:true,force:true}),200);}
