// Shared pacing in seconds/metres and normalized tension; species balance is in fish-species.js.
export const FISHING_CONFIG = Object.freeze({
  castMin: 8, castMax: 32, castDragPixels: 180, castSpread: 0.7, flightSeconds: 0.8,
  biteDelay: 3, biteMean: 12, hookWindow: 1, actionSeconds: 1.2, actionMultiplier: 1.35,
  // Land beyond the 3.25m bow so the surface effect stays visible.
  lureSpeed: 0.65, landingDistance: 4.5, landingSeconds: 1.1, failureSeconds: 1.5,
  tensionStart: 0.42, tensionRise: 0.24, tensionRelief: 0.42,
  slackThreshold: 0.12, slackGrace: 1.4, slackEscapeRate: 1.2, fightReelSeconds: 6.5,
  // Bound retrieval duration while keeping the full resistance in tension.
  reelResistanceMin: 0.8, reelResistanceMax: 1.25,
});
// Retain the Phase 2 import path for existing consumers.
export { BLACK_BASS } from './fish-species.js';
export const GESTURES = Object.freeze({ holdSeconds: 0.22, flickSeconds: 0.22, flickPixels: 24, tapPixels: 14 });
