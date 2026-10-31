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
