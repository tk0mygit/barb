import { parseSaveData, serializeSaveData, validateSaveData, tryRestoreSaveData, SaveDataError, SAVE_LIMITS } from './save-data.js';

export const SAVE_STORAGE_KEYS = Object.freeze(['barb.save.v1.slotA', 'barb.save.v1.slotB']);
const STORAGE_VERSION = 1;
const MAX_SLOT_CHARACTERS = SAVE_LIMITS.jsonCharacters + 256;

function classify(error, operation) {
  if (error?.name === 'QuotaExceededError' || error?.name === 'NS_ERROR_DOM_QUOTA_REACHED') return 'quota-exceeded';
  if (error?.name === 'SecurityError') return 'access-denied';
  return `storage-${operation}-failed`;
}

function inspectSlot(raw, index) {
  if (raw === null) return { index, absent: true };
  try {
    if (typeof raw !== 'string' || raw.length > MAX_SLOT_CHARACTERS) throw new SaveDataError('input-too-large', 'slot');
    let envelope;
    try { envelope = JSON.parse(raw); }
    catch { throw new SaveDataError('invalid-json', 'slot'); }
    if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) throw new SaveDataError('invalid-data', 'slot');
    if (Number.isSafeInteger(envelope.storageVersion) && envelope.storageVersion >= 0 && envelope.storageVersion !== STORAGE_VERSION) {
      throw new SaveDataError('unsupported-version', 'slot.storageVersion');
    }
    const keys = Object.keys(envelope);
    if (keys.length !== 3 || !['storageVersion', 'generation', 'data'].every(key => Object.hasOwn(envelope, key))
      || envelope.storageVersion !== STORAGE_VERSION || !Number.isSafeInteger(envelope.generation) || envelope.generation < 1) {
      throw new SaveDataError('invalid-data', 'slot');
    }
    // Validate the shallow known schema before stringifying: a hostile unknown
    // nested field must not trigger recursive serialization/stack exhaustion.
    const json = JSON.stringify(validateSaveData(envelope.data));
    const data = parseSaveData(json);
    return { index, generation: envelope.generation, data, json };
  } catch (error) {
    if (!(error instanceof SaveDataError)) throw error;
    return { index, error: error.code };
  }
}

// A synchronous localStorage transaction writes exactly one inactive slot.
// The raw two-slot checkpoint is compared immediately before every write. It
// detects other tabs without trusting wall time, including generation reuse.
// localStorage has no compare-and-swap: callers may additionally serialize
// cooperative tabs with Web Locks, but must not assume this check is a lock.
export function createSaveStorage({ getStorage = () => globalThis.localStorage } = {}) {
  const listeners = new Set();
  let status = Object.freeze({ phase: 'unavailable', code: 'not-loaded', canSave: false,
    generation: 0, savedAt: null, restoredFromBackup: false });
  let loaded = false, state = null, baseline = null, selected = null, blocked = false;
  const publish = changes => {
    status = Object.freeze({ ...status, ...changes });
    for (const listener of listeners) {
      try { listener(status); } catch (error) { console.error('Save status subscriber failed', error); }
    }
    return status;
  };
  function read() {
    const storage = getStorage(); // Property access itself can throw SecurityError.
    if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') {
      const error = new Error('Storage unavailable'); error.name = 'StorageUnavailableError'; throw error;
    }
    return { storage, raw: SAVE_STORAGE_KEYS.map(key => storage.getItem(key)) };
  }
  function failAccess(error, operation) {
    const code = classify(error, operation);
    publish({ phase: baseline === null || code === 'access-denied' || error?.name === 'StorageUnavailableError' ? 'unavailable' : 'failed',
      code, canSave: !blocked && baseline !== null });
    return { ok: false, status };
  }
  function conflict() {
    blocked = true;
    publish({ phase: 'conflict', code: 'external-change', canSave: false });
  }
  return {
    get status() { return status; },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    load() {
      // A live session cannot silently adopt a new checkpoint and authorize
      // overwriting it with domains that were constructed from an older one.
      if (loaded) return { state, status };
      loaded = true;
      let raw;
      try { ({ raw } = read()); }
      catch (error) { blocked = true; failAccess(error, 'read'); return { state, status }; }
      baseline = raw;
      const slots = raw.map(inspectSlot);
      const valid = slots.filter(slot => slot.data).sort((a, b) => b.generation - a.generation);
      const unsupported = slots.some(slot => slot.error === 'unsupported-version');
      const duplicate = valid.length === 2 && valid[0].generation === valid[1].generation;
      if (duplicate) {
        blocked = true;
        publish({ phase: 'protected', code: 'duplicate-generation', canSave: false });
        return { state, status };
      }
      if (!valid.length) {
        blocked = slots.some(slot => !slot.absent);
        publish({ phase: blocked ? 'protected' : 'empty', code: unsupported ? 'unsupported-version' : blocked ? 'invalid-data' : null,
          canSave: !blocked });
        return { state, status };
      }
      const candidate = valid[0];
      let restored;
      try { restored = tryRestoreSaveData(candidate.json); }
      catch {
        blocked = true;
        publish({ phase: 'protected', code: 'restore-failed', canSave: false });
        return { state, status };
      }
      if (!restored.ok) {
        blocked = true;
        publish({ phase: 'protected', code: restored.error.code, canSave: false });
        return { state, status };
      }
      state = restored.state;
      selected = candidate;
      const backup = slots.some(slot => slot.error);
      blocked = unsupported || candidate.generation === Number.MAX_SAFE_INTEGER;
      publish({ phase: blocked ? 'protected' : backup ? 'backup' : 'restored',
        code: unsupported ? 'unsupported-version' : blocked ? 'generation-exhausted' : null,
        canSave: !blocked, generation: candidate.generation, savedAt: candidate.data.savedAt, restoredFromBackup: backup });
      return { state, status };
    },
    checkForExternalChanges() {
      if (!loaded || baseline === null || blocked) return false;
      let current;
      try { current = read().raw; }
      catch (error) { failAccess(error, 'read'); return false; }
      if (current.some((value, i) => value !== baseline[i])) { conflict(); return true; }
      return false;
    },
    save(data) {
      if (!loaded || blocked || baseline === null) return { ok: false, status };
      let json;
      try { json = serializeSaveData(data); }
      catch (error) {
        publish({ phase: 'failed', code: error instanceof SaveDataError ? error.code : 'serialization-failed', canSave: true });
        return { ok: false, status };
      }
      const savedAt = data.savedAt;
      const generation = (selected?.generation ?? 0) + 1;
      if (!Number.isSafeInteger(generation)) {
        blocked = true;
        publish({ phase: 'protected', code: 'generation-exhausted', canSave: false });
        return { ok: false, status };
      }
      const index = selected ? 1 - selected.index : 0;
      const raw = `{"storageVersion":${STORAGE_VERSION},"generation":${generation},"data":${json}}`;
      let current;
      try { current = read(); }
      catch (error) { return failAccess(error, 'read'); }
      if (current.raw.some((value, i) => value !== baseline[i])) {
        conflict(); return { ok: false, status };
      }
      try { current.storage.setItem(SAVE_STORAGE_KEYS[index], raw); }
      catch (error) { return failAccess(error, 'write'); }
      baseline = [...baseline]; baseline[index] = raw;
      selected = { index, generation };
      publish({ phase: generation === Number.MAX_SAFE_INTEGER ? 'protected' : 'saved',
        code: generation === Number.MAX_SAFE_INTEGER ? 'generation-exhausted' : null,
        canSave: generation < Number.MAX_SAFE_INTEGER, generation, savedAt });
      if (generation === Number.MAX_SAFE_INTEGER) blocked = true;
      return { ok: true, status };
    },
  };
}
