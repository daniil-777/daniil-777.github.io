#!/usr/bin/env node
/**
 * Turns the raw recordings referenced in src/content/projects/*.md into web media.
 *
 *   npm run media              transcode anything new or changed
 *   npm run media -- --force   redo everything
 *   npm run media -- astro-pilot lap-stratafix    only these video ids
 *
 * For every `videos[]` entry it writes
 *   public/media/video/<id>.mp4     1080p H.264, streamable
 *   public/media/small/<id>.mp4     the same at 960px wide, for phones
 *   public/media/preview/<id>.mp4   short silent loop for cards
 *   src/assets/posters/<id>.jpg     poster frame (optimised again by Astro)
 * and records dimensions and duration in src/data/media.json.
 * It also cuts the hero showreel defined in src/data/showreel.json, with a 960px copy for phones.
 *
 * An output is rebuilt when its file is missing, or when something it depends
 * on has changed: the source recording, `posterAt`, `previewAt`, `audio`, or
 * the encoding settings below. So editing `posterAt` regenerates only the poster.
 *
 * Requires ffmpeg and ffprobe on PATH.
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { parse as parseYaml } from 'yaml';
import sharp from 'sharp';

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const at = (...p) => path.join(root, ...p);

const args = process.argv.slice(2);
const force = args.includes('--force');
const only = new Set(args.filter((a) => !a.startsWith('--')));

const FULL = { maxWidth: 1920, fps: 30, crf: 25, maxrate: '4500k', bufsize: '9000k' };
const SMALL = { maxWidth: 960, fps: 30, crf: 27, maxrate: '1400k', bufsize: '2800k' };
const PREVIEW = { width: 960, fps: 24, crf: 30, seconds: 6 };
const REEL = { width: 1600, height: 900, fps: 30, crf: 26, fade: 0.5 };
const REEL_SMALL = { width: 960, crf: 28 };

/**
 * Runs ffmpeg into a temporary file and renames it into place. An interrupted
 * run therefore never leaves a half-written file that looks finished.
 */
async function ffmpegTo(out, argv) {
  const partial = out.replace(/(\.\w+)$/, '.partial$1');
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', ...argv, partial], { maxBuffer: 1 << 26 });
  if (!existsSync(partial)) throw new Error(`ffmpeg wrote nothing for ${path.relative(root, out)}`);
  await rename(partial, out);
}

async function probe(file) {
  const { stdout } = await run('ffprobe', [
    '-v', 'error', '-show_entries', 'stream=codec_type,width,height:format=duration',
    '-of', 'json', file,
  ]);
  const info = JSON.parse(stdout);
  const video = info.streams.find((s) => s.codec_type === 'video');
  return {
    width: video.width,
    height: video.height,
    duration: Math.round(Number(info.format.duration) * 10) / 10,
    hasAudio: info.streams.some((s) => s.codec_type === 'audio'),
  };
}

const fingerprint = (value) => createHash('sha1').update(JSON.stringify(value)).digest('hex').slice(0, 12);

async function readProjects() {
  const dir = at('src/content/projects');
  const files = (await readdir(dir)).filter((f) => f.endsWith('.md'));
  const videos = [];
  for (const file of files) {
    const text = await readFile(path.join(dir, file), 'utf8');
    const match = text.match(/^---\n([\s\S]*?)\n---/);
    if (!match) throw new Error(`${file}: missing frontmatter`);
    const data = parseYaml(match[1]);
    for (const v of data.videos ?? []) videos.push({ ...v, project: file.replace(/\.md$/, '') });
  }
  return videos;
}

/** @param previous this video's entry from the last run, if any */
async function transcode(video, previous) {
  const src = at(video.source);
  if (!existsSync(src)) throw new Error(`${video.id}: source not found: ${video.source}`);
  const out = {
    full: at('public/media/video', `${video.id}.mp4`),
    small: at('public/media/small', `${video.id}.mp4`),
    preview: at('public/media/preview', `${video.id}.mp4`),
    poster: at('src/assets/posters', `${video.id}.jpg`),
  };
  const info = await probe(src);
  const keepAudio = video.audio !== false && info.hasAudio;
  // Seeking past the end yields no frame at all, so stay inside the clip.
  const posterAt = Math.min(video.posterAt ?? 1, Math.max(info.duration - 0.2, 0));
  const previewAt = Math.min(video.previewAt ?? 0, Math.max(info.duration - PREVIEW.seconds, 0));

  // Optional `crop` (source pixels per edge) is applied before scaling, to all three outputs.
  const { top = 0, bottom = 0, left = 0, right = 0 } = video.crop ?? {};
  const crop = top || bottom || left || right ? `crop=iw-${left + right}:ih-${top + bottom}:${left}:${top},` : '';

  // What each output depends on. A change to any of it rebuilds just that output.
  const source = [video.source, (await stat(src)).size, crop];
  const sig = {
    full: fingerprint([source, keepAudio, FULL]),
    small: fingerprint([source, keepAudio, SMALL]),
    preview: fingerprint([source, previewAt, PREVIEW]),
    poster: fingerprint([source, posterAt]),
  };
  // Entries written before signatures were recorded are taken as current, once.
  const known = previous?.sig ?? (previous ? sig : {});
  /** The 1080p and the phone rendition differ only in their settings. */
  const encode = (target, settings) => ffmpegTo(target, [
    '-i', src,
    '-vf', `${crop}scale='min(${settings.maxWidth},iw)':-2:flags=lanczos,fps=${settings.fps},format=yuv420p`,
    '-c:v', 'libx264', '-preset', 'medium', '-profile:v', 'high', '-crf', String(settings.crf),
    '-maxrate', settings.maxrate, '-bufsize', settings.bufsize,
    ...(keepAudio ? ['-c:a', 'aac', '-b:a', '128k', '-ac', '2'] : ['-an']),
    '-movflags', '+faststart',
  ]);
  const stale = (key) => force || !existsSync(out[key]) || known[key] !== sig[key];

  if (stale('full')) {
    console.log(`  video    ${video.id}`);
    await encode(out.full, FULL);
  }
  if (stale('small')) {
    console.log(`  small    ${video.id}`);
    await encode(out.small, SMALL);
  }
  if (stale('preview')) {
    console.log(`  preview  ${video.id}`);
    await ffmpegTo(out.preview, [
      '-ss', String(previewAt), '-t', String(PREVIEW.seconds), '-i', src,
      '-vf', `${crop}scale=${PREVIEW.width}:-2:flags=lanczos,fps=${PREVIEW.fps},format=yuv420p`,
      '-c:v', 'libx264', '-preset', 'slow', '-crf', String(PREVIEW.crf), '-an',
      '-movflags', '+faststart',
    ]);
  }
  if (stale('poster')) {
    console.log(`  poster   ${video.id}`);
    await ffmpegTo(out.poster, [
      '-ss', String(posterAt), '-i', src, '-frames:v', '1',
      '-vf', `${crop}scale='min(1920,iw)':-2:flags=lanczos`, '-q:v', '3',
    ]);
  }

  const done = await probe(out.full);
  return {
    src: `/media/video/${video.id}.mp4`,
    small: `/media/small/${video.id}.mp4`,
    preview: `/media/preview/${video.id}.mp4`,
    width: done.width,
    height: done.height,
    duration: done.duration,
    audio: done.hasAudio,
    sig,
  };
}

/** Cross-fades the clips listed in src/data/showreel.json into one silent loop. */
async function showreel() {
  const clips = JSON.parse(await readFile(at('src/data/showreel.json'), 'utf8'));
  const out = at('public/media/showreel.mp4');
  const poster = at('src/assets/posters/showreel.jpg');
  const sources = clips.map((c) => at(c.source));
  const newest = Math.max(...(await Promise.all(sources.map(async (s) => (await stat(s)).mtimeMs))));
  const configTime = Math.max((await stat(at('src/data/showreel.json'))).mtimeMs, (await stat(fileURLToPath(import.meta.url))).mtimeMs);
  const fresh = !force && existsSync(out) && (await stat(out)).mtimeMs > Math.max(newest, configTime);

  if (!fresh) {
    console.log('  showreel');
    const inputs = clips.flatMap((c) => ['-ss', String(c.start), '-t', String(c.duration), '-i', at(c.source)]);
    // Rasterise typography once; labels become part of the video on every device.
    const escape = (text) => text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
    const labelDir = at('public/media/reel-labels');
    await mkdir(labelDir, { recursive: true });
    for (const [i, clip] of clips.entries()) {
      const label = path.join(labelDir, `${i}.png`);
      const svg = `<svg width="1600" height="900" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="shade" x2="0" y2="1"><stop stop-color="#071018" stop-opacity=".95"/><stop offset="1" stop-color="#071018" stop-opacity="0"/></linearGradient></defs><rect width="1600" height="230" fill="url(#shade)"/><rect x="56" y="54" width="5" height="104" rx="2" fill="#86e4ce"/><text x="82" y="86" fill="#b7cec9" font-family="Helvetica,Arial,sans-serif" font-size="26" font-weight="600">${escape(clip.label)}</text><text x="82" y="142" fill="white" font-family="Helvetica,Arial,sans-serif" font-size="42" font-weight="700">${escape(clip.technology)}</text></svg>`;
      await sharp(Buffer.from(svg)).png().toFile(label);
      inputs.push('-loop', '1', '-i', label);
    }
    // Keep an instructional sidebar in view when a clip explicitly requests the full frame.
    const fit = (clip) => {
      const contain = clip.fit === 'contain';
      const frame = contain ? `pad=${REEL.width}:${REEL.height}:(ow-iw)/2:(oh-ih)/2` : `crop=${REEL.width}:${REEL.height}`;
      return `scale=${REEL.width}:${REEL.height}:force_original_aspect_ratio=${contain ? 'decrease' : 'increase'}:force_divisible_by=2:flags=lanczos:out_range=tv,${frame},fps=${REEL.fps},format=yuv420p,setsar=1,setpts=PTS-STARTPTS`;
    };
    const filters = clips.flatMap((clip, i) => [
      `[${i}:v]${fit(clip)}[base${i}]`,
      `[base${i}][${clips.length + i}:v]overlay=shortest=1:format=auto,format=yuv420p[c${i}]`,
    ]);
    let last = 'c0';
    let offset = 0;
    for (let i = 1; i < clips.length; i++) {
      offset += clips[i - 1].duration - REEL.fade;
      filters.push(`[${last}][c${i}]xfade=transition=fade:duration=${REEL.fade}:offset=${offset.toFixed(2)}[x${i}]`);
      last = `x${i}`;
    }
    await ffmpegTo(out, [
      ...inputs, '-filter_complex', filters.join(';'), '-map', `[${last}]`,
      // xfade renegotiates the pixel format (the sources mix ranges); without this the
      // reel comes out as High 4:4:4, which phone decoders are not required to play.
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-preset', 'slow', '-crf', String(REEL.crf), '-an',
      '-movflags', '+faststart',
    ]);
  }
  if (!fresh || !existsSync(poster)) await ffmpegTo(poster, ['-i', out, '-frames:v', '1', '-q:v', '3']);
  const small = at('public/media/showreel-small.mp4');
  if (!fresh || !existsSync(small)) {
    console.log('  showreel (small)');
    await ffmpegTo(small, [
      '-i', out, '-vf', `scale=${REEL_SMALL.width}:-2:flags=lanczos,format=yuv420p`,
      '-c:v', 'libx264', '-profile:v', 'high', '-preset', 'slow', '-crf', String(REEL_SMALL.crf), '-an',
      '-movflags', '+faststart',
    ]);
  }
}

async function main() {
  for (const dir of ['public/media/video', 'public/media/small', 'public/media/preview', 'src/assets/posters']) {
    await mkdir(at(dir), { recursive: true });
  }
  const manifestPath = at('src/data/media.json');
  const manifest = existsSync(manifestPath) ? JSON.parse(await readFile(manifestPath, 'utf8')) : {};

  const videos = await readProjects();
  const ids = videos.map((v) => v.id);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dupes.length) throw new Error(`duplicate video ids: ${[...new Set(dupes)].join(', ')}`);

  for (const video of videos) {
    if (only.size && !only.has(video.id)) continue;
    console.log(`${video.project} / ${video.id}`);
    manifest[video.id] = await transcode(video, manifest[video.id]);
    // Written after every video so an interrupted run keeps its progress.
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }
  for (const id of Object.keys(manifest)) if (!ids.includes(id)) delete manifest[id];
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  if (!only.size || only.has('showreel')) await showreel();
  console.log('media: done');
}

main().catch((err) => {
  console.error(`media: ${err.stderr || err.message}`);
  process.exit(1);
});
