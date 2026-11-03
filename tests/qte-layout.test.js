import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateQteLayout } from '../src/ui/qte-layout.js';

const overlap = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
const width = r => r.right - r.left, height = r => r.bottom - r.top;
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
const rect = (left, top, right, bottom) => ({ left, top, right, bottom });

test('central region expands both dimensions from the approved old layout and keeps safe insets on PC/portrait/landscape', () => {
  // Old unobstructed region sizes from 0cc246e (304px panel cap, 12px
  // horizontal and 52/24px vertical insets). Obstacles only reduced them.
  for (const [w, h, oldWidth] of [[1000, 700, 280], [390, 844, 280], [844, 390, 280], [568, 320, 280], [360, 640, 272]]) {
    const canvas = rect(0, 0, w, h), safe = rect(24, 16, w - 24, h - 16);
    const result = calculateQteLayout({ canvas, safe }); assert.ok(result, `${w}x${h}`);
    const { panel, region, target } = result;
    assert.ok(panel.left >= safe.left + 8 && panel.right <= safe.right - 8
      && panel.top >= safe.top + 8 && panel.bottom <= safe.bottom - 8);
    assert.ok(width(region) > oldWidth, `${w}x${h}: ${width(region)} <= ${oldWidth}`);
    assert.ok(height(region) > 140, `${w}x${h}: ${height(region)} <= 140`);
    close((panel.left + panel.right) / 2, w / 2); close((panel.top + panel.bottom) / 2, h / 2);
    close(target.x, w / 2); close(target.y, h / 2);
    // Each direction has space for an ordinary 75px swipe and the fixed
    // 40px touch radius, with neither additional start nor endpoint rules.
    for (const [x, y] of [[40, 0], [-40, 0], [0, 40], [0, -40]]) assert.ok(target.x + x >= region.left
      && target.x + x <= region.right && target.y + y >= region.top && target.y + y <= region.bottom);
    assert.ok(Object.isFrozen(result) && Object.isFrozen(panel) && Object.isFrozen(region) && Object.isFrozen(target));
  }
});

test('decorative FIGHT HUD occupancy no longer changes placement or causes unavailable layout', () => {
  const canvas = rect(0, 0, 568, 320), safe = rect(24, 16, 544, 304);
  const obstacles = [rect(36, 24, 532, 76), rect(278, 148, 290, 172),
    rect(36, 155, 260, 292), rect(308, 199, 532, 292)];
  const result = calculateQteLayout({ canvas, safe, obstacles });
  assert.deepEqual(result, calculateQteLayout({ canvas, safe }));
  assert.deepEqual(result, calculateQteLayout({ canvas, safe, obstacles: [canvas] }));
  assert.ok(obstacles.some(o => overlap(o, result.region)));
  assert.equal(result.compact, true);
  assert.ok(width(result.region) > 84 && height(result.region) > 80);
  close(result.target.x, 284); close(result.target.y, 160);
});

test('fractional canvas and pre-intersected visual viewport remain centred without safe-area expansion', () => {
  const canvas = rect(-20.375, 4.125, 822.875, 676.625);
  // HUD measure() already intersects the CSS safe probe with visualViewport.
  const safe = rect(17.25, 31.375, 701.625, 594.875);
  const { panel, region, target } = calculateQteLayout({ canvas, safe });
  close(target.x, (safe.left + safe.right) / 2); close(target.y, (safe.top + safe.bottom) / 2);
  assert.ok(panel.left >= safe.left + 8 && panel.right <= safe.right - 8
    && panel.top >= safe.top + 8 && panel.bottom <= safe.bottom - 8);
  assert.ok(!Number.isInteger(region.left));
  // Only the shared canvas/viewport is usable when the canvas starts inside it.
  const clipped = calculateQteLayout({ canvas: rect(90.5, 100.25, 850, 800), safe });
  close(clipped.target.x, (90.5 + safe.right) / 2); close(clipped.target.y, (100.25 + safe.bottom) / 2);
});

test('insufficient, disjoint, reversed or nonfinite rectangles fail explicitly without fabricated geometry', () => {
  const large = rect(0, 0, 800, 600);
  for (const canvas of [rect(0, 0, 180, 176), rect(0, 0, 800, 200), rect(800, 0, 0, 600), rect(0, 600, 800, 600),
    rect(0, 0, NaN, 600), rect(0, 0, Infinity, 600), rect(-Number.MAX_VALUE, 0, Number.MAX_VALUE, 600), null, {}])
    assert.equal(calculateQteLayout({ canvas, safe: large }), null);
  assert.equal(calculateQteLayout({ canvas: large, safe: rect(900, 0, 1700, 600) }), null);
  assert.equal(calculateQteLayout({ canvas: large, safe: rect(0, 0, 800, -1) }), null);
  assert.equal(calculateQteLayout({ canvas: large }), null);
  assert.equal(calculateQteLayout(), null); assert.equal(calculateQteLayout(null), null);
});
