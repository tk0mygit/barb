import test from 'node:test';
import assert from 'node:assert/strict';
import { createFishImageLoader } from '../src/ui/fish-image-loader.js';

function fixture() {
  const images = [];
  const load = createFishImageLoader(() => {
    let resolve, reject;
    const decoded = new Promise((yes, no) => { resolve = yes; reject = no; });
    const image = { complete: false, decode: () => decoded,
      resolve() { image.complete = true; resolve(); }, reject,
      removeAttribute(name) { if (name === 'src') { image.cancelled = true; delete image.src; } } };
    images.push(image); return image;
  });
  const fish = id => ({ id, image: `/barb/${id}.png` });
  return { load, images, fish };
}

test('encounter/frame/RESULT calls share one decoded image; only two LRU species are retained', async () => {
  const { load, images, fish } = fixture();
  const bass = load(fish('bass'));
  for (let i = 0; i < 120; i++) assert.equal(load(fish('bass')), bass);
  assert.equal(images.length, 1);
  assert.equal(images[0].fetchPriority, 'high');
  images[0].resolve();
  assert.equal(await bass, images[0]);
  const bluegill = load(fish('bluegill')); images[1].resolve(); await bluegill;
  assert.equal(load(fish('bass')), bass); // bass is now the recent entry
  const trout = load(fish('trout')); images[2].resolve(); await trout;
  assert.equal(load(fish('bass')), bass);
  assert.notEqual(load(fish('bluegill')), bluegill);
  assert.equal(images.length, 4);
  images[3].resolve();
});

test('failed fetch/decode is retryable, and late eviction failures cannot delete a newer request', async () => {
  const { load, images, fish } = fixture();
  const old = load(fish('bass'));
  const rejectedOld = assert.rejects(old, /decode/);
  const b = load(fish('bluegill')), c = load(fish('trout'));
  const fresh = load(fish('bass'));
  assert.equal(images[0].cancelled, true);
  images[0].reject(new Error('decode failed')); await rejectedOld;
  assert.equal(load(fish('bass')), fresh);
  images[1].resolve(); images[2].resolve(); images[3].resolve();
  await Promise.all([b, c, fresh]);
  const failure = load(fish('pike'));
  const rejectedFailure = assert.rejects(failure, /network/);
  images[4].reject(new Error('network failed')); await rejectedFailure;
  const retry = load(fish('pike')); assert.notEqual(retry, failure);
  images[5].resolve(); assert.equal(await retry, images[5]);
});
