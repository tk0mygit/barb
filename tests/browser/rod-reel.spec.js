import { test, expect } from './diagnostics-fixture.js';
import { GEAR_PROFILES, openGear, assertGear, gearRead, gearTick, gearPhase, gearEvidence } from './rod-reel-fixture.js';

// All screenshots use the shipped build, normal save loading and native mode
// controls. Full-DPR evidence is separate from the existing low-buffer
// transaction regressions; it does not change their fixtures or compare IDs.
for (const profile of GEAR_PROFILES.filter(p => p.id !== 'small')) for (const level of [1, 5, 10]) {
  const version = level === 10 ? 2 : 1;
  test(`rod/reel appearance: ${profile.id} Lv${level} V${version} restore`, async ({ createContext }, info) => {
    const { page, click, errors } = await openGear(createContext, profile, { level, version });
    const sailing = await gearRead(page);
    expect(sailing.visible).toBe(false);
    expect(sailing.rod.level).toBe(level); expect(sailing.reel.level).toBe(level);
    await click('#fish-button');
    for (let i = 0; i < 12; i++) await gearTick(page);
    await expect(page.locator('#fishing-panel')).toHaveAttribute('data-phase', 'ready');
    const snapshot = await gearEvidence(page, info, `rod-reel-${profile.id}-lv${level}`, { screenshot: true });
    assertGear(snapshot, level);
    expect(snapshot.dpr).toBe(profile.dpr);
    const versions = [snapshot.rod.positionVersion, snapshot.reel.positionVersion];
    for (let i = 0; i < 6; i++) await gearTick(page);
    const stable = await gearRead(page);
    expect([stable.rod.positionVersion, stable.reel.positionVersion]).toEqual(versions);
    expect(stable.resources).toEqual(snapshot.resources);
    await click('#return-button'); await gearTick(page);
    expect((await gearRead(page)).visible).toBe(false);
    expect(errors).toEqual([]);
  });
}

for (const profile of GEAR_PROFILES) {
  test(`rod/reel static phases: ${profile.id} READY AIM CAST LURE BITE FIGHT`, async ({ createContext }, info) => {
    // The night and fog samples exercise the model's ordinary fog-aware
    // material without changing environment settings or the camera rig.
    const seconds = profile.id === 'landscape' ? 3971 * 360 + 270 : profile.id === 'small' ? 270 : 90;
    const { page, click, input, errors } = await openGear(createContext, profile, { seconds });
    await click('#fish-button');
    for (let i = 0; i < 12; i++) await gearTick(page);
    const initial = await gearEvidence(page, info, 'ready'); assertGear(initial, 1);
    await click('#cast-button'); await gearTick(page);
    expect(await gearPhase(page)).toBe('aim'); assertGear(await gearEvidence(page, info, 'aim'), 1);
    const point = { x: Math.round(profile.width * 0.6), y: Math.round(profile.height * 0.48) };
    await input.down(point); await input.move({ x: point.x, y: point.y - 150 }); await gearTick(page);
    await input.up(); await gearTick(page);
    expect(await gearPhase(page)).toBe('cast');
    assertGear(await gearEvidence(page, info, 'cast'), 1, { line: true });
    for (let i = 0; i < 8 && await gearPhase(page) === 'cast'; i++) await gearTick(page);
    expect(await gearPhase(page)).toBe('lure');
    assertGear(await gearEvidence(page, info, 'lure'), 1, { line: true });
    for (let i = 0; i < 120 && await gearPhase(page) !== 'bite'; i++) await gearTick(page);
    expect(await gearPhase(page)).toBe('bite');
    assertGear(await gearEvidence(page, info, 'bite'), 1, { line: true });
    await input.down(); await input.up(); await page.clock.fastForward(16);
    expect(await gearPhase(page)).toBe('fight');
    const fight = await gearEvidence(page, info, 'fight', { screenshot: profile.id === 'landscape' || profile.id === 'small' });
    assertGear(fight, 1, { line: true });
    expect(fight.rod.geometryId).toBe(initial.rod.geometryId); expect(fight.reel.geometryId).toBe(initial.reel.geometryId);
    expect(fight.rod.positionVersion).toBe(initial.rod.positionVersion);
    expect(fight.reel.positionVersion).toBe(initial.reel.positionVersion);
    // Lure/ring/line have their own documented first-cast allocation;
    // one subsequent low-FPS FIGHT update must retain its actual resources.
    await page.clock.fastForward(1000);
    const slow = await gearRead(page);
    for (const key of ['geometries', 'textures', 'programs']) expect(slow.resources[key]).toBe(fight.resources[key]);
    assertGear(slow, 1, { line: true });
    if (profile.id === 'portrait') {
      const hud = page.locator('.qte-hud');
      let held = false;
      for (let i = 0; i < 100 && !await hud.isVisible() && await gearPhase(page) === 'fight'; i++) {
        const tension = await page.locator('#line-tension').evaluate(element => element.value);
        if (!held && tension < 0.35) { await input.down(); held = true; }
        else if (held && tension > 0.65) { await input.up(); held = false; }
        await gearTick(page);
      }
      if (held) await input.up();
      await expect(hud).toBeVisible();
      for (let i = 0; i < 12 && await hud.getAttribute('data-state') !== 'active'; i++) await page.clock.fastForward(100);
      await expect(hud).toHaveAttribute('data-state', 'active');
      await expect(hud.locator('.qte-instruction')).toBeVisible();
      const snapshot = await gearEvidence(page, info, 'portrait-native-qte', { screenshot: true });
      assertGear(snapshot, 1, { line: true });
      const target = await hud.locator('.qte-gesture').boundingBox();
      const contact = { x: target.x + target.width / 2, y: target.y + target.height / 2 };
      expect(await page.evaluate(p => document.elementFromPoint(p.x, p.y)?.id, contact)).toBe('scene');
      const serial = await page.evaluate(() => window.e2eDiagnostics.events.at(-1)?.sequence ?? 0);
      await input.down(contact); await input.up();
      expect(await page.evaluate(serial => window.e2eDiagnostics.events.some(event => event.sequence > serial
        && event.type === 'pointerdown' && event.target === 'scene' && event.trusted && event.pointerType === 'touch'), serial)).toBe(true);
      await page.setViewportSize({ width: 844, height: 390 });
      assertGear(await gearEvidence(page, info, 'fight-rotated'), 1, { line: true });
      expect(await gearPhase(page)).toBe('fight');
    }
    expect(errors).toEqual([]);
  });
}

for (const profile of GEAR_PROFILES.filter(p => ['pc', 'portrait'].includes(p.id))) {
  test(`rod/reel purchase: ${profile.id} immediate paused-menu appearance and reload`, async ({ createContext }, info) => {
    const balance = profile.id === 'pc' ? 100000 : 1000;
    const { page, click, errors } = await openGear(createContext, profile, { balance });
    await click('#fish-button'); for (let i = 0; i < 12; i++) await gearTick(page);
    const before = await gearRead(page); assertGear(before, 1);
    await click('#menu-button'); await click('[data-view="equipment"]');
    const renders = (await gearRead(page)).renders;
    await click('[data-upgrade="rod"]'); await click('#confirm-upgrade');
    await expect(page.locator('[data-equipment="rod"] h3')).toHaveText('ロッド · Lv.2');
    let purchased = await gearRead(page);
    expect(purchased.renders).toBe(renders);
    expect(purchased.rod.level).toBe(2); expect(purchased.reel.level).toBe(1);
    expect(purchased.rod.geometryId).toBe(before.rod.geometryId);
    expect(purchased.reel.positionVersion).toBe(before.reel.positionVersion);
    expect(purchased.rod.parts).not.toEqual(before.rod.parts);
    await click('[data-upgrade="reel"]'); await click('#confirm-upgrade');
    purchased = await gearRead(page);
    expect(purchased.renders).toBe(renders); expect(purchased.reel.level).toBe(2);
    expect(purchased.reel.geometryId).toBe(before.reel.geometryId);
    expect(purchased.reel.parts).not.toEqual(before.reel.parts);
    await gearEvidence(page, info, 'paused-menu-purchase');
    await page.clock.fastForward(1250);
    const saved = await page.evaluate(() => ['barb.save.v1.slotA', 'barb.save.v1.slotB'].map(key => localStorage.getItem(key))
      .filter(Boolean).map(JSON.parse).sort((a, b) => b.generation - a.generation)[0]);
    expect(saved.data.collection.equipment).toEqual({ rodLevel: 2, reelLevel: 2 });
    expect(saved.data.collection.wallet).toEqual({ balance: balance - 600, lifetimeSales: balance });
    expect(saved.data.saveVersion).toBe(2);
    await click('#collection-close'); await gearTick(page);
    assertGear(await gearRead(page), 2);
    await page.reload(); await gearTick(page);
    await expect(page.locator('#status')).toBeHidden();
    const restored = await gearRead(page);
    expect(restored.visible).toBe(false);
    expect(restored.rod.level).toBe(2); expect(restored.reel.level).toBe(2);
    await click('#fish-button'); for (let i = 0; i < 12; i++) await gearTick(page);
    const restoredReady = await gearEvidence(page, info, 'purchase-restored');
    assertGear(restoredReady, 2);
    if (profile.id === 'pc') {
      const table = [{ level: 2, rod: restoredReady.rod, reel: restoredReady.reel, resources: restoredReady.resources }];
      for (let level = 3; level <= 10; level++) {
        await click('#menu-button'); await click('[data-view="equipment"]');
        const start = await gearRead(page);
        for (const kind of ['rod', 'reel']) {
          await click(`[data-upgrade="${kind}"]`); await click('#confirm-upgrade');
          const changed = await gearRead(page), other = kind === 'rod' ? 'reel' : 'rod';
          expect(changed.renders).toBe(start.renders);
          expect(changed[kind].level).toBe(level);
          expect(changed[kind].geometryId).toBe(restoredReady[kind].geometryId);
          expect(changed[kind].materialId).toBe(restoredReady[kind].materialId);
          expect(changed[other].level).toBe(kind === 'rod' ? level - 1 : level);
        }
        await click('#collection-close'); await gearTick(page);
        const current = await gearRead(page); assertGear(current, level);
        for (const key of ['geometries', 'textures', 'programs']) expect(current.resources[key]).toBe(restoredReady.resources[key]);
        expect(current.resources.calls).toBe(restoredReady.resources.calls);
        expect(current.rod.triangles + current.reel.triangles).toBeLessThanOrEqual(1356);
        table.push({ level, rod: current.rod, reel: current.reel, resources: current.resources });
      }
      await info.attach('native-level-switch-resources', { body: JSON.stringify(table, null, 2), contentType: 'application/json' });
      await click('#menu-button'); await click('[data-view="equipment"]');
      await expect(page.locator('[data-upgrade="rod"]')).toBeDisabled();
      await expect(page.locator('[data-upgrade="reel"]')).toBeDisabled();
    }
    expect(errors).toEqual([]);
  });
}

test('rod/reel context loss: owned GPU resources dispose once with the existing reload error', async ({ createContext }, info) => {
  const { page, click, errors } = await openGear(createContext, GEAR_PROFILES[0]);
  await click('#fish-button'); await gearTick(page);
  const before = await gearRead(page);
  await page.locator('#scene').evaluate(canvas => canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true })));
  await expect(page.locator('#error')).toContainText('ページを再読み込み');
  const after = await gearRead(page);
  expect(after.visible).toBe(false);
  expect(after.rod).toBeNull(); expect(after.reel).toBeNull();
  expect(after.disposal.geometries.sort((a, b) => a - b)).toEqual([before.rod.geometryId, before.reel.geometryId].sort((a, b) => a - b));
  expect(after.disposal.materials).toEqual([before.rod.materialId]);
  await info.attach('context-loss-disposal', { body: JSON.stringify({ before, after }), contentType: 'application/json' });
  expect(errors).toEqual([]);
});
