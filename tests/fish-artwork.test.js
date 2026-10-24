import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { FISH_SPECIES } from '../src/game/fish-species.js';
import { validateFishImage } from '../scripts/lib/fish-image-validation.js';

// Production artwork requirements are deliberately stricter than the reusable
// SVG/PNG format validator. Decode actual alpha samples rather than treating
// the mere presence of an RGBA channel as evidence of a clear background.
function artworkPixels(bytes, width, height) {
  const chunks = [];
  for (let offset = 8; offset < bytes.length;) {
    const length = bytes.readUInt32BE(offset);
    chunks.push({ type: bytes.toString('ascii', offset + 4, offset + 8), data: bytes.subarray(offset + 8, offset + 8 + length) });
    offset += length + 12;
  }
  const srgb = chunks.filter(chunk => chunk.type === 'sRGB');
  assert.equal(srgb.length, 1, 'explicit sRGB color space');
  assert.equal(srgb[0].data.length, 1);
  assert.ok(srgb[0].data[0] <= 3, 'valid sRGB rendering intent');
  const encoded = inflateSync(Buffer.concat(chunks.filter(chunk => chunk.type === 'IDAT').map(chunk => chunk.data)));
  const stride = width * 4;
  const rgba = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = encoded[y * (stride + 1)];
    const start = y * stride;
    for (let x = 0; x < stride; x++) {
      const left = x >= 4 ? rgba[start + x - 4] : 0;
      const up = y ? rgba[start + x - stride] : 0;
      const corner = y && x >= 4 ? rgba[start + x - stride - 4] : 0;
      const prediction = left + up - corner;
      const a = Math.abs(prediction - left), b = Math.abs(prediction - up), c = Math.abs(prediction - corner);
      const paeth = a <= b && a <= c ? left : b <= c ? up : corner;
      const predictor = [0, left, up, Math.floor((left + up) / 2), paeth][filter];
      rgba[start + x] = (encoded[y * (stride + 1) + x + 1] + predictor) & 255;
    }
  }
  return rgba;
}

test('all 12 finished fish PNGs meet dimensions, size, sRGB and clear-border requirements', async t => {
  const directory = new URL('../src/assets/fish/', import.meta.url);
  assert.deepEqual(readdirSync(directory).filter(name => name.endsWith('.png')).sort(),
    FISH_SPECIES.map(fish => `${fish.id}.png`).sort(), 'production contains exactly the 12 species PNGs and no test PNG');
  assert.equal(validateFishImage('unknown.svg', readFileSync(new URL('unknown.svg', directory))).format, 'svg');
  const hashes = new Set();
  const fixtureHash = createHash('sha256').update(readFileSync(new URL('./fixtures/fish-assets/transparent-test.png', import.meta.url))).digest('hex');
  let totalBytes = 0;
  for (const fish of FISH_SPECIES) await t.test(fish.id, () => {
    const bytes = readFileSync(new URL(fish.image));
    const image = validateFishImage(new URL(fish.image).pathname, bytes);
    assert.deepEqual(image, { format: 'png', width: 1280, height: 560, bitDepth: 8, colorType: 6, transparent: true });
    assert.equal(bytes[28], 0, 'non-interlaced');
    assert.ok(bytes.length <= 800 * 1024, `${bytes.length} bytes exceeds the per-image target`);
    totalBytes += bytes.length;
    const hash = createHash('sha256').update(bytes).digest('hex');
    assert.notEqual(hash, fixtureHash, 'test fixture is never a production image');
    assert.ok(!hashes.has(hash), 'each species uses distinct image content');
    hashes.add(hash);
    const pixels = artworkPixels(bytes, image.width, image.height);
    let clear = 0, opaque = 0, visible = 0;
    let minX = image.width, minY = image.height, maxX = -1, maxY = -1;
    for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
      const alpha = pixels[(y * image.width + x) * 4 + 3];
      if (alpha === 0) clear++;
      else {
        visible++;
        if (alpha === 255) opaque++;
        minX = Math.min(minX, x); minY = Math.min(minY, y);
        maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      }
      if (x === 0 || y === 0 || x === image.width - 1 || y === image.height - 1) {
        assert.equal(alpha, 0, `nontransparent background at perimeter (${x}, ${y})`);
      }
    }
    assert.ok(clear > 0 && opaque > 0 && visible > 0, 'actual transparent background and visible fish pixels');
    assert.ok(minX >= 8 && minY >= 8 && maxX < image.width - 8 && maxY < image.height - 8,
      'fish and fin tips retain at least eight clear pixels on every side');
  });
  assert.equal(hashes.size, 12);
  assert.ok(totalBytes <= 8 * 1024 * 1024, `${totalBytes} total bytes exceeds the complete artwork budget`);
});
