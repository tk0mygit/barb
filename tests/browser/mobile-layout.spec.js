import { test, expect } from './diagnostics-fixture.js';
import { startCapture, enterFishing, fishingInput, phase, tick, layout, assertLayout } from './mobile-capture.js';

// Layout / gesture checks keep the existing low-DPR test optimization. The
// separate comparison spec covers actual requested DPRs without this reduction.
test('mobile safe insets, short landscape, font enlargement, menu/fight/result rotation', async ({ createContext }, info) => {
  test.setTimeout(240000);
  const context = await createContext({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 0.5, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await startCapture(page); await enterFishing(page, true);
  // Emulated CSS inset values exercise the same env-backed variables. This is
  // not a claim of a physical notch / browser chrome test.
  async function insets(values) {
    await page.evaluate(values => Object.entries(values).forEach(([edge, value]) => document.documentElement.style.setProperty(`--safe-${edge}`, `${value}px`)), values);
  }
  const portraitInsets = { top: 44, bottom: 34, left: 0, right: 0 };
  await insets(portraitInsets); assertLayout(await layout(page), { fight: false, inset: portraitInsets });
  await page.locator('#menu-button').tap();
  const progress = await page.evaluate(() => window.lightingProbe.last.mistTime);
  await page.setViewportSize({ width: 740, height: 360 });
  await insets({ top: 0, bottom: 21, left: 44, right: 44 });
  await tick(page);
  expect(await page.evaluate(() => window.lightingProbe.last.mistTime)).toBe(progress);
  for (const view of ['encyclopedia', 'storage', 'equipment', 'sound']) {
    await page.locator(`[data-view="${view}"]`).tap();
    const content = page.locator('#collection-content');
    await content.evaluate(el => { el.scrollTop = el.scrollHeight; });
    if (view === 'storage') await expect(page.locator('#sell-all')).toBeDisabled();
    if (view === 'sound') {
      await expect(page.locator('#ambient-toggle')).toBeVisible();
      if (await page.locator('#ambient-retry').isVisible()) await page.locator('#ambient-retry').tap();
    }
    await page.locator('#collection-back').tap();
  }
  await page.locator('#collection-close').tap(); await tick(page);
  assertLayout(await layout(page), { fight: false, inset: { top: 0, bottom: 21, left: 44, right: 44 } });
  // Controls remain native hit targets after a short-height rotation.
  await page.locator('[data-lure-id="worm"]').tap();
  await page.locator('#cast-button').tap(); await tick(page);
  await page.locator('#cancel-cast').tap(); await tick(page);
  await page.setViewportSize({ width: 360, height: 740 }); await insets(portraitInsets);
  // Enlarge rendered text by 25%, preserving each element's existing size ratio.
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('#fishing-panel p, #fight-gauge label, #tension-value, #hint, #return-button')) {
      el.style.fontSize = `${parseFloat(getComputedStyle(el).fontSize) * 1.25}px`;
    }
  });
  assertLayout(await layout(page), { fight: false, inset: portraitInsets });
  const input = await fishingInput(page, true); await input.bite();
  assertLayout(await layout(page), { fight: false, inset: portraitInsets });
  await input.hook(); assertLayout(await layout(page), { inset: portraitInsets });
  const initial = await page.evaluate(() => window.mobileProbe.resources);
  for (const viewport of [{ width: 640, height: 320 }, { width: 844, height: 390 }, { width: 360, height: 740 }]) {
    await page.setViewportSize(viewport);
    await insets(viewport.width > viewport.height ? { top: 0, bottom: 21, left: 44, right: 44 } : portraitInsets);
    await expect.poll(() => page.evaluate(() => window.mobileProbe.viewport)).toEqual(viewport);
    expect(await phase(page)).toBe('fight');
    assertLayout(await layout(page), { inset: viewport.width > viewport.height ? { top: 0, bottom: 21, left: 44, right: 44 } : portraitInsets });
    const r = await page.evaluate(() => window.mobileProbe);
    expect(r.pixelRatio).toBe(0.5); expect(r.camera.aspect).toBeCloseTo(viewport.width / viewport.height, 8);
    // Aspect changes alter frustum culling, so calls / triangles can change.
    // Allocations must remain constant; returning to the same view must also
    // restore identical submitted work.
    for (const field of ['geometries', 'textures', 'programs']) expect(r.resources[field]).toBe(initial[field]);
    expect(r.resources.calls).toBeLessThan(40);
    if (viewport.width === 360) expect(r.resources).toEqual(initial);
  }
  // Focus loss next to rotation releases a native hold and freezes game time.
  await input.down(); await tick(page);
  const pointerId = await page.evaluate(() => window.e2eDiagnostics.events.findLast(e => e.type === 'pointerdown' && e.target === 'scene').pointerId);
  expect(await page.locator('#scene').evaluate((el, id) => el.hasPointerCapture(id), pointerId)).toBe(true);
  const beforeBlur = await page.evaluate(() => { window.dispatchEvent(new Event('blur')); return window.lightingProbe.last.mistTime; });
  await page.setViewportSize({ width: 844, height: 390 });
  await page.clock.fastForward(5000);
  expect(await page.evaluate(() => window.lightingProbe.last.mistTime)).toBe(beforeBlur);
  expect(await page.locator('#scene').evaluate((el, id) => el.hasPointerCapture(id), pointerId)).toBe(false);
  await input.up(); await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await tick(page);
  expect(await page.evaluate(() => window.lightingProbe.last.mistTime) - beforeBlur).toBeLessThanOrEqual(0.251);
  // Land using the unchanged tension feedback, then rotate the real modal.
  let held = false;
  for (let i = 0; i < 140 && await phase(page) === 'fight'; i++) {
    const value = await page.locator('#line-tension').evaluate(el => el.value);
    if (!held && value < 0.3) { await input.down(); held = true; }
    else if (held && value > 0.58) { await input.up(); held = false; }
    await tick(page);
  }
  if (held) await input.up();
  for (let i = 0; i < 6 && await phase(page) === 'landing'; i++) await tick(page);
  await expect(page.locator('#catch-dialog')).toBeVisible();
  for (const viewport of [{ width: 360, height: 740 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    await insets(viewport.width > viewport.height ? { top: 0, bottom: 21, left: 44, right: 44 } : portraitInsets);
    const dialog = page.locator('#catch-dialog');
    for (const id of ['sell-catch', 'close-catch']) {
      const button = page.locator(`#${id}`); await button.scrollIntoViewIfNeeded();
      const hit = await button.evaluate(el => { const r = el.getBoundingClientRect(); return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('button')?.id; });
      expect(hit).toBe(id);
    }
    const box = await dialog.boundingBox(); expect(box.y).toBeGreaterThanOrEqual(viewport.width > viewport.height ? 0 : 44);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height - (viewport.width > viewport.height ? 21 : 34));
  }
  await page.locator('#close-catch').tap(); await tick(page);
  await page.locator('#return-button').tap(); await tick(page);
  await expect(page.locator('#fish-button')).toBeVisible();
  expect(errors).toEqual([]);
  await page.screenshot({ path: info.outputPath('after-modal-rotation.png') });
  const clockAtLoss = await page.evaluate(() => {
    const extension = document.querySelector('#scene').getContext('webgl2').getExtension('WEBGL_lose_context');
    if (!extension) throw new Error('Missing WebGL context loss extension');
    extension.loseContext();
    return window.lightingProbe.last.mistTime;
  });
  await expect(page.locator('#error')).toContainText('描画が中断');
  await tick(page);
  expect(await page.evaluate(() => window.lightingProbe.last.mistTime)).toBe(clockAtLoss);
  await expect(page.locator('#fish-button')).toBeDisabled();
  await expect(page.locator('#menu-button')).toBeDisabled();
});
