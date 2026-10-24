import { test as base, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

// Observe input without changing it. Keep memory and protocol traffic bounded;
// export the ring only on failure, never once per rendered frame.
function installDiagnostics() {
  const events = [];
  const records = new WeakMap();
  let sequence = 0;
  window.e2eDiagnostics = { events, actions: [] };
  for (const type of ['pointerdown', 'pointerup', 'pointercancel', 'gotpointercapture', 'lostpointercapture',
    'touchstart', 'touchend', 'touchcancel', 'mousedown', 'mouseup', 'click', 'blur', 'focus', 'visibilitychange']) {
    window.addEventListener(type, event => {
      const target = event.target instanceof Element ? event.target : null;
      const record = {
        type, sequence: ++sequence, target: target?.closest('button')?.id || target?.id || event.target?.nodeName,
        trusted: event.isTrusted, timestamp: event.timeStamp, wallTime: Date.now(), performanceTime: performance.now(),
        pointerId: event.pointerId, pointerType: event.pointerType,
        x: event.clientX ?? event.changedTouches?.[0]?.clientX, y: event.clientY ?? event.changedTouches?.[0]?.clientY,
        phase: document.querySelector('#fishing-panel')?.dataset.phase,
        mode: document.body?.classList.contains('fishing') ? 'fishing' : 'sailing',
        capture: target?.hasPointerCapture?.(event.pointerId),
      };
      events.push(record);
      if (events.length > 100) events.shift();
      record.prevented = event.defaultPrevented;
      records.set(event, record);
    }, true);
    // Native dispatch can run a microtask checkpoint between capture and target
    // listeners. Read prevention in bubble phase, after the game's handlers.
    window.addEventListener(type, event => { if (records.has(event)) records.get(event).prevented = event.defaultPrevented; });
  }
}

async function boundedSnapshot(page) {
  let timer;
  try {
    return await Promise.race([
      page.evaluate(() => {
        const buttons = [...document.querySelectorAll('button')].map(button => {
          const bounds = button.getBoundingClientRect();
          const style = getComputedStyle(button);
          const hit = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
          return { id: button.id, text: button.textContent, visible: bounds.width > 0 && bounds.height > 0 && style.visibility !== 'hidden',
            enabled: !button.matches(':disabled'), bounds: bounds.toJSON(), hit: hit?.closest('button')?.id || hit?.id,
            receivesEvents: hit === button || button.contains(hit) };
        });
        return { url: location.href, mode: document.body.classList.contains('fishing') ? 'fishing' : 'sailing',
          phase: document.querySelector('#fishing-panel')?.dataset.phase,
          motion: document.querySelector('#motion-label')?.textContent,
          hidden: document.hidden, focused: document.hasFocus(), activeElement: document.activeElement?.id,
          wallTime: Date.now(), performanceTime: performance.now(), buttons, ...window.e2eDiagnostics,
          lighting: window.lightingProbe?.last, renders: window.lightingProbe?.renders };
      }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Diagnostic snapshot exceeded 5s')), 5000); }),
    ]);
  } finally { clearTimeout(timer); }
}

async function monitorContext(context, testInfo, label) {
  const errors = [], listeners = new Map();
  const recordError = error => { errors.push(error); if (errors.length > 100) errors.shift(); };
  const onPage = page => {
    const onError = error => recordError({ type: 'pageerror', url: page.url(), message: error.message });
    const onConsole = message => {
      if (message.type() === 'error') recordError({ type: 'console.error', url: page.url(), message: message.text() });
    };
    page.on('pageerror', onError); page.on('console', onConsole);
    listeners.set(page, () => { page.off('pageerror', onError); page.off('console', onConsole); });
  };
  context.on('page', onPage);
  context.pages().forEach(onPage);
  await context.addInitScript(installDiagnostics);
  return async () => {
    try {
      if (testInfo.status === testInfo.expectedStatus) return;
      if (!context.pages().length && !errors.length) return;
      const pages = [];
      for (const page of context.pages()) {
        try { pages.push(await boundedSnapshot(page)); }
        catch (error) { pages.push({ url: page.url(), snapshotError: error.message }); }
      }
      const path = testInfo.outputPath(`${label}-diagnostics.json`);
      await writeFile(path, JSON.stringify({ test: testInfo.titlePath, status: testInfo.status,
        failures: testInfo.errors.map(error => error.message), errors, pages }, null, 2));
      await testInfo.attach(`${label}-diagnostics`, { path, contentType: 'application/json' });
    } finally {
      context.off('page', onPage);
      listeners.forEach(dispose => dispose());
    }
  };
}

export const test = base.extend({
  _gameDiagnostics: [async ({ context }, use, testInfo) => {
    const finish = await monitorContext(context, testInfo, 'default');
    try { await use(); } finally { await finish(); }
  }, { auto: true }],
  createContext: async ({ browser, contextOptions }, use, testInfo) => {
    const contexts = [];
    try {
      await use(async options => {
        const context = await browser.newContext({ ...contextOptions, ...options });
        const entry = { context, finish: null };
        contexts.push(entry);
        entry.finish = await monitorContext(context, testInfo, `context-${contexts.length}`);
        return context;
      });
    } finally {
      const results = await Promise.allSettled(contexts.map(async ({ context, finish }) => {
        try { await finish?.(); } finally { await context.close(); }
      }));
      const failures = results.filter(result => result.status === 'rejected').map(result => result.reason);
      if (failures.length) throw new AggregateError(failures, 'Context diagnostics/cleanup failed');
    }
  },
});
export { expect };
