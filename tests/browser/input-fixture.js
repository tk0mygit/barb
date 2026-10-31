import { test, expect } from './diagnostics-fixture.js';

// Existing catch/transaction regressions deliberately do not score a gesture.
// Public ON cancels the old normal hold at warning. Observe its finite failure
// and release that native contact, so the caller can send a fresh normal down.
// Keep the caller's normal-physics step budget and all result assertions intact.
export async function expirePublicQte(page, release) {
  const hud = page.locator('.qte-hud');
  if (!await hud.isVisible()) return false;
  await release();
  const states = [];
  // 600ms warning + at most 2000ms operation + 100ms grace + 450ms result,
  // with rendering opportunities, must finish within these 4 virtual seconds.
  for (let n = 0; n < 40 && await hud.isVisible(); n++) {
    const state = await hud.getAttribute('data-state'); states.push(state);
    expect(['warning', 'awaiting-display', 'active', 'awaiting-result', 'failure']).toContain(state);
    await page.clock.fastForward(100);
  }
  await expect(hud).toBeHidden();
  expect(states).toContain('failure');
  await test.info().attach('public-unscored-qte', { body: JSON.stringify({ states, outcome: 'finite failure; fresh normal contact required' }), contentType: 'application/json' });
  return true;
}

// The twelve-species capture/image driver follows the displayed mouse gesture
// instead of adding three failure penalties to its original physics budget.
// Observe the real UI and finite result; never inject a score or fishing state.
export async function succeedMousePublicQte(page) {
  const hud = page.locator('.qte-hud');
  if (!await hud.isVisible()) return false;
  await page.mouse.up();
  for (let n = 0; n < 12 && await hud.getAttribute('data-state') !== 'active'; n++) await page.clock.fastForward(100);
  await expect(hud).toHaveAttribute('data-state', 'active');
  const gesture = await hud.evaluate(hud => {
    const region = hud.querySelector('.qte-gesture').getBoundingClientRect();
    const circle = hud.querySelector('.qte-target'), r = circle.getBoundingClientRect();
    return { operation: hud.dataset.operation, direction: hud.querySelector('.qte-arrow').dataset.direction,
      x: circle.hidden ? (region.left + region.right) / 2 : (r.left + r.right) / 2,
      y: circle.hidden ? (region.top + region.bottom) / 2 : (r.top + r.bottom) / 2 };
  });
  const vector = { up: [0, -1], right: [1, 0], down: [0, 1], left: [-1, 0] }[gesture.direction] ?? [0, 0];
  const distance = gesture.operation === 'swipe' ? 80 : gesture.operation === 'flick' ? 50 : 0;
  const x = gesture.x - vector[0] * distance / 2, y = gesture.y - vector[1] * distance / 2;
  expect(await page.evaluate(p => document.elementFromPoint(p.x, p.y)?.id, { x, y })).toBe('scene');
  for (let n = 0; n < (gesture.operation === 'tap' ? 3 : 1); n++) {
    await page.clock.fastForward(10); await page.mouse.move(x, y); await page.mouse.down();
    if (distance) await page.mouse.move(x + vector[0] * distance, y + vector[1] * distance);
    await page.clock.fastForward(20); await page.mouse.up();
  }
  for (let n = 0; n < 24 && await hud.getAttribute('data-state') === 'active'; n++) await page.clock.fastForward(100);
  // Receipt wait can be observed separately from the operation window.
  for (let n = 0; n < 3 && await hud.getAttribute('data-state') === 'awaiting-result'; n++) await page.clock.fastForward(100);
  await expect(hud).toHaveAttribute('data-state', 'success');
  for (let n = 0; n < 4 && await hud.isVisible(); n++) await page.clock.fastForward(250);
  await expect(hud).toBeHidden();
  await test.info().attach('public-successful-mouse-qte', { body: JSON.stringify(gesture), contentType: 'application/json' });
  return true;
}

export async function activateButton(button, touch = false) {
  await test.step(`${touch ? 'tap' : 'click'} ${button}`, async () => {
    await expect(button).toBeVisible();
    await expect(button).toBeEnabled();
    await button.evaluate(button => {
      const bounds = button.getBoundingClientRect();
      const hit = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      const probe = window.e2eDiagnostics;
      probe.actions.push({ button: button.id || button.outerHTML, phase: document.querySelector('#fishing-panel')?.dataset.phase,
        visible: bounds.width > 0 && bounds.height > 0, enabled: !button.matches(':disabled'), bounds: bounds.toJSON(),
        hit: hit?.closest('button')?.id || hit?.id, receivesEvents: hit === button || button.contains(hit),
        eventSequence: probe.events.at(-1)?.sequence ?? 0 });
      if (probe.actions.length > 30) probe.actions.shift();
    });
    // The locator performs stability, scrolling and hit-target checks itself.
    // Send exactly one native gesture; a missing click must fail visibly.
    if (touch) await button.tap();
    else await button.click();
  });
}
