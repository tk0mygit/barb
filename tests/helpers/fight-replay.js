import assert from 'node:assert/strict';
import { createFishing, PHASE } from '../../src/game/fishing.js';
import { createFishingInput } from '../../src/input/fishing.js';
import { createCatchCollection } from '../../src/game/catch-collection.js';
import { getFishSpecies } from '../../src/game/fish-species.js';
import { getEquipmentLevel } from '../../src/game/equipment.js';
import { encounterModel, getRodEncounterModifiers } from '../../src/game/encounter-production.js';
import { getLure } from '../../src/game/lures.js';
import { getFishingSpotStatus } from '../../src/game/fishing-spots.js';

// Reach the requested start through CAST/LURE/BITE/HOOK; no writable-state
// injection. The final short LURE step preserves legal near-landing cases.
export function hookedFight(condition = {}, options = {}) {
  const { speciesId = 'black-bass', size = 'mid', startDistance = 32, rod = 1, reel = 1, seed = 0x9e3779b9 } = condition;
  const species = getFishSpecies(speciesId), length = condition.lengthCm ?? (size === 'min' ? species.minLengthCm : size === 'max' ? species.maxLengthCm : (species.minLengthCm + species.maxLengthCm) / 2);
  const max = 32 + getEquipmentLevel('rod', rod).castDistanceBonusM;
  assert.ok(startDistance > 4.5 && startDistance <= max, 'fixture must be legally reachable');
  const castDistance = Math.min(max, Math.max(8, Math.ceil(startDistance * 4) / 4));
  const speed = .65 * getEquipmentLevel('reel', reel).reelSpeedMultiplier, travel = (castDistance - startDistance) / speed;
  let total = 0, roll;
  for (const entry of encounterModel.getProbabilities('minnow', undefined, getRodEncounterModifiers(rod))) {
    if (entry.speciesId === species.id) roll = total + entry.probability / 2;
    total += entry.probability;
  }
  const hitMultiplier = getLure('minnow').hitMultiplier * getFishingSpotStatus({ x: 0, z: 30 }).hitMultiplier;
  const setup = [-Math.expm1(-Math.max(0, travel - 3 + .1) * hitMultiplier / 12), roll,
    Math.min(1 - Number.EPSILON, (length - species.minLengthCm) / (species.maxLengthCm - species.minLengthCm))];
  let x = seed >>> 0, calls = 0;
  const random = () => { calls++; if (setup.length) return setup.shift(); x = (Math.imul(1664525, x) + 1013904223) >>> 0; return x / 4294967296; };
  const collection = createCatchCollection({ initialData: { catches: [], wallet: { balance: 0, lifetimeSales: 0 }, equipment: { rodLevel: rod, reelLevel: reel } } });
  const f = createFishing({ random, collection, ...options });
  assert.equal(f.prepare({ x: 0, z: 30 }, 0), true);
  f.aim(0, Math.min(180, (castDistance + .125 - 8) / (max - 8) * 180)); assert.equal(f.state.distance, castDistance);
  f.cast(); while (f.state.phase === PHASE.CAST) f.step(1 / 60);
  if (travel > 0) {
    f.reel(true);
    while (f.state.distance - startDistance > 1e-11) {
      assert.equal(f.state.phase, PHASE.LURE);
      f.step(Math.min(1 / 60, (f.state.distance - startDistance) / speed));
    }
    f.reel(false);
  }
  for (let n = 0; n < 10000 && f.state.phase === PHASE.LURE; n++) f.step(1 / 60);
  assert.equal(f.state.phase, PHASE.BITE); assert.equal(calls, 3);
  assert.equal(f.state.encounter.speciesId, speciesId); assert.equal(f.state.encounter.lengthCm, length);
  assert.ok(Math.abs(f.state.distance - startDistance) < 1e-10);
  assert.equal(f.hook(), true);
  return { f, calls: () => calls };
}

export function replayFight(condition, { mode = 'none', operation = 'flick', providedEvents = null, renderDts = null,
  adaptive = false, maxSeconds = 180 } = {}) {
  const events = [], transitions = [];
  let f, input, qteIndex = 0, held = false;
  const send = (type, at) => {
    events.push({ type, at });
    if (type === 'down') input.down(0, 0, 1000 + at * 1000);
    else if (type === 'cancel') input.cancel(1000 + at * 1000);
    else input.up(1000 + at * 1000);
  };
  ({ f } = hookedFight(condition, { qte: { enabled: mode !== 'none', selectOperation: () => operation }, onFightEvent(event) {
    transitions.push(event);
    if (event.type === 'qte-warning') {
      held = false;
      if (!providedEvents) send('up', event.fight.elapsedSeconds);
      const success = mode === 'success' || mode === 'alternating' && qteIndex % 2 === 0; qteIndex++;
      assert.equal(f.submitQteResult(event.fight.qte.token, success, event.fight.qte.deadlineSeconds), true);
    }
    if (event.type === 'qte-resolved') { held = false; if (!providedEvents && !adaptive) send('down', event.fight.elapsedSeconds); }
  } }));
  input = createFishingInput(f);
  if (!providedEvents && !adaptive) send('down', 0);
  let wall = 0, frames = 0, index = 0, nextPoll = 0;
  while (f.state.phase === PHASE.FIGHT && wall < maxSeconds) {
    const dt = renderDts ? renderDts[frames % renderDts.length] : 1 / (condition.fps ?? 60), end = wall + dt;
    if (providedEvents) while (index < providedEvents.length && providedEvents[index].at <= end) { const e = providedEvents[index++]; send(e.type, e.at); }
    if (adaptive && f.state.inputOwner === 'normal' && f.state.fight.normalSeconds >= nextPoll) {
      nextPoll += .1;
      // Ownership changes discard the old contact, even if the strategy kept
      // its previous logical button value through the QTE.
      if (f.state.tension > .65 && held) { send('up', wall); held = false; }
      if (f.state.tension < .35 && !held) { send('down', wall); held = true; }
    }
    input.step(dt, 1000 + end * 1000); f.step(dt); wall = end; frames++;
  }
  const progress = f.state.fight;
  return { outcome: progress?.outcome ?? 'right-censored', fight: progress, f, events, transitions, frames };
}
