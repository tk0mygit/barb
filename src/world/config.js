// Geometry and presentation are centralized so future maps/assets can replace them.
export const LAKE = Object.freeze({ radius: 145, boatMargin: 7, segments: 160 });
export const PALETTE = Object.freeze({ water: '#286f70', shore: '#a59b76', grass: '#657859', forest: '#284b3b', sky: '#c5dcd9' });
export function shoreRadius(angle) {
  return LAKE.radius + 13 * Math.sin(angle * 3 + 0.4) + 8 * Math.cos(angle * 5) + 4 * Math.sin(angle * 9);
}
export function randomGenerator(seed = 71) {
  return () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 4294967296; };
}
