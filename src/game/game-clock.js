export const GAME_CLOCK_CONFIG = Object.freeze({ daySeconds: 180, nightSeconds: 180 });

// Active elapsed time only; caller supplies monotonic frame deltas and pause
// state. No wall-clock reads, rendering dependencies or per-frame time rounding.
export function createGameClock(config = GAME_CLOCK_CONFIG, { elapsedSeconds: initialSeconds = 0 } = {}) {
  const { daySeconds, nightSeconds } = { ...GAME_CLOCK_CONFIG, ...config };
  const cycleDuration = daySeconds + nightSeconds;
  if (![daySeconds, nightSeconds, cycleDuration].every(n => Number.isFinite(n) && n > 0)) throw new RangeError('Clock durations must be finite positive seconds');
  if (!Number.isFinite(initialSeconds) || initialSeconds < 0) throw new RangeError('Elapsed seconds must be finite and non-negative');
  let elapsedSeconds = initialSeconds, compensation = 0;
  return {
    step(dt, paused = false) {
      if (paused || !Number.isFinite(dt) || dt <= 0) return;
      const corrected = dt - compensation;
      const next = elapsedSeconds + corrected;
      if (!Number.isFinite(next)) return;
      compensation = (next - elapsedSeconds) - corrected;
      elapsedSeconds = next;
    },
    get state() {
      let cycleSeconds = elapsedSeconds % cycleDuration;
      // Resolve sub-nanosecond rounding at phase/cycle boundaries equally at
      // 30, 60 and 144fps, without shifting meaningful near-boundary times.
      if (cycleDuration - cycleSeconds < 1e-9) cycleSeconds = 0;
      if (Math.abs(cycleSeconds - daySeconds) < 1e-9) cycleSeconds = daySeconds;
      const timeOfDay = cycleSeconds < daySeconds ? 'day' : 'night';
      const phaseSeconds = timeOfDay === 'day' ? cycleSeconds : cycleSeconds - daySeconds;
      return Object.freeze({ elapsedSeconds, cycleSeconds, cycleProgress: cycleSeconds / cycleDuration,
        timeOfDay, phaseProgress: phaseSeconds / (timeOfDay === 'day' ? daySeconds : nightSeconds) });
    },
  };
}
