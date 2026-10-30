import { QTE_DELIVERY_CONFIG } from '../game/qte-delivery-config.js';

export const QTE_SUSPEND_REASONS = Object.freeze(['hidden', 'blur', 'menu', 'page', 'orientation', 'technical', 'display']);

// A single, explicit Window clock. Old history is rejected, never reconstructed
// with Date.now(), the normal-input origin, a deadline clamp, or receipt-only time.
export function createQteClock({ now = () => performance.now(), timestampMode = 'relative', timeOrigin,
  historyCapacity = QTE_DELIVERY_CONFIG.clockHistoryCapacity } = {}) {
  if (!['relative', 'epoch'].includes(timestampMode) || timestampMode === 'epoch' && !Number.isFinite(timeOrigin)) throw new TypeError('Explicit timestamp origin required');
  if (!Number.isInteger(historyCapacity) || historyCapacity < 2) throw new RangeError('Invalid clock history capacity');
  const start = now();
  if (!Number.isFinite(start) || start < 0) throw new RangeError('Invalid monotonic clock');
  let last = start, revision = 0;
  const reasons = new Set(), history = [{ raw: start, active: 0, suspended: false, revision }];
  function read(raw = now()) {
    if (!Number.isFinite(raw) || raw < last) return null;
    last = raw;
    const segment = history.at(-1);
    return { raw, active: segment.active + (segment.suspended ? 0 : raw - segment.raw), suspended: reasons.size > 0, revision };
  }
  function source(timestamp, receipt) {
    const raw = timestampMode === 'epoch' ? timestamp - timeOrigin : timestamp;
    if (!Number.isFinite(raw) || raw < history[0].raw || !receipt || raw > receipt.raw) return null;
    // A coarse timestamp exactly on a suspend transition cannot establish
    // which lifecycle produced it. Reject that ambiguity without an epsilon.
    if (history.slice(1).some(segment => segment.raw === raw)) return null;
    let i = history.length - 1;
    while (i > 0 && history[i].raw > raw) i--;
    const segment = history[i];
    return { raw, active: segment.active + (segment.suspended ? 0 : raw - segment.raw), suspended: segment.suspended, revision: segment.revision };
  }
  function setSuspended(reason, suspended, raw = now()) {
    if (!QTE_SUSPEND_REASONS.includes(reason)) throw new RangeError('Unknown QTE suspend reason');
    const receipt = read(raw);
    if (!receipt) return null;
    const before = reasons.size > 0;
    if (suspended) reasons.add(reason); else reasons.delete(reason);
    if (before !== (reasons.size > 0)) {
      revision++;
      history.push({ raw, active: receipt.active, suspended: reasons.size > 0, revision });
      if (history.length > historyCapacity) history.shift();
    }
    return read(raw);
  }
  return { now, read, source, setSuspended,
    get reasons() { return Object.freeze([...reasons]); },
    get historySize() { return history.length; } };
}
