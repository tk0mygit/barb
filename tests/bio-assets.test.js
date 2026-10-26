import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BIO_VARIANTS, BIO_SOURCE_URLS } from '../src/audio/bio-source-assets.js';
import { BIO_SOURCE_IDS, validateBioManifest, validateBioWav } from '../src/audio/bio-source-validation.js';
import { verifyBioAssets } from '../scripts/verify-bio-assets.mjs';

const manifest = JSON.parse(readFileSync(new URL('../src/assets/audio/bio/manifest.json', import.meta.url)));
const valid = readFileSync(new URL(BIO_SOURCE_URLS['bird-a']));
const variant = BIO_VARIANTS[0];

test('all six delivered files and the original manifest retain SHA-256, PCM16 headers and exact durations', async () => {
  const result = await verifyBioAssets();
  assert.deepEqual(result.variants.map(v => v.id), BIO_SOURCE_IDS);
  assert.deepEqual(result.variants.map(v => v.durationSeconds), [2.1, 2.55, 2.85, 3.6, 4.1, 3.85]);
  assert.equal(result.wavBytes, 1680474);
  assert.equal(result.float32Bytes44100, 3360420);
  for (const row of result.variants) {
    assert.equal(row.sampleRate, 44100); assert.equal(row.channels, 1); assert.equal(row.bitsPerSample, 16);
  }
});

test('ID catalog and six distinct Vite URL literals are immutable and bind to the canonical file paths', () => {
  assert.deepEqual(Object.keys(BIO_SOURCE_URLS), BIO_SOURCE_IDS);
  assert.equal(new Set(Object.values(BIO_SOURCE_URLS)).size, 6);
  assert(Object.isFrozen(BIO_SOURCE_URLS)); assert(Object.isFrozen(BIO_VARIANTS));
  for (const v of BIO_VARIANTS) {
    assert(Object.isFrozen(v)); assert.equal(v.loop, false);
    assert.equal(new URL(BIO_SOURCE_URLS[v.id]).pathname,
      new URL(`../src/assets/audio/bio/wav/${v.id}.wav`, import.meta.url).pathname);
  }
});

test('manifest rejects missing/duplicate/foreign IDs, URL/path substitutions and inconsistent PCM metadata', () => {
  const bad = [
    m => m.variants.pop(), m => { m.variants[1] = m.variants[0]; },
    m => { m.variants[0].id = 'bird-d'; }, m => { m.variants[0].file = '../bird-a.wav'; },
    m => { m.variants[0].file = 'wav/bird-b.wav'; }, m => { m.variants[0].kind = 'suzumushi'; },
    m => { m.variants[0].loop = true; }, m => { m.variants[0].channels = 2; },
    m => { m.variants[0].sampleRate = 48000; }, m => { m.variants[0].frames = 0; },
    m => { m.variants[0].durationSeconds += .1; }, m => { m.variants[0].wavBytes--; },
    m => { m.variants[0].float32Bytes--; }, m => { m.variants[0].sha256 = 'invalid'; },
    m => { m.encoding = 'mp3'; }, m => { m.sampleRate = 48000; },
  ];
  for (const [index, mutate] of bad.entries()) {
    const copy = structuredClone(manifest); mutate(copy);
    assert.throws(() => validateBioManifest(copy), TypeError, `case ${index}`);
  }
  for (const m of [null, {}, { ...manifest, variants: [null, ...manifest.variants.slice(1)] }])
    assert.throws(() => validateBioManifest(m), TypeError);
});

test('WAV parser handles ArrayBuffer/views and rejects truncated data, damaged headers and invalid formats', () => {
  const accepted = validateBioWav(valid, variant);
  assert.equal(accepted.frames, 92610); assert.equal(accepted.dataOffset, 44);
  assert.deepEqual(validateBioWav(Uint8Array.from(valid).buffer, variant), accepted);
  const offsetView = Buffer.concat([Buffer.alloc(7), valid]).subarray(7);
  assert.deepEqual(validateBioWav(offsetView, variant), accepted);
  const bad = [Buffer.alloc(0), valid.subarray(0, 43), valid.subarray(0, -1), Buffer.concat([valid, Buffer.from([0])]),
    Buffer.alloc(1024 * 1024 + 1)];
  for (const [offset, value, size] of [[4, 20, 4], [16, 0xffffffff, 4], [20, 3, 2], [22, 2, 2],
    [24, 48000, 4], [28, 44100, 4], [32, 4, 2], [34, 8, 2], [40, 1, 4], [40, 0xffffffff, 4]]) {
    const bytes = Buffer.from(valid);
    if (size === 2) bytes.writeUInt16LE(value, offset); else bytes.writeUInt32LE(value, offset);
    bad.push(bytes);
  }
  for (const offset of [0, 8, 12, 36]) { const bytes = Buffer.from(valid); bytes.write('NOPE', offset); bad.push(bytes); }
  for (const [index, bytes] of bad.entries()) assert.throws(() => validateBioWav(bytes, variant), TypeError, `case ${index}`);
  for (const input of [null, {}, 'RIFF']) assert.throws(() => validateBioWav(input), TypeError);
  assert.throws(() => validateBioWav(valid, BIO_VARIANTS[1]), TypeError);
});

test('RIFF chunk bounds, padding, duplicate chunks and fmt-before-data are enforced', () => {
  const riff = (...chunks) => {
    const bytes = Buffer.concat([valid.subarray(0, 12), ...chunks]);
    bytes.writeUInt32LE(bytes.length - 8, 4); return bytes;
  };
  const fmt = valid.subarray(12, 36), data = valid.subarray(36);
  const junk = Buffer.from([74, 85, 78, 75, 1, 0, 0, 0, 42, 0]); // odd-sized chunk + pad
  assert.equal(validateBioWav(riff(junk, fmt, data)).frames, variant.frames);
  for (const bytes of [riff(fmt, fmt, data), riff(data, fmt), riff(fmt, data, data),
    riff(fmt), riff(fmt, data, Buffer.from([0])), riff(junk.subarray(0, -1), fmt, data)])
    assert.throws(() => validateBioWav(bytes), TypeError);
});
