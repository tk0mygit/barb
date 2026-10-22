import { FISH_SPECIES, getFishSpecies } from './fish-species.js';
import { calculateSalePrice, addMoney } from './fish-sales.js';

// Copy mutable data, but preserve already deeply frozen encounter snapshots.
function immutable(value) {
  if (!value || typeof value !== 'object') return value;
  const entries = Object.entries(value).map(([key, item]) => [key, immutable(item)]);
  if (Object.isFrozen(value) && entries.every(([key, item]) => value[key] === item)) return value;
  return Object.freeze(Array.isArray(value) ? entries.map(([, item]) => item) : Object.fromEntries(entries));
}

// Session data only. History is authoritative; storage is a disposition view.
// Discovery is recorded on capture, before any storage/sale decision.
export function createCatchCollection({ now = Date.now } = {}) {
  let catches = Object.freeze([]);
  let wallet = Object.freeze({ balance: 0, lifetimeSales: 0 });
  const indices = new Map();
  const statistics = new Map();
  const encyclopedia = () => Object.freeze(FISH_SPECIES.map(({ id }) => Object.freeze({
    speciesId: id, count: statistics.get(id)?.count ?? 0,
    maxLengthCm: statistics.get(id)?.maxLengthCm ?? null,
  })));
  const stored = () => Object.freeze(catches.filter(record => record.disposition === 'stored'));
  function quote(ids, disposition) {
    if (!Array.isArray(ids) || !ids.length || new Set(ids).size !== ids.length) return null;
    const records = ids.map(id => catches[indices.get(id)]);
    if (records.some(record => !record || record.disposition !== disposition)) return null;
    try {
      const prices = records.map(calculateSalePrice);
      const total = prices.reduce(addMoney, 0);
      return { records, prices, total };
    } catch (error) {
      if (error instanceof RangeError) return null;
      throw error;
    }
  }
  function sell(ids, disposition) {
    const sale = quote(ids, disposition);
    if (!sale) return null;
    // Validate every price, both balances and the timestamp before replacing
    // any record. No callbacks/await between the state changes: all or nothing.
    let nextWallet, soldAt;
    try {
      nextWallet = Object.freeze({ balance: addMoney(wallet.balance, sale.total), lifetimeSales: addMoney(wallet.lifetimeSales, sale.total) });
      soldAt = new Date(now()).toISOString();
    } catch (error) {
      if (error instanceof RangeError) return null;
      throw error;
    }
    const replacements = new Map(sale.records.map((record, index) => [record.id,
      Object.freeze({ ...record, disposition: 'sold', salePrice: sale.prices[index], soldAt })]));
    const nextCatches = Object.freeze(catches.map(record => replacements.get(record.id) ?? record));
    const receipt = Object.freeze({ ids: Object.freeze([...ids]), count: ids.length, total: sale.total, soldAt });
    catches = nextCatches; wallet = nextWallet;
    return receipt;
  }
  return {
    get catches() { return catches; },
    get stored() { return stored(); },
    get encyclopedia() { return encyclopedia(); },
    get wallet() { return wallet; },
    get snapshot() {
      return Object.freeze({ schemaVersion: 1, catches, storedIds: Object.freeze(stored().map(record => record.id)), encyclopedia: encyclopedia(), wallet });
    },
    sellUnassigned(id) { return sell([id], 'unassigned'); },
    sellStored(ids) { return sell(ids, 'stored'); },
    quoteStored() {
      const ids = stored().map(record => record.id), sale = quote(ids, 'stored');
      return sale ? Object.freeze({ ids: Object.freeze(ids), count: ids.length, total: sale.total }) : null;
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
