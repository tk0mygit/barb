import { GAME_CLOCK_CONFIG } from '../game/game-clock.js';
import manifest from '../assets/audio/bio/manifest.json' with { type: 'json' };
import { validateBioManifest } from './bio-source-validation.js';

// Metadata only: importing this module does not import the factory or WAV URLs.
const variants = validateBioManifest(manifest);
const CYCLE_SECONDS = GAME_CLOCK_CONFIG.daySeconds + GAME_CLOCK_CONFIG.nightSeconds;
export const DEFAULT_BIO_SEED = 0x42494f32;
export const BIO_SCHEDULE_CONFIG = Object.freeze({
  day: Object.freeze({ minIntervalSeconds: 15, maxIntervalSeconds: 30 }),
  night: Object.freeze({ minIntervalSeconds: 8, maxIntervalSeconds: 20 }),
  maxLatenessSeconds: .25,
  maxStepSeconds: .25,
  // Covers dispatch lateness and leaves a further 250ms before a phase ends.
  endGuardSeconds: .5,
});
// Keep millisecond arithmetic safe, including the whole final cached cycle.
export const MAX_BIO_CYCLE_INDEX = Math.floor(Number.MAX_SAFE_INTEGER / 1000 / CYCLE_SECONDS) - 1;
export const MAX_BIO_ELAPSED_SECONDS = (MAX_BIO_CYCLE_INDEX + 1) * CYCLE_SECONDS;
const phases = ['day', 'night'].map((timeOfDay, index) => Object.freeze({
  timeOfDay, offset: index === 0 ? 0 : GAME_CLOCK_CONFIG.daySeconds,
  seconds: index === 0 ? GAME_CLOCK_CONFIG.daySeconds : GAME_CLOCK_CONFIG.nightSeconds,
  variants: variants.filter(v => v.kind === (index === 0 ? 'bird' : 'suzumushi')),
  ...BIO_SCHEDULE_CONFIG[timeOfDay],
}));
export const MAX_BIO_EVENTS_PER_CYCLE = phases.reduce((count, phase) => count + Math.floor(
  (phase.seconds - Math.max(...phase.variants.map(v => v.durationSeconds)) - BIO_SCHEDULE_CONFIG.endGuardSeconds)
  / phase.minIntervalSeconds), 0);

function validateSeed(seed) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new RangeError('Bio seed must be a uint32');
}
function mix32(value) {
  value = Math.imul(value ^ (value >>> 16), 0x85ebca6b);
  value = Math.imul(value ^ (value >>> 13), 0xc2b2ae35);
  return (value ^ (value >>> 16)) >>> 0;
}
function random(seed) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

// Pure, bounded plan. Full cycle index (both 32-bit words) participates in seeds.
export function createBioCyclePlan(cycleIndex, { seed = DEFAULT_BIO_SEED } = {}) {
  validateSeed(seed);
  if (!Number.isSafeInteger(cycleIndex) || cycleIndex < 0 || cycleIndex > MAX_BIO_CYCLE_INDEX)
    throw new RangeError('Bio cycle index out of supported range');
  const cycleStartSeconds = cycleIndex * CYCLE_SECONDS, events = [];
  for (const [phaseIndex, phase] of phases.entries()) {
    const phaseSeed = mix32(seed ^ mix32(cycleIndex >>> 0)
      ^ mix32(Math.floor(cycleIndex / 0x100000000) ^ 0x9e3779b9) ^ (phaseIndex === 0 ? 0x646179 : 0x6e696768));
    const timing = random(mix32(phaseSeed ^ 0x74696d65)), selection = random(mix32(phaseSeed ^ 0x76617273));
    const maxDuration = Math.max(...phase.variants.map(v => v.durationSeconds));
    const minMs = phase.minIntervalSeconds * 1000, maxMs = phase.maxIntervalSeconds * 1000;
    const phaseEndSeconds = cycleStartSeconds + phase.offset + phase.seconds;
    let offsetMs = 0, bag = [], lastId;
    for (let ordinal = 0; ordinal < Math.floor(phase.seconds / phase.minIntervalSeconds); ordinal++) {
      offsetMs += minMs + Math.floor(timing() * (maxMs - minMs + 1));
      if (offsetMs / 1000 + maxDuration + BIO_SCHEDULE_CONFIG.endGuardSeconds > phase.seconds) break;
      if (!bag.length) {
        bag = [...phase.variants];
        for (let i = bag.length - 1; i > 0; i--) {
          const j = Math.floor(selection() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]];
        }
        if (bag[0].id === lastId) {
          const j = 1 + Math.floor(selection() * (bag.length - 1)); [bag[0], bag[j]] = [bag[j], bag[0]];
        }
      }
      const variant = bag.shift(); lastId = variant.id;
      const scheduledSeconds = cycleStartSeconds + phase.offset + offsetMs / 1000;
      events.push(Object.freeze({
        eventId: `bio-v1/${seed.toString(16).padStart(8, '0')}/${cycleIndex}/${phase.timeOfDay}/${ordinal}`,
        sourceId: variant.id, timeOfDay: phase.timeOfDay, cycleIndex, scheduledSeconds,
        latestStartSeconds: scheduledSeconds + BIO_SCHEDULE_CONFIG.maxLatenessSeconds,
        durationSeconds: variant.durationSeconds, phaseEndSeconds,
      }));
    }
  }
  return Object.freeze({ cycleIndex, seed, cycleStartSeconds,
    cycleEndSeconds: cycleStartSeconds + CYCLE_SECONDS, events: Object.freeze(events) });
}

function position(clock) {
  const { elapsedSeconds, cycleSeconds, timeOfDay } = clock ?? {};
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0 || elapsedSeconds >= MAX_BIO_ELAPSED_SECONDS
    || !Number.isFinite(cycleSeconds) || cycleSeconds < 0 || cycleSeconds >= CYCLE_SECONDS
    || !['day', 'night'].includes(timeOfDay)) throw new RangeError('A supported game-clock state is required');
  // cycleSeconds is supplied by the existing clock, including its boundary
  // rounding. Do not duplicate its day/night sampling or advance another clock.
  const cycleIndex = Math.round((elapsedSeconds - cycleSeconds) / CYCLE_SECONDS) + 0; // normalize -0
  const tolerance = Math.max(1e-8, elapsedSeconds * Number.EPSILON * 2);
  if (!Number.isSafeInteger(cycleIndex) || cycleIndex < 0 || cycleIndex > MAX_BIO_CYCLE_INDEX
    || Math.abs(elapsedSeconds - (cycleIndex * CYCLE_SECONDS + cycleSeconds)) > tolerance)
    throw new RangeError('Inconsistent game-clock cycle');
  return { elapsedSeconds, timeOfDay, cycleIndex };
}

// Bounded dispatch cursor over pure plans. No timers, playback, DOM or I/O.
export function createBioScheduler({ seed = DEFAULT_BIO_SEED } = {}) {
  validateSeed(seed);
  let cachedPlan, previous, highWater = -Infinity, wasPaused = false;
  const planFor = cycleIndex => {
    if (cachedPlan?.cycleIndex !== cycleIndex) cachedPlan = createBioCyclePlan(cycleIndex, { seed });
    return cachedPlan;
  };
  function anchor(now) { previous = now; highWater = Math.max(highWater, now.elapsedSeconds); }
  return Object.freeze({
    getPlan(clock) { return planFor(position(clock).cycleIndex); },
    sync(clock) {
      const now = position(clock); planFor(now.cycleIndex); anchor(now); wasPaused = false;
    },
    update(clock, { paused = false } = {}) {
      if (typeof paused !== 'boolean') throw new TypeError('paused must be boolean');
      const now = position(clock), plan = planFor(now.cycleIndex), before = previous, consumed = highWater;
      const resuming = wasPaused; wasPaused = paused; anchor(now);
      if (paused || resuming || !before || now.elapsedSeconds <= consumed
        || now.elapsedSeconds - before.elapsedSeconds > BIO_SCHEDULE_CONFIG.maxStepSeconds
        || now.cycleIndex !== before.cycleIndex || now.timeOfDay !== before.timeOfDay) return null;
      return plan.events.find(event => event.timeOfDay === now.timeOfDay
        && event.scheduledSeconds > consumed && event.scheduledSeconds <= now.elapsedSeconds
        && now.elapsedSeconds <= event.latestStartSeconds
        && now.elapsedSeconds + event.durationSeconds <= event.phaseEndSeconds) ?? null;
    },
    get state() {
      return Object.freeze({ cachedCycleIndex: cachedPlan?.cycleIndex ?? null,
        retainedCycleCount: cachedPlan ? 1 : 0, cachedEventCount: cachedPlan?.events.length ?? 0,
        consumedThroughSeconds: Number.isFinite(highWater) ? highWater : null, paused: wasPaused });
    },
  });
}
