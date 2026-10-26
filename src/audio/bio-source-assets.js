import manifest from '../assets/audio/bio/manifest.json' with { type: 'json' };
import { validateBioManifest } from './bio-source-validation.js';

export const BIO_VARIANTS = validateBioManifest(manifest);
// Literal new URL imports let Vite emit hashed files under its /barb/ base.
// No caller-supplied URL overrides. Fetch-time SHA-256 also binds each ID to bytes.
export const BIO_SOURCE_URLS = Object.freeze({
  'bird-a': new URL('../assets/audio/bio/wav/bird-a.wav', import.meta.url).href,
  'bird-b': new URL('../assets/audio/bio/wav/bird-b.wav', import.meta.url).href,
  'bird-c': new URL('../assets/audio/bio/wav/bird-c.wav', import.meta.url).href,
  'suzumushi-a': new URL('../assets/audio/bio/wav/suzumushi-a.wav', import.meta.url).href,
  'suzumushi-b': new URL('../assets/audio/bio/wav/suzumushi-b.wav', import.meta.url).href,
  'suzumushi-c': new URL('../assets/audio/bio/wav/suzumushi-c.wav', import.meta.url).href,
});
