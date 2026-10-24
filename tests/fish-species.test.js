import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FISH_SPECIES, BLACK_BASS, getFishSpecies, calculateFishWeightKg } from '../src/game/fish-species.js';
import { BLACK_BASS as legacyBass } from '../src/game/fishing-config.js';
import { validateFishImage } from '../scripts/lib/fish-image-validation.js';

const expectedIds = ['black-bass', 'smallmouth-bass', 'bluegill', 'rainbow-trout', 'brown-trout', 'iwana', 'northern-pike', 'european-perch', 'walleye', 'catfish', 'alligator-gar', 'arowana'];

test('all 12 ordinary species have unique stable IDs, metadata and lookup', () => {
  assert.deepEqual(FISH_SPECIES.map(fish => fish.id), expectedIds);
  assert.equal(new Set(FISH_SPECIES.map(fish => fish.id)).size, 12);
  assert.equal(new Set(FISH_SPECIES.map(fish => fish.name)).size, 12);
  for (const fish of FISH_SPECIES) {
    assert.equal(getFishSpecies(fish.id), fish);
    assert.ok(fish.name.length > 0 && fish.description.length >= 20 && fish.fight.style.length > 0);
    assert.ok(Object.isFrozen(fish) && Object.isFrozen(fish.weight) && Object.isFrozen(fish.fight));
  }
  assert.ok(Object.isFrozen(FISH_SPECIES));
  for (const id of ['unknown', 'constructor', '__proto__', undefined]) assert.equal(getFishSpecies(id), undefined);
});

test('length, mass, resistance and price data stay within the provisional game envelope', () => {
  for (const fish of FISH_SPECIES) {
    assert.ok(fish.minLengthCm >= 5 && fish.minLengthCm < fish.maxLengthCm && fish.maxLengthCm <= 250, fish.id);
    const w = fish.weight, f = fish.fight;
    for (const number of [fish.minLengthCm, fish.maxLengthCm, ...Object.values(w), f.baseResistance, f.lengthScaleCm, f.surgeAmplitude, f.surgeFrequency, fish.basePricePerKg]) {
      assert.ok(Number.isFinite(number) && number > 0, fish.id);
    }
    assert.ok(w.referenceLengthCm >= fish.minLengthCm && w.referenceLengthCm <= fish.maxLengthCm);
    assert.ok(w.referenceWeightKg >= 0.01 && w.referenceWeightKg <= 100 && w.exponent >= 2 && w.exponent <= 4);
    assert.ok(Number.isInteger(fish.basePricePerKg) && fish.basePricePerKg <= 1000);
    assert.ok(f.baseResistance >= 0.3 && f.baseResistance <= 2);
    assert.ok(f.surgeAmplitude < f.baseResistance && f.surgeFrequency <= 5 && f.lengthScaleCm >= 50);
    assert.ok(f.baseResistance + (fish.maxLengthCm - fish.minLengthCm) / f.lengthScaleCm + f.surgeAmplitude <= 3);
    let previous = 0;
    for (let i = 0; i <= 20; i++) {
      const length = fish.minLengthCm + (fish.maxLengthCm - fish.minLengthCm) * i / 20;
      const mass = calculateFishWeightKg(fish.id, length);
      assert.ok(Number.isFinite(mass) && mass >= 0.01 && mass <= 100 && mass >= previous, fish.id);
      // Validate the price inputs without implementing a sale/inventory system.
      assert.ok(mass * fish.basePricePerKg > 0 && mass * fish.basePricePerKg <= 100000);
      previous = mass;
    }
    assert.equal(calculateFishWeightKg(fish.id, w.referenceLengthCm), w.referenceWeightKg);
  }
});

test('each species references its own validated local SVG or transparent PNG', () => {
  assert.equal(new Set(FISH_SPECIES.map(fish => fish.image)).size, 12);
  const contents = new Set();
  for (const fish of FISH_SPECIES) {
    const url = new URL(fish.image);
    assert.equal(url.protocol, 'file:');
    const bytes = readFileSync(url);
    const image = validateFishImage(url.pathname, bytes);
    assert.ok(image.width > 0 && image.height > 0);
    contents.add(bytes.toString('base64'));
  }
  assert.equal(contents.size, 12);
});

test('black-bass imports and Phase 2 weight/resistance values remain compatible', () => {
  assert.equal(legacyBass, BLACK_BASS);
  assert.equal(getFishSpecies('black-bass'), legacyBass);
  assert.equal(BLACK_BASS.name, 'ブラックバス');
  assert.equal(BLACK_BASS.alternateName, 'ラージマウスバス');
  assert.equal(BLACK_BASS.minLengthCm, 25); assert.equal(BLACK_BASS.maxLengthCm, 55);
  for (let n = 250; n <= 550; n++) {
    const length = n / 10;
    assert.equal(calculateFishWeightKg('black-bass', length), Math.round(1.1 * (length / 40) ** 3 * 100) / 100);
  }
  assert.deepEqual([BLACK_BASS.fight.baseResistance, BLACK_BASS.fight.lengthScaleCm, BLACK_BASS.fight.surgeAmplitude, BLACK_BASS.fight.surgeFrequency], [0.85, 100, 0.15, 2.4]);
});

test('invalid IDs and invalid lengths cannot generate corrupt catch weights', () => {
  assert.throws(() => calculateFishWeightKg('unknown', 40), RangeError);
  for (const length of [NaN, Infinity, -Infinity, -1, 0, 24.9, 55.1, '40', null]) {
    assert.throws(() => calculateFishWeightKg('black-bass', length), RangeError);
  }
});
