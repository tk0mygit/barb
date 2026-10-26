import { BIO_VARIANTS, BIO_SOURCE_URLS } from './bio-source-assets.js';
import { validateBioWav, validateDecodedBioBuffer } from './bio-source-validation.js';

export { BIO_VARIANTS };

// Only acquisition/decoding/ownership. Never creates, resumes or closes a context;
// never allocates playback nodes, schedules calls, or imports the game.
export function createBioSourceFactory(context, { fetcher = globalThis.fetch } = {}) {
  if (!context || typeof context.decodeAudioData !== 'function'
    || !Number.isFinite(context.sampleRate) || context.sampleRate <= 0)
    throw new TypeError('A supplied decoding context and sampleRate are required');
  if (typeof fetcher !== 'function') throw new TypeError('A fetch function is required');
  const variants = new Map(BIO_VARIANTS.map(v => [v.id, v]));
  const cache = new Map();
  let disposed = false;
  const aborted = () => new DOMException('Bio source request invalidated', 'AbortError');
  function clear() {
    const previous = [...cache.values()];
    cache.clear(); // Invalidate before abort callbacks or late decode completion.
    for (const entry of previous) entry.cancel?.();
  }
  return Object.freeze({
    variants: BIO_VARIANTS,
    // Not async: the exact same Promise object is returned for a cached ID.
    get(id) {
      if (disposed) return Promise.reject(new DOMException('Bio source factory disposed', 'InvalidStateError'));
      const variant = variants.get(id);
      if (!variant) return Promise.reject(new RangeError('Unknown bio source ID'));
      if (context.state === 'closed') return Promise.reject(new DOMException('Audio context closed', 'InvalidStateError'));
      if (cache.has(id)) return cache.get(id).promise;
      const controller = new AbortController(), decodeContext = context, request = fetcher;
      const entry = { promise: null, cancel: null };
      const cancelled = new Promise((_, reject) => {
        entry.cancel = () => { controller.abort(); reject(aborted()); };
      });
      const current = () => {
        if (disposed || cache.get(id) !== entry) throw aborted();
      };
      const load = Promise.resolve().then(async () => {
        current();
        const response = await request(BIO_SOURCE_URLS[id], { signal: controller.signal });
        current();
        if (!response.ok) throw new Error(`Bio source HTTP error: ${response.status}`);
        const bytes = await response.arrayBuffer();
        current();
        validateBioWav(bytes, variant);
        const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
        current();
        const hash = Array.from(new Uint8Array(digest), x => x.toString(16).padStart(2, '0')).join('');
        if (hash !== variant.sha256) throw new TypeError(`Bio source SHA-256 mismatch: ${id}`);
        const buffer = await decodeContext.decodeAudioData(bytes);
        current();
        return validateDecodedBioBuffer(buffer, variant, decodeContext.sampleRate);
      });
      entry.promise = Promise.race([load, cancelled]).then(buffer => {
        current(); entry.cancel = null;
        return buffer;
      }, error => {
        // A stale rejection must never evict a newer request for the same ID.
        if (cache.get(id) === entry) cache.delete(id);
        controller.abort(); entry.cancel = null;
        throw error;
      });
      cache.set(id, entry);
      return entry.promise;
    },
    clear,
    dispose() {
      if (disposed) return;
      disposed = true; clear();
      context = null; fetcher = null;
    },
  });
}
