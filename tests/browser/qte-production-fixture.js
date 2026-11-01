import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { createQteOperationProvider } from '../../src/game/qte-operation-provider.js';
import { getFishSpecies } from '../../src/game/fish-species.js';
import { createGameplay } from '../../src/game/gameplay.js';
import { createSaveData } from '../../src/game/save-data.js';
import { encounterModel, getRodEncounterModifiers } from '../../src/game/encounter-production.js';
import { expect } from './diagnostics-fixture.js';
import { installPausedClock } from './clock-fixture.js';

const root = new URL('../../', import.meta.url);
const main = readFileSync(new URL('src/main.js', root), 'utf8');
if (execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all', '--', 'src'], { cwd: root }).toString().trim()) {
  throw new Error('Production evidence requires committed, unchanged runtime sources');
}
const source = { sha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root }).toString().trim(),
  sourceTree: execFileSync('git', ['rev-parse', 'HEAD:src'], { cwd: root }).toString().trim(),
  mainSha256: createHash('sha256').update(main).digest('hex') };
export const saveKeys = ['barb.save.v1.slotA', 'barb.save.v1.slotB'];

export function historicalSave(version) {
  const game = createGameplay({ now: () => 1000 });
  game.collection.register({ schemaVersion: 1, id: 'historical', speciesId: 'black-bass', lengthCm: 40,
    weightKg: 10, caughtAt: '2026-10-30T00:00:00Z', qteSuccessCount: 0 });
  game.collection.sellUnassigned('historical');
  const data = structuredClone(createSaveData(game, { savedAt: '2026-10-31T00:00:00.000Z' }));
  data.collection.catches[0].salePrice = 777;
  data.collection.catches[0].soldAt = '1970-01-01T00:00:01Z';
  data.collection.wallet = { balance: 777, lifetimeSales: 777 };
  if (version === 1) { data.saveVersion = 1; for (const record of data.collection.catches) delete record.qteSuccessCount; }
  return data;
}

// Playwright serves the real application dependency graph. Only the final
// initializer call is injected; input, loop, renderer, restore, HUD and save
// code are byte-identical source modules. Built-entry tests run separately
// without this routing or initializer replacement.
export async function openQteProduction(page, { enabled = true, save = null, frameFaults = false } = {}) {
  await installPausedClock(page);
  if (frameFaults) await page.addInitScript(() => {
    let devtools;
    window.holdProductionFrame = false; window.skippedProductionFrames = 0;
    Object.defineProperty(window, '__THREE_DEVTOOLS__', { configurable: true,
      get: () => devtools, set(value) {
        devtools = value;
        value.addEventListener('observe', ({ detail: renderer }) => {
          if (!renderer.isWebGLRenderer) return;
          const original = renderer.setAnimationLoop;
          renderer.setAnimationLoop = function(callback) {
            return original.call(this, callback && (now => {
              // Explicit scheduling fault injection. The unchanged production
              // callback/renderer runs again after the real monotonic gap.
              if (window.holdProductionFrame) { window.skippedProductionFrames++; return; }
              return callback(now);
            }));
          };
        });
      } });
    window.__THREE_DEVTOOLS__ = new EventTarget();
  });
  await page.addInitScript(() => {
    window.productNativeEvidence = [];
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'lostpointercapture']) {
      window.addEventListener(type, event => {
        if (event.target?.id !== 'scene' || !window.qteProduct?.qteDelivery) return;
        const fight = window.qteProduct.state.fishing.state.fight;
        if (!fight?.qte.token) return;
        const samples = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : [];
        // A test evidence ring, independent of delivery's semantic ledger.
        // Valid operation tests must not silently truncate their source path.
        window.productNativeEvidence.push({ type, source: event.timeStamp, receipt: performance.now(), trusted: event.isTrusted,
          fightId: fight.id, index: fight.qte.token.index, generation: fight.generation,
          pointerId: event.pointerId, pointerType: event.pointerType, button: event.button, isPrimary: event.isPrimary,
          x: event.clientX, y: event.clientY, coalescedCount: samples.length,
          coalesced: samples.slice(0, 128).map(p => ({ source: p.timeStamp, x: p.clientX, y: p.clientY })) });
        if (window.productNativeEvidence.length > 256) window.productNativeEvidence.shift();
      }, true);
    }
  });
  await page.route('**/barb/src/**', route => {
    const pathname = new URL(route.request().url()).pathname.slice('/barb/'.length);
    const path = resolve(new URL(root).pathname, pathname);
    if (!path.startsWith(new URL('src/', root).pathname)) throw new Error('Invalid source path');
    const extensions = { js: 'text/javascript', css: 'text/css', json: 'application/json', png: 'image/png', wav: 'audio/wav', svg: 'image/svg+xml' };
    let body = readFileSync(path);
    if (pathname === 'src/main.js') {
      if (!/\nstartGame\(\{ qteEnabled: true \}\);\s*$/.test(main)) throw new Error('Production initializer entry changed');
      body = main.replace("import './ui/style.css';", '').replace(/\nstartGame\(\{ qteEnabled: true \}\);\s*$/, `
window.productSource = ${JSON.stringify(source)};
window.productEvents = [];
window.productDrawCount = 0;
window.productDrawQueue = [];
window.qteProduct = startGame({ qteEnabled: ${enabled},
  random: () => { window.productDrawCount++; return window.productDrawQueue.length ? window.productDrawQueue.shift() : .5; },
  onFightEvent: event => { window.productEvents.push(event); if(window.productEvents.length > 80) window.productEvents.shift(); }
});
`);
    }
    return route.fulfill({ body, contentType: extensions[path.split('.').at(-1)] ?? 'application/octet-stream' });
  });
  for (const file of ['three.module.js', 'three.core.js']) await page.route(`**/barb/test-three/${file}`, route =>
    route.fulfill({ body: readFileSync(new URL(`node_modules/three/build/${file}`, root)), contentType: 'text/javascript' }));
  await page.route('**/barb/test-addons/**', route => {
    const path = resolve(new URL('node_modules/three/examples/jsm/', root).pathname,
      new URL(route.request().url()).pathname.slice('/barb/test-addons/'.length));
    if (!path.startsWith(new URL('node_modules/three/examples/jsm/', root).pathname)) throw new Error('Invalid addon path');
    return route.fulfill({ body: readFileSync(path), contentType: 'text/javascript' });
  });
  const html = readFileSync(new URL('index.html', root), 'utf8')
    .replaceAll('%BASE_URL%', './')
    .replace('<script type="module" src="/src/main.js"></script>', `<link rel="stylesheet" href="./src/ui/style.css">
      <script type="importmap">{"imports":{"three":"./test-three/three.module.js","three/addons/":"./test-addons/"}}</script>
      <script type="module" src="./src/main.js"></script>`);
  await page.route('**/barb/qte-production.html', route => route.fulfill({ body: html, contentType: 'text/html' }));
  if (save) await page.addInitScript(({ save, keys }) => {
    if (!sessionStorage.getItem('production-save-seeded')) {
      localStorage.setItem(keys[0], JSON.stringify({ storageVersion: 1, generation: 7, data: save }));
      sessionStorage.setItem('production-save-seeded', 'yes');
    }
  }, { save, keys: saveKeys });
  await page.goto('./qte-production.html');
  await expect.poll(() => page.evaluate(() => ({ started: Boolean(window.qteProduct),
    error: document.querySelector('#error').hidden ? null : document.querySelector('#error').textContent })))
    .toEqual({ started: true, error: null });
  await page.clock.fastForward(32);
  await expect(page.locator('#status')).toBeHidden();
  await expect(page.locator('#error')).toBeHidden();
}

export async function productInput(page, touch) {
  const cdp = touch ? await page.context().newCDPSession(page) : null;
  let held = false;
  return {
    async down(p) {
      if (touch) await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [p] });
      else { await page.mouse.move(p.x, p.y); await page.mouse.down(); }
      held = true;
    },
    async up() {
      if (!held) return;
      if (touch) await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      else await page.mouse.up();
      held = false;
    },
    async move(p) {
      if (touch) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [p] });
      else await page.mouse.move(p.x, p.y);
    },
    async cancel() {
      if (!touch) throw new Error('Native touch cancellation requires a touch context');
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] }); held = false;
    },
    async click(locator) { if (touch) await locator.tap(); else await locator.click(); },
    get held() { return held; },
  };
}

export function individualFor(operation, speciesId = 'alligator-gar', fightId = 1) {
  const species = getFishSpecies(speciesId);
  for (let n = species.maxLengthCm * 10; n >= species.minLengthCm * 10; n--) {
    const lengthCm = n / 10;
    if (createQteOperationProvider({ fightId, speciesId, lengthCm }).getDescriptor(0).operation === operation) return { species, lengthCm };
  }
  throw new Error('No deterministic individual');
}

export const productSnapshot = page => page.evaluate(() => {
  const { state, qteDelivery, qteHUD } = window.qteProduct;
  const fight = state.fishing.state.fight;
  return { phase: state.fishing.state.phase, tension: state.fishing.state.tension, fight,
    encounter: state.fishing.state.encounter, clockSample: qteDelivery?.clock.read(),
    snapshot: qteDelivery?.snapshot, geometry: qteHUD?.geometry,
    descriptor: fight?.qte.token ? state.qteProvider?.getDescriptor(fight.qte.token.index) : null,
    preview: qteDelivery?.preview(), source: window.productSource, events: window.productEvents,
    drawCount: window.productDrawCount, catch: state.fishing.state.catch };
});

export async function castAndHookProduct(page, input, { operation = 'tap', speciesId = 'alligator-gar', fightId = 1 } = {}) {
  const individual = individualFor(operation, speciesId, fightId);
  const drawsBefore = await page.evaluate(() => window.productDrawCount);
  if (await page.evaluate(() => window.qteProduct.state.boat.mode) !== 'fishing') {
    await input.click(page.locator('#fish-button'));
    await page.clock.fastForward(250);
  }
  await input.click(page.locator('#cast-button'));
  await page.clock.fastForward(250);
  await expect(page.locator('#fishing-panel')).toHaveAttribute('data-phase', 'aim');
  const p = await page.evaluate(() => ({ x: innerWidth * .6, y: innerHeight * .48 }));
  // No drag: the legal 8m minimum cast, using the real visibility constraint.
  await input.down(p); await input.up();
  for (let n = 0; n < 8 && (await productSnapshot(page)).phase === 'cast'; n++) await page.clock.fastForward(250);
  const conditions = await page.evaluate(() => ({ conditions: window.qteProduct.state.fishing.getConditions(),
    rodLevel: window.qteProduct.state.collection.equipment.rodLevel }));
  let roll = 0;
  for (const row of encounterModel.getProbabilities('minnow', conditions.conditions, getRodEncounterModifiers(conditions.rodLevel))) {
    if (row.speciesId === speciesId) { roll += row.probability / 2; break; }
    roll += row.probability;
  }
  // The first bite draw was made on entering LURE. Its initial .5 is retained;
  // only the next species/length RNG values are fixed, without state mutation.
  await page.evaluate(({ roll, length }) => { window.productDrawQueue = [roll, length]; },
    { roll, length: Math.min(1 - Number.EPSILON, (individual.lengthCm - individual.species.minLengthCm)
      / (individual.species.maxLengthCm - individual.species.minLengthCm)) });
  for (let n = 0; n < 160 && (await productSnapshot(page)).phase !== 'bite'; n++) await page.clock.fastForward(250);
  await expect(page.locator('#fishing-panel')).toHaveAttribute('data-phase', 'bite');
  await input.down(p); await input.up(); await page.clock.fastForward(16);
  const result = await productSnapshot(page);
  expect(result.phase).toBe('fight'); expect(result.drawCount - drawsBefore).toBe(3);
  expect(await page.evaluate(() => window.qteProduct.state.fishing.state.encounter.speciesId)).toBe(speciesId);
  expect(await page.evaluate(() => window.qteProduct.state.fishing.state.encounter.lengthCm)).toBe(individual.lengthCm);
  return p;
}

export async function advanceToWarning(page, input, p, index) {
  for (let n = 0; n < 400; n++) {
    const result = await productSnapshot(page);
    expect(result.phase, JSON.stringify(result)).toBe('fight');
    if (result.fight.qte.token?.index === index) { await input.up(); return productSnapshot(page); }
    if (!input.held && result.tension < .35) await input.down(p);
    else if (input.held && result.tension > .6) await input.up();
    await page.clock.fastForward(250);
  }
  throw new Error('QTE reservation did not open');
}

export async function performProductOperation(page, input, { success = true } = {}) {
  for (let n = 0; n < 12 && !(await productSnapshot(page)).snapshot.displayReady; n++) await page.clock.fastForward(100);
  const before = await productSnapshot(page);
  expect(before.snapshot.displayReady, JSON.stringify(before)).toBe(true);
  const { descriptor: d, geometry: g } = before;
  const v = { up: [0, -1], right: [1, 0], down: [0, 1], left: [-1, 0] }[d.direction] ?? [0, 0];
  const distance = d.operation === 'swipe' ? 80 : d.operation === 'flick' ? 50 : 0;
  const start = { x: g.target.x - v[0] * distance / 2, y: g.target.y - v[1] * distance / 2 };
  const end = { x: g.target.x + v[0] * distance / 2, y: g.target.y + v[1] * distance / 2 };
  expect(await page.evaluate(p => document.elementFromPoint(p.x, p.y)?.id, start)).toBe('scene');
  if (success) for (let n = 0; n < (d.operation === 'tap' ? 3 : 1); n++) {
    await page.clock.fastForward(10);
    await input.down(start);
    if (distance) await input.move(end);
    await page.clock.fastForward(20); await input.up();
  }
  const pending = await productSnapshot(page);
  expect(pending.preview.success, JSON.stringify(pending)).toBe(success);
  expect(pending.fight.qte.successes).toBe(before.fight.qte.successes);
  const remaining = await page.evaluate(() => {
    const { qteDelivery: d } = window.qteProduct; return Math.max(0, d.snapshot.cut - d.clock.read().active);
  });
  await page.clock.fastForward(remaining + 32);
  const after = await productSnapshot(page);
  expect(after.fight.qte.successes).toBe(before.fight.qte.successes + (success ? 1 : 0));
  expect(after.fight.qte.failures).toBe(before.fight.qte.failures + (success ? 0 : 1));
  return { before, pending, after };
}

export async function landProduct(page, input, p) {
  for (let n = 0; n < 500; n++) {
    const result = await productSnapshot(page);
    if (result.phase === 'result') { await input.up(); return result.catch; }
    expect(['fight', 'landing'], JSON.stringify(result)).toContain(result.phase);
    if (result.phase === 'fight') {
      if (!input.held && result.tension < .35) await input.down(p);
      else if (input.held && result.tension > .6) await input.up();
    }
    await page.clock.fastForward(250);
  }
  throw new Error('Product fight did not land');
}
