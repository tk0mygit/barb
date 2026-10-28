import { shoreRadius } from './config.js';
import { ridgeNoise, sceneryNoise } from './scenery-noise.js';

const goldenAngle = Math.PI * (3 - Math.sqrt(5));
const cellSize = 16;

// Initialization only. Warp the legacy samples, retaining their groves/openings
// and consuming none of the PRNG used by individual trees and subsequent rocks.
export function createForestPlacement() {
  const cells = new Map(), groves = [];
  const key = (x, z) => `${x},${z}`;
  const place = (id, x, z, crownRadius) => {
    const angle = Math.atan2(z, x);
    const fraction = (Math.hypot(x, z) - shoreRadius(angle) - 11) / 168;
    // A wider near-shore belt and a taper into the upper slope. Both edges
    // meander continuously instead of drawing a circular treeline.
    const edge = 14 + 12 * ridgeNoise(angle, 13, 947);
    const outer = 348 + 24 * ridgeNoise(angle, 9, 631) - shoreRadius(angle);
    const offset = edge + (outer - edge) * fraction ** 1.7;
    const radius = shoreRadius(angle) + offset;
    let targetX = Math.cos(angle) * radius, targetZ = Math.sin(angle) * radius;
    // The expanded slope otherwise strands a few trees far behind the forest.
    // Pull those samples toward an existing local grove, fading the effect in
    // across the middle belt and retaining irregular gaps between groves.
    if (offset > 75) {
      let anchor, distance = 90;
      for (const tree of groves) {
        const dx = targetX - tree.x, dz = targetZ - tree.z;
        // Reject distant groves before the more expensive exact distance.
        // This preserves the selected anchor and every resulting position.
        if (Math.abs(dx) >= distance || Math.abs(dz) >= distance) continue;
        const d = Math.hypot(dx, dz);
        if (d < distance) { anchor = tree; distance = d; }
      }
      const spacing = 12 + (id * 0.618033988749895 % 1) * 5;
      if (anchor && distance > spacing) {
        const t = Math.min(1, (offset - 75) / 55);
        const pull = Math.min(48, distance - spacing) / distance * t * t * (3 - 2 * t);
        targetX += (anchor.x - targetX) * pull; targetZ += (anchor.z - targetZ) * pull;
      }
    }
    let best, bestClearance = -Infinity;
    for (let attempt = 0; attempt < 64; attempt++) {
      const spread = 2.5 * Math.sqrt(attempt), direction = (id + attempt) * goldenAngle;
      const px = targetX + Math.cos(direction) * spread, pz = targetZ + Math.sin(direction) * spread;
      const r = Math.hypot(px, pz), shore = shoreRadius(Math.atan2(pz, px));
      if (r < shore + 10 + crownRadius || r + crownRadius > 378) continue;
      const cx = Math.floor(px / cellSize), cz = Math.floor(pz / cellSize);
      let clearance = Infinity;
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        for (const tree of cells.get(key(cx + dx, cz + dz)) ?? []) {
          const minimum = Math.max(3.8, (crownRadius + tree.radius) * 0.6);
          clearance = Math.min(clearance, Math.hypot(px - tree.x, pz - tree.z) - minimum);
        }
      }
      if (clearance > bestClearance || !best) {
        best = { x: px, z: pz, radius: crownRadius }; bestClearance = clearance;
      }
      if (clearance >= 0) break;
    }
    // The fixed 850 samples always find a separated candidate. Keep a bounded
    // best-candidate fallback rather than introducing unbounded scene setup.
    const cell = key(Math.floor(best.x / cellSize), Math.floor(best.z / cellSize));
    if (!cells.has(cell)) cells.set(cell, []);
    cells.get(cell).push(best);
    if (Math.hypot(best.x, best.z) - shoreRadius(Math.atan2(best.z, best.x)) > 80) groves.push(best);
    return best;
  };
  // Append only, after all 850 legacy calls. The same cells protect both old
  // and new trees. No grove rescan, PRNG consumption or per-frame work is added.
  place.add = (id, x, z, crownRadius, grounded) => {
    const angle = Math.atan2(z, x);
    const fraction = (Math.hypot(x, z) - shoreRadius(angle) - 11) / 168;
    const offset = 18 + 12 * ridgeNoise(angle, 13, 947) + 120 * fraction ** 1.4;
    const radius = shoreRadius(angle) + offset;
    const targetX = Math.cos(angle) * radius, targetZ = Math.sin(angle) * radius;
    for (let attempt = 0; attempt < 384; attempt++) {
      const spread = 2.5 * Math.sqrt(attempt), direction = (id + attempt) * goldenAngle;
      const px = targetX + Math.cos(direction) * spread, pz = targetZ + Math.sin(direction) * spread;
      const r = Math.hypot(px, pz), bank = r - shoreRadius(Math.atan2(pz, px));
      if (bank < 10 + crownRadius || bank > 160 || r + crownRadius > 378) continue;
      // Keep coherent openings instead of filling every angular strip evenly.
      if (sceneryNoise(px * 0.028, pz * 0.028, 311) < 0.35) continue;
      const cx = Math.floor(px / cellSize), cz = Math.floor(pz / cellSize);
      let separated = true;
      for (let dx = -1; dx <= 1 && separated; dx++) for (let dz = -1; dz <= 1 && separated; dz++) {
        for (const tree of cells.get(key(cx + dx, cz + dz)) ?? []) {
          if (Math.hypot(px - tree.x, pz - tree.z) < Math.max(3.8, (crownRadius + tree.radius) * 0.6)) {
            separated = false; break;
          }
        }
      }
      if (!separated || !grounded(px, pz)) continue;
      const tree = { x: px, z: pz, radius: crownRadius }, cell = key(cx, cz);
      if (!cells.has(cell)) cells.set(cell, []);
      cells.get(cell).push(tree);
      return tree;
    }
    throw new Error(`No safe additional forest candidate for ID ${id}`);
  };
  return place;
}
