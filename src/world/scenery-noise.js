// Continuous deterministic noise, sampled only while building the scenery.
const blend = t => t * t * (3 - 2 * t);
const hash = (x, z, seed) => {
  let n = Math.imul(x, 374761393) ^ Math.imul(z, 668265263) ^ seed;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
};
export function sceneryNoise(x, z, seed = 71) {
  const ix = Math.floor(x), iz = Math.floor(z), u = blend(x - ix), v = blend(z - iz);
  const a = hash(ix, iz, seed), b = hash(ix + 1, iz, seed);
  const c = hash(ix, iz + 1, seed), d = hash(ix + 1, iz + 1, seed);
  return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
}
export function ridgeNoise(angle, cells, seed) {
  const p = ((angle / (Math.PI * 2) % 1) + 1) % 1 * cells;
  const i = Math.floor(p), t = blend(p - i);
  return hash(i % cells, 0, seed) * (1 - t) + hash((i + 1) % cells, 0, seed) * t;
}
