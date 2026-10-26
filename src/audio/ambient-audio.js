import { sampleAudioMix } from './audio-mix.js';
import { createAudioPreferences, validateAudioPreferences } from './audio-preferences.js';
import { createAmbientPlayer } from './ambient-player.js';
import { createBioPlayer } from './bio-player.js';

// No DOM, independent clocks, save subscriptions or input-state side effects.
export function createAmbientAudio({ session, clock, preferencesStore = createAudioPreferences(), player = createAmbientPlayer(),
  bioPlayer = createBioPlayer({ clock }) }) {
  let { preferences, persistence } = preferencesStore.load();
  const pauses = new Set(), mix = {};
  let playback = 'off', failed = false, disposed = false, lastPublished;
  const listeners = new Set();
  const snapshot = () => ({ preferences, persistence, playback, mode: mix.mode });
  function publish() {
    if (lastPublished?.preferences === preferences && lastPublished.persistence === persistence
      && lastPublished.playback === playback && lastPublished.mode === mix.mode) return;
    const next = snapshot(); lastPublished = next;
    for (const listener of listeners) { try { listener(next); } catch { /* UI cannot interrupt fishing. */ } }
  }
  function update() {
    if (disposed) return;
    const clockState = clock.state;
    sampleAudioMix(clockState, mix);
    if (!preferences.enabled) playback = 'off';
    else if (session.status === 'unsupported') playback = 'unsupported';
    else if (failed || session.status === 'blocked') playback = 'blocked';
    else if (session.status === 'interrupted') playback = 'interrupted';
    else if (session.status === 'starting') playback = 'starting';
    else if (session.status !== 'ready') playback = 'waiting';
    else if (session.context?.state !== 'running') playback = 'interrupted';
    else if (pauses.size) playback = 'paused';
    else if (!preferences.volume) playback = 'muted';
    else playback = 'playing';
    try {
      if (playback === 'playing') player.play(session.context, mix, preferences.volume, clockState.elapsedSeconds);
      else player.stop({ immediate: session.context?.state !== 'running', freeBuffers: !preferences.enabled });
    } catch { failed = true; playback = 'blocked'; }
    // Acquisition/playback failures in the optional one-shot layer must never
    // mark the existing BGM/nature bank as blocked or interrupt fishing input.
    try { bioPlayer.update({ context: session.context, mix, volume: preferences.volume,
      enabled: preferences.enabled, playing: playback === 'playing', ready: session.status === 'ready' }); }
    catch { /* Independent layer; the regular bank and its UI remain valid. */ }
    publish();
  }
  const unsubscribe = session.subscribe(update);
  update();
  return {
    get state() { return snapshot(); },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    update,
    setPaused(reason, paused) { if (paused) pauses.add(reason); else pauses.delete(reason); update(); },
    setPreferences(changes) {
      const next = validateAudioPreferences({ ...preferences, ...changes });
      if (!next || (next.enabled === preferences.enabled && next.volume === preferences.volume)) return;
      preferences = next; failed = false;
      persistence = preferencesStore.save(preferences);
      update();
    },
    // Must be invoked by a user gesture, including retry after mobile interruption.
    unlock() {
      if (disposed) return;
      const retryBio = failed || session.status !== 'ready' || session.context?.state !== 'running';
      failed = false;
      if (retryBio) { try { bioPlayer.retry(); } catch { /* Retry is best effort for this layer. */ } }
      session.unlock().then(update).catch(() => { failed = true; update(); });
    },
    dispose() {
      disposed = true; unsubscribe(); listeners.clear();
      try { bioPlayer.dispose(); } catch { /* Always release the regular bank. */ }
      player.dispose();
    },
  };
}
