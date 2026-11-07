// Historical identity set: never derive the original-twelve award from a
// mutable registry length/order. V1/V2 could contain only these species.
export const ORIGINAL_FISH_SPECIES_IDS = Object.freeze([
  'black-bass', 'smallmouth-bass', 'bluegill', 'rainbow-trout',
  'brown-trout', 'iwana', 'northern-pike', 'european-perch',
  'walleye', 'catfish', 'alligator-gar', 'arowana',
]);

// Exact historical V3 revision1 roster; never expand with the live registry.
export const PHASE6A_FISH_SPECIES_IDS = Object.freeze([
  ...ORIGINAL_FISH_SPECIES_IDS,
  'common-carp', 'tench', 'pumpkinseed', 'black-crappie',
  'rock-bass', 'freshwater-drum', 'white-bass', 'brook-trout',
]);

// Exact historical V3 revision2 roster; later fish never enter this source set.
export const PHASE6B_FISH_SPECIES_IDS = Object.freeze([
  ...PHASE6A_FISH_SPECIES_IDS,
  'striped-bass', 'burbot', 'grayling', 'lake-trout',
  'arctic-char', 'bowfin', 'murray-cod', 'golden-dorado',
]);
