import test from 'node:test';
import assert from 'node:assert/strict';
import { createFightController } from '../src/game/fight-controller.js';
import { FISHING_CONFIG } from '../src/game/fishing-config.js';
import { FISH_SPECIES } from '../src/game/fish-species.js';
import { getEquipmentLevel } from '../src/game/equipment.js';

const make = random => createFightController({ species: FISH_SPECIES[0], lengthCm: 40, startDistance: 32,
  rod: getEquipmentLevel('rod', 1), reel: getEquipmentLevel('reel', 1), settings: FISHING_CONFIG, random, id: 1 });
test('escape survival follows the unchanged exponential rate across 2048 seeds and all fps', t => {
  const probe = make(() => 1 - Number.EPSILON);
  while (!probe.snapshot.rngCalls) probe.step(1 / 60);
  // Exactly sixty eligible physical intervals, including the first draw.
  const horizon = probe.snapshot.elapsedSeconds + 59 / 60, expected = 1 - Math.exp(-1.2);
  const byFps = [];
  for (const fps of [30, 60, 144]) {
    const results = []; let escaped = 0;
    for (let seed = 0; seed < 2048; seed++) {
      let x = (Math.imul(seed + 1, 0x9e3779b9) ^ 0x85ebca6b) >>> 0;
      const fight = make(() => { x = (Math.imul(1664525, x) + 1013904223) >>> 0; return x / 4294967296; });
      let admitted = 0, frame = 0;
      while (admitted < horizon && !fight.snapshot.outcome) {
        // As in RAF, dt is the difference of source timestamps. Do not use
        // a second naive dt sum to manufacture different final horizons.
        const end = Math.min(++frame / fps, horizon); fight.step(end - admitted); admitted = end;
      }
      const outcome = fight.snapshot.outcome; if (outcome === 'slack-escape') escaped++;
      assert.ok(outcome === null || outcome === 'slack-escape'); results.push({ outcome, draws: fight.snapshot.rngCalls, time: fight.snapshot.elapsedSeconds });
    }
    const probability = escaped / 2048;
    assert.ok(Math.abs(probability - expected) < 5 * Math.sqrt(expected * (1 - expected) / 2048), `fps=${fps}, p=${probability}`);
    if (byFps.length) assert.deepEqual(results, byFps[0]);
    byFps.push(results); t.diagnostic(`${fps}fps: ${escaped}/2048 escapes, measured=${probability}, expected=${expected}; identical per-seed physical results`);
  }
});
