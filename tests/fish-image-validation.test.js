import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { validateFishImage, IMAGE_LIMITS } from '../scripts/lib/fish-image-validation.js';
import { makePNG, pngChunk } from './helpers/png-fixture.js';

const check = bytes => validateFishImage('test.png', bytes);
test('transparent PNG fixture is real RGBA with independent, non-SVG dimensions', () => {
  assert.deepEqual(check(readFileSync(new URL('./fixtures/fish-assets/transparent-test.png', import.meta.url))),
    { format: 'png', width: 40, height: 64, bitDepth: 8, colorType: 6, transparent: true });
  for (const [color, raw, transparency] of [
    [4, [0, 80, 0]], [6, [0, 20, 80, 160, 128]],
    [0, [0, 80], [0, 80]], [2, [0, 20, 80, 160], [0, 20, 0, 80, 0, 160]],
  ]) assert.equal(check(makePNG({ color, raw: Buffer.from(raw), transparency: transparency && Buffer.from(transparency) })).transparent, true);
  assert.equal(check(makePNG({ color: 3, palette: Buffer.from([20, 80, 160]), transparency: Buffer.from([0]), raw: Buffer.from([0, 0]) })).colorType, 3);
  assert.equal(check(makePNG({ depth: 16, raw: Buffer.alloc(9) })).bitDepth, 16);
  for (const depth of [1, 2, 4, 8, 16]) {
    assert.equal(check(makePNG({ color: 0, depth, raw: Buffer.alloc(depth === 16 ? 3 : 2), transparency: Buffer.alloc(2) })).bitDepth, depth);
    if (depth !== 16) assert.equal(check(makePNG({ color: 3, depth, raw: Buffer.alloc(2), palette: Buffer.alloc(3), transparency: Buffer.alloc(1) })).bitDepth, depth);
  }
  for (const color of [2, 4, 6]) for (const depth of [8, 16]) {
    const channels = { 2: 3, 4: 2, 6: 4 }[color];
    assert.equal(check(makePNG({ color, depth, raw: Buffer.alloc(1 + channels * depth / 8),
      transparency: color === 2 ? Buffer.alloc(6) : undefined })).colorType, color);
  }
  for (const filter of [0, 1, 2, 3, 4]) {
    const raw = Buffer.alloc(2 * 9); raw[0] = raw[9] = filter;
    assert.equal(check(makePNG({ width: 2, height: 2, raw })).height, 2);
  }
});

test('PNG rejects corrupt structures, pixels, opaque formats and resource exhaustion', () => {
  const valid = makePNG(), crc = Buffer.from(valid); crc[crc.length - 1] ^= 1;
  const ihdr = valid.subarray(8, 33), idat = valid.subarray(33, valid.length - 12), iend = valid.subarray(-12), sig = valid.subarray(0, 8);
  const bad = [Buffer.from('not PNG'), valid.subarray(0, -1), crc, Buffer.concat([valid, Buffer.from([0])]),
    Buffer.concat([sig, idat, ihdr, iend]), Buffer.concat([sig, ihdr, ihdr, idat, iend]),
    Buffer.concat([sig, ihdr, idat, pngChunk('tEXt'), idat, iend]),
    makePNG({ extra: [pngChunk('NOPE')] }), makePNG({ extra: [pngChunk('acTL')] }),
    makePNG({ width: 0 }), makePNG({ width: IMAGE_LIMITS.dimension + 1 }), makePNG({ width: 8192, height: 8192 }),
    makePNG({ color: 5 }), makePNG({ depth: 4 }), makePNG({ interlace: 1 }), makePNG({ raw: Buffer.from([5, 0, 0, 0, 0]) }),
    makePNG({ raw: Buffer.alloc(4) }), makePNG({ raw: Buffer.alloc(6) }),
    makePNG({ compressed: Buffer.from('bad zlib') }),
    makePNG({ compressed: Buffer.concat([deflateSync(Buffer.alloc(5)), Buffer.from([0])]) }),
    makePNG({ compressed: deflateSync(Buffer.alloc(1000000)) }),
    makePNG({ color: 2, raw: Buffer.from([0, 20, 80, 160]) }),
    makePNG({ color: 6, transparency: Buffer.from([0]) }),
    makePNG({ color: 3, raw: Buffer.from([0, 0]) }),
    makePNG({ color: 3, palette: Buffer.from([0, 0, 0]), transparency: Buffer.from([255]), raw: Buffer.from([0, 0]) }),
    makePNG({ color: 3, palette: Buffer.from([0, 0, 0]), transparency: Buffer.from([0]), raw: Buffer.from([0, 1]) }),
    makePNG({ color: 0, transparency: Buffer.from([1, 0]), raw: Buffer.from([0, 0]) }),
    Buffer.alloc(IMAGE_LIMITS.bytes + 1)];
  for (const [index, bytes] of bad.entries()) assert.throws(() => check(bytes), TypeError, `case ${index}`);
});

test('SVG retains safety and size checks while allowing other positive viewBoxes', () => {
  assert.deepEqual(validateFishImage('transparent-test.svg', readFileSync(new URL('./fixtures/fish-assets/transparent-test.svg', import.meta.url))),
    { format: 'svg', width: 640, height: 280 });
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 120"><path d="M0 0"/></svg>';
  assert.deepEqual(validateFishImage('test.svg', Buffer.from(svg)), { format: 'svg', width: 80, height: 120 });
  for (const content of ['<script/>', '<foreignObject/>', '<image href="https://example.com/a"/>', '<path onclick="x()"/>',
    '<path style="fill:url(https://example.com/a)"/>', '<!ENTITY x "bad">', '<style>@import "x";</style>']) {
    assert.throws(() => validateFishImage('test.svg', Buffer.from(svg.replace('<path d="M0 0"/>', content))), TypeError);
  }
  for (const invalid of [svg.replace('80 120', '0 120'), svg.replace('80 120', 'NaN 120'), svg.slice(0, -6), 'x'.repeat(10000)]) {
    assert.throws(() => validateFishImage('test.svg', Buffer.from(invalid)), TypeError);
  }
  for (const name of ['test.jpg', 'test.webp', 'test.PNG', 'test.png.exe', 'test']) assert.throws(() => validateFishImage(name, makePNG()), TypeError);
  assert.throws(() => validateFishImage('test.svg', makePNG()), TypeError);
  assert.throws(() => validateFishImage('test.png', Buffer.from(svg)), TypeError);
});
