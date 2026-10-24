import { test, expect } from './diagnostics-fixture.js';
import { FISHING_SPOTS } from '../../src/world/fishing-spots.js';
import { createBoatState } from '../../src/game/boat.js';

for (const touch of [false, true]) {
  test(`${touch ? 'touch' : 'mouse'}: sail to all three spots, see effects, fish inside and leave the range`, async ({ createContext }) => {
    test.setTimeout(240000);
    const context = await createContext({ viewport: touch ? { width: 390, height: 844 } : { width: 1000, height: 700 }, hasTouch: touch, isMobile: touch, deviceScaleFactor: 0.5 });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => { Math.random = () => 0.5; });
    await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
    await page.goto('./'); await expect(page.locator('#status')).toBeHidden();
    await expect(page.locator('#spot-status')).toBeHidden();
    // No +1s protocol deadline: keep wall time fixed while pausing timers.
    const frozenTime = new Date(await page.evaluate(() => Date.now()));
    await page.clock.setFixedTime(frozenTime);
    await page.clock.pauseAt(frozenTime);
    await page.clock.setSystemTime(frozenTime);
    const cdp = await context.newCDPSession(page);
    const x = touch ? 195 : 500, y = touch ? 450 : 350;
    const down = async () => touch
      ? cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
      : (await page.mouse.move(x, y), page.mouse.down());
    const move = (dx, dy) => touch
      ? cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx, y: y + dy }] })
      : page.mouse.move(x + dx, y + dy);
    const up = () => touch
      ? cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }) : page.mouse.up();
    const click = locator => touch ? locator.tap({ force: true }) : locator.click({ force: true });
    const tick = () => page.clock.fastForward(250);
    const boat = createBoatState();
    let sawApproach = false, sawExit = false;
    async function sailTick() {
      await tick();
      const status = await page.locator('#spot-status').evaluate(el => ({
        hidden: el.hidden, active: el.dataset.active,
        heading: -parseFloat(document.querySelector('#compass-needle').style.transform.slice(7)),
        speed: Number(document.querySelector('#speed').textContent) / 3.6,
      }));
      // Estimate travel from the visible compass/speed. Touch move delivery can
      // lag a frame, so commanded steering is not a reliable position estimate.
      boat.x += 0.125 * (Math.sin(boat.heading) * boat.speed + Math.sin(status.heading) * status.speed);
      boat.z -= 0.125 * (Math.cos(boat.heading) * boat.speed + Math.cos(status.heading) * status.speed);
      boat.heading = status.heading; boat.speed = status.speed;
      return status;
    }
    // Guide real pointer steering using UI telemetry; the browser's boat is
    // never moved/injected by the test. Each tick uses the production dt cap.
    async function sailTo(target) {
      await down();
      for (let frame = 0; frame < 360 && Math.hypot(boat.x - target.x, boat.z - target.z) > 8; frame++) {
        const desired = Math.atan2(target.x - boat.x, boat.z - target.z);
        const delta = Math.atan2(Math.sin(desired - boat.heading), Math.cos(desired - boat.heading));
        const steer = Math.max(-1, Math.min(1, delta * 2));
        await move(steer * 65, -80);
        const status = await sailTick();
        if (!status.hidden && status.active === 'false') sawApproach = true;
        if (status.active === 'false') sawExit = true;
      }
      await up();
      for (let frame = 0; frame < 10; frame++) await sailTick();
      await expect(page.locator('#motion-label')).toHaveText('停船中');
    }
    for (const [index, spot] of FISHING_SPOTS.entries()) {
      await sailTo(spot);
      const panel = page.locator('#spot-status');
      await expect(panel).toHaveAttribute('data-spot-id', spot.id);
      await expect(panel).toHaveAttribute('data-active', 'true');
      await expect(page.locator('#spot-name')).toHaveText(spot.name);
      await expect(page.locator('#spot-effect')).toHaveText('アタリ発生率 ×1.5 · 船が範囲内');
      const bounds = await panel.boundingBox();
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(page.viewportSize().width);
      await click(page.locator('#fish-button')); await tick();
      await expect(page.locator('#lure-picker')).toBeVisible();
      await page.screenshot({ path: `test-results/spot-${spot.id}-${touch ? 'touch' : 'mouse'}.png` });
      if (index === 0) {
        await click(page.locator('#cast-button')); await tick();
        await down(); await move(0, -100); await up();
        for (let i = 0; i < 4; i++) await tick();
        await expect(page.locator('#fishing-panel')).toHaveAttribute('data-phase', 'lure');
        let frames = 0;
        while (frames < 48 && await page.locator('#fishing-panel').getAttribute('data-phase') === 'lure') { await tick(); frames++; }
        await expect(page.locator('#fishing-panel')).toHaveAttribute('data-phase', 'bite');
        // Same fixed RNG/default lure outside takes ~10.9s; inside ~8.3s.
        expect(frames * 0.25).toBeGreaterThan(7.5);
        expect(frames * 0.25).toBeLessThan(9);
        for (let i = 0; i < 12; i++) await tick(); // missed hook -> retry
        await expect(page.locator('#fishing-panel')).toHaveAttribute('data-phase', 'ready');
      }
      await click(page.locator('#return-button')); await tick();
    }
    sawExit = false;
    await sailTo({ x: 0, z: 30 });
    expect(sawApproach).toBe(true); expect(sawExit).toBe(true);
    await expect(page.locator('#spot-status')).toBeHidden();
    expect(errors).toEqual([]);
  });
}
