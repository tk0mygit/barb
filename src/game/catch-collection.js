import { FISH_SPECIES, getFishSpecies } from './fish-species.js';

// Copy mutable data, but preserve already deeply frozen encounter snapshots.
function immutable(value) {
  if (!value || typeof value !== 'object') return value;
  const entries = Object.entries(value).map(([key, item]) => [key, immutable(item)]);
  if (Object.isFrozen(value) && entries.every(([key, item]) => value[key] === item)) return value;
  return Object.freeze(Array.isArray(value) ? entries.map(([, item]) => item) : Object.fromEntries(entries));
}

// Session data only. History is authoritative; storage is a disposition view.
// Discovery is recorded on capture, before any storage/future sale decision.
export function createCatchCollection() {
  let catches = Object.freeze([]);
  const indices = new Map();
  const statistics = new Map();
  const encyclopedia = () => Object.freeze(FISH_SPECIES.map(({ id }) => Object.freeze({
    speciesId: id, count: statistics.get(id)?.count ?? 0,
    maxLengthCm: statistics.get(id)?.maxLengthCm ?? null,
  })));
  const stored = () => Object.freeze(catches.filter(record => record.disposition === 'stored'));
  return {
    get catches() { return catches; },
    get stored() { return stored(); },
    get encyclopedia() { return encyclopedia(); },
    get snapshot() {
      return Object.freeze({ schemaVersion: 1, catches, storedIds: Object.freeze(stored().map(record => record.id)), encyclopedia: encyclopedia() });
    },
    register(record) {
      if (indices.has(record?.id)) return catches[indices.get(record.id)];
      if (!record || record.schemaVersion !== 1 || typeof record.id !== 'string' || !record.id
        || !getFishSpecies(record.speciesId) || !Number.isFinite(record.lengthCm) || record.lengthCm <= 0
        || !Number.isFinite(record.weightKg) || record.weightKg <= 0 || !Number.isFinite(Date.parse(record.caughtAt))) {
        throw new TypeError('Invalid catch record');
      }
      const captured = immutable({ ...record, disposition: 'unassigned' });
      indices.set(captured.id, catches.length);
      catches = Object.freeze([...catches, captured]);
      const previous = statistics.get(captured.speciesId);
      statistics.set(captured.speciesId, { count: (previous?.count ?? 0) + 1,
        maxLengthCm: Math.max(previous?.maxLengthCm ?? 0, captured.lengthCm) });
      return captured;
    },
    store(id) {
      const index = indices.get(id);
      if (index === undefined) return null;
      const record = catches[index];
      if (record.disposition === 'stored') return record;
      if (record.disposition !== 'unassigned') return null;
      const retained = Object.freeze({ ...record, disposition: 'stored' });
      catches = Object.freeze(catches.map((item, i) => i === index ? retained : item));
      return retained;
    },
  };
}
