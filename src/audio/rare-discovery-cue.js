export const RARE_CUE_GAIN = 0.055;
export const RARE_CUE_SECONDS = 0.32;

// An effect like BITE: independent of ambient preferences, never unlocks audio.
export function createRareDiscoveryCue({ session, documentTarget = globalThis.document,
  windowTarget = globalThis.window } = {}) {
  let voice, context, disposed = false, pageHidden = false;
  function stop(entry = voice) {
    if (!entry || entry !== voice) return;
    voice = undefined;
    entry.source.onended = null;
    try { entry.source.stop(); } catch { /* Partial start or already ended. */ }
    try { entry.source.disconnect(); } catch { /* Best effort. */ }
    try { entry.gain?.disconnect(); } catch { /* Partial allocation. */ }
  }
  function sync() {
    if (context !== session.context) {
      stop(); context?.removeEventListener('statechange', sync);
      context = session.context; context?.addEventListener('statechange', sync);
    }
    if (context?.state !== 'running' || session.status !== 'ready') stop();
  }
  const unsubscribe = session.subscribe(sync);
  const blur = () => stop();
  const visibility = () => { if (documentTarget?.hidden) stop(); };
  const pagehide = () => { pageHidden = true; stop(); };
  const pageshow = () => { pageHidden = false; };
  documentTarget?.addEventListener('visibilitychange', visibility);
  windowTarget?.addEventListener('blur', blur);
  windowTarget?.addEventListener('pagehide', pagehide);
  windowTarget?.addEventListener('pageshow', pageshow);
  sync();
  return {
    play() {
      if (disposed || voice || documentTarget?.hidden || pageHidden
        || session.status !== 'ready' || session.context?.state !== 'running') return;
      sync();
      try {
        const entry = voice = { source: context.createOscillator(), gain: null };
        entry.gain = context.createGain();
        const now = context.currentTime;
        entry.source.type = 'sine';
        entry.source.frequency.setValueAtTime(146.83, now);
        entry.source.frequency.linearRampToValueAtTime(110, now + RARE_CUE_SECONDS);
        entry.gain.gain.setValueAtTime(0, now);
        entry.gain.gain.linearRampToValueAtTime(RARE_CUE_GAIN, now + 0.025);
        entry.gain.gain.linearRampToValueAtTime(0, now + RARE_CUE_SECONDS);
        entry.source.connect(entry.gain).connect(context.destination);
        entry.source.onended = () => stop(entry);
        entry.source.start(now); entry.source.stop(now + RARE_CUE_SECONDS);
      } catch { stop(); }
    },
    stop: blur,
    dispose() {
      if (disposed) return;
      disposed = true; stop(); unsubscribe();
      context?.removeEventListener('statechange', sync); context = undefined;
      documentTarget?.removeEventListener('visibilitychange', visibility);
      windowTarget?.removeEventListener('blur', blur);
      windowTarget?.removeEventListener('pagehide', pagehide);
      windowTarget?.removeEventListener('pageshow', pageshow);
    },
  };
}
