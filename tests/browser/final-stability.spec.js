import { writeFile } from 'node:fs/promises';
import { test, expect } from './diagnostics-fixture.js';
import { activateButton } from './input-fixture.js';
import { startCapture, enterFishing, fishingInput, tick, phase } from './mobile-capture.js';
import { read, assertEnvironment } from './day-night-fixture.js';
import { createResourceDiagnostics, assertResourcePlateau } from './resource-diagnostics.js';
import { validateSaveData } from '../../src/game/save-data.js';

const SAVE_KEYS = ['barb.save.v1.slotA', 'barb.save.v1.slotB'];
const money = value => `${value.toLocaleString('ja-JP')} 通貨`;
const elapsed = async page => (await read(page)).mistTime;

async function savedSlots(page) {
  const slots = await page.evaluate(keys => keys.map(key => JSON.parse(localStorage.getItem(key))).filter(Boolean), SAVE_KEYS);
  for (const slot of slots) {
    expect(slot.storageVersion).toBe(1);
    validateSaveData(slot.data);
  }
  return slots.sort((a, b) => b.generation - a.generation);
}

// This is one bounded transaction/lifecycle regression, not a real-time soak.
// Native input drives every cast and capture. Long virtual frames exercise the
// active game clock/environment; fishing and movement retain their dt cap.
test('touch: repeated play, multi-cycle environment and reload keep resources and durable progress stable', async ({ createContext }, info) => {
  const started = Date.now();
  // Resource lifetimes and native CSS-coordinate gestures do not need a large
  // SwiftShader backbuffer. Actual-DPR quality remains in mobile-performance.
  const context = await createContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 0.5 });
  const page = await context.newPage();
  const resources = await createResourceDiagnostics(page);
  let completed = false;
  const report = { limits: ['Virtual elapsed time is not 15–20 minutes of real-time play.',
    'Headless Chromium touch emulation is not physical Chrome/Brave acceptance.'], captures: [], environment: [], pauses: [] };
  try {
    await startCapture(page, 90);
    // Match the established fishing fixtures: deterministic draws, while the
    // production state machine, gestures, economy and saves remain untouched.
    await page.evaluate(() => { Math.random = () => 0.1; });
    const input = await fishingInput(page, true);
    const click = locator => activateButton(locator, true);
    const sampleAt = async target => {
      const current = await elapsed(page);
      expect(target).toBeGreaterThan(current);
      await page.clock.fastForward(Math.round((target - current) * 1000));
      const actual = await read(page);
      assertEnvironment(actual, target);
      report.environment.push({ elapsedSeconds: target, fogStrength: actual.fogStrength, mistAmount: actual.mistAmount });
    };
    const settle = async () => { for (let i = 0; i < 20; i++) await tick(page); };
    const openView = async view => {
      await click(page.locator('#menu-button'));
      await expect(page.locator('#collection-dialog')).toBeVisible();
      await click(page.locator(`[data-view="${view}"]`));
    };
    const closeMenu = () => click(page.locator('#collection-close'));

    // Move and brake once, then keep the same boat position for resource
    // comparisons. READY camera settling and matching daytime remove culling
    // and fog differences from the comparison.
    await input.down({ x: 240, y: 400 }); await input.move({ x: 240, y: 300 });
    for (let i = 0; i < 4; i++) await tick(page);
    await expect(page.locator('#motion-label')).toHaveText('航行中');
    await input.up(); await settle();
    await expect(page.locator('#motion-label')).toHaveText('停船中');
    await expect(page.locator('#speed')).toHaveText('0.0');
    await enterFishing(page, true);
    await click(page.locator('#cast-button')); await tick(page);
    await expect(page.locator('#fishing-panel')).toHaveAttribute('data-phase', 'aim');
    await click(page.locator('#cancel-cast')); await tick(page);
    await expect(page.locator('#fishing-panel')).toHaveAttribute('data-phase', 'ready');
    await settle(); await sampleAt(450);
    await resources.snapshot('initial-ready');

    let balance = 0, warmup;
    const dispositions = [];
    for (let round = 0; round < 3; round++) {
      await click(page.locator(`[data-lure-id="${round === 1 ? 'crankbait' : 'minnow'}"]`));
      await tick(page);
      await expect(page.locator(`[data-lure-id="${round === 1 ? 'crankbait' : 'minnow'}"]`)).toHaveAttribute('aria-pressed', 'true');
      await input.bite();
      const biteTime = await page.evaluate(() => performance.now());
      await input.hook();
      expect(await page.evaluate(() => performance.now()) - biteTime).toBeLessThan(1000);
      let held = false;
      for (let i = 0; i < 140; i++) {
        const { currentPhase, tension } = await page.evaluate(() => ({ currentPhase: document.querySelector('#fishing-panel').dataset.phase,
          tension: document.querySelector('#line-tension').value }));
        if (currentPhase !== 'fight') break;
        if (!held && tension < 0.35) { await input.down(); held = true; }
        else if (held && tension > 0.65) { await input.up(); held = false; }
        await tick(page);
      }
      if (held) await input.up();
      expect(await phase(page)).toBe('landing');
      for (let i = 0; i < 5; i++) await tick(page);
      await expect(page.locator('#catch-dialog')).toBeVisible();
      const price = Number((await page.locator('#catch-sale-price').textContent()).replace(/[^0-9]/g, ''));
      const disposition = round === 1 ? 'stored' : 'sold';
      dispositions.push(disposition);
      await click(page.locator(round === 1 ? '#close-catch' : '#sell-catch')); await tick(page);
      if (disposition === 'sold') balance += price;
      await expect(page.locator('#fishing-panel')).toHaveAttribute('data-phase', 'ready');
      await expect(page.locator('#wallet-balance')).toHaveText(money(balance));

      await openView('storage');
      await expect(page.locator('#collection-title')).toHaveText('保管魚');
      await expect(page.locator('.stored-fish')).toHaveCount(round === 0 ? 0 : 1);
      const clockBefore = await elapsed(page);
      await page.clock.fastForward(720000);
      expect(await elapsed(page)).toBe(clockBefore);
      report.pauses.push({ reason: 'menu', round: round + 1, virtualMs: 720000, elapsedSeconds: clockBefore });
      await click(page.locator('#collection-back')); await click(page.locator('[data-view="encyclopedia"]'));
      expect(await page.locator('button.fish-card').count()).toBeGreaterThan(0);
      await click(page.locator('#collection-back')); await click(page.locator('[data-view="equipment"]'));
      await expect(page.locator('[data-equipment="rod"] h3')).toHaveText('ロッド · Lv.1');
      await expect(page.locator('[data-equipment="reel"] h3')).toHaveText('リール · Lv.1');
      await closeMenu(); await tick(page);
      expect(await elapsed(page) - clockBefore).toBeCloseTo(0.25, 7);
      await click(page.locator('#return-button')); await tick(page);
      await expect(page.locator('#fish-button')).toBeEnabled();
      await expect(page.locator('#speed')).toHaveText('0.0');
      await enterFishing(page, true);

      if (round === 0) {
        await sampleAt(630); // genuine dense night, then its resolution
        expect((await read(page)).fogStrength).toBe(0.95);
        await sampleAt(720.25);
      } else if (round === 1) {
        await sampleAt(2790); // genuine ordinary fog on a later night
        expect((await read(page)).fogStrength).toBeGreaterThan(0.3);
        expect((await read(page)).fogStrength).toBeLessThan(0.7);
        await sampleAt(2880.25);
      }
      await settle(); await sampleAt([810, 2970, 3330][round]);
      const sample = await resources.snapshot(round === 0 ? 'warmup-ready' : `repeat-${round + 1}-ready`);
      if (round === 0) warmup = sample;
      else assertResourcePlateau(warmup, sample);

      await page.evaluate(() => { window.dispatchEvent(new Event('pagehide')); window.dispatchEvent(new Event('pageshow')); });
      const slots = await savedSlots(page);
      expect(slots).toHaveLength(2);
      expect(slots[0].generation).toBeGreaterThan(slots[1].generation);
      expect(slots[0].data.collection.catches).toHaveLength(round + 1);
      expect(slots[0].data.collection.wallet.balance).toBe(balance);
      expect(slots[0].data.collection.catches.map(fish => fish.disposition)).toEqual(dispositions);
      expect(new Set(slots[0].data.collection.catches.map(fish => fish.id)).size).toBe(round + 1);
      const awards = slots[0].data.achievements.unlocked.map(award => award.id);
      expect(new Set(awards).size).toBe(awards.length);
      report.captures.push({ round: round + 1, disposition, price, balance, generation: slots[0].generation,
        elapsedSeconds: slots[0].data.clock.elapsedSeconds, catchCount: round + 1, achievements: awards });
    }

    // Repeat sailing only after the matched resource samples: this movement
    // must not change the camera/boat conditions used to diagnose allocation.
    await click(page.locator('#return-button')); await tick(page);
    await input.down({ x: 240, y: 400 }); await input.move({ x: 240, y: 300 });
    for (let i = 0; i < 4; i++) await tick(page);
    await expect(page.locator('#motion-label')).toHaveText('航行中');
    await input.up(); await settle();
    await expect(page.locator('#motion-label')).toHaveText('停船中');
    await expect(page.locator('#speed')).toHaveText('0.0');
    await enterFishing(page, true);
    report.sailingAndBrakingPasses = 2;

    // Lifecycle events are synthetic to exercise the handlers deterministically;
    // actual OS switching/background suspension remains a physical-device check.
    for (const reason of ['blur', 'hidden']) {
      const clockBefore = await elapsed(page);
      await page.evaluate(reason => {
        if (reason === 'blur') window.dispatchEvent(new Event('blur'));
        else { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); }
      }, reason);
      await page.clock.fastForward(600000);
      expect(await elapsed(page)).toBe(clockBefore);
      await page.evaluate(reason => {
        if (reason === 'blur') window.dispatchEvent(new Event('focus'));
        else { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); }
      }, reason);
      await tick(page);
      expect(await elapsed(page) - clockBefore).toBeCloseTo(0.25, 7);
      report.pauses.push({ reason, virtualMs: 600000, elapsedSeconds: clockBefore });
    }
    await openView('storage');
    await expect(page.locator('.stored-fish')).toHaveCount(1);
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    const before = (await savedSlots(page))[0].data;
    await page.reload(); await tick(page);
    await expect(page.locator('#status')).toBeHidden();
    await expect(page.locator('#error')).toBeHidden();
    assertEnvironment(await page.evaluate(() => window.lightingProbe.first), before.clock.elapsedSeconds);
    await expect(page.locator('#motion-label')).toHaveText('停船中');
    await expect(page.locator('#speed')).toHaveText('0.0');
    await expect(page.locator('#wallet-balance')).toHaveText(money(balance));
    await openView('storage'); await expect(page.locator('.stored-fish')).toHaveCount(1);
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    const after = (await savedSlots(page))[0].data;
    expect(after.collection).toEqual(before.collection);
    expect(after.achievements).toEqual(before.achievements);
    expect(after.boat).toEqual(before.boat);
    expect(after.clock.elapsedSeconds - before.clock.elapsedSeconds).toBeCloseTo(0.25, 7);
    await closeMenu(); await tick(page);
    await enterFishing(page, true);
    await expect(page.locator('#cast-button')).toBeEnabled();
    await click(page.locator('#return-button')); await tick(page);
    await expect(page.locator('#fish-button')).toBeEnabled();
    const health = await resources.snapshot('after-reload');
    expect(health.errors).toEqual([]);
    expect(health.contextLosses).toBe(0);
    report.reload = { collection: true, achievements: true, boat: true, firstFrameClock: before.clock.elapsedSeconds,
      recoveredClock: after.clock.elapsedSeconds, slots: 2 };
    completed = true;
  } finally {
    report.durationMs = Date.now() - started;
    report.status = completed ? 'passed' : 'incomplete-or-failed';
    const path = info.outputPath('final-stability-results.json');
    await writeFile(path, JSON.stringify(report, null, 2));
    await info.attach('final-stability-results', { path, contentType: 'application/json' });
    await resources.save(info);
  }
});
