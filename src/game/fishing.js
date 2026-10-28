import { FISHING_CONFIG } from './fishing-config.js';
import { calculateFishWeightKg, getFishSpecies } from './fish-species.js';
import { DEFAULT_LURE_ID, getLure } from './lures.js';
import { normalizeEncounterConditions } from './fish-encounters.js';
import { encounterModel, getRodEncounterModifiers } from './encounter-production.js';
import { fishResistance, isLargeFish } from './fish-fight.js';
import { getFishingSpotStatus } from './fishing-spots.js';
import { createCatchCollection } from './catch-collection.js';
import { getEquipmentLevel } from './equipment.js';

export const PHASE = Object.freeze({ READY: 'ready', AIM: 'aim', CAST: 'cast', LURE: 'lure', BITE: 'bite', FIGHT: 'fight', LANDING: 'landing', RESULT: 'result', FAILED: 'failed' });
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// Current surface position, including retrieval; shared by sampling and view.
export function getLurePosition(state) {
  return { x: state.origin.x + Math.sin(state.heading) * state.distance,
    z: state.origin.z - Math.cos(state.heading) * state.distance };
}

// No DOM, Three.js or input events: callers supply world queries and randomness.
export function createFishing({ config = {}, random = Math.random, isWater = () => true, now = Date.now, getBoatPosition, getEnvironment, collection = createCatchCollection() } = {}) {
  const settings = { ...FISHING_CONFIG, ...config };
  const state = {
    phase: PHASE.READY, revision: 0, time: 0, reeling: false, distance: 0, tension: 0,
    origin: { x: 0, z: 0 }, target: { x: 0, z: 0 }, heading: 0, validCast: true,
    action: 0, message: '', catch: null, get catches() { return collection.catches; }, biteRemaining: 0,
    lureId: DEFAULT_LURE_ID, encounter: null,
  };
  let aimHeading = 0, biteBudget = 0, lureTime = 0, slackTime = 0, fightDistance = 0;
  let castVisibility = null, aimDX = 0, aimDY = 0;
  // Immutable shared row, captured once per cast; collection remains authoritative.
  let rodPerformance = getEquipmentLevel('rod', 1);
  let reelPerformance = getEquipmentLevel('reel', 1);
  let encounterModifiers = getRodEncounterModifiers(1), largeFishAssistMultiplier = 1;
  const exponential = () => -Math.log(Math.max(1e-9, 1 - random()));
  function getConditions() {
    if (!getEnvironment) return null; // legacy standalone callers stay neutral
    const lurePosition = Object.freeze(getLurePosition(state));
    return Object.freeze({ ...normalizeEncounterConditions(getEnvironment(lurePosition)), lureId: state.lureId, lurePosition });
  }
  function transition(phase) {
    state.phase = phase;
    state.revision++;
    state.time = 0;
    state.reeling = false;
  }
  function ready(message = '') { transition(PHASE.READY); state.message = message; state.catch = null; state.encounter = null; }
  function fail(message) { transition(PHASE.FAILED); state.message = message; }
  function aim(dx = 0, dy = 0) {
    if (state.phase !== PHASE.AIM) return;
    aimDX = dx; aimDY = dy;
    const requested = settings.castMin + (settings.castMax + rodPerformance.castDistanceBonusM - settings.castMin) * clamp(Math.hypot(dx, dy) / settings.castDragPixels, 0, 1);
    const limits = castVisibility?.constrain({ origin: state.origin, heading: aimHeading, requestedDistance: requested,
      spread: settings.castSpread, landingDistance: settings.landingDistance });
    const drag = clamp(dx / settings.castDragPixels, -1, 1);
    state.heading = aimHeading + Math.abs(drag) * (drag < 0 ? limits?.minAngle ?? -settings.castSpread : limits?.maxAngle ?? settings.castSpread);
    // Check the whole cast ray, so a lure cannot cross land into another inlet.
    let distance = 0;
    for (let d = 0.25; d <= requested; d += 0.25) {
      if (!isWater(state.origin.x + Math.sin(state.heading) * d, state.origin.z - Math.cos(state.heading) * d)) break;
      distance = d;
    }
    state.distance = distance;
    const waterValid = distance >= settings.landingDistance + 1;
    const visible = !castVisibility || (limits.valid && castVisibility.isVisible({ origin: state.origin,
      heading: state.heading, distance, landingDistance: settings.landingDistance }));
    state.validCast = waterValid && visible;
    state.message = !waterValid ? '岸が近すぎます。湖側へ向きを変えてください' : !visible
      ? limits.reason || '着水先を画面内に確保できません。湖側へ向くか画面の向きを変えてください' : '';
    state.target = { x: state.origin.x + Math.sin(state.heading) * distance, z: state.origin.z - Math.cos(state.heading) * distance };
  }
  function advance(dt) {
    state.time += dt;
    state.action = Math.max(0, state.action - dt);
    if (state.phase === PHASE.CAST && state.time >= settings.flightSeconds) {
      transition(PHASE.LURE);
      lureTime = 0;
      biteBudget = exponential() * settings.biteMean;
    } else if (state.phase === PHASE.LURE) {
      const activeTime = Math.max(0, lureTime + dt - settings.biteDelay) - Math.max(0, lureTime - settings.biteDelay);
      lureTime += dt;
      if (state.reeling) state.distance = Math.max(settings.landingDistance, state.distance - settings.lureSpeed * reelPerformance.reelSpeedMultiplier * dt);
      if (state.distance <= settings.landingDistance) { ready('ルアーを回収しました'); return; }
      // The boat stays still while fishing today; the callback also supports
      // live position changes without ever consulting the lure's target.
      const spotMultiplier = getFishingSpotStatus(getBoatPosition?.() ?? state.origin).hitMultiplier;
      biteBudget -= activeTime * getLure(state.lureId).hitMultiplier * spotMultiplier * (state.action > 0 ? settings.actionMultiplier : 1);
      if (biteBudget <= 0 && lureTime >= settings.biteDelay) {
        const conditions = getConditions();
        const species = encounterModel.sample(state.lureId, random, conditions, encounterModifiers);
        const lengthCm = Math.round((species.minLengthCm + random() * (species.maxLengthCm - species.minLengthCm)) * 10) / 10;
        state.encounter = Object.freeze({ speciesId: species.id, lengthCm, weightKg: calculateFishWeightKg(species.id, lengthCm), ...(conditions ? { conditions } : {}) });
        transition(PHASE.BITE);
        state.biteRemaining = settings.hookWindow;
      }
    } else if (state.phase === PHASE.BITE) {
      state.biteRemaining = Math.max(0, settings.hookWindow - state.time);
      if (state.time >= settings.hookWindow) fail('アワセが遅れて魚が逃げました');
    } else if (state.phase === PHASE.FIGHT) {
      const fish = state.encounter;
      const resistance = fishResistance(getFishSpecies(fish.speciesId), fish.lengthCm, state.time);
      state.tension = clamp(state.tension + dt * (state.reeling ? settings.tensionRise * resistance * rodPerformance.tensionMultiplier : -settings.tensionRelief * reelPerformance.tensionReliefMultiplier), 0, 1);
      if (state.tension >= 1) { fail('テンションが高すぎてラインが切れました'); return; }
      slackTime = state.tension < settings.slackThreshold ? slackTime + dt : 0;
      if (slackTime > settings.slackGrace && random() < -Math.expm1(-settings.slackEscapeRate * dt)) { fail('ラインが緩み、魚が逃げました'); return; }
      const reelResistance = clamp(resistance, settings.reelResistanceMin, settings.reelResistanceMax);
      if (state.reeling) state.distance = Math.max(settings.landingDistance, state.distance - fightDistance / (settings.fightReelSeconds * reelResistance) * reelPerformance.reelSpeedMultiplier * largeFishAssistMultiplier * dt);
      if (state.distance <= settings.landingDistance) transition(PHASE.LANDING);
    } else if (state.phase === PHASE.LANDING && state.time >= settings.landingSeconds) {
      const capturedAt = now();
      let sequence = state.catches.length + 1;
      let id = `catch-${capturedAt}-${sequence}`;
      // Restored IDs can have any suffix, and the wall clock can move back.
      while (collection.has ? collection.has(id) : state.catches.some(record => record.id === id)) id = `catch-${capturedAt}-${++sequence}`;
      state.catch = collection.register(Object.freeze({ schemaVersion: 1, id, ...state.encounter, caughtAt: new Date(capturedAt).toISOString(), disposition: 'unassigned' }));
      transition(PHASE.RESULT);
    } else if (state.phase === PHASE.FAILED && state.time >= settings.failureSeconds) ready(state.message);
  }
  return {
    state, settings, getConditions, collection,
    selectLure(id) {
      if (state.phase !== PHASE.READY || !getLure(id)) return false;
      state.lureId = id; return true;
    },
    canLeave: () => [PHASE.READY, PHASE.AIM, PHASE.FAILED].includes(state.phase),
    prepare(origin, heading, visibility) {
      if (state.phase !== PHASE.READY) return false;
      if (visibility !== undefined) castVisibility = visibility;
      rodPerformance = getEquipmentLevel('rod', collection.equipment?.rodLevel) ?? getEquipmentLevel('rod', 1);
      reelPerformance = getEquipmentLevel('reel', collection.equipment?.reelLevel) ?? getEquipmentLevel('reel', 1);
      encounterModifiers = getRodEncounterModifiers(rodPerformance.level);
      state.origin = { x: origin.x, z: origin.z };
      aimHeading = heading;
      state.message = '';
      state.action = 0;
      transition(PHASE.AIM); aim(); return true;
    },
    aim,
    setCastVisibility(visibility) { castVisibility = visibility; if (state.phase === PHASE.AIM) aim(aimDX, aimDY); },
    refreshAim() { if (state.phase === PHASE.AIM) aim(aimDX, aimDY); },
    cast() {
      if (state.phase !== PHASE.AIM) return;
      if (!state.validCast) { ready(state.message); return; }
      // Commit the last preview. A notice expiring between rendering and
      // release may widen the view limits, but must never redirect this cast.
      // Recheck safety without changing heading, distance or the water target.
      for (let d = 0.25; d <= state.distance; d += 0.25) {
        if (!isWater(state.origin.x + Math.sin(state.heading) * d, state.origin.z - Math.cos(state.heading) * d)) {
          state.validCast = false;
          ready('岸が近すぎます。湖側へ向きを変えてください'); return;
        }
      }
      if (castVisibility && !castVisibility.isVisible({ origin: state.origin, heading: state.heading,
        distance: state.distance, landingDistance: settings.landingDistance })) {
        state.validCast = false;
        ready('着水先を画面内に確保できません。湖側へ向くか画面の向きを変えてください'); return;
      }
      transition(PHASE.CAST);
    },
    cancelInput() { state.reeling = false; if (state.phase === PHASE.AIM) ready('キャスト準備を解除しました'); },
    cancelForViewChange(message = '画面サイズが変わったためルアーを回収しました。向きを調整して再キャストしてください') {
      if (![PHASE.CAST, PHASE.LURE, PHASE.BITE].includes(state.phase)) return false;
      // A narrower viewport can hide an already committed target. Recall it
      // explicitly instead of changing its direction, distance or camera FOV.
      state.action = 0;
      state.biteRemaining = 0;
      ready(message);
      return true;
    },
    reel(active) { state.reeling = active && [PHASE.LURE, PHASE.FIGHT].includes(state.phase); },
    flick() { if (state.phase === PHASE.LURE) state.action = settings.actionSeconds; },
    hook() {
      if (state.phase !== PHASE.BITE || state.time >= settings.hookWindow) return false;
      state.tension = settings.tensionStart;
      fightDistance = state.distance - settings.landingDistance;
      largeFishAssistMultiplier = isLargeFish(getFishSpecies(state.encounter.speciesId), state.encounter.lengthCm)
        ? reelPerformance.largeFishAssistMultiplier ?? 1 : 1;
      slackTime = 0;
      transition(PHASE.FIGHT); return true;
    },
    closeResult() {
      if (state.phase !== PHASE.RESULT) return false;
      if (!collection.store(state.catch.id)) return false;
      ready(); return true;
    },
    sellResult() {
      if (state.phase !== PHASE.RESULT) return null;
      const receipt = collection.sellUnassigned(state.catch.id);
      if (receipt) ready();
      return receipt;
    },
    reset() { if (this.canLeave()) ready(); },
    step(dt) {
      // Keep probability and failure boundaries stable across frame rates.
      let remaining = Math.max(0, dt);
      while (remaining > 1e-9) { const step = Math.min(remaining, 1 / 60); advance(step); remaining -= step; }
    },
  };
}
