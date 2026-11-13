export const PLAY_PREFERENCES_KEY = 'barb.play.preferences.v1';
export const DEFAULT_PLAY_PREFERENCES = Object.freeze({ version: 1, dayNightSkip: false });

export function validatePlayPreferences(value) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype
    || Reflect.ownKeys(value).length !== 2
    || !['version', 'dayNightSkip'].every(key => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor && 'value' in descriptor;
    }) || value.version !== 1 || typeof value.dayNightSkip !== 'boolean') return null;
  return Object.freeze({ version: 1, dayNightSkip: value.dayNightSkip });
}

// This preference never enters the game checkpoint or the audio store. Read
// the current storage on external events, rather than replaying stale newValue.
export function createPlayPreferences({ getStorage = () => globalThis.localStorage,
  eventTarget = globalThis.window } = {}) {
  let preferences = read();
  const listeners = new Set();
  function read() {
    try {
      const raw = getStorage().getItem(PLAY_PREFERENCES_KEY);
      return typeof raw === 'string' && raw.length <= 128
        ? validatePlayPreferences(JSON.parse(raw)) ?? DEFAULT_PLAY_PREFERENCES : DEFAULT_PLAY_PREFERENCES;
    } catch { return DEFAULT_PLAY_PREFERENCES; }
  }
  function publish(next) {
    if (next.dayNightSkip === preferences.dayNightSkip) return;
    preferences = next;
    for (const listener of listeners) listener(preferences);
  }
  function onStorage(event) {
    if (event.key === null || event.key === PLAY_PREFERENCES_KEY) publish(read());
  }
  eventTarget?.addEventListener('storage', onStorage);
  return Object.freeze({
    get state() { return preferences; },
    setDayNightSkip(enabled) {
      if (typeof enabled !== 'boolean') return;
      const next = validatePlayPreferences({ version: 1, dayNightSkip: enabled });
      try { getStorage().setItem(PLAY_PREFERENCES_KEY, JSON.stringify(next)); }
      catch { /* An unavailable store still permits a session preference. */ }
      publish(next);
    },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    dispose() { eventTarget?.removeEventListener('storage', onStorage); listeners.clear(); },
  });
}
