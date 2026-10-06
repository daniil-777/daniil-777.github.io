/** Test the shipped player in an isolated browser, including decoded audio samples. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { startBrowser } from './watch-language/browser-helper.mjs';

const base = (process.env.VIDEO_QA_URL ?? 'http://127.0.0.1:4368').replace(/\/+$/, '');
const output = process.env.VIDEO_QA_OUTPUT ?? '/tmp/ai-proctor-audio-browser-local';
await mkdir(output, { recursive: true });
const receipt = { url: base, checks: [] };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

for (const mobile of [false, true]) {
  for (const inline of [false, true]) {
    const browser = await startBrowser('about:blank', { width: mobile ? 390 : 1440, height: mobile ? 844 : 1000, mobile });
    const name = `${mobile ? 'mobile' : 'desktop'}-${inline ? 'inline' : 'dialog'}`;
    try {
      async function until(expression, timeout = 20000) {
        const deadline = Date.now() + timeout;
        while (Date.now() < deadline) {
          if (await browser.evaluate(expression)) return;
          await sleep(100);
        }
        throw new Error(`${name}: timed out: ${expression}`);
      }
      const selector = inline
        ? '[data-player][data-video*="ai-proctor-davos"] .player__btn'
        : '[data-video-open][data-video*="ai-proctor-davos"]';
      await browser.send('Page.navigate', { url: `${base}${inline ? '/work/ai-proctor/' : '/'}?video-audio-qa=${Date.now()}` });
      await until(`document.readyState === 'complete' && Boolean(document.querySelector(${JSON.stringify(selector)}))`);
      const point = await browser.evaluate(`(()=>{const button=document.querySelector(${JSON.stringify(selector)});button.scrollIntoView({block:'center'});const r=button.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);
      await browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
      await browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
      await until('Boolean(document.querySelector("mux-player")?.media?.nativeEl?.readyState >= 2)');
      await until('document.querySelector("mux-player").currentTime > 0.2');
      const result = await browser.evaluate(`(async()=>{
        const player=document.querySelector('mux-player');
        const video=player.media.nativeEl;
        const ctx=new AudioContext();
        const source=ctx.createMediaElementSource(video);
        const analyser=ctx.createAnalyser();analyser.fftSize=2048;
        source.connect(analyser);analyser.connect(ctx.destination);await ctx.resume();
        video.currentTime=3;
        await new Promise((resolve,reject)=>{video.addEventListener('seeked',resolve,{once:true});setTimeout(()=>reject(new Error('seek timed out')),10000);});
        await video.play();
        const samples=new Float32Array(analyser.fftSize);let peak=0;
        for(let i=0;i<40;i++){
          await new Promise(r=>setTimeout(r,100));analyser.getFloatTimeDomainData(samples);
          peak=Math.max(peak,...samples.map(Math.abs));
        }
        const result={src:video.currentSrc,muted:video.muted,volume:video.volume,paused:video.paused,currentTime:video.currentTime,
          duration:video.duration,decodedAudioBytes:video.webkitAudioDecodedByteCount,peakAudioSample:peak,error:video.error?.message??null};
        await ctx.close();return result;
      })()`);
      assert.equal(result.muted, false, `${name}: playback is unmuted`);
      assert.ok(result.volume > 0, `${name}: volume is audible`);
      assert.equal(result.paused, false, `${name}: playing`);
      assert.ok(result.currentTime > 5, `${name}: playback advances after seeking`);
      assert.ok(result.peakAudioSample > 0.001, `${name}: real non-silent audio is decoded`);
      assert.equal(result.error, null, `${name}: no media error`);
      assert.ok(result.src.includes(`/media/${mobile ? 'small' : 'video'}/ai-proctor-davos.mp4?v=`), `${name}: correct versioned rendition`);
      const { data } = await browser.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      await writeFile(`${output}/${name}.png`, Buffer.from(data, 'base64'));
      receipt.checks.push({ name, ...result });
      console.log(`${name}: PASS (audio peak ${result.peakAudioSample.toFixed(4)})`);
    } finally { await browser.close(); }
  }
}
await writeFile(`${output}/receipt.json`, `${JSON.stringify(receipt, null, 2)}\n`);
