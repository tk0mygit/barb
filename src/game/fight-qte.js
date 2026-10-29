// Pure, transient FIGHT contracts. No input events, RNG, sale or save data.
export const QTE_TIMING = Object.freeze({ warningSeconds: 0.6, gapSeconds: 0.8, armSeconds: 0.22, tapSeconds: 2 });
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
function decimal(value) {
  const text = String(value);
  if (!/^\d+(\.\d+)?$/.test(text)) throw new RangeError('Expected a finite nonnegative decimal');
  const [whole, fraction = ''] = text.split('.');
  return [BigInt(whole + fraction), 10n ** BigInt(fraction.length)];
}
const gcd = (a, b) => b ? gcd(b, a % b) : a;
export function getQteDifficulty(species, lengthCm) {
  const [ln, ld] = decimal(lengthCm);
  if (ln * 10n % ld) throw new RangeError('Fish length must be rounded to 0.1cm');
  const low = BigInt(species.minLengthCm * 10), high = BigInt(species.maxLengthCm * 10), length = ln * 10n / ld;
  if (high <= low || length < low || length > high) throw new RangeError('Fish length outside species range');
  const [bn, bd] = decimal(species.fight.baseResistance), span = high - low;
  let numerator = bn * 100n * span + 35n * (length - low) * bd, denominator = bd * 100n * span;
  const divisor = gcd(numerator, denominator); numerator /= divisor; denominator /= divisor;
  const below = (n, d) => numerator * BigInt(d) < BigInt(n) * denominator;
  const count = below(19, 20) ? 1 : below(13, 10) ? 2 : 3;
  const seconds = below(9, 10) ? 1.5 : below(5, 4) ? 1 : 0.5;
  return Object.freeze({ numerator: String(numerator), denominator: String(denominator),
    // Approximation is metadata only; all comparisons above use cross products.
    value: Number(numerator) / Number(denominator), ratio: Number(length - low) / Number(span),
    count, seconds, tapSeconds: QTE_TIMING.tapSeconds,
    thresholds: Object.freeze(count === 1 ? [0.4] : count === 2 ? [0.3, 0.7] : [0.2, 0.5, 0.8]) });
}
export function qteSeconds(difficulty, operation) {
  if (!['flick', 'swipe', 'target', 'tap'].includes(operation)) throw new RangeError('Unknown QTE operation');
  return operation === 'tap' ? difficulty.tapSeconds : difficulty.seconds;
}
export function getFightScale(startDistance, landingDistance = 4.5, span = 27.5) {
  return clamp((startDistance - landingDistance) / span, 0, 1);
}
export function applyQteEffect(state, success, failures, startDistance, scale, landingDistance = 4.5, allowance = 4) {
  if (success) {
    state.distance = Math.max(landingDistance, state.distance - Math.min(1.2, startDistance * 0.08));
    state.tension += clamp(0.45 - state.tension, -0.10, 0.10);
  } else {
    const n = Math.min(3, failures);
    state.distance = Math.min(startDistance + allowance, state.distance + 0.5 * n * scale);
    state.tension = Math.min(0.98, state.tension + 0.06 * n);
  }
}
export class FightQteSchedule {
  constructor(difficulty, startDistance, landingDistance, enabled) {
    this.startDistance = startDistance; this.landingDistance = landingDistance;
    this.entries = (enabled ? difficulty.thresholds : []).map((progress, index) => ({ index, progress, status: 'reserved' }));
    this.nextNormalAt = 0; this.active = null;
  }
  observe(distance) {
    const progress = clamp((this.startDistance - distance) / (this.startDistance - this.landingDistance), 0, 1);
    for (const entry of this.entries) if (entry.status === 'reserved' && progress >= entry.progress) entry.status = 'pending';
  }
  get pending() { return this.entries.some(e => e.status === 'pending'); }
  start(normalTime) {
    if (this.active || normalTime < this.nextNormalAt) return null;
    const entry = this.entries.find(e => e.status === 'pending');
    if (!entry) return null;
    entry.status = 'active'; this.active = entry; return entry;
  }
  resolve(normalTime) {
    if (!this.active) return false;
    this.active.status = 'done'; this.active = null; this.nextNormalAt = normalTime + QTE_TIMING.gapSeconds; return true;
  }
  abort() { for (const entry of this.entries) if (entry.status !== 'done') entry.status = 'cancelled'; this.active = null; }
  get complete() { return this.entries.every(e => e.status === 'done'); }
}
