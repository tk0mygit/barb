// One lazily unlocked context shared by independent ambient and bite paths.
// Only unlock(), called synchronously by a user gesture, creates/resumes it.
export function createAudioSession({ createContext = () => {
  const Audio = globalThis.AudioContext || globalThis.webkitAudioContext;
  return Audio ? new Audio() : null;
} } = {}) {
  let context, status = 'waiting', disposed = false, generation = 0;
  const listeners = new Set();
  const publish = next => {
    if (status === next) return;
    status = next;
    for (const listener of listeners) { try { listener(); } catch { /* Audio cannot interrupt input. */ } }
  };
  const stateChange = () => {
    // The observed state takes precedence over any earlier resume promise.
    generation++;
    publish(context.state === 'running' ? 'ready' : 'interrupted');
  };
  const settle = (candidate, request, rejected) => {
    if (disposed || context !== candidate) return false;
    const running = candidate.state === 'running';
    if (running) publish('ready');
    else if (request === generation) publish(rejected ? 'blocked' : 'interrupted');
    return running;
  };
  return {
    get context() { return context; },
    get status() { return status; },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    unlock() {
      if (disposed) return Promise.resolve(false);
      const request = ++generation;
      let candidate;
      try {
        if (!context || context.state === 'closed') {
          context?.removeEventListener('statechange', stateChange);
          context = createContext();
          if (!context) { publish('unsupported'); return Promise.resolve(false); }
          context.addEventListener('statechange', stateChange);
        }
        candidate = context;
        if (context.state === 'running') { publish('ready'); return Promise.resolve(true); }
        publish('starting');
        // Every new user gesture gets a synchronous resume call. A browser can
        // leave a previous request pending indefinitely without rejecting it.
        return Promise.resolve(candidate.resume()).then(
          () => settle(candidate, request, false),
          () => settle(candidate, request, true),
        );
      } catch {
        if (candidate) return Promise.resolve(settle(candidate, request, true));
        publish('blocked'); return Promise.resolve(false);
      }
    },
    dispose() {
      disposed = true;
      generation++;
      context?.removeEventListener('statechange', stateChange);
      listeners.clear();
      try { Promise.resolve(context?.close()).catch(() => {}); } catch { /* Best effort. */ }
    },
  };
}
