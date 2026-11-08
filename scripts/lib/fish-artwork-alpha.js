import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const approved6c = JSON.parse(readFileSync(new URL('../../docs/artwork/phase6/approved-6c.json', import.meta.url)));
const approvedImages = new Map(approved6c.images.map(row => [row.speciesId, Object.freeze(row)]));
const approvedSmallBodies = new Set(['red-bellied-piranha', 'muskellunge', 'lake-sturgeon']);

// Shared by source-pixel unit checks and the Chromium-decoded artwork report.
export function measureArtworkAlpha(pixels, width, height) {
  let transparentPixels = 0, partialAlphaPixels = 0, opaquePixels = 0;
  let nearOpaquePixels = 0, softEdgePixels = 0, nontransparentBorderPixels = 0;
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const alpha = pixels[(y * width + x) * 4 + 3];
    if (alpha === 0) transparentPixels++;
    else {
      if (alpha === 255) opaquePixels++; else partialAlphaPixels++;
      if (alpha >= 250) nearOpaquePixels++; else softEdgePixels++;
      left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
      if (x < 8 || y < 8 || x >= width - 8 || y >= height - 8) nontransparentBorderPixels++;
    }
  }
  return { decodedWidth: width, decodedHeight: height, transparentPixels, partialAlphaPixels, opaquePixels,
    nearOpaquePixels, softEdgePixels, nontransparentBorderPixels, nontransparentBounds: { left, top, right, bottom } };
}

export function assertArtworkAlpha(profile, { legacy, id, sourceSha256 }) {
  const { decodedWidth: width, decodedHeight: height, transparentPixels, nearOpaquePixels, softEdgePixels,
    opaquePixels, nontransparentBounds: bounds } = profile;
  assert.equal(width, 1280, id); assert.equal(height, 560, id);
  assert.equal(profile.nontransparentBorderPixels, 0, `${id}: eight transparent margin pixels`);
  assert.ok(transparentPixels > 0, `${id}: transparent background`);
  assert.ok(bounds.left >= 8 && bounds.top >= 8 && bounds.right < width - 8 && bounds.bottom < height - 8, `${id}: visible bounds`);
  if (legacy) assert.ok(opaquePixels > 1000, `${id}: original opaque-pixel requirement`);
  else {
    const visible = width * height - transparentPixels;
    const approved = approvedImages.get(id);
    if (approved) {
      assert.equal(sourceSha256, approved.sha256, `${id}: immutable approved image bytes`);
      assert.equal(nearOpaquePixels, approved.approvedNearlyOpaquePixelsAlpha250OrMore, `${id}: exact approved alpha>=250 samples`);
    }
    // Approved 6-A profiles have >177k near-opaque samples and ≥93% core
    // density (measured from immutable source alpha). Require a substantial
    // body, rather than accepting a few opaque specks or a faded fish.
    if (!approvedSmallBodies.has(id)) assert.ok(nearOpaquePixels >= 150000, `${id}: dense near-opaque fish body`);
    if (id === 'barramundi') {
      // The immutable PM-approved bytes have a wider soft contour. Exact
      // independent source-alpha counts replace neither other fish's density
      // nor this image's SHA / approved near-opaque / margin checks above.
      assert.equal(visible, approved.sourceMeasuredVisiblePixels, `${id}: exact source visible body`);
      assert.equal(softEdgePixels, approved.sourceMeasuredSoftEdgePixels, `${id}: exact source soft contour`);
    } else {
      assert.ok(nearOpaquePixels / visible >= 0.92, `${id}: dense near-opaque fish body`);
      assert.ok(softEdgePixels >= 1000 && softEdgePixels / visible <= 0.08, `${id}: bounded soft contour`);
    }
  }
}
