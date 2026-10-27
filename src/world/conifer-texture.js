import * as THREE from 'three';

// Local preview presets, not a selected production treatment. Both use the
// same mapping/material; only their deterministic albedo pixels differ.
export const CONIFER_TEXTURE_VARIANT = 'A';
export const CONIFER_TEXTURE_MEAN = 0.68;
const size = 64;
const blend = t => t * t * (3 - 2 * t);
const wrap = (n, period) => ((n % period) + period) % period;
function noise(x, y, period, seed) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const hash = (a, b) => {
    let n = Math.imul(wrap(a, period), 374761393) ^ Math.imul(wrap(b, period), 668265263) ^ seed;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  const u = blend(x - ix), v = blend(y - iy);
  return THREE.MathUtils.lerp(
    THREE.MathUtils.lerp(hash(ix, iy), hash(ix + 1, iy), u),
    THREE.MathUtils.lerp(hash(ix, iy + 1), hash(ix + 1, iy + 1), u), v);
}
const encode = value => Math.round(255 * (1.055 * value ** (1 / 2.4) - 0.055));

export function createConiferTexture(variant = CONIFER_TEXTURE_VARIANT) {
  if (variant !== 'A' && variant !== 'B') throw new RangeError('Unknown conifer texture preset');
  const field = new Float32Array(size * size);
  const cells = variant === 'A' ? 7 : 12, amplitude = variant === 'A' ? 0.14 : 0.24;
  let sum = 0, min = Infinity, max = -Infinity;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    // Periodic domain warping breaks up the grid without adding pixel noise.
    const dx = (noise(u * 4, v * 4, 4, 617) - 0.5) * 0.8;
    const dy = (noise(u * 4, v * 4, 4, 919) - 0.5) * 0.8;
    const value = 0.75 * noise(u * cells + dx, v * cells + dy, cells, 331)
      + 0.25 * noise(u * cells * 2 + dx, v * cells * 2 + dy, cells * 2, 733);
    field[y * size + x] = value; sum += value; min = Math.min(min, value); max = Math.max(max, value);
  }
  const mean = sum / field.length, extent = Math.max(mean - min, max - mean);
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < field.length; i++) {
    // Neutral albedo modulation: existing vertex/instance colors supply green.
    // Both presets have the same linear mean, compensated by one material gain.
    const value = encode(CONIFER_TEXTURE_MEAN + amplitude * (field[i] - mean) / extent);
    data.set([value, value, value, 255], i * 4);
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.name = `conifer-albedo-${variant}`;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(3, 4);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}
