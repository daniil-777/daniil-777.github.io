/**
 * The QR code is drawn by hand so it can have rounded modules. These checks
 * pin the two properties that were measured to decide whether it scans:
 * a four-module quiet zone, and square (unrounded) finder patterns.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import QRCode from 'qrcode';
import { qrSvg } from '../src/lib/qr.ts';

const url = 'https://demtsev.com/work/laparoscopic-skills-trainer/';
const svg = qrSvg(url);
const modules = QRCode.create(url, { errorCorrectionLevel: 'M' }).modules;
const viewBox = Number(svg.match(/viewBox="0 0 (\d+) \d+"/)?.[1]);

describe('qrSvg', () => {
  it('leaves a four-module quiet zone on every side', () => {
    assert.equal(viewBox, modules.size + 8);
    const xs = [...svg.matchAll(/<rect x="(\d+)" y="(\d+)" width="1"/g)].flatMap((m) => [Number(m[1]), Number(m[2])]);
    assert.ok(Math.min(...xs) >= 4, 'a module is drawn inside the quiet zone');
    assert.ok(Math.max(...xs) <= viewBox - 5, 'a module is drawn inside the quiet zone');
  });

  it('draws the three finder patterns as plain squares', () => {
    const finders = [...svg.matchAll(/<path fill-rule="evenodd" d="M(\d+) (\d+)h7v7h-7z/g)].map((m) => `${m[1]},${m[2]}`);
    const far = viewBox - 4 - 7;
    assert.deepEqual(finders, ['4,4', `${far},4`, `4,${far}`]);
    assert.equal([...svg.matchAll(/width="3" height="3"\/>/g)].length, 3, 'finder centres must not be rounded');
  });

  it('draws one rounded dot per dark data module', () => {
    const n = modules.size;
    const inFinder = (r: number, c: number) => (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);
    let expected = 0;
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (modules.get(r, c) && !inFinder(r, c)) expected++;
    assert.equal([...svg.matchAll(/width="1" height="1" rx="/g)].length, expected);
  });

  it('is dark on white whatever the page theme', () => {
    assert.match(svg, /<rect width="\d+" height="\d+" fill="#fff"\/>/);
    assert.match(svg, /<g fill="#1d1d1f">/);
  });
});
