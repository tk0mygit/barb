// Strict configuration data only. Runtime conditions have a separate, neutral
// normalization boundary in encounter-model.js.
export function record(value, path) {
  if (!value || typeof value !== 'object'
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new TypeError(`${path}: expected a plain record`);
  }
  for (const key of Reflect.ownKeys(value)) {
    if (!Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value')) {
      throw new TypeError(`${path}.${String(key)}: expected a data property`);
    }
  }
  return value;
}

export function exactRecord(value, keys, path) {
  record(value, path);
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) throw new TypeError(`${path}.${key}: required`);
  }
  for (const key of Reflect.ownKeys(value)) {
    if (!keys.includes(key)) throw new RangeError(`${path}.${String(key)}: unknown key`);
  }
  return value;
}

export function denseArray(value, path) {
  if (!Array.isArray(value)) throw new TypeError(`${path}: expected an array`);
  if (value.length === 0) throw new RangeError(`${path}: must not be empty`);
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, index);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError(`${path}[${index}]: required data element (no holes)`);
    }
  }
  for (const key of Reflect.ownKeys(value)) {
    if (key !== 'length' && (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/.test(key))) {
      throw new RangeError(`${path}.${String(key)}: unknown array key`);
    }
  }
  return value;
}

export function orderedIds(values, path) {
  denseArray(values, path);
  const seen = new Set();
  return Object.freeze(values.map((id, index) => {
    if (typeof id !== 'string') throw new TypeError(`${path}[${index}]: expected an ID string`);
    if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(id)) throw new RangeError(`${path}[${index}]: invalid ID ${id}`);
    if (seen.has(id)) throw new RangeError(`${path}[${index}]: duplicate ID ${id}`);
    seen.add(id);
    return id;
  }));
}

export function positive(value, path) {
  if (typeof value !== 'number') throw new TypeError(`${path}: expected a number`);
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${path}: must be finite and > 0`);
  return value;
}

export function positiveTable(value, keys, path) {
  exactRecord(value, keys, path);
  return Object.freeze(Object.fromEntries(keys.map(key => [key, positive(value[key], `${path}.${key}`)])));
}

// Preserve identities of deeply frozen registry records. Mutable records are
// detached recursively; freezing the caller's objects would not be defensive.
export function immutableData(value, path, ancestors = new Set()) {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'function') throw new TypeError(`${path}: expected data, not a function`);
    return value;
  }
  if (ancestors.has(value)) throw new TypeError(`${path}: cyclic data`);
  if (Array.isArray(value)) denseArray(value, path); else record(value, path);
  ancestors.add(value);
  const keys = Reflect.ownKeys(value).filter(key => key !== 'length' || !Array.isArray(value));
  const entries = keys.map(key => [key, immutableData(value[key], `${path}.${String(key)}`, ancestors)]);
  ancestors.delete(value);
  if (Object.isFrozen(value) && entries.every(([key, child]) => child === value[key])) return value;
  return Object.freeze(Array.isArray(value) ? entries.map(([, child]) => child) : Object.fromEntries(entries));
}
