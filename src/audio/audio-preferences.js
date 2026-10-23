export const AUDIO_PREFERENCES_KEY = 'barb.audio.preferences.v1';
export const DEFAULT_AUDIO_PREFERENCES = Object.freeze({ version: 1, enabled: false, volume: 40 });

// Small, strict user preferences, deliberately independent of game save v1.
export function validateAudioPreferences(value) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype
    || Reflect.ownKeys(value).length !== 3
    || !['version', 'enabled', 'volume'].every(key => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor && 'value' in descriptor;
    }) || value.version !== 1 || typeof value.enabled !== 'boolean'
    || !Number.isInteger(value.volume) || value.volume < 0 || value.volume > 100) return null;
  return Object.freeze({ version: 1, enabled: value.enabled, volume: value.volume });
}

export function createAudioPreferences({ getStorage = () => globalThis.localStorage } = {}) {
  return {
    load() {
      try {
        const raw = getStorage().getItem(AUDIO_PREFERENCES_KEY);
        if (raw === null) return { preferences: DEFAULT_AUDIO_PREFERENCES, persistence: 'default' };
        const preferences = typeof raw === 'string' && raw.length <= 256 ? validateAudioPreferences(JSON.parse(raw)) : null;
        return { preferences: preferences || DEFAULT_AUDIO_PREFERENCES, persistence: preferences ? 'loaded' : 'invalid' };
      } catch (error) {
        return { preferences: DEFAULT_AUDIO_PREFERENCES, persistence: error instanceof SyntaxError ? 'invalid' : 'unavailable' };
      }
    },
    save(value) {
      const preferences = validateAudioPreferences(value);
      if (!preferences) return 'invalid';
      try { getStorage().setItem(AUDIO_PREFERENCES_KEY, JSON.stringify(preferences)); return 'saved'; }
      catch { return 'failed'; }
    },
  };
}
