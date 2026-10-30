// S1 D11. All geometry is in client CSS pixels; all evidence times are active
// milliseconds from the delivery clock. No clock, DOM, RNG or domain writes.
export const QTE_OPERATIONS = Object.freeze(['flick', 'swipe', 'tap', 'target']);
export const QTE_DIRECTIONS = Object.freeze({
  up: Object.freeze({ x: 0, y: -1 }), right: Object.freeze({ x: 1, y: 0 }),
  down: Object.freeze({ x: 0, y: 1 }), left: Object.freeze({ x: -1, y: 0 }),
});
export const QTE_GESTURE_LIMITS = Object.freeze({ flickPixels: 35, flickMs: 300, flickDegrees: 35,
  swipePixels: 75, swipeDegrees: 30, tapMs: 350, tapPixels: 14, taps: 3, mouseRadius: 32, touchRadius: 40 });

const finite = Number.isFinite;
const inside = (x, y, rect) => rect && [x, y, rect.left, rect.top, rect.right, rect.bottom].every(finite)
  && rect.left <= x && x <= rect.right && rect.top <= y && y <= rect.bottom;

export function scoreQteContact({ descriptor, contact, window }) {
  const c = contact, geometry = c?.geometry;
  if (!QTE_OPERATIONS.includes(descriptor?.operation) || !c || c.cancelled || !['mouse', 'touch'].includes(c.pointerType)
    || c.isPrimary !== true || c.pointerType === 'mouse' && c.button !== 0
    || !geometry || geometry.revision !== c.displayRevision || !window
    || ![window.active, window.deadline, window.cut, c.downSource, c.upSource, c.downReceipt, c.upReceipt,
      c.startX, c.startY, c.endX, c.endY, c.maxDisplacement].every(finite)
    || window.active > c.downSource || c.downSource > c.upSource || c.upSource > window.deadline
    || c.downReceipt < c.downSource || c.upReceipt < c.upSource || c.downReceipt >= window.cut || c.upReceipt >= window.cut
    || !inside(c.startX, c.startY, geometry.region) || c.maxDisplacement < 0) return false;
  const dx = c.endX - c.startX, dy = c.endY - c.startY, elapsed = c.upSource - c.downSource;
  if (descriptor.operation === 'tap') return elapsed <= QTE_GESTURE_LIMITS.tapMs && c.maxDisplacement <= QTE_GESTURE_LIMITS.tapPixels
    && Math.hypot(dx, dy) <= c.maxDisplacement;
  if (descriptor.operation === 'target') {
    const target = geometry.target, radius = c.pointerType === 'mouse' ? QTE_GESTURE_LIMITS.mouseRadius : QTE_GESTURE_LIMITS.touchRadius;
    return target && [target.x, target.y].every(finite)
      && Math.hypot(c.startX - target.x, c.startY - target.y) <= radius
      && Math.hypot(c.endX - target.x, c.endY - target.y) <= radius;
  }
  const direction = QTE_DIRECTIONS[descriptor.direction];
  if (!direction) return false;
  const flick = descriptor.operation === 'flick', distance = Math.hypot(dx, dy);
  if (distance < (flick ? 35 : 75) || flick && elapsed > 300) return false;
  // Compare the cross products with the boundary vector. This avoids dividing
  // by cos(theta), introducing neither an epsilon nor angular grace.
  const forward = dx * direction.x + dy * direction.y;
  const sideways = Math.abs(dx * direction.y - dy * direction.x);
  const angle = (flick ? 35 : 30) * Math.PI / 180;
  return forward > 0 && sideways * Math.cos(angle) <= forward * Math.sin(angle);
}

export function evaluateQteOperation({ descriptor, handle, window, previous, edges, completedOperations = 0, final = false }) {
  if (!QTE_OPERATIONS.includes(descriptor?.operation) || descriptor.fightId !== handle?.fightId || descriptor.index !== handle?.index)
    throw new TypeError('QTE descriptor must match the delivery identity');
  const limit = descriptor.operation === 'tap' ? 3 : 1;
  const base = Math.max(previous?.completedOperations ?? 0, completedOperations);
  if (!Number.isInteger(base) || base < 0 || base > limit || !Array.isArray(edges) || typeof final !== 'boolean') throw new TypeError('Invalid QTE evidence');
  const after = previous?.throughSerial ?? -1;
  let count = base, throughSerial = after;
  const downs = new Map(), counted = new Set();
  for (const edge of [...edges].sort((a, b) => a.source - b.source || a.serial - b.serial)) {
    if (!Number.isSafeInteger(edge.serial) || edge.serial < 0) continue;
    throughSerial = Math.max(throughSerial, edge.serial);
    if (edge.serial <= after) continue;
    const c = edge.contact;
    if (!c || c.adapter !== handle.adapter || c.instance !== handle.instance || c.fightId !== handle.fightId || c.index !== handle.index) continue;
    if (edge.type === 'down' && edge.source === c.downSource && edge.receipt === c.downReceipt) downs.set(c.serial, edge);
    const down = downs.get(c.serial);
    if (edge.type !== 'up' || !down || counted.has(c.serial) || edge.source !== c.upSource || edge.receipt !== c.upReceipt
      || down.contact.generation !== c.generation || down.contact.lifecycle !== c.lifecycle
      || down.contact.pointerId !== c.pointerId || down.contact.displayRevision !== c.displayRevision
      || down.contact.pointerType !== c.pointerType || down.contact.geometry !== c.geometry) continue;
    counted.add(c.serial);
    if (scoreQteContact({ descriptor, contact: c, window })) count = Math.min(limit, count + 1);
  }
  return Object.freeze({ success: previous?.success === true || count === limit, completedOperations: count, throughSerial });
}

// Provider descriptors are cached immutable values shared by domain selection,
// the HUD and this consumer. Calling evaluate repeatedly never advances RNG.
export function createQteEvaluator(provider) {
  return input => evaluateQteOperation({ ...input, descriptor: provider.getDescriptor(input.handle.index) });
}
