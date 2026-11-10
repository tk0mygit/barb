import { execFileSync } from 'node:child_process';
import { test, expect } from './diagnostics-fixture.js';
import { openQteProduction, productInput, castAndHookProduct, advanceToWarning, performProductOperation } from './qte-production-fixture.js';
import { observeQteUI, captureQteUI } from './qte-fixture.js';
import { auditProductionQte } from '../helpers/qte-production-audit.js';
import { createLightingSave } from '../helpers/lighting-save.js';

const base = '05dd8fcb45726cbbfe439d43c89f295f5affac93';
const source = execFileSync('git', ['show', `${base}:src/ui/qte-layout.js`]).toString();
const { calculateQteLayout: approvedLayout } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const timingSource = execFileSync('git', ['show', `${base}:src/game/fight-qte.js`]).toString();
const { qteSeconds: approvedSeconds } = await import(`data:text/javascript;base64,${Buffer.from(timingSource).toString('base64')}`);

for (const viewport of [{ width: 568, height: 320 }, { width: 844, height: 390 }]) for (const operation of ['flick', 'swipe', 'tap', 'target']) {
  test(`UX-B3 ${viewport.width} short20 rotation: native ${operation}, unchanged QTE geometry and time`, async ({ createContext }, info) => {
    const context = await createContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: .5 });
    const page = await context.newPage(), save = structuredClone(createLightingSave(90));
    save.boat = { x: 0, z: -55, heading: 0 };
    await openQteProduction(page, { save });
    const input = await productInput(page, true);
    const direction = operation === 'swipe' ? 'down' : operation === 'flick' ? 'up' : undefined;
    await castAndHookProduct(page, input, { operation, direction });
    await page.setViewportSize(viewport);
    await page.evaluate(() => {
      for (const [edge, v] of Object.entries({ top: 8, bottom: 8, left: 12, right: 12 })) document.documentElement.style.setProperty(`--safe-${edge}`, `${v}px`);
      document.documentElement.style.fontSize = '20px';
      for (const e of document.querySelectorAll('#fishing-panel p, #fight-gauge label, #tension-value, #hint, #fishing-note, .action-panel button, #spot-name, #spot-effect, #sale-notice')) e.style.setProperty('font-size', '20px', 'important');
    });
    await advanceToWarning(page, input, { x: viewport.width * .6, y: viewport.height * .6 }, 0);
    const evidence = await performProductOperation(page, input);
    await expect(page.locator('#spot-status')).toBeVisible();
    const measured = await observeQteUI(page), expected = approvedLayout(measured);
    const paint = await page.evaluate(() => {
      const visible = e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden';
      const b = e => ({ id: e.id || e.classList.value, ...e.getBoundingClientRect().toJSON() });
      const hud = [...document.querySelectorAll('#fishing-panel, #fishing-conditions, #return-button, .header-tools, #spot-status, #sale-notice, #achievement-notice')].filter(visible).map(b);
      const qte = [...document.querySelectorAll('.qte-target, .qte-arrow-shape, .qte-timer')].filter(visible).map(b);
      for (const e of document.querySelectorAll('.qte-state, .qte-instruction, .qte-taps')) {
        if (!visible(e)) continue;
        const range = document.createRange(); range.selectNodeContents(e);
        for (const rect of range.getClientRects()) qte.push({ id: e.className, ...rect.toJSON() });
      }
      return { hud, qte };
    });
    for (const q of paint.qte) for (const h of paint.hud) {
      expect(q.right <= h.left || h.right <= q.left || q.bottom <= h.top || h.bottom <= q.top,
        JSON.stringify({ q, h, paint })).toBe(true);
    }
    // Resolve the approved base calculator through the same browser's native
    // CSS pixel quantization, independently of the live QTE node/styles.
    const approvedRegion = await page.evaluate(({ panel: p, region: r }) => {
      const parent = document.createElement('div'), child = document.createElement('div');
      Object.assign(parent.style, { position: 'fixed', visibility: 'hidden', padding: '0', border: '0',
        left: `${p.left}px`, top: `${p.top}px`, width: `${p.right - p.left}px`, height: `${p.bottom - p.top}px` });
      Object.assign(child.style, { position: 'absolute', padding: '0', border: '0', left: `${r.left - p.left}px`,
        top: `${r.top - p.top}px`, width: `${r.right - r.left}px`, height: `${r.bottom - r.top}px` });
      parent.append(child); document.body.append(parent);
      const b = child.getBoundingClientRect(), result = { left: b.left, top: b.top, right: b.right, bottom: b.bottom };
      parent.remove(); return result;
    }, expected);
    expect(measured.geometry.region).toEqual(approvedRegion);
    if (operation === 'target') {
      const circle = measured.circles[0];
      expect(measured.geometry.target).toEqual({ x: circle.left + circle.width / 2, y: circle.top + circle.height / 2 });
    } else expect(measured.geometry.target).toEqual(expected.target);
    expect(measured.grid.filter(point => point.hit !== 'scene')).toEqual([]);
    const edgeHits = await page.evaluate(r => {
      const points = [];
      for (let row = 0; row <= 4; row++) for (let col = 0; col <= 8; col++) {
        const x = r.left + .1 + (r.right - r.left - .2) * col / 8;
        const y = r.top + .1 + (r.bottom - r.top - .2) * row / 4;
        points.push({ x, y, hit: document.elementFromPoint(x, y)?.id });
      }
      return points;
    }, measured.geometry.region);
    expect(edgeHits.filter(point => point.hit !== 'scene'), JSON.stringify(edgeHits)).toEqual([]);
    expect(evidence.before.snapshot.deadline - evidence.before.snapshot.active).toBe(approvedSeconds(evidence.before.fight.difficulty, operation) * 1000);
    const native = await page.evaluate(() => window.productNativeEvidence);
    expect(native.some(event => event.trusted && event.pointerType === 'touch' && event.type === 'pointerdown')).toBe(true);
    const audit = await auditProductionQte({ ...evidence, native });
    await captureQteUI(page, info, 'short20-qte', { base, operation, evidence, audit, measured, expected, paint, edgeHits });
  });
}
