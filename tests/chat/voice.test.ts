import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { insertTranscript, monoAudio, WHISTLE } from '../../src/lib/chat/voice.ts';

test('dictation preserves a draft and inserts at its selected text', () => {
  assert.deepEqual(insertTranscript('Ask about work', 'Daniil’s research', 10, 14, 2000), { value: 'Ask about Daniil’s research', caret: 27, truncated: false });
  assert.equal(insertTranscript('Before after', 'spoken text', 7, 7, 2000).value, 'Before spoken text after');
  assert.equal(insertTranscript('Existing draft', '  ', 14, 14, 2000).value, 'Existing draft');
  assert.equal(insertTranscript('Explain ().', 'the project', 9, 9, 2000).value, 'Explain (the project).');
});

test('dictation respects the character limit without deleting the remaining draft', () => {
  const result = insertTranscript('ab cd', '123456', 3, 3, 9);
  assert.equal(result.value, 'ab 123 cd');
  assert.equal(result.value.length, 9);
  assert.equal(result.truncated, true);
  assert.equal(result.caret, 7);
  assert.equal(insertTranscript('full', 'more', 4, 4, 4).value, 'full');
  assert.equal(insertTranscript('', '🙂', 0, 0, 1).value, '');
});

test('speech PCM mixes channels, clamps malformed samples, and caps recordings at 30 seconds', () => {
  const channels = [new Float32Array([0.4, -0.2, 5, NaN]), new Float32Array([0.2, 0.2, 5, 0])];
  const mixed = monoAudio({ sampleRate: 16000, length: 4, numberOfChannels: 2, getChannelData: (channel) => channels[channel] });
  assert.ok(Math.abs(mixed[0] - 0.3) < 0.00001);
  assert.deepEqual(Array.from(mixed.slice(1)), [0, 1, 0]);
  const long = new Float32Array(500000);
  assert.equal(monoAudio({ sampleRate: 16000, length: long.length, numberOfChannels: 1, getChannelData: () => long }).length, 480000);
  assert.throws(() => monoAudio({ sampleRate: 48000, length: 4, numberOfChannels: 2, getChannelData: (channel) => channels[channel] }), /format/);
});

test('bundled Whistle runtime, weights and license match the pinned release', () => {
  const directory = new URL('../../public/vendor/whistle/2026-10-02/', import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL('manifest.json', directory), 'utf8'));
  assert.equal(manifest.engineRevision, WHISTLE.engineRevision);
  assert.equal(manifest.modelRevision, WHISTLE.modelRevision);
  let total = 0;
  for (const file of manifest.files) {
    const bytes = readFileSync(new URL(file.name, directory));
    assert.equal(bytes.length, file.bytes, file.name);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256, file.name);
    if (file.name !== 'LICENSE') total += bytes.length;
  }
  assert.equal(total, WHISTLE.bytes);
});
