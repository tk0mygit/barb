import { execFileSync } from 'node:child_process';
import { test, expect } from './diagnostics-fixture.js';
import { openQteProduction, productInput, castAndHookProduct, advanceToWarning, performProductOperation } from './qte-production-fixture.js';
import { observeQteUI, captureQteUI } from './qte-fixture.js';
import { auditProductionQte } from '../helpers/qte-production-audit.js';

const base = '05dd8fcb45726cbbfe439d43c89f295f5affac93';
const source = execFileSync('git', ['show', `${base}:src/ui/qte-layout.js`]).toString();
const { calculateQteLayout: approvedLayout } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

for (const operation of ['flick', 'swipe', 'tap', 'target']) {
  test(`UX-B3 short20 rotation: native ${operation}, unchanged QTE geometry and time`, async ({ createContext }, info) => {
    const context = await createContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: .5 });
    const page = await context.newPage(); await openQteProduction(page);
    const input = await productInput(page, true);
    await castAndHookProduct(page, input, { operation });
    await page.setViewportSize({ width: 568, height: 320 });
    await page.evaluate(() => {
      for (const [edge, v] of Object.entries({ top: 8, bottom: 8, left: 12, right: 12 })) document.documentElement.style.setProperty(`--safe-${edge}`, `${v}px`);
      document.documentElement.style.fontSize = '20px';
      for (const e of document.querySelectorAll('#fishing-panel p, #fight-gauge label, #tension-value, #hint, #fishing-note, .action-panel button')) e.style.setProperty('font-size', '20px', 'important');
    });
    await advanceToWarning(page, input, { x: 340, y: 192 }, 0);
    const evidence = await performProductOperation(page, input);
    const measured = await observeQteUI(page), expected = approvedLayout(measured);
    expect(measured.geometry.region).toEqual(expected.region);
    expect(measured.geometry.target).toEqual(expected.target);
    expect(measured.grid.filter(point => point.hit !== 'scene')).toEqual([]);
    expect(evidence.before.snapshot.deadline - evidence.before.snapshot.active).toBe(evidence.before.descriptor.durationMs);
    const native = await page.evaluate(() => window.productNativeEvidence);
    expect(native.some(event => event.trusted && event.pointerType === 'touch' && event.type === 'pointerdown')).toBe(true);
    const audit = await auditProductionQte({ ...evidence, native });
    await captureQteUI(page, info, 'short20-qte', { base, operation, evidence, audit, measured, expected });
  });
}
