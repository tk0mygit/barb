import { createSaveData } from './save-data.js';
import { PHASE } from './fishing.js';

export const AUTOSAVE_TIMING = Object.freeze({ eventDelayMs: 250, minAttemptMs: 1000, intervalMs: 20000, criticalRetryMs: 1000 });
const criticalPhases = new Set([PHASE.CAST, PHASE.BITE, PHASE.FIGHT, PHASE.LANDING]);

// Scheduling is independent of the animation loop: menu transactions are saved
// even while rendering is paused. Browser lifecycle events belong to the caller.
export function createAutosave({ state, storage,
  schedule = (callback, ms) => globalThis.setTimeout(callback, ms),
  cancel = handle => globalThis.clearTimeout(handle),
  repeat = (callback, ms) => globalThis.setInterval(callback, ms),
  cancelRepeat = handle => globalThis.clearInterval(handle),
  now = Date.now, monotonicNow = () => globalThis.performance.now(), eventDelayMs = AUTOSAVE_TIMING.eventDelayMs,
  minAttemptMs = AUTOSAVE_TIMING.minAttemptMs, intervalMs = AUTOSAVE_TIMING.intervalMs,
}) {
  const listeners = new Set();
  let started = false, disposed = false, dirty = false, revision = 0;
  let eventTimer = null, periodicTimer = null, lastAttempt = -Infinity;
  let flushing = false, localFailure = null;
  let unsubscribeCollection, unsubscribeAchievements, unsubscribeStorage;
  let progress = readProgress();

  function readProgress() {
    return { x: state.boat.x, z: state.boat.z, heading: state.boat.heading,
      elapsedSeconds: state.clock.state.elapsedSeconds };
  }
  function status() {
    const current = storage.status;
    return Object.freeze({ ...current,
      ...(localFailure && current.canSave ? { phase: 'failed', code: localFailure } : {}),
      ...(dirty && current.canSave && !['failed', 'unavailable'].includes(current.phase) && !localFailure ? { phase: 'dirty' } : {}),
      dirty, started });
  }
  function notify() {
    if (!listeners.size) return;
    const current = status();
    for (const listener of listeners) {
      try { listener(current); }
      catch (error) { console.error('Autosave subscriber failed', error); }
    }
  }
  function markDirty() {
    revision++;
    const changed = !dirty;
    dirty = true;
    // Progress changes every frame; publish only a status transition.
    if (changed) notify();
  }
  function markProgress() {
    if (!started || disposed) return;
    const next = readProgress();
    if (next.x === progress.x && next.z === progress.z && next.heading === progress.heading
      && next.elapsedSeconds === progress.elapsedSeconds) return;
    progress = next;
    markDirty();
  }
  function queueEventSave() {
    if (!started || disposed) return;
    markDirty();
    if (!storage.status.canSave || eventTimer !== null) return;
    // Fixed first-event deadline avoids starvation under continuous changes.
    const delay = Math.max(eventDelayMs, lastAttempt + minAttemptMs - monotonicNow());
    eventTimer = schedule(() => { eventTimer = null; automaticFlush(); }, delay);
  }
  function automaticFlush() {
    if (!started || disposed) return;
    markProgress();
    if (!dirty || !storage.status.canSave) return;
    const critical = criticalPhases.has(state.fishing?.state.phase);
    const wait = Math.max(0, lastAttempt + minAttemptMs - monotonicNow());
    if (critical || wait > 0) {
      // Large histories cost synchronous validation time. Avoid interrupting a
      // cast, hook window or fight; retry until the next safe gameplay state.
      if (eventTimer === null) eventTimer = schedule(() => { eventTimer = null; automaticFlush(); },
        Math.max(critical ? AUTOSAVE_TIMING.criticalRetryMs : 0, wait));
      return;
    }
    flush();
  }
  function flush() {
    if (!started || disposed) return { ok: false, skipped: true, status: status() };
    markProgress();
    if (!dirty) return { ok: true, skipped: true, status: status() };
    if (flushing || !storage.status.canSave) return { ok: false, skipped: true, status: status() };
    if (eventTimer !== null) { cancel(eventTimer); eventTimer = null; }
    const capturedRevision = revision;
    flushing = true;
    lastAttempt = monotonicNow();
    let ok = false;
    try {
      const data = createSaveData(state, { savedAt: new Date(now()).toISOString() });
      localFailure = null;
      ok = storage.save(data).ok;
      // A synchronous injected storage/subscriber can change state during save.
      // Do not acknowledge that newer state as part of the old checkpoint.
      markProgress();
      if (ok && revision === capturedRevision) dirty = false;
    } catch (error) {
      localFailure = error.code ?? 'save-failed';
    } finally {
      flushing = false;
      notify();
    }
    // ok acknowledges this checkpoint only; dirty can remain true if a newer
    // revision arrived during its synchronous write.
    return { ok, status: status() };
  }
  return Object.freeze({
    start() {
      if (started || disposed) return;
      started = true;
      unsubscribeStorage = storage.subscribe(notify);
      unsubscribeCollection = state.collection.subscribe(queueEventSave);
      unsubscribeAchievements = state.achievements.subscribe(queueEventSave);
      // A new session has no durable checkpoint, even before its first frame.
      if (storage.status.phase === 'empty') markDirty();
      markProgress();
      periodicTimer = repeat(automaticFlush, intervalMs);
      notify();
    },
    markProgress,
    flush,
    checkForExternalChanges() { return storage.checkForExternalChanges(); },
    get status() { return status(); },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    dispose() {
      if (disposed) return;
      disposed = true;
      started = false;
      if (eventTimer !== null) cancel(eventTimer);
      if (periodicTimer !== null) cancelRepeat(periodicTimer);
      unsubscribeCollection?.(); unsubscribeAchievements?.(); unsubscribeStorage?.();
      listeners.clear();
    },
  });
}
