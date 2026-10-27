import { createAudioSession } from '../audio/audio-session.js';

export const BITE_SOURCE_URL = new URL('../assets/audio/bite/waterdrop.wav', import.meta.url).href;
// Measured PCM peak 0.984375. Keep headroom independently of ambient settings.
export const BITE_GAIN = 0.2;
export const BITE_OFFSET_SECONDS = 0.02;
export const BITE_ATTACK_SECONDS = 0.001;
export const BITE_RELEASE_SECONDS = 0.005;

// One asset request/decode, one cached PCM and one voice. Preparation never
// queues a bite: a missed notification remains silent after loading completes.
export function createFishingAudio({ session = createAudioSession(), fetcher = globalThis.fetch,
  documentTarget = globalThis.document, windowTarget = globalThis.window } = {}) {
  let context, encoded, buffer, job, voice, disposed = false, failed = false;
  let generation = 0, lastStatus, closedContext, pageHidden = false;

  function release(entry = voice) {
    if (!entry || voice !== entry) return;
    voice = undefined;
    entry.source.onended = null;
    try { entry.source.stop(); } catch { /* Already ended or not started. */ }
    try { entry.source.disconnect(); } catch { /* Partial allocation. */ }
    try { entry.gain?.disconnect(); } catch { /* Best effort teardown. */ }
    try { entry.source.buffer = null; } catch { /* An unavailable context. */ }
  }
  function clearBank() {
    generation++;
    encoded = buffer = undefined;
    job?.controller.abort();
    // Keep an unabortable decode tracked until it settles. A replacement
    // context cannot start another decode while this one is still in flight.
  }
  function validate(decoded, owner) {
    if (!decoded || decoded.numberOfChannels !== 2 || decoded.sampleRate !== owner.sampleRate
      || !Number.isFinite(decoded.duration) || Math.abs(decoded.duration - 1) > 2 / owner.sampleRate
      || decoded.length !== Math.round(decoded.duration * decoded.sampleRate)
      || decoded.sampleRate <= 0 || decoded.sampleRate > 192000) throw Error('Invalid bite PCM');
    for (let c = 0; c < decoded.numberOfChannels; c++) {
      const data = decoded.getChannelData(c);
      if (data.length !== decoded.length) throw Error('Invalid bite channel');
      for (const sample of data) {
        // Allow resampling overshoot, bounded to 0.25 after BITE_GAIN.
        if (!Number.isFinite(sample) || Math.abs(sample) > 1.25) throw Error('Invalid bite samples');
      }
    }
    return decoded;
  }
  function preload() {
    if (disposed || failed || context?.state === 'closed' || session.status === 'unsupported') return Promise.resolve(false);
    if (buffer) return Promise.resolve(true);
    if (job) return job.promise;
    const entry = { controller: new AbortController(), generation, promise: null };
    job = entry;
    const current = () => !disposed && entry.generation === generation;
    entry.promise = Promise.resolve().then(async () => {
      if (!current()) return false;
      if (!encoded) {
        const response = await fetcher(BITE_SOURCE_URL, { signal: entry.controller.signal });
        if (!current()) return false;
        if (!response.ok) throw Error('Bite source HTTP ' + response.status);
        const bytes = await response.arrayBuffer();
        if (!current()) return false;
        if (bytes.byteLength > 256 * 1024) throw Error('Oversized bite source');
        encoded = bytes;
      }
      const owner = context;
      if (!owner || owner.state !== 'running' || session.status !== 'ready') return false;
      const bytes = encoded; encoded = undefined; // decodeAudioData may detach it.
      const decoded = await owner.decodeAudioData(bytes);
      if (!current() || context !== owner || owner.state === 'closed') return false;
      buffer = validate(decoded, owner);
      return true;
    }).catch(() => {
      if (current()) { failed = true; encoded = buffer = undefined; }
      return false; // Neither a rejected request nor a decoder can reach input.
    }).finally(() => {
      if (job === entry) job = undefined;
      if (!disposed && !failed && context?.state === 'running' && session.status === 'ready'
        && !buffer && (encoded || entry.generation !== generation)) void preload();
    });
    return entry.promise;
  }
  function sync() {
    if (disposed) return;
    const next = session.context;
    if (next !== context) {
      if (context) {
        release(); clearBank();
        context.removeEventListener('statechange', sync);
      }
      context = next;
      context?.addEventListener('statechange', sync);
      failed = false;
    }
    if (context?.state !== 'running' || session.status !== 'ready') release();
    if (context?.state === 'closed' && closedContext !== context) {
      closedContext = context; clearBank();
      context.removeEventListener('statechange', sync);
    }
    if (session.status === 'unsupported') clearBank();
    if (session.status === 'ready' && context?.state === 'running') {
      if (lastStatus !== 'ready') failed = false;
      void preload();
    }
    lastStatus = session.status;
  }
  const unsubscribe = session.subscribe(sync);
  const stop = () => release();
  const visibility = () => { if (documentTarget?.hidden) release(); };
  const pagehide = () => { pageHidden = true; release(); };
  const pageshow = () => { pageHidden = false; };
  function dispose() {
    if (disposed) return;
    disposed = true; release(); clearBank(); unsubscribe();
    context?.removeEventListener('statechange', sync); context = undefined;
    documentTarget?.removeEventListener('visibilitychange', visibility);
    windowTarget?.removeEventListener('blur', stop);
    windowTarget?.removeEventListener('pagehide', pagehide);
    windowTarget?.removeEventListener('pageshow', pageshow);
    windowTarget?.removeEventListener('webglcontextlost', dispose, true);
  }
  documentTarget?.addEventListener('visibilitychange', visibility);
  windowTarget?.addEventListener('blur', stop);
  windowTarget?.addEventListener('pagehide', pagehide);
  windowTarget?.addEventListener('pageshow', pageshow);
  // Capture also sees the canvas event, without changing main's error flow.
  windowTarget?.addEventListener('webglcontextlost', dispose, true);
  sync();
  void preload(); // Fetch ahead; decoding waits for the existing gesture unlock.
  return {
    unlock() {
      if (disposed) return Promise.resolve(false);
      failed = false; const result = session.unlock(); void preload(); return result;
    },
    preload, dispose,
    bite() {
      if (disposed || !buffer || context !== session.context || context?.state !== 'running'
        || session.status !== 'ready' || documentTarget?.hidden || pageHidden) return;
      release();
      try {
        const entry = { source: context.createBufferSource(), gain: null };
        voice = entry; // Record it before the next allocation can throw.
        entry.source.buffer = buffer; entry.source.loop = false;
        const gain = entry.gain = context.createGain(), now = context.currentTime;
        const duration = buffer.duration - BITE_OFFSET_SECONDS;
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(BITE_GAIN, now + BITE_ATTACK_SECONDS);
        gain.gain.setValueAtTime(BITE_GAIN, now + duration - BITE_RELEASE_SECONDS);
        gain.gain.linearRampToValueAtTime(0, now + duration);
        entry.source.connect(gain).connect(context.destination);
        entry.source.onended = () => release(entry);
        entry.source.start(now, BITE_OFFSET_SECONDS);
        entry.source.stop(now + duration);
      } catch { release(); }
    },
  };
}
