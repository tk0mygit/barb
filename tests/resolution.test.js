import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateRenderResolution as calculate } from '../src/rendering/resolution.js';
const resolution = (width, height, devicePixelRatio, coarsePointer = true) => calculate({ width, height, devicePixelRatio, coarsePointer });

test('narrow touch screens retain at least CSS resolution and reduce old high-DPR pixels by 20%', () => {
  for (const [w, h, dpr] of [[390, 844, 2], [844, 390, 2], [360, 740, 3], [740, 360, 3]]) {
    const r = resolution(w, h, dpr);
    assert.equal(r.pixelRatio, 1.5);
    assert.ok(w * h * r.pixelRatio ** 2 <= 750000);
    assert.ok(r.pixelRatio ** 2 / 1.75 ** 2 < 0.8);
    assert.deepEqual(r, resolution(w, h, dpr));
  }
});
test('desktop quality and ordinary / deliberately low DPR are preserved', () => {
  for (const dpr of [0.5, 1, 1.25, 2, 3]) {
    assert.equal(resolution(1280, 800, dpr, false).pixelRatio, Math.min(dpr, 1.75));
    assert.equal(resolution(390, 844, dpr, false).pixelRatio, Math.min(dpr, 1.75));
    assert.equal(resolution(390, 844, dpr).pixelRatio, Math.min(dpr, 1.5));
  }
});
test('pixel budget scales a larger phone but yields to 1x quality floor on unusually wide screens', () => {
  assert.equal(resolution(500, 1000, 3).pixelRatio, Math.sqrt(1.5));
  assert.equal(resolution(600, 2000, 3).pixelRatio, 1);
  assert.equal(resolution(600, 2000, 0.5).pixelRatio, 0.5);
  assert.equal(resolution(2560, 1440, 2).pixelRatio, 1.75);
});
test('invalid inputs always yield finite positive sizes / ratio without increasing valid low DPR', () => {
  for (const w of [0, -1, NaN, Infinity, undefined]) for (const h of [0, -1, NaN, Infinity, undefined]) {
    for (const dpr of [0, -1, NaN, Infinity, undefined, 0.5]) {
      const r = resolution(w, h, dpr);
      assert.equal(r.width, 1); assert.equal(r.height, 1);
      assert.equal(r.pixelRatio, dpr === 0.5 ? 0.5 : 1);
    }
  }
});
test('rotation is symmetric, repeats are stable and tiny dimensions do not overflow', () => {
  for (const [w, h] of [[390, 844], [500, 1000], [1, 1], [1e308, 1e308]]) {
    assert.equal(resolution(w, h, 3).pixelRatio, resolution(h, w, 3).pixelRatio);
    assert.ok(Number.isFinite(resolution(w, h, 3).pixelRatio));
  }
});
