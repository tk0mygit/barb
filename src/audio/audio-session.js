// One lazily unlocked context shared by independent ambient and bite paths.
// Only unlock(), called synchronously by a user gesture, creates/resumes it.
export function createAudioSession({ createContext = () => {
  const Audio = globalThis.AudioContext || globalThis.webkitAudioContext;
  return Audio ? new Audio() : null;
} } = {}) {
  let context, status = 'waiting', disposed = false, attempt;
  const listeners = new Set();
  const publish = next => {
    if (status === next) return;
    status = next;
    for (const listener of listeners) { try { listener(); } catch { /* Audio cannot interrupt input. */ } }
  };
  const stateChange = () => publish(context.state === 'running' ? 'ready' : 'interrupted');
  return {
    get context() { return context; },
    get status() { return status; },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    unlock() {
      if (disposed) return Promise.resolve(false);
      try {
        if (!context || context.state === 'closed') {
          context?.removeEventListener('statechange', stateChange);
          context = createContext();
          if (!context) { publish('unsupported'); return Promise.resolve(false); }
          context.addEventListener('statechange', stateChange);
        }
        if (context.state === 'running') { publish('ready'); return Promise.resolve(true); }
        if (attempt) return attempt;
        // resume is invoked before any await to retain transient activation.
        attempt = Promise.resolve(context.resume()).then(() => {
          if (disposed) return false;
          stateChange(); return context.state === 'running';
        }, () => { if (!disposed) publish('blocked'); return false; }).finally(() => { attempt = null; });
        return attempt;
      } catch { publish('blocked'); return Promise.resolve(false); }
    },
    dispose() {
      disposed = true;
      context?.removeEventListener('statechange', stateChange);
      listeners.clear();
      try { Promise.resolve(context?.close()).catch(() => {}); } catch { /* Best effort. */ }
    },
  };
}
