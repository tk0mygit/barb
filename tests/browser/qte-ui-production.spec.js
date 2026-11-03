import { execFileSync } from 'node:child_process';
import { test, expect } from './diagnostics-fixture.js';
import { openQteProduction, productInput, productSnapshot, castAndHookProduct, advanceToWarning } from './qte-production-fixture.js';
import { observeQteUI, captureQteUI } from './qte-fixture.js';
import { auditProductionQte } from '../helpers/qte-production-audit.js';

const approvedBase = '0cc246e387585363747a24ea82d818f91ba95bfe';
const oldSource = execFileSync('git', ['show', `${approvedBase}:src/ui/qte-layout.js`], { cwd: new URL('../../', import.meta.url) }).toString();
const { calculateQteLayout: calculateApprovedLayout } = await import(`data:text/javascript;base64,${Buffer.from(oldSource).toString('base64')}`);
const inside = (p, r) => r && p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom;

test('production central QTE: rendered warning boundary, expanded FIGHT overlap and native 0.5s scoring', async ({ createContext }, info) => {
  const context = await createContext({ viewport: { width: 1000, height: 700 }, deviceScaleFactor: .5 });
  const page = await context.newPage(); await openQteProduction(page);
  const input = await productInput(page, false), p = await castAndHookProduct(page, input, { operation: 'swipe' });
  await advanceToWarning(page, input, p, 0);
  const warning = await productSnapshot(page);
  expect(warning.snapshot.active).toBeNull(); expect(warning.snapshot.displayReady).toBe(false);
  // A native warning contact cannot carry into the later displayed window.
  await input.down(warning.geometry.target); await input.up();
  expect((await productSnapshot(page)).preview.success).toBe(false);
  const frames = [{ snapshot: warning.snapshot, render: await page.evaluate(() => window.qteProduct.renderer.info.render.frame) }];
  for (let n = 0; n < 50 && !(await productSnapshot(page)).snapshot.displayReady; n++) {
    await page.clock.fastForward(16);
    frames.push(await page.evaluate(() => ({ snapshot: window.qteProduct.qteDelivery.snapshot,
      render: window.qteProduct.renderer.info.render.frame })));
  }
  const before = await productSnapshot(page), measured = await observeQteUI(page);
  expect(before.snapshot.displayReady, JSON.stringify({ before, frames })).toBe(true);
  expect(before.snapshot.active).toBeGreaterThanOrEqual(before.snapshot.warning + 600);
  expect(before.snapshot.deadline - before.snapshot.active).toBe(500);
  expect(frames.at(-1).render).toBeGreaterThan(frames[0].render);
  expect(measured.grid.filter(point => point.hit !== 'scene'), JSON.stringify(measured)).toEqual([]);
  expect(measured.descriptor).toMatchObject({ operation: 'swipe', direction: 'right' });
  expect(measured.arrows).toHaveLength(2);
  for (const style of measured.styles) {
    expect(style.backgroundColor).toBe('rgba(0, 0, 0, 0)'); expect(style.backgroundImage).toBe('none');
    expect(style.outlineStyle).toBe('none'); expect(style.boxShadow).toBe('none'); expect(style.pointerEvents).toBe('none');
  }
  const old = calculateApprovedLayout(measured);
  // Native PointerEvent coordinates can quantize fractional CDP positions.
  // Choose whole CSS pixels, then prove the same spatial contract explicitly;
  // keep the exact native coordinate assertion below.
  const starts = measured.grid.map(point => ({ x: Math.round(point.x), y: Math.round(point.y) }))
    .filter(point => inside(point, measured.geometry.region) && !inside(point, old?.region) && inside(point, measured.fight)
    && inside({ x: point.x + 80, y: point.y }, measured.geometry.region));
  expect(starts.length, JSON.stringify({ measured, old })).toBeGreaterThan(0);
  const start = { x: starts[0].x, y: starts[0].y }, end = { x: start.x + 80, y: start.y };
  expect(inside(start, measured.geometry.region)).toBe(true); expect(inside(start, measured.fight)).toBe(true);
  expect(inside(start, old?.region)).toBeFalsy();
  expect(await page.evaluate(points => points.map(p => document.elementFromPoint(p.x, p.y)?.id), [start, end])).toEqual(['scene', 'scene']);
  await captureQteUI(page, info, 'production-fight-central-qte', { approvedBase, old, measured, before, frames, start, end });
  await input.down(start); await input.move(end); await page.clock.fastForward(20); await input.up();
  const pending = await productSnapshot(page);
  expect(pending.preview.success, JSON.stringify(pending)).toBe(true);
  expect(pending.fight.qte.successes).toBe(before.fight.qte.successes);
  const remaining = await page.evaluate(() => {
    const d = window.qteProduct.qteDelivery; return Math.max(0, d.snapshot.cut - d.clock.read().active);
  });
  await page.clock.fastForward(remaining + 32);
  const after = await productSnapshot(page), native = await page.evaluate(() => window.productNativeEvidence);
  expect(after.fight.qte.successes).toBe(before.fight.qte.successes + 1);
  expect(after.events.filter(e => e.type === 'qte-resolved')).toHaveLength(1);
  expect(native.some(e => e.type === 'pointerdown' && e.x === start.x && e.y === start.y && e.trusted)).toBe(true);
  const audit = await auditProductionQte({ before, after, native });
  await info.attach('production-expanded-region-source-replay', { body: JSON.stringify({ before, pending, after, native, audit }), contentType: 'application/json' });
});
