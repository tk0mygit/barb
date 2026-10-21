// Seconds, metres and normalized tension. All pacing/difficulty lives here.
export const FISHING_CONFIG = Object.freeze({
  castMin: 8, castMax: 32, castDragPixels: 180, castSpread: 0.7, flightSeconds: 0.8,
  biteDelay: 3, biteMean: 12, hookWindow: 1, actionSeconds: 1.2, actionMultiplier: 1.35,
  lureSpeed: 0.65, landingDistance: 1.8, landingSeconds: 1.1, failureSeconds: 1.5,
  tensionStart: 0.42, tensionRise: 0.24, tensionRelief: 0.42,
  slackThreshold: 0.12, slackGrace: 1.4, slackEscapeRate: 1.2, fightReelSeconds: 6.5,
});
export const BLACK_BASS = Object.freeze({ id: 'black-bass', name: 'ブラックバス', minLengthCm: 25, maxLengthCm: 55 });
export const GESTURES = Object.freeze({ holdSeconds: 0.22, flickSeconds: 0.22, flickPixels: 24, tapPixels: 14 });
