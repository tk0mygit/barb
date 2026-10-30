import { QTE_OPERATIONS, QTE_DIRECTIONS } from './qte-operations.js';

export function createQteOperationProvider({ fightId, speciesId, lengthCm }) {
  if (!Number.isSafeInteger(fightId) || fightId < 1 || typeof speciesId !== 'string' || !speciesId.trim()
    || !Number.isFinite(lengthCm) || lengthCm <= 0) throw new TypeError('Invalid QTE fight identity');
  // Decimal parsing avoids treating 0.1cm binary representation error as a
  // different individual. Reject precision beyond tenths rather than rounding.
  const match = /^(\d+)(?:\.(\d))?$/.exec(String(lengthCm));
  if (!match) throw new RangeError('QTE length requires integer tenths of a centimetre');
  const tenths = BigInt(match[1]) * 10n + BigInt(match[2] ?? 0);
  if (tenths > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('QTE length exceeds safe integer');
  // Versioned JSON tuple is unambiguous (including embedded separators). NFC
  // preserves case/whitespace; equivalent Unicode spellings share the seed.
  const identity = Object.freeze({ fightId, speciesId: speciesId.normalize('NFC'), lengthTenths: Number(tenths) });
  const seedKey = JSON.stringify(['barb-qte-v1', identity.fightId, identity.speciesId, identity.lengthTenths]);
  // FNV-1a over specified UTF-16 code units; zero maps to a fixed nonzero state.
  let seed = 2166136261;
  for (let i = 0; i < seedKey.length; i++) seed = Math.imul(seed ^ seedKey.charCodeAt(i), 16777619) >>> 0;
  seed = seed || 0x9e3779b9;
  let state = seed;
  const next = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return state >>> 0; };
  const integer = n => {
    // Rejection sampling avoids modulo bias. xorshift32 has nonzero states.
    const ceiling = Math.floor(0xffffffff / n) * n;
    let value; do { value = next() - 1; } while (value >= ceiling);
    return value % n;
  };
  const order = [...QTE_OPERATIONS];
  for (let i = order.length - 1; i > 0; i--) { const j = integer(i + 1); [order[i], order[j]] = [order[j], order[i]]; }
  const directions = Object.keys(QTE_DIRECTIONS);
  const descriptors = Object.freeze(order.map((operation, index) => Object.freeze({ ...identity, seed, seedKey, index, operation,
    direction: ['flick', 'swipe'].includes(operation) ? directions[integer(directions.length)] : null })));
  const getDescriptor = index => {
    if (!Number.isInteger(index) || index < 0 || index > 3) throw new RangeError('Invalid QTE index');
    return descriptors[index];
  };
  return Object.freeze({ identity, seed, seedKey, descriptors, getDescriptor,
    selectOperation: ({ index }) => getDescriptor(index).operation });
}
