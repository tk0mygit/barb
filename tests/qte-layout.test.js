import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateQteLayout } from '../src/ui/qte-layout.js';

const overlap = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
test('layout leaves safe insets, HUD/notifications and 75px swipe/80px target space in portrait and landscape', () => {
  for (const [width, height] of [[1000, 700], [390, 844], [844, 390], [568, 320], [360, 640]]) {
    const canvas = { left: 0, top: 0, right: width, bottom: height }, safe = { left: 24, top: 16, right: width - 24, bottom: height - 16 };
    const obstacles = [{ left: 24, top: 24, right: width - 24, bottom: 75 },
      { left: 24, top: height - 100, right: width - 24, bottom: height - 24 }];
    const result = calculateQteLayout({ canvas, safe, obstacles }); assert.ok(result, `${width}x${height}`);
    assert.ok(result.panel.left >= safe.left && result.panel.right <= safe.right && result.panel.top >= safe.top && result.panel.bottom <= safe.bottom);
    assert.ok(obstacles.every(o => !overlap(o, result.panel)));
    assert.ok(result.region.right - result.region.left >= 80 && result.region.bottom - result.region.top >= 80);
    for (const [x, y] of [[40, 0], [-40, 0], [0, 40], [0, -40]]) assert.ok(result.target.x + x >= result.region.left
      && result.target.x + x <= result.region.right && result.target.y + y >= result.region.top && result.target.y + y <= result.region.bottom);
  }
});
test('insufficient canvas space is explicit; no fabricated region or successful display', () => {
  const canvas = { left: 0, top: 0, right: 180, bottom: 176 };
  assert.equal(calculateQteLayout({ canvas, safe: canvas }), null);
  const large = { ...canvas, right: 800, bottom: 600 };
  assert.equal(calculateQteLayout({ canvas: large, safe: large, obstacles: [large] }), null);
});
test('real short landscape occupancy retains an 80px target/swipe region beside the existing HUD and reticle', () => {
  const result = calculateQteLayout({ canvas: { left: 0, top: 0, right: 568, bottom: 320 }, safe: { left: 24, top: 16, right: 544, bottom: 304 },
    obstacles: [{ left: 36, top: 24, right: 532, bottom: 76 }, { left: 278, top: 148, right: 290, bottom: 172 },
      { left: 36, top: 155, right: 260, bottom: 292 }, { left: 308, top: 199, right: 532, bottom: 292 }] });
  assert.ok(result); assert.equal(result.compact, true);
  assert.ok(result.region.bottom - result.region.top >= 80 && result.region.right - result.region.left >= 80);
});
