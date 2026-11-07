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
    'common-carp': 0.85, tench: 0.85, pumpkinseed: 0.85, 'black-crappie': 1.60,
    'rock-bass': 0.85, 'freshwater-drum': 0.85, 'white-bass': 1.60, 'brook-trout': 1.60,
    'striped-bass': 1.60, burbot: 0.85, grayling: 1.60, 'lake-trout': 0.85,
    'arctic-char': 1.60, bowfin: 0.85, 'murray-cod': 0.85, 'golden-dorado': 0.85,
    'red-bellied-piranha': 0.85, barramundi: 1.60, muskellunge: 0.85, 'peacock-bass': 1.60,
    'northern-snakehead': 0.85, 'lake-sturgeon': 0.85, arapaima: 1.60, payara: 1.60,
  }),
  lure('crankbait', 'クランクベイト', 1, {
    'black-bass': 1.5, 'smallmouth-bass': 1.5, bluegill: 0.8,
    'rainbow-trout': 1, 'brown-trout': 1.2, iwana: 0.7,
    'northern-pike': 1.2, 'european-perch': 1.5, walleye: 1.5,
    catfish: 0.8, 'alligator-gar': 0.9, arowana: 0.8,
    'common-carp': 0.85, tench: 0.85, pumpkinseed: 0.85, 'black-crappie': 0.85,
    'rock-bass': 1.60, 'freshwater-drum': 0.85, 'white-bass': 0.85, 'brook-trout': 0.85,
    'striped-bass': 0.85, burbot: 0.85, grayling: 0.85, 'lake-trout': 1.60,
    'arctic-char': 0.85, bowfin: 0.85, 'murray-cod': 1.60, 'golden-dorado': 0.85,
    'red-bellied-piranha': 0.85, barramundi: 0.85, muskellunge: 0.85, 'peacock-bass': 0.85,
    'northern-snakehead': 0.85, 'lake-sturgeon': 0.85, arapaima: 0.85, payara: 0.85,
  }),
  lure('worm', 'ワーム', 0.9, {
    'black-bass': 1.5, 'smallmouth-bass': 1.1, bluegill: 1.8,
    'rainbow-trout': 0.9, 'brown-trout': 0.8, iwana: 1.1,
    'northern-pike': 0.5, 'european-perch': 1.2, walleye: 0.9,
    catfish: 1.8, 'alligator-gar': 0.6, arowana: 0.7,
    'common-carp': 1.60, tench: 1.60, pumpkinseed: 1.60, 'black-crappie': 0.85,
    'rock-bass': 0.85, 'freshwater-drum': 1.60, 'white-bass': 0.85, 'brook-trout': 0.85,
    'striped-bass': 0.85, burbot: 1.60, grayling: 0.85, 'lake-trout': 0.85,
    'arctic-char': 0.85, bowfin: 0.85, 'murray-cod': 0.85, 'golden-dorado': 0.85,
    'red-bellied-piranha': 1.60, barramundi: 0.85, muskellunge: 0.85, 'peacock-bass': 0.85,
    'northern-snakehead': 0.85, 'lake-sturgeon': 1.60, arapaima: 0.85, payara: 0.85,
  }),
  lure('spinnerbait', 'スピナーベイト', 1.1, {
    'black-bass': 1.5, 'smallmouth-bass': 1.3, bluegill: 0.5,
    'rainbow-trout': 0.7, 'brown-trout': 0.8, iwana: 0.5,
    'northern-pike': 1.8, 'european-perch': 1.1, walleye: 0.8,
    catfish: 1, 'alligator-gar': 1.5, arowana: 1.4,
    'common-carp': 0.85, tench: 0.85, pumpkinseed: 0.85, 'black-crappie': 0.85,
    'rock-bass': 0.85, 'freshwater-drum': 0.85, 'white-bass': 0.85, 'brook-trout': 0.85,
    'striped-bass': 0.85, burbot: 0.85, grayling: 0.85, 'lake-trout': 0.85,
    'arctic-char': 0.85, bowfin: 1.60, 'murray-cod': 0.85, 'golden-dorado': 1.60,
    'red-bellied-piranha': 0.85, barramundi: 0.85, muskellunge: 1.60, 'peacock-bass': 0.85,
    'northern-snakehead': 1.60, 'lake-sturgeon': 0.85, arapaima: 0.85, payara: 0.85,
  }),
]);
export const DEFAULT_LURE_ID = 'minnow';
const byId = new Map(LURES.map(lure => [lure.id, lure]));
export const getLure = id => byId.get(id);
