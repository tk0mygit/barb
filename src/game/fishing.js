import { FISHING_CONFIG, BLACK_BASS } from './fishing-config.js';
import { calculateFishWeightKg } from './fish-species.js';

export const PHASE = Object.freeze({ READY: 'ready', AIM: 'aim', CAST: 'cast', LURE: 'lure', BITE: 'bite', FIGHT: 'fight', LANDING: 'landing', RESULT: 'result', FAILED: 'failed' });
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// No DOM, Three.js or input events: callers supply world queries and randomness.
export function createFishing({ config = {}, random = Math.random, isWater = () => true, now = Date.now } = {}) {
  const settings = { ...FISHING_CONFIG, ...config };
  const state = {
    phase: PHASE.READY, revision: 0, time: 0, reeling: false, distance: 0, tension: 0,
    origin: { x: 0, z: 0 }, target: { x: 0, z: 0 }, heading: 0, validCast: true,
    action: 0, message: '', catch: null, catches: [], biteRemaining: 0,
  };
  let aimHeading = 0, biteBudget = 0, lureTime = 0, slackTime = 0, fightDistance = 0;
  let fish = null;
  const exponential = () => -Math.log(Math.max(1e-9, 1 - random()));
  function transition(phase) {
    state.phase = phase;
    state.revision++;
    state.time = 0;
    state.reeling = false;
  }
  function ready(message = '') { transition(PHASE.READY); state.message = message; state.catch = null; }
  function fail(message) { transition(PHASE.FAILED); state.message = message; }
  function aim(dx = 0, dy = 0) {
    if (state.phase !== PHASE.AIM) return;
    state.heading = aimHeading + clamp(dx / settings.castDragPixels, -1, 1) * settings.castSpread;
    const requested = settings.castMin + (settings.castMax - settings.castMin) * clamp(Math.hypot(dx, dy) / settings.castDragPixels, 0, 1);
    // Check the whole cast ray, so a lure cannot cross land into another inlet.
    let distance = 0;
    for (let d = 0.25; d <= requested; d += 0.25) {
      if (!isWater(state.origin.x + Math.sin(state.heading) * d, state.origin.z - Math.cos(state.heading) * d)) break;
      distance = d;
    }
    state.distance = distance;
    state.validCast = distance >= settings.landingDistance + 1;
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
      if (state.reeling) state.distance = Math.max(settings.landingDistance, state.distance - settings.lureSpeed * dt);
      if (state.distance <= settings.landingDistance) { ready('ルアーを回収しました'); return; }
      biteBudget -= activeTime * (state.action > 0 ? settings.actionMultiplier : 1);
      if (biteBudget <= 0 && lureTime >= settings.biteDelay) {
        transition(PHASE.BITE);
        state.biteRemaining = settings.hookWindow;
      }
    } else if (state.phase === PHASE.BITE) {
      state.biteRemaining = Math.max(0, settings.hookWindow - state.time);
      if (state.time >= settings.hookWindow) fail('アワセが遅れて魚が逃げました');
    } else if (state.phase === PHASE.FIGHT) {
      const { baseResistance, lengthScaleCm, surgeAmplitude, surgeFrequency } = BLACK_BASS.fight;
      const resistance = baseResistance + (fish.lengthCm - BLACK_BASS.minLengthCm) / lengthScaleCm + surgeAmplitude * Math.sin(state.time * surgeFrequency);
      state.tension = clamp(state.tension + dt * (state.reeling ? settings.tensionRise * resistance : -settings.tensionRelief), 0, 1);
      if (state.tension >= 1) { fail('テンションが高すぎてラインが切れました'); return; }
      slackTime = state.tension < settings.slackThreshold ? slackTime + dt : 0;
      if (slackTime > settings.slackGrace && random() < -Math.expm1(-settings.slackEscapeRate * dt)) { fail('ラインが緩み、魚が逃げました'); return; }
      if (state.reeling) state.distance = Math.max(settings.landingDistance, state.distance - fightDistance / (settings.fightReelSeconds * resistance) * dt);
      if (state.distance <= settings.landingDistance) transition(PHASE.LANDING);
    } else if (state.phase === PHASE.LANDING && state.time >= settings.landingSeconds) {
      state.catch = Object.freeze({ schemaVersion: 1, id: `catch-${now()}-${state.catches.length + 1}`, speciesId: BLACK_BASS.id, lengthCm: fish.lengthCm, weightKg: fish.weightKg, caughtAt: new Date(now()).toISOString(), disposition: 'unassigned' });
      state.catches.push(state.catch);
      transition(PHASE.RESULT);
    } else if (state.phase === PHASE.FAILED && state.time >= settings.failureSeconds) ready(state.message);
  }
  return {
    state, settings,
    canLeave: () => [PHASE.READY, PHASE.AIM, PHASE.FAILED].includes(state.phase),
    prepare(origin, heading) {
      if (state.phase !== PHASE.READY) return false;
      state.origin = { x: origin.x, z: origin.z };
      aimHeading = heading;
      state.message = '';
      state.action = 0;
      transition(PHASE.AIM); aim(); return true;
    },
    aim,
    cast() {
      if (state.phase !== PHASE.AIM) return;
      if (!state.validCast) { ready('岸が近すぎます。湖側へ向きを変えてください'); return; }
      transition(PHASE.CAST);
    },
    cancelInput() { state.reeling = false; if (state.phase === PHASE.AIM) ready('キャスト準備を解除しました'); },
    reel(active) { state.reeling = active && [PHASE.LURE, PHASE.FIGHT].includes(state.phase); },
    flick() { if (state.phase === PHASE.LURE) state.action = settings.actionSeconds; },
    hook() {
      if (state.phase !== PHASE.BITE || state.time >= settings.hookWindow) return false;
      const lengthCm = Math.round((BLACK_BASS.minLengthCm + random() * (BLACK_BASS.maxLengthCm - BLACK_BASS.minLengthCm)) * 10) / 10;
      fish = { lengthCm, weightKg: calculateFishWeightKg(BLACK_BASS.id, lengthCm) };
      state.tension = settings.tensionStart;
      fightDistance = state.distance - settings.landingDistance;
      slackTime = 0;
      transition(PHASE.FIGHT); return true;
    },
    closeResult() { if (state.phase === PHASE.RESULT) ready(); },
    reset() { if (this.canLeave()) ready(); },
    step(dt) {
      // Keep probability and failure boundaries stable across frame rates.
      let remaining = Math.max(0, dt);
      while (remaining > 1e-9) { const step = Math.min(remaining, 1 / 60); advance(step); remaining -= step; }
    },
  };
}
