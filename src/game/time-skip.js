import { GAME_CLOCK_CONFIG } from './game-clock.js';

export const TIME_SKIP_RATE = 18;
export const TIME_SKIP_MAX_SECONDS = 10;

// The only owner of an in-flight skip. Its lifetime is deliberately absent
// from save data. step() reports the whole finishing frame as clock-only.
export function createTimeSkip(clock, config = GAME_CLOCK_CONFIG) {
  const { daySeconds, nightSeconds } = { ...GAME_CLOCK_CONFIG, ...config };
  const cycle = daySeconds + nightSeconds;
  let run = null;
  return Object.freeze({
    get active() { return run !== null; },
    start(allowed = false) {
      if (!allowed || run) return false;
      const state = clock.state;
      const rawCycle = state.elapsedSeconds % cycle;
      // The clock rounds very close phase boundaries. Honor that same phase
      // even when a restored value lies a fraction below a cycle boundary.
      const base = state.elapsedSeconds - rawCycle + (state.cycleSeconds === 0 && rawCycle > daySeconds ? cycle : 0);
      const boundary = base + (state.timeOfDay === 'day' ? daySeconds : cycle);
      const remaining = boundary - state.elapsedSeconds;
      if (!Number.isFinite(boundary) || remaining <= 0 || remaining > TIME_SKIP_RATE * TIME_SKIP_MAX_SECONDS + 1e-9) return false;
      run = { timeOfDay: state.timeOfDay, boundary, remaining, expected: state.elapsedSeconds,
        seconds: 0, compensation: 0, advanced: 0 };
      return true;
    },
    cancel() { run = null; },
    step(frameSeconds) {
      if (!run) { clock.step(frameSeconds); return false; }
      const state = clock.state;
      // Another owner, a restored clock or a bad timestamp cannot silently
      // move the fixed target, re-arm the skip or bank a later catch-up.
      if (state.elapsedSeconds !== run.expected || state.timeOfDay !== run.timeOfDay
        || !Number.isFinite(frameSeconds) || frameSeconds < 0) { run = null; return true; }
      const duration = Math.min(TIME_SKIP_MAX_SECONDS, run.remaining / TIME_SKIP_RATE);
      const corrected = frameSeconds - run.compensation;
      const next = run.seconds + corrected;
      run.compensation = (next - run.seconds) - corrected;
      run.seconds = Math.min(duration, next);
      const finished = duration - run.seconds < 1e-12;
      const advanced = finished ? run.remaining : Math.min(run.remaining, run.seconds * TIME_SKIP_RATE);
      clock.step(Math.max(0, advanced - run.advanced));
      run.advanced = advanced;
      run.expected = clock.state.elapsedSeconds;
      if (finished || run.expected >= run.boundary || clock.state.timeOfDay !== run.timeOfDay) run = null;
      return true;
    },
  });
}
