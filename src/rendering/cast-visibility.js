import * as THREE from 'three';
import { nearRingExpansion } from './fishing-visuals.js';
import { LURE_FOOTPRINT_ENVELOPES } from './lure-models.js';

// Include the largest splash (0.7 * 2.6), bite pulse (0.7 * 1.9),
// and the lure's bob/action envelope. These are visual bounds, not distances.
export const CAST_EDGE_MARGIN_PX = 12;
export const CAST_SPLASH_RADIUS = 1.82;
export const CAST_BITE_RADIUS = 1.33;
const point = new THREE.Vector3();
const union = (a, b) => ({ left: Math.min(a.left, b.left), right: Math.max(a.right, b.right),
  top: Math.min(a.top, b.top), bottom: Math.max(a.bottom, b.bottom), clipped: a.clipped || b.clipped });

// Project the actual 40-sided ring plus all models' rotation/bob/action envelope.
// CSS pixels deliberately do not depend on the renderer's backbuffer ratio.
export function projectCastFootprint(camera, { x, z, radius = CAST_SPLASH_RADIUS }, { width, height }) {
  const ndc = { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity };
  let clipped = false;
  function include(px, py, pz) {
    point.set(px, py, pz).project(camera);
    if (!Number.isFinite(point.x + point.y + point.z) || point.z < -1 || point.z > 1) clipped = true;
    ndc.left = Math.min(ndc.left, point.x); ndc.right = Math.max(ndc.right, point.x);
    ndc.top = Math.min(ndc.top, -point.y); ndc.bottom = Math.max(ndc.bottom, -point.y);
  }
  for (let i = 0; i < 40; i++) {
    const angle = i * Math.PI * 2 / 40;
    include(x + Math.cos(angle) * radius, 0.12, z + Math.sin(angle) * radius);
  }
  for (const envelope of LURE_FOOTPRINT_ENVELOPES) {
    for (const dx of [-envelope.radius, envelope.radius]) for (const dz of [-envelope.radius, envelope.radius]) {
      for (const y of [0.15 - 0.035 + envelope.minY, 0.15 + 0.035 + 0.35 + envelope.maxY]) include(x + dx, y, z + dz);
    }
  }
  return { left: (1 + ndc.left) * width / 2, right: (1 + ndc.right) * width / 2,
    top: (1 + ndc.top) * height / 2, bottom: (1 + ndc.bottom) * height / 2, ndc, clipped };
}

export function createCastVisibility(camera, getViewport) {
  let cachedKey, cachedLimits;
  function snapshot() {
    camera.updateMatrixWorld();
    return getViewport();
  }
  function footprint(target, viewport = snapshot()) { return projectCastFootprint(camera, target, viewport); }
  function safe(bounds, viewport) {
    const { width, height, insets = {}, occlusions = [] } = viewport;
    // A subpixel guard keeps arithmetic/bisection roundoff outside the 12px rule.
    const margin = CAST_EDGE_MARGIN_PX + 0.05;
    if (bounds.clipped || bounds.left < margin + (insets.left ?? 0) || bounds.top < margin + (insets.top ?? 0)
      || bounds.right > width - margin - (insets.right ?? 0) || bounds.bottom > height - margin - (insets.bottom ?? 0)) return false;
    return !occlusions.some(rect => bounds.right > rect.left - margin && bounds.left < rect.right + margin
      && bounds.bottom > rect.top - margin && bounds.top < rect.bottom + margin);
  }
  function visible({ origin, heading, distance, landingDistance = 4.5 }, viewport) {
    const at = (d, radius) => footprint({ x: origin.x + Math.sin(heading) * d,
      z: origin.z - Math.cos(heading) * d, radius }, viewport);
    const expansion = d => nearRingExpansion(d, landingDistance);
    if (!safe(at(distance, 0.7 * (1 + 1.6 * expansion(distance))), viewport)) return false;
    // Perspective maps each segment to a segment while it remains in front of
    // the eye. Ring expansion is also linear up to 8m, then constant, so these
    // segment endpoint bounds enclose every point of the entire retrieval path.
    const distances = [Math.min(distance, landingDistance), Math.min(distance, 8), distance];
    const bounds = distances.map(d => at(d, 0.7 * (1 + 0.9 * expansion(d))));
    function safeSegment(start, startBounds, end, endBounds, depth = 0) {
      if (safe(union(startBounds, endBounds), viewport)) return true;
      if (!safe(startBounds, viewport) || !safe(endBounds, viewport) || depth === 8) return false;
      // A diagonal swept rectangle can cover a corner notice even though the
      // actual marker passes alongside it. Subdivision tightens that bound;
      // every accepted subsegment still encloses its complete continuous path.
      const middle = (start + end) / 2;
      const middleBounds = at(middle, 0.7 * (1 + 0.9 * expansion(middle)));
      return safeSegment(start, startBounds, middle, middleBounds, depth + 1)
        && safeSegment(middle, middleBounds, end, endBounds, depth + 1);
    }
    return safeSegment(distances[0], bounds[0], distances[1], bounds[1])
      && safeSegment(distances[1], bounds[1], distances[2], bounds[2]);
  }
  return {
    footprint,
    isVisible(options) { return visible(options, snapshot()); },
    constrain({ origin, heading, requestedDistance, spread, landingDistance = 4.5 }) {
      const viewport = snapshot();
      const key = JSON.stringify([camera.matrixWorld.elements, camera.projectionMatrix.elements, viewport,
        origin.x, origin.z, heading, requestedDistance, spread, landingDistance]);
      if (key === cachedKey) return cachedLimits;
      const fits = angle => visible({ origin, heading: heading + angle, distance: requestedDistance, landingDistance }, viewport);
      const valid = fits(0);
      function limit(sign) {
        let low = 0, high = spread;
        // Stop at the first blocked angle: dragging never jumps across a HUD
        // obstacle into a disconnected range of directions.
        for (let i = 1; i <= 64; i++) {
          const angle = spread * i / 64;
          if (!fits(sign * angle)) { high = angle; break; }
          low = angle;
        }
        if (low === spread) return sign * spread;
        for (let i = 0; i < 24; i++) {
          const middle = (low + high) / 2;
          if (fits(sign * middle)) low = middle; else high = middle;
        }
        return sign * low;
      }
      cachedKey = key;
      cachedLimits = { minAngle: valid ? limit(-1) : 0, maxAngle: valid ? limit(1) : 0, valid,
        reason: valid ? '' : '着水先を画面内に確保できません。湖側へ向くか画面の向きを変えてください' };
      return cachedLimits;
    },
  };
}
