import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { placeCastNotices } from '../src/ui/cast-notices.js';
import { createCastVisibility } from '../src/rendering/cast-visibility.js';
import { nearRingExpansion } from '../src/rendering/fishing-visuals.js';

const separated = (a, b, gap) => a.right + gap <= b.left || b.right + gap <= a.left
  || a.bottom + gap <= b.top || b.bottom + gap <= a.top;
const box = (left, top, width, height, extra = {}) => ({ left, top, width, height, right: left + width, bottom: top + height, ...extra });
const profiles = [[1000, 700], [390, 844], [844, 390], [320, 568]];

function scene(width, height, insets = {}) {
  const portrait = width <= 640 && height > 500, mobile = width <= 640 || height <= 500;
  const left = Math.max(mobile ? 22 : 42, (insets.left ?? 0) + 12), right = width - Math.max(mobile ? 22 : 42, (insets.right ?? 0) + 12);
  const top = Math.max(portrait ? 88 : height <= 500 ? 84 : 100, (insets.top ?? 0) + (portrait ? 68 : height <= 500 ? 64 : 72));
  const panelWidth = portrait ? right - left : 320, panelHeight = width <= 340 ? 117 : 99;
  const actionWidth = portrait ? panelWidth : Math.min(420, right - left - 360);
  const actionTop = portrait ? top + panelHeight + 8 : top, actionHeight = width <= 340 ? 50 : 88;
  const blocked = [box(left, Math.max(mobile ? 24 : 32, (insets.top ?? 0) + 8), right - left, 50),
    box(left, top, panelWidth, panelHeight), box(portrait ? left : right - actionWidth, actionTop, actionWidth, actionHeight),
    box(width / 2 - 10, height / 2 - 10, 20, 20)];
  const edgeLeft = 12 + (insets.left ?? 0), edgeRight = width - 12 - (insets.right ?? 0);
  const middle = Math.max(height * (height <= 500 ? 0.54 : 0.55), (insets.top ?? 0) + (height <= 500 ? 208 : 310));
  const saleWidth = Math.min(220, width * 0.36), awardWidth = Math.min(180, width * 0.32);
  const usableWidth = edgeRight - edgeLeft;
  // CSS/text measurements from all three notices shown at once. Reflow keeps
  // each font and message intact; only its available inline width increases.
  const notices = [box(edgeLeft, middle, 100, 61, { id: 'spot', variants: [{ width: usableWidth, height: 47 }] }),
    box(edgeRight - saleWidth, middle, saleWidth, width <= 340 ? 169.15625 : width <= 640 ? 125.96875 : 82.78125,
      { id: 'sale', variants: [{ width: usableWidth, height: 82.78125 }, { width: usableWidth - awardWidth - 8, height: 104.375 }] }),
    box(edgeLeft, height - 12 - (insets.bottom ?? 0) - (width <= 340 ? 68 : 48.5), awardWidth, width <= 340 ? 68 : 48.5,
      { id: 'achievement', variants: [{ width: Math.min(usableWidth, width - 44), height: 48.5 }] })];
  const camera = new THREE.PerspectiveCamera(55, width / height, 0.1, 2400);
  camera.position.set(0, 2.15, 31.25); camera.lookAt(0, 2.15, 11.25);
  const visibility = createCastVisibility(camera, () => ({ width, height, insets }));
  return { blocked, notices, visibility };
}

function assertLayout(positions, original, { width, height, insets = {}, blocked, context = '' }) {
  assert.ok(positions, `${width}x${height}: all three notices must fit ${context}`);
  assert.equal(positions.length, original.length);
  for (const [index, position] of positions.entries()) {
    assert.equal(position.id, original[index].id);
    assert.ok([original[index], ...(original[index].variants ?? [])]
      .some(size => size.width === position.width && size.height === position.height), 'only measured text reflow sizes are allowed');
    assert.ok(position.left >= 12 + (insets.left ?? 0)); assert.ok(position.top >= 12 + (insets.top ?? 0));
    assert.ok(position.right <= width - 12 - (insets.right ?? 0)); assert.ok(position.bottom <= height - 12 - (insets.bottom ?? 0));
    for (const obstacle of blocked) assert.ok(separated(position, obstacle, obstacle.gap ?? 8), `${position.id}: obstacle collision`);
    for (const other of positions.slice(0, index)) assert.ok(separated(position, other, 8), `${position.id}: notice collision`);
  }
}

for (const [width, height] of profiles) test(`${width}x${height}: three notices avoid real markers through long casts and near retrieval`, () => {
  const insetProfiles = width <= 340 ? [{}] : [{}, width > height ? { left: 44, right: 44, bottom: 21 } : { top: 44, bottom: 34 }];
  for (const insets of insetProfiles) {
    const { blocked, notices, visibility } = scene(width, height, insets);
    const limits = visibility.constrain({ origin: { x: 0, z: 30 }, heading: 0, requestedDistance: 40, spread: 0.7 });
    for (const heading of [limits.minAngle, 0, limits.maxAngle]) {
      let previous = notices;
      for (const distance of [40, 32, 16, 8, 5.5, 4.5]) {
        // The initial 40m splash expands further than BITE during retrieval;
        // reeling back through 8m never starts a second splash there.
        const radius = 0.7 * (1 + (distance === 40 ? 1.6 : 0.9) * nearRingExpansion(distance));
        const marker = visibility.footprint({ x: Math.sin(heading) * distance, z: 30 - Math.cos(heading) * distance, radius });
        const obstacles = [...blocked, { ...marker, gap: 12 }];
        const options = { width, height, insets, blocked: obstacles,
          notices: previous.map(position => {
            const natural = notices.find(notice => notice.id === position.id);
            return { ...position, variants: [natural, ...natural.variants] };
          }),
          context: JSON.stringify({ insets, heading, distance }) };
        const positions = placeCastNotices(options);
        assertLayout(positions, notices, options);
        // A stationary marker does not cause layout oscillation or drift.
        assert.deepEqual(placeCastNotices({ ...options, notices: positions }), positions);
        previous = positions;
      }
    }
  }
});

test('small safe-area keeps each ordinary notice readable and reports simultaneous physical overflow', () => {
  const width = 320, height = 568, insets = { top: 44, bottom: 34 };
  const { blocked, notices, visibility } = scene(width, height, insets);
  const limits = visibility.constrain({ origin: { x: 0, z: 30 }, heading: 0, requestedDistance: 40, spread: 0.7 });
  for (const heading of [limits.minAngle, 0, limits.maxAngle]) for (const distance of [40, 32, 8, 5.5, 4.5]) {
    const marker = visibility.footprint({ x: Math.sin(heading) * distance, z: 30 - Math.cos(heading) * distance,
      radius: 0.7 * (1 + 0.9 * nearRingExpansion(distance)) });
    const options = { width, height, insets, blocked: [...blocked, { ...marker, gap: 12 }] };
    for (const notice of notices) assertLayout(placeCastNotices({ ...options, notices: [notice] }), [notice], options);
  }
  // With the largest current action envelope, all three messages cannot fit
  // between this tiny safe viewport and the immutable primary controls. The
  // caller must reject/recover visibly, never hide a message or a water marker.
  const marker = visibility.footprint({ x: Math.sin(limits.minAngle) * 5.5, z: 30 - Math.cos(limits.minAngle) * 5.5,
    radius: 0.7 * (1 + 0.9 * nearRingExpansion(5.5)) });
  const before = structuredClone(notices);
  assert.equal(placeCastNotices({ width, height, insets, blocked: [...blocked, { ...marker, gap: 12 }], notices }), null);
  assert.deepEqual(notices, before);
});

test('a sale notice that previously blocked a central cast moves without hiding or resizing information', () => {
  const { blocked, visibility } = scene(390, 844);
  const marker = visibility.footprint({ x: 0, z: -2, radius: 1.82 });
  const notices = [box(237.6, 464.2, 140.4, 88, { id: 'sale' })];
  assert.equal(separated(notices[0], marker, 12), false, 'fixture must reproduce the former collision');
  const options = { width: 390, height: 844, blocked: [...blocked, { ...marker, gap: 12 }], notices };
  const before = structuredClone(notices);
  const positions = placeCastNotices(options);
  assertLayout(positions, notices, options);
  assert.deepEqual(notices, before, 'the solver never mutates the original layout');
});

test('impossible layouts report failure instead of hiding notices or overlapping the marker', () => {
  const notices = [box(12, 12, 100, 60, { id: 'sale' })];
  assert.equal(placeCastNotices({ width: 320, height: 568, notices, blocked: [box(0, 0, 320, 568, { gap: 12 })] }), null);
  assert.equal(placeCastNotices({ width: 100, height: 80, notices }), null);
  assert.deepEqual(placeCastNotices({ width: 100, height: 80, notices: [] }), []);
});
