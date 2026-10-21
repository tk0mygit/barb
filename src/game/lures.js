// Provisional game balance: all lures are available, with no inventory or cost.
// Affinities change the species mix; hitMultiplier changes the bite rate only.
const lure = (id, name, hitMultiplier, affinities) => Object.freeze({
  id, name, hitMultiplier, affinities: Object.freeze(affinities),
});
export const LURES = Object.freeze([
  lure('minnow', 'ミノー', 1.05, {
    'black-bass': 1.1, 'smallmouth-bass': 1.2, bluegill: 0.6,
    'rainbow-trout': 1.6, 'brown-trout': 1.5, iwana: 1.5,
    'northern-pike': 1.3, 'european-perch': 1.2, walleye: 1.5,
    catfish: 0.6, 'alligator-gar': 1.1, arowana: 1.4,
  }),
  lure('crankbait', 'クランクベイト', 1, {
    'black-bass': 1.5, 'smallmouth-bass': 1.5, bluegill: 0.8,
    'rainbow-trout': 1, 'brown-trout': 1.2, iwana: 0.7,
    'northern-pike': 1.2, 'european-perch': 1.5, walleye: 1.5,
    catfish: 0.8, 'alligator-gar': 0.9, arowana: 0.8,
  }),
  lure('worm', 'ワーム', 0.9, {
    'black-bass': 1.5, 'smallmouth-bass': 1.1, bluegill: 1.8,
    'rainbow-trout': 0.9, 'brown-trout': 0.8, iwana: 1.1,
    'northern-pike': 0.5, 'european-perch': 1.2, walleye: 0.9,
    catfish: 1.8, 'alligator-gar': 0.6, arowana: 0.7,
  }),
  lure('spinnerbait', 'スピナーベイト', 1.1, {
    'black-bass': 1.5, 'smallmouth-bass': 1.3, bluegill: 0.5,
    'rainbow-trout': 0.7, 'brown-trout': 0.8, iwana: 0.5,
    'northern-pike': 1.8, 'european-perch': 1.1, walleye: 0.8,
    catfish: 1, 'alligator-gar': 1.5, arowana: 1.4,
  }),
]);
export const DEFAULT_LURE_ID = 'minnow';
const byId = new Map(LURES.map(lure => [lure.id, lure]));
export const getLure = id => byId.get(id);
