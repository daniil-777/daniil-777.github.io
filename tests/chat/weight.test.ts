/**
 * A visitor who never opens the chat must not pay for it. Two things in the
 * source decide that, long before the sizes are measured on the build.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { normalise as chatNormalise } from '../../src/lib/chat/text.ts';
import { normalise } from '../../src/lib/filter.ts';
import { root } from './load.ts';

const sources = ['src/lib/chat', 'src/scripts/chat'].flatMap((dir) => readdirSync(path.join(root, dir)).map((file) => path.join(dir, file)));
const importsOf = (file: string) => [...readFileSync(path.join(root, file), 'utf8').matchAll(/^import\s+(type\s+)?[^;]*?from\s+'([^']+)'|^import\s+'([^']+)'/gm)].map((match) => ({ typeOnly: !!match[1], from: match[2] ?? match[3] }));

describe('the chat and the pages', () => {
  it('share no module except the player, which every page loads anyway', () => {
    // A module imported by both would be split into a chunk of its own: one more request on every page.
    const shared = /\/(filter|projects|documents|qr)\.ts$|\/scripts\/(site|catalog)\.ts$/;
    for (const file of sources) {
      for (const { typeOnly, from } of importsOf(file)) assert.ok(typeOnly || !shared.test(from), `${file} imports ${from}`);
    }
  });

  it('loads its stylesheet as text, so it is not added to every page', () => {
    const styles = sources.flatMap((file) => importsOf(file).map(({ from }) => from)).filter((from) => from.includes('.css'));
    assert.deepEqual(styles, ['../../styles/chat.css?inline']);
  });

  it('normalises text exactly as the catalogue search does', () => {
    for (const text of ['Zürich', 'São Paulo', 'ÉCOLE', 'naïve Café', 'C++ / WebGPU', 'İstanbul', '']) assert.equal(chatNormalise(text), normalise(text));
  });
});
