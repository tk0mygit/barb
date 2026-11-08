import { PHASE } from '../game/fishing.js';

// Presentation observes committed state only. The achievement manager subscribes
// first, so defer its notifications until the entire synchronous change is known.
export function createDiscoveryCoordinator({ collection, fishing, achievements,
  achievementNotice, discoveryNotice, schedule = queueMicrotask }) {
  const known = new Set(collection.encyclopedia.filter(entry => entry.count > 0).map(entry => entry.speciesId));
  let observed = collection.catches.length, candidate = null, active = null;
  let buffered = [], scheduled = false, disposed = false;
  const matches = record => fishing.state.phase === PHASE.RESULT
    && fishing.state.catch?.id === record.id && fishing.state.catch?.speciesId === record.speciesId;
  function flush() {
    scheduled = false;
    if (disposed) return;
    if (candidate && !matches(candidate)) candidate = null;
    achievementNotice.setPaused(Boolean(candidate || active));
    const awards = buffered; buffered = [];
    if (awards.length) achievementNotice.notify(awards);
  }
  function requestFlush() {
    if (scheduled || disposed) return;
    scheduled = true; schedule(flush);
  }
  const unsubscribeAwards = achievements.subscribe(awards => {
    buffered.push(...awards); requestFlush();
  });
  const unsubscribeCollection = collection.subscribe(() => {
    const records = collection.catches;
    for (const record of records.slice(observed)) {
      if (known.has(record.speciesId)) continue;
      known.add(record.speciesId);
      if (collection.encyclopedia.find(entry => entry.speciesId === record.speciesId)?.count === 1
        && fishing.state.phase === PHASE.LANDING && fishing.state.encounter?.speciesId === record.speciesId
        && record.disposition === 'unassigned') candidate = { id: record.id, speciesId: record.speciesId };
    }
    observed = records.length;
    requestFlush();
  });
  function finish(id) {
    if (active !== id) return;
    active = null; requestFlush();
  }
  function closeResult() {
    candidate = null;
    discoveryNotice.cancel();
    active = null;
    // Also releases a result closed in the same turn as register(), before
    // the buffered awards have been handed to the existing queue.
    if (!disposed) flush();
  }
  return {
    showResult(record) {
      if (disposed || !record || !candidate || candidate.id !== record.id
        || candidate.speciesId !== record.speciesId || !matches(record)) {
        if (active !== record?.id) closeResult();
        return;
      }
      candidate = null; active = record.id;
      achievementNotice.setPaused(true);
      try {
        if (!discoveryNotice.show(record, () => finish(record.id))) finish(record.id);
      } catch {
        // A failed DOM/animation path cannot hold awards or interrupt RESULT.
        discoveryNotice.cancel(); finish(record.id);
      }
      requestFlush();
    },
    recoverFocus() { if (!disposed) discoveryNotice.recoverFocus(); },
    closeResult,
    dispose() {
      if (disposed) return;
      closeResult(); disposed = true;
      unsubscribeAwards(); unsubscribeCollection();
      discoveryNotice.dispose();
    },
  };
}
