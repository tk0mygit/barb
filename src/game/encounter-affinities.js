// Ordinary ecology-inspired, provisional game balance. All values stay positive
// so every species remains available in every band and both time periods.
const profile = (shallow, mid, deep, day, night) => Object.freeze({
  depth: Object.freeze({ shallow, mid, deep }), time: Object.freeze({ day, night }),
});
export const FISH_ENVIRONMENT_AFFINITIES = Object.freeze({
  'black-bass': profile(1.2, 1.1, 0.85, 1.1, 0.95),
  'smallmouth-bass': profile(0.95, 1.2, 1.1, 1.1, 0.95),
  bluegill: profile(1.3, 1, 0.8, 1.2, 0.8),
  'rainbow-trout': profile(0.9, 1.15, 1.25, 1.15, 0.95),
  'brown-trout': profile(0.95, 1.1, 1.2, 0.95, 1.2),
  iwana: profile(1.05, 1.2, 1.1, 1.1, 1),
  'northern-pike': profile(1.2, 1.15, 0.9, 1.15, 0.95),
  'european-perch': profile(1.15, 1.2, 0.9, 1.2, 0.85),
  walleye: profile(0.85, 1.1, 1.25, 0.85, 1.25),
  catfish: profile(1.1, 1.05, 1.2, 0.85, 1.25),
  'alligator-gar': profile(1.2, 1.1, 0.85, 1.05, 1.1),
  arowana: profile(1.3, 1, 0.75, 1.1, 1),
});
export const LURE_DEPTH_AFFINITIES = Object.freeze({
  minnow: Object.freeze({ shallow: 1.15, mid: 1, deep: 0.85 }),
  crankbait: Object.freeze({ shallow: 0.9, mid: 1.15, deep: 1.2 }),
  worm: Object.freeze({ shallow: 1.05, mid: 1.1, deep: 1.15 }),
  spinnerbait: Object.freeze({ shallow: 1.2, mid: 1.1, deep: 0.8 }),
});

// A common scalar lure multiplier would cancel during normalization. Instead,
// its depth affinity controls how strongly that depth favours resident species.
export function getEnvironmentWeight(speciesId, lureId, { depthBand, timeOfDay }) {
  const fish = FISH_ENVIRONMENT_AFFINITIES[speciesId];
  const fishDepth = fish?.depth[depthBand] ?? 1;
  const lureDepth = LURE_DEPTH_AFFINITIES[lureId]?.[depthBand] ?? 1;
  return fishDepth ** lureDepth * (fish?.time[timeOfDay] ?? 1);
}
