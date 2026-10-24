import { test, expect } from './diagnostics-fixture.js';

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
