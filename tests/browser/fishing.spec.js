import { test, expect } from './diagnostics-fixture.js';
import { readFileSync } from 'node:fs';
import { FISH_SPECIES, getFishSpecies, calculateFishWeightKg } from '../../src/game/fish-species.js';
import { getSpeciesProbabilities, sampleFishSpecies } from '../../src/game/fish-encounters.js';
import { installPausedClock } from './clock-fixture.js';
import { expirePublicQte, succeedMousePublicQte } from './input-fixture.js';
import { validateFishImage } from '../../scripts/lib/fish-image-validation.js';
import { calculateSalePrice } from '../../src/game/fish-sales.js';
import { armEncounter, verifyEncounterBite, readFishingEvidence } from './encounter-fixture.js';
import { createStorageCheckpointTest } from './storage-checkpoint-fixture.js';

// Keep software WebGL responsive while retaining CSS viewport/touch behavior.
test.use({ deviceScaleFactor: 0.5 });

// Controlled RNG and the real production build. No state-forcing hooks.
async function setup(page, { paused = false, time } = {}) {
  await page.addInitScript(() => {
    Math.random = () => window.testRandomDraws?.length ? window.testRandomDraws.shift() : window.testRandomValue ?? 0.5;
  });
  if (paused) await installPausedClock(page, time);
  await page.goto('./');
  if (paused) await page.clock.fastForward(250);
  await expect(page.locator('#status')).toBeHidden();
}
const phase = page => page.locator('#fishing-panel');
async function inputFor(page, touch) {
  const cdp = await page.context().newCDPSession(page);
  const touchEvent = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: x === undefined ? [] : [{ x, y }] });
  return {
    down: async (x = 300, y = 420) => touch ? touchEvent('touchStart', x, y) : (await page.mouse.move(x, y), page.mouse.down()),
    move: async (x, y) => touch ? touchEvent('touchMove', x, y) : page.mouse.move(x, y),
    tap: async () => {
      const timestamp = Date.now() / 1000;
      if (touch) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 300, y: 420 }], timestamp });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [], timestamp: timestamp + 0.03 });
      } else {
        await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 300, y: 420, button: 'left', buttons: 1, clickCount: 1, timestamp });
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 300, y: 420, button: 'left', buttons: 0, clickCount: 1, timestamp: timestamp + 0.03 });
      }
    },
    flick: async () => {
      const timestamp = Date.now() / 1000;
      if (touch) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 300, y: 420 }], timestamp });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 340, y: 420 }], timestamp: timestamp + 0.04 });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [], timestamp: timestamp + 0.08 });
      } else {
        await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 300, y: 420, button: 'left', buttons: 1, clickCount: 1, timestamp });
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 340, y: 420, button: 'left', buttons: 1, timestamp: timestamp + 0.04 });
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 340, y: 420, button: 'left', buttons: 0, clickCount: 1, timestamp: timestamp + 0.08 });
      }
    },
    up: async () => touch ? touchEvent('touchEnd') : page.mouse.up(),
    cancel: async () => touch ? touchEvent('touchCancel') : page.locator('#scene').evaluate(el => el.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1 }))),
    click: async locator => touch ? locator.tap() : locator.click(),
  };
}
async function cast(page, input, advance = async () => {}) {
  await input.click(page.locator('#cast-button'));
  await advance();
  await expect(phase(page)).toHaveAttribute('data-phase', 'aim');
  const lureButtons = await page.locator('#lure-picker button').all();
  await Promise.all([
    expect(page.locator('#fishing-state')).toHaveText('キャスト準備'),
    expect(page.locator('#hint')).toBeHidden(),
    expect(page.locator('#lure-picker')).toBeHidden(),
    ...lureButtons.map(button => expect(button).toBeDisabled()),
  ]);
  await input.down(); await input.move(300, 270);
  await advance();
  await expect(page.locator('#line-distance')).toContainText('着水予測 28.0 m');
  await input.up();
  await expect.poll(async () => {
    await advance();
    return phase(page).getAttribute('data-phase');
  }).toBe('lure');
  await Promise.all([
    expect(page.locator('#fishing-state')).toHaveText('静寂を聴く'), expect(page.locator('#hint')).toBeHidden(),
  ]);
}
async function hook(page, input, keepPaused = false) {
  // Software WebGL/CDP round trips can exceed the one-second hook window.
  // Advance the real game clock to the bite, then keep it still while sending
  // native pointer input. Do not extend the game's window or force its state.
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-01-01T00:01:00Z'));
  for (let i = 0; i < 120 && await phase(page).getAttribute('data-phase') !== 'bite'; i++) await page.clock.fastForward(250);
  expect(await phase(page).getAttribute('data-phase')).toBe('bite');
  await Promise.all([
    expect(page.locator('#fishing-state')).toHaveText('シグナルを検知した'), expect(page.locator('#hint')).toBeHidden(),
  ]);
  await input.tap();
  await page.clock.fastForward(16);
  await expect(phase(page)).toHaveAttribute('data-phase', 'fight');
  await Promise.all([
    expect(page.locator('#fishing-state')).toHaveText('抵抗を検知'), expect(page.locator('#hint')).toBeHidden(),
  ]);
  if (!keepPaused) await page.clock.resume();
}
async function assertCatch(page, speciesId, size = 0.5) {
  const species = getFishSpecies(speciesId);
  const length = Math.round((species.minLengthCm + size * (species.maxLengthCm - species.minLengthCm)) * 10) / 10;
  // Observe the same settled result together; extra text coverage must not
  // add one software-rendering round trip per independent field.
  await Promise.all([
    expect(page.locator('#catch-dialog')).toBeVisible(),
    expect(page.locator('#fishing-state')).toHaveText('個体を回収した'),
    expect(page.locator('#hint')).toBeHidden(),
    expect(page.locator('#catch-species')).toHaveText(species.name),
    expect(page.locator('#catch-length')).toHaveText(`${length.toFixed(1)} cm`),
    expect(page.locator('#catch-weight')).toHaveText(`${calculateFishWeightKg(species.id, length).toFixed(2)} kg`),
    expect(page.locator('#catch-image')).toHaveAttribute('alt', `${species.name}の側面イラスト`),
  ]);
  const expectedBytes = readFileSync(new URL(species.image));
  const expectedImage = validateFishImage(new URL(species.image).pathname, expectedBytes);
  // Compare actual bytes/content and decoded dimensions; Vite may inline assets.
  const actual = await page.locator('#catch-image').evaluate(async img => {
    await img.decode();
    if (img.naturalWidth <= 0) throw new Error('Image did not load');
    return { bytes: [...new Uint8Array(await (await fetch(img.currentSrc)).arrayBuffer())], width: img.naturalWidth, height: img.naturalHeight };
  });
  expect(actual.width / actual.height).toBeCloseTo(expectedImage.width / expectedImage.height, 2);
  if (expectedImage.format === 'svg') {
    const normalize = svg => svg.replaceAll('"', "'").replace(/>\s+</g, '><').replace(/\s+/g, ' ').trim();
    expect(normalize(Buffer.from(actual.bytes).toString('utf8'))).toBe(normalize(expectedBytes.toString('utf8')));
  } else expect(Buffer.from(actual.bytes)).toEqual(expectedBytes);
}
async function land(page, input, speciesId, keepPaused = false) {
  let held = false;
  for (let i = 0; i < 140; i++) {
    const snapshot = await page.evaluate(() => ({ phase: document.querySelector('#fishing-panel').dataset.phase, tension: document.querySelector('#line-tension').value }));
    if (snapshot.phase !== 'fight') {
      if (snapshot.phase === 'landing') {
        await Promise.all([
          expect(page.locator('#fishing-state')).toHaveText('回収中...'),
          expect(page.locator('#hint')).toHaveText('回収まで、あとわずか'), expect(page.locator('#hint')).toBeVisible(),
        ]);
        await page.screenshot({ path: `test-results/landing-${page.viewportSize().width}.png` });
      }
      break;
    }
    if (await expirePublicQte(page, () => input.up())) { held = false; continue; }
    const tension = snapshot.tension;
    if (!held && tension < 0.3) { await input.down(); held = true; }
    else if (held && tension > 0.58) { await input.up(); held = false; }
    await page.clock.fastForward(250);
  }
  if (held) await input.up();
  for (let i = 0; i < 5; i++) await page.clock.fastForward(250);
  await assertCatch(page, speciesId);
  if (!keepPaused) await page.clock.resume();
}

// Keep the 5E-2B display contract local. The broader fishing/menu regressions
// remain above/below unchanged in coverage; this clock is installed before
// startup and every phase below comes from native input and ordinary steps.
for (const touch of [false, true]) {
  test(`5E-2B ${touch ? 'touch' : 'mouse'} text: native retry, slack, break, catch and ${touch ? 'sale' : 'storage'}`, async ({ createContext }) => {
    test.setTimeout(360000);
    const context = await createContext({ viewport: touch ? { width: 390, height: 844 } : { width: 1000, height: 700 },
      hasTouch: touch, isMobile: touch, deviceScaleFactor: .5 });
    const page = await context.newPage(); await setup(page, { paused: true });
    const input = await inputFor(page, touch), tick = () => page.clock.fastForward(250);
    const readPhase = () => phase(page).getAttribute('data-phase');
    const toPhase = async expected => {
      for (let n = 0; n < 80 && await readPhase() !== expected; n++) await tick();
      await expect(phase(page)).toHaveAttribute('data-phase', expected);
    };
    const text = async (label, hint = '') => {
      await Promise.all([
        expect(page.locator('#fishing-state')).toHaveText(label), expect(page.locator('#hint')).toHaveText(hint),
        hint ? expect(page.locator('#hint')).toBeVisible() : expect(page.locator('#hint')).toBeHidden(),
      ]);
    };
    const castForText = async (long = false) => {
      // Only the exponential waiting roll is zero. Species/size and FIGHT
      // use the existing deterministic .5 fixture after legal splashdown.
      await page.evaluate(() => { window.testRandomValue = 0; });
      await input.click(page.locator('#cast-button')); await tick();
      await expect(phase(page)).toHaveAttribute('data-phase', 'aim'); await text('キャスト準備');
      await input.down(); if (long) await input.move(300, 270); await input.up(); await tick();
      await expect(phase(page)).toHaveAttribute('data-phase', 'cast'); await text('キャスト中', '着水待ち...');
      await toPhase('lure'); await text('静寂を聴く');
      await page.evaluate(() => { window.testRandomValue = .5; });
      await toPhase('bite'); await text('シグナルを検知した');
    };
    const hookShort = async () => {
      await input.tap(); await page.clock.fastForward(16);
      await expect(phase(page)).toHaveAttribute('data-phase', 'fight'); await text('抵抗を検知');
    };
    await Promise.all([expect(page.locator('#hint')).toBeHidden(), expect(page.locator('#hint')).toHaveText('')]);
    await input.click(page.locator('#fish-button')); await tick(); await text('キャスト前');
    await castForText(); await toPhase('failed'); await text('個体を見失った', '再試行を待機');
    await expect(page.locator('#fishing-note')).toHaveText('応答が遅れ、個体を見失った。');
    await toPhase('ready'); await text('キャスト前');
    await castForText(); await hookShort();
    await expect(page.locator('#tension-warning')).toHaveText('張力が安定している');
    for (let n = 0; n < 20 && await page.locator('#line-tension').evaluate(el => el.value) >= .18; n++) await tick();
    await expect(phase(page)).toHaveAttribute('data-phase', 'fight');
    await expect(page.locator('#tension-warning')).toHaveText('長押しで巻く！');
    // Slack escape is probabilistic after its grace period. Supply a valid
    // zero roll for that draw; the already sampled individual stays fixed.
    await page.evaluate(() => { window.testRandomValue = 0; });
    await toPhase('failed');
    await text('個体を見失った', '再試行を待機');
    await expect(page.locator('#fishing-note')).toHaveText('針が外れ、個体を見失った。');
    await toPhase('ready'); await castForText(true); await hookShort();
    let held = false, sawHigh = false;
    for (let n = 0; n < 140 && await readPhase() === 'fight'; n++) {
      if (await expirePublicQte(page, () => input.up())) { held = false; continue; }
      if (!held) { await input.down(); held = true; }
      await tick();
      if (await readPhase() === 'fight' && await page.locator('#line-tension').evaluate(el => el.value) > .78) {
        sawHigh = true; await expect(page.locator('#tension-warning')).toHaveText('離して緩める！');
      }
    }
    if (held) await input.up();
    expect(sawHigh).toBe(true);
    await expect(phase(page)).toHaveAttribute('data-phase', 'failed');
    await text('個体を見失った', '再試行を待機');
    await expect(page.locator('#fishing-note')).toHaveText('ラインが断裂した。');
    await toPhase('ready'); await castForText();
    const conditions = await page.locator('#fishing-conditions').evaluate(el => ({ depthM: Number(el.dataset.depthM), timeOfDay: el.dataset.timeOfDay }));
    const species = sampleFishSpecies('minnow', () => .5, conditions);
    await hookShort(); await land(page, input, species.id, true); await text('個体を回収した');
    await expect(page.locator('#catch-qte-bonus')).toContainText('QTE成功0回');
    const lengthCm = Math.round((species.minLengthCm + .5 * (species.maxLengthCm - species.minLengthCm)) * 10) / 10;
    const price = calculateSalePrice({ speciesId: species.id, weightKg: calculateFishWeightKg(species.id, lengthCm), qteSuccessCount: 0 });
    await expect(page.locator('#catch-sale-price')).toHaveText(`売却価格 ${price.toLocaleString('ja-JP')} Value`);
    await input.click(page.locator(touch ? '#sell-catch' : '#close-catch')); await tick();
    await Promise.all([expect(page.locator('#catch-dialog')).toBeHidden(), expect(phase(page)).toHaveAttribute('data-phase', 'ready')]);
    await text('キャスト前');
    if (touch) await expect(page.locator('#wallet-balance')).toHaveText(`${price.toLocaleString('ja-JP')} Value`);
    else {
      await input.click(page.locator('#menu-button')); await input.click(page.locator('[data-view="storage"]'));
      await Promise.all([expect(page.locator('.stored-fish')).toHaveCount(1), expect(page.locator('.stored-fish')).toContainText(species.name)]);
      await input.click(page.locator('#collection-close'));
    }
    await input.click(page.locator('#return-button')); await tick();
    await Promise.all([expect(phase(page)).toHaveAttribute('data-phase', 'inactive'), expect(page.locator('#hint')).toBeHidden()]);
  });
}

for (const touch of [false, true]) {
  test(`${touch ? 'touch' : 'mouse'}: cancellation, missed hook, retry, flick, fight and catch result`, async ({ createContext }) => {
    test.setTimeout(360000);
    const context = await createContext({ viewport: touch ? { width: 390, height: 844 } : { width: 1000, height: 700 }, hasTouch: touch, isMobile: touch, deviceScaleFactor: 0.5 });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await setup(page);
    const input = await inputFor(page, touch);
    await input.click(page.locator('#fish-button'));
    await expect(page.locator('#lure-picker button')).toHaveCount(4);
    for (const id of ['minnow', 'spinnerbait', 'crankbait', 'worm']) {
      await input.click(page.locator(`[data-lure-id="${id}"]`));
      await expect(page.locator(`[data-lure-id="${id}"]`)).toHaveAttribute('aria-pressed', 'true');
    }
    const lureId = touch ? 'worm' : 'crankbait';
    await input.click(page.locator(`[data-lure-id="${lureId}"]`));
    await page.waitForTimeout(1000);
    await input.click(page.locator('#cast-button'));
    await expect(phase(page)).toHaveAttribute('data-phase', 'aim');
    await input.down(); await input.move(300, 300); await input.cancel();
    if (!touch) await page.mouse.up();
    await expect(phase(page)).toHaveAttribute('data-phase', 'ready');
    await expect(page.locator(`[data-lure-id="${lureId}"]`)).toHaveAttribute('aria-pressed', 'true');
    await cast(page, input);
    await expect(page.locator('#return-button')).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(phase(page)).toHaveAttribute('data-phase', 'lure');
    await input.down(); await page.waitForTimeout(400);
    await expect(page.locator('#reel-state')).toHaveText('巻き取り中');
    await input.cancel(); if (!touch) await page.mouse.up();
    await expect(page.locator('#reel-state')).toHaveText('待機中');
    // Bite/fight time is simulation time. Real-time waits can expire before
    // the dt-capped simulation progresses on a slow software GPU.
    await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
    await page.clock.pauseAt(new Date('2026-01-01T00:01:00Z'));
    for (let i = 0; i < 160 && await phase(page).getAttribute('data-phase') !== 'failed'; i++) await page.clock.fastForward(250);
    await expect(phase(page)).toHaveAttribute('data-phase', 'failed');
    await Promise.all([
      expect(page.locator('#fishing-state')).toHaveText('個体を見失った'),
      expect(page.locator('#hint')).toHaveText('再試行を待機'), expect(page.locator('#hint')).toBeVisible(),
    ]);
    for (let i = 0; i < 12 && await phase(page).getAttribute('data-phase') !== 'ready'; i++) await page.clock.fastForward(250);
    await expect(phase(page)).toHaveAttribute('data-phase', 'ready');
    await page.clock.resume();
    await expect(page.locator('#fishing-note')).toHaveText('応答が遅れ、個体を見失った。');
    await cast(page, input);
    // Installed Playwright clocks also virtualize Event.timeStamp. Keep time
    // still across the short native flick, then render its action explicitly.
    const flickPause = await page.evaluate(() => Date.now() + 60000);
    await page.clock.pauseAt(new Date(flickPause));
    await input.flick();
    await page.clock.fastForward(16);
    await expect(page.locator('#reel-state')).toHaveText('ルアーアクション');
    await hook(page, input, true);
    await expect(page.locator('#return-button')).toBeDisabled();
    await expect(page.locator('#lure-picker')).toBeHidden();
    const conditions = await page.locator('#fishing-conditions').evaluate(el => ({ depthM: Number(el.dataset.depthM), timeOfDay: el.dataset.timeOfDay }));
    await land(page, input, sampleFishSpecies(lureId, () => 0.5, conditions).id);
    const [caughtName, caughtLength, caughtWeight] = await Promise.all([
      page.locator('#catch-species').textContent(), page.locator('#catch-length').textContent(), page.locator('#catch-weight').textContent(),
    ]);
    await expect(page.locator('#menu-button')).toBeDisabled();
    await page.locator('#menu-button').evaluate(button => button.dispatchEvent(new MouseEvent('click')));
    await expect(page.locator('#collection-dialog')).toBeHidden();
    await page.screenshot({ path: `test-results/${touch ? 'mobile' : 'desktop'}-catch.png` });
    if (touch) await input.click(page.locator('#close-catch')); else await page.keyboard.press('Escape');
    await Promise.all([
      expect(page.locator('#catch-dialog')).toBeHidden(), expect(phase(page)).toHaveAttribute('data-phase', 'ready'),
      expect(page.locator('#lure-picker')).toBeVisible(),
    ]);
    await input.click(page.locator('#menu-button'));
    await input.click(page.locator('[data-view="encyclopedia"]'));
    await expect(page.locator('button.fish-card')).toHaveCount(1);
    await input.click(page.locator('button.fish-card'));
    const fish = FISH_SPECIES.find(item => item.name === caughtName);
    await Promise.all([
      expect(page.locator('#collection-title')).toHaveText(caughtName),
      expect(page.locator('.fish-detail')).toContainText('1匹'), expect(page.locator('.fish-detail')).toContainText(caughtLength),
      expect(page.locator('.fish-description')).toHaveText(fish.description),
      expect(page.locator('.fish-detail dt')).toHaveText(['捕獲数', '最大記録', '規定売価']),
      expect(page.locator('.fish-detail')).toContainText(`${fish.basePricePerKg} Val/kg`),
    ]);
    await input.click(page.locator('#collection-back')); await input.click(page.locator('#collection-back'));
    await input.click(page.locator('[data-view="storage"]'));
    await Promise.all([
      expect(page.locator('.stored-fish')).toHaveCount(1), expect(page.locator('.stored-fish')).toContainText(caughtName),
      expect(page.locator('.stored-fish')).toContainText(caughtLength), expect(page.locator('.stored-fish')).toContainText(caughtWeight),
      expect(page.locator('.stored-fish time')).toHaveAttribute('datetime', /T/),
    ]);
    await page.screenshot({ path: `test-results/${touch ? 'mobile' : 'desktop'}-storage.png` });
    await input.click(page.locator('#collection-close'));
    await cast(page, input);
    expect(errors).toEqual([]);
  });
}

test('mouse: blur/lost capture reset aim, over-tension fails and retry works', async ({ page }) => {
  // This case checks simulation state and cancellation, not flick duration.
  // Bind clocks before the renderer starts and keep native pointer ordering.
  await setup(page, { paused: true });
  const tick = () => page.clock.fastForward(250);
  const advanceTo = async expected => {
    // This paused-clock case needs ~11 simulated seconds before BITE. On
    // software WebGL, a 15s wall-clock poll can expire after only 9s of game
    // time. Bound ordinary 250ms updates by simulation steps instead; stop at
    // the first matching phase so the one-second hook window stays intact.
    for (let frame = 0; frame < 64 && await phase(page).getAttribute('data-phase') !== expected; frame++) await tick();
    await expect(phase(page)).toHaveAttribute('data-phase', expected);
  };
  const input = await inputFor(page, false);
  await page.locator('#fish-button').click(); await tick();
  await expect(phase(page)).toHaveAttribute('data-phase', 'ready');
  for (const reason of ['blur', 'lostpointercapture', 'visibilitychange']) {
    await page.locator('#cast-button').click(); await tick();
    await expect(phase(page)).toHaveAttribute('data-phase', 'aim');
    await input.down();
    // setPointerCapture is pending until the next native pointer event. Commit
    // it before releasing, so this exercises a real lostpointercapture event.
    await page.mouse.move(301, 420);
    await expect.poll(() => page.locator('#scene').evaluate(canvas => canvas.hasPointerCapture(1))).toBe(true);
    const progress = await page.locator('#fishing-conditions').getAttribute('data-cycle-progress');
    await page.evaluate(reason => {
      if (reason === 'blur') window.dispatchEvent(new Event('blur'));
      else if (reason === 'visibilitychange') {
        Object.defineProperty(document, 'hidden', { configurable: true, value: true });
        document.dispatchEvent(new Event(reason));
      } else document.querySelector('#scene').releasePointerCapture(1);
    }, reason);
    // Flush pending native lostpointercapture, then check the actual capture.
    await input.up();
    await expect.poll(() => page.locator('#scene').evaluate(canvas => canvas.hasPointerCapture(1))).toBe(false);
    if (reason !== 'lostpointercapture') {
      await page.clock.fastForward(1000);
      await expect(page.locator('#fishing-conditions')).toHaveAttribute('data-cycle-progress', progress);
      await page.evaluate(reason => {
        if (reason === 'blur') window.dispatchEvent(new Event('focus'));
        else { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); }
      }, reason);
    }
    await tick();
    await expect(phase(page)).toHaveAttribute('data-phase', 'ready');
    await expect(page.locator('#cast-button')).toBeVisible();
    await expect(page.locator('#cast-button')).toBeEnabled();
  }
  await cast(page, input, tick);
  // This cancellation/QTE/line-break regression previously selected this fish
  // with .5 in the twelve-species roster. Keep its size/resistance stable.
  const encounterPlan = await armEncounter(page, { speciesId: 'rainbow-trout', lengthRoll: 0.5, rodLevel: 1 });
  await advanceTo('bite');
  await verifyEncounterBite(page, encounterPlan);
  await input.tap(); await tick();
  await expect(phase(page)).toHaveAttribute('data-phase', 'fight');
  await input.down();
  await expect.poll(async () => {
    await tick();
    return page.locator('#line-tension').evaluate(el => el.value);
  }).toBeGreaterThanOrEqual(0.3);
  // Sample before cancellation in the same browser turn: a slow automation
  // round trip may otherwise observe tension already relaxed to zero.
  const tension = await page.evaluate(() => {
    const value = document.querySelector('#line-tension').value;
    window.dispatchEvent(new Event('blur'));
    return value;
  });
  await expect.poll(() => page.locator('#scene').evaluate(canvas => canvas.hasPointerCapture(1))).toBe(false);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(async () => {
    await tick();
    return page.locator('#line-tension').evaluate(el => el.value);
  }).toBeLessThan(tension);
  await input.up(); await input.down();
  const hud = page.locator('.qte-hud'), handoffs = [];
  const samples = [];
  const observedPhase = async () => {
    const sample = await readFishingEvidence(page); samples.push(sample); return sample.phase;
  };
  // Warning invalidates the old normal hold. Keep the 64 ordinary-step
  // budget; only the existing finite QTE wait has its own bounded clock.
  for (let frame = 0; frame < 64 && await observedPhase() !== 'failed'; frame++) {
    if (await hud.isVisible()) {
      await expect(hud).toHaveAttribute('data-state', 'warning');
      expect(await expirePublicQte(page, input.up)).toBe(true);
      await expect(phase(page)).toHaveAttribute('data-phase', 'fight');
      await expect.poll(() => page.locator('#scene').evaluate(canvas => canvas.hasPointerCapture(1))).toBe(false);
      const sealed = await page.locator('#line-tension').evaluate(el => el.value);
      await tick(); frame++;
      const released = await page.locator('#line-tension').evaluate(el => el.value);
      // The stale up/lostcapture must leave no ghost hold after the seal.
      expect(released).toBeLessThan(sealed);
      handoffs.push({ sealed, released });
      await input.down();
    }
    await tick();
  }
  expect(handoffs.length).toBeGreaterThan(0);
  await test.info().attach('over-tension-qte-handoff', { body: JSON.stringify({ encounterPlan, handoffs, samples,
    native: await page.evaluate(() => window.e2eDiagnostics.events.filter(e => e.target === 'scene')) }), contentType: 'application/json' });
  await expect(phase(page)).toHaveAttribute('data-phase', 'failed'); await input.up();
  await expect(phase(page)).toHaveAttribute('data-phase', 'failed');
  await expect(page.locator('#fishing-note')).toHaveText('ラインが断裂した。');
  await advanceTo('ready');
  await expect(phase(page)).toHaveAttribute('data-phase', 'ready');
  await expect(page.locator('#cast-button')).toBeVisible();
  await expect(page.locator('#cast-button')).toBeEnabled();
  await cast(page, input, tick);
});

test('mobile landscape: prepare/cancel and return controls remain reachable', async ({ createContext }) => {
  const context = await createContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true });
  const page = await context.newPage(); await setup(page);
  await page.locator('#fish-button').tap();
  for (const button of await page.locator('#lure-picker button').all()) {
    const bounds = await button.boundingBox();
    expect(bounds.y).toBeGreaterThan(0); expect(bounds.y + bounds.height).toBeLessThan(390);
    await button.tap(); await expect(button).toHaveAttribute('aria-pressed', 'true');
  }
  await page.locator('#cast-button').tap();
  await expect(phase(page)).toHaveAttribute('data-phase', 'aim');
  await page.locator('#cancel-cast').tap();
  await expect(phase(page)).toHaveAttribute('data-phase', 'ready');
  await page.screenshot({ path: 'test-results/mobile-landscape-fishing.png' });
  await page.locator('#return-button').tap();
  await expect(page.locator('#motion-label')).toHaveText('停船中');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('Phase 6-C Rare: initial equipment arapaima through native three-QTE catch, exact PNG and saved reload', async ({ page }, testInfo) => {
  const started = performance.now();
  await page.setViewportSize({ width: 800, height: 600 });
  await setup(page, { paused: true });
  expect(await page.evaluate(() => ['barb.save.v1.slotA', 'barb.save.v1.slotB'].map(key => localStorage.getItem(key)))).toEqual([null, null]);
  await page.evaluate(() => { window.testRandomValue = .1; });
  const tick = () => page.clock.fastForward(250), input = await inputFor(page, false);
  await page.locator('#fish-button').click(); await tick();
  await cast(page, input, tick);
  const plan = await armEncounter(page, { speciesId: 'arapaima', lengthRoll: .5, rodLevel: 1 });
  for (let i = 0; i < 24 && await phase(page).getAttribute('data-phase') === 'lure'; i++) await tick();
  await verifyEncounterBite(page, plan);
  await input.tap(); await tick(); await expect(phase(page)).toHaveAttribute('data-phase', 'fight');
  const fightStarted = await page.evaluate(() => Date.now());
  let held = false, successes = 0, ticks = 0;
  for (; ticks < 100; ticks++) {
    const state = await page.evaluate(() => ({ phase: document.querySelector('#fishing-panel').dataset.phase, tension: document.querySelector('#line-tension').value }));
    if (state.phase !== 'fight') break;
    if (await succeedMousePublicQte(page)) { held = false; successes++; continue; }
    if (!held && state.tension < .35) { await input.down(); held = true; }
    else if (held && state.tension > .65) { await input.up(); held = false; }
    await tick();
  }
  if (held) await input.up();
  await expect(phase(page)).toHaveAttribute('data-phase', 'landing');
  expect(successes).toBe(3);
  const observedFightMs = await page.evaluate(() => Date.now()) - fightStarted;
  for (let i = 0; i < 5; i++) await tick();
  await assertCatch(page, 'arapaima', plan.lengthRoll);
  await expect(page.locator('#catch-qte-bonus')).toContainText('QTE成功3回／');
  await page.locator('#close-catch').click(); await tick();
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  const saved = (await readSpeciesSave(page)).data;
  expect([saved.saveVersion, saved.rosterRevision, saved.achievements.contractVersion]).toEqual([3, 3, 5]);
  expect(saved.collection.equipment).toEqual({ rodLevel: 1, reelLevel: 1 });
  expect(saved.collection.catches).toHaveLength(1);
  const record = saved.collection.catches[0];
  expect(record).toMatchObject({ speciesId: 'arapaima', qteSuccessCount: 3, disposition: 'stored', lengthCm: plan.lengthCm, weightKg: plan.weightKg });
  await page.reload(); await tick(); await expect(page.locator('#status')).toBeHidden();
  expect((await readSpeciesSave(page)).data.collection.catches).toEqual([record]);
  await page.locator('#menu-button').click(); await page.locator('[data-view="encyclopedia"]').click();
  await expect(page.locator('.collection-summary')).toHaveText('発見 1 / 36 種');
  await expect(page.locator('button.fish-card')).toHaveCount(1); await expect(page.locator('div.fish-card')).toHaveCount(35);
  await testInfo.attach('phase6c-rare-native', { body: JSON.stringify({ plan, successes, ticks, observedFightMs, durationMs: Math.round(performance.now() - started), record }), contentType: 'application/json' });
});

const speciesTest = createStorageCheckpointTest(test);
const speciesSaveKeys = ['barb.save.v1.slotA', 'barb.save.v1.slotB'];
const speciesGroups = [[0, 7], [7, 14], [14, 21], [21, 28], [28, 32], [32, 36]]
  .map(([start, end]) => ({ start, end }));

async function readSpeciesSave(page) {
  return page.evaluate(keys => {
    const raw = keys.map(key => localStorage.getItem(key));
    const latest = raw.filter(Boolean).map(JSON.parse).sort((a, b) => b.generation - a.generation)[0];
    return { raw, data: latest?.data ?? null };
  }, speciesSaveKeys);
}
function assertSpeciesSave(data, count, qteCounts) {
  expect(data).not.toBeNull();
  expect([data.saveVersion, data.rosterRevision, data.achievements.contractVersion]).toEqual([3, 3, 5]);
  const records = data.collection.catches;
  expect(records.map(record => record.speciesId)).toEqual(FISH_SPECIES.slice(0, count).map(fish => fish.id));
  expect(new Set(records.map(record => record.id)).size).toBe(count);
  expect(records.every(record => record.disposition === 'stored')).toBe(true);
  expect(records.map(record => record.qteSuccessCount)).toEqual(qteCounts);
}
async function assertRestoredCheckpoint(page, checkpoint, expectedCount, qteCounts) {
  const saved = await readSpeciesSave(page);
  const origin = new URL(page.url()).origin;
  const entries = checkpoint?.origins.find(entry => entry.origin === origin)?.localStorage ?? [];
  // Compare the exact two original strings, not reconstructed save objects.
  expect(saved.raw).toEqual(speciesSaveKeys.map(key => entries.find(entry => entry.name === key)?.value ?? null));
  if (expectedCount) assertSpeciesSave(saved.data, expectedCount, qteCounts);
}

speciesTest.describe('all 36 species: continuous production catches and saved collection', () => {
  // Failures block dependent parts through Playwright's serial scheduling;
  // ci-required still rejects every failed or unexecuted test. No shared page.
  speciesTest.describe.configure({ mode: 'serial' });
  let confirmedCounts = [];
  let checkpointTime;

  speciesTest.beforeAll(() => {
    expect(FISH_SPECIES).toHaveLength(36);
    expect(speciesGroups.map(({ start, end }) => end - start)).toEqual([7, 7, 7, 7, 4, 4]);
  });

  for (const { start, end } of speciesGroups) {
    speciesTest(`No.${start + 1}–${end}: cast, hook, fight, QTE, result image and recast`, async ({ page, storageCheckpoint }, testInfo) => {
      // Preserve the four seven-fish segments and add two four-fish segments.
      // Each keeps the existing five-minute budget; final UI work is separate.
      speciesTest.setTimeout(300000);
      const started = performance.now();
      const progress = { planned: FISH_SPECIES.slice(start, end).map(fish => fish.id), stage: 'startup', completed: [], current: null };
      const segmentCounts = [];
      try {
        expect(confirmedCounts).toHaveLength(start);
        await page.setViewportSize({ width: 800, height: 600 });
        await setup(page, { paused: true, time: checkpointTime });
        await assertRestoredCheckpoint(page, storageCheckpoint.previous, start, confirmedCounts);
        const tick = () => page.clock.fastForward(250);
        await page.locator('#fish-button').click(); await tick();
        await expect(phase(page)).toHaveAttribute('data-phase', 'ready');
        const input = await inputFor(page, false);
        const snapshot = () => page.evaluate(() => ({ phase: document.querySelector('#fishing-panel').dataset.phase, tension: document.querySelector('#line-tension').value }));

        progress.stage = 'fishing';
        for (let index = start; index < end; index++) {
          const species = FISH_SPECIES[index], fishStarted = performance.now();
          progress.current = { speciesId: species.id, stage: 'cast' };
          let successes = 0;
          await speciesTest.step(`No.${index + 1} ${species.id}`, async () => {
            // Retain the original global lure/day-night sequence across reloads.
            const timeOfDay = index % 2 ? 'night' : 'day';
            const cycle = Number(await page.locator('#fishing-conditions').getAttribute('data-cycle-progress'));
            const targetProgress = index % 2 ? 0.5 : 0;
            await page.clock.fastForward(Math.ceil(((targetProgress - cycle + 1) % 1) * 360000) + 250);
            await expect(page.locator('#fishing-conditions')).toHaveAttribute('data-time-of-day', timeOfDay);
            const lureId = ['minnow', 'crankbait', 'worm', 'spinnerbait'][index % 4];
            await page.evaluate(() => { window.testRandomValue = 0.1; });
            await page.locator(`[data-lure-id="${lureId}"]`).click({ force: true });
            await page.locator('#cast-button').click({ force: true }); await tick();
            await input.down(450, 240); await input.move(450, 90); await input.up();
            for (let i = 0; i < 4; i++) await tick();
            expect((await snapshot()).phase).toBe('lure');
            await expect(page.locator('#fishing-conditions')).toHaveAttribute('data-depth-m', '12');
            const plan = await armEncounter(page, { speciesId: species.id, lengthRoll: .5, rodLevel: 1 });
            progress.current.stage = 'bite';
            for (let i = 0; i < 24 && (await snapshot()).phase === 'lure'; i++) await tick();
            expect((await snapshot()).phase).toBe('bite');
            await verifyEncounterBite(page, plan);
            await input.tap(); await tick();
            expect((await snapshot()).phase).toBe('fight');
            progress.current.stage = 'fight/QTE';
            let held = false;
            for (let i = 0; i < 100; i++) {
              const s = await snapshot();
              if (s.phase !== 'fight') break;
              if (await succeedMousePublicQte(page)) { held = false; successes++; continue; }
              if (!held && s.tension < 0.35) { await input.down(); held = true; }
              else if (held && s.tension > 0.65) { await input.up(); held = false; }
              await tick();
            }
            if (held) await input.up();
            expect((await snapshot()).phase).toBe('landing');
            progress.current.stage = 'landing/result image';
            for (let i = 0; i < 5; i++) await tick();
            await assertCatch(page, species.id, plan.lengthRoll);
            expect(successes).toBeGreaterThanOrEqual(1); expect(successes).toBeLessThanOrEqual(3);
            await expect(page.locator('#catch-qte-bonus')).toContainText(`QTE成功${successes}回／`);
            progress.current.stage = 'recast';
            if (index === 0) await page.locator('#catch-dialog').evaluate(dialog => dialog.close());
            else await page.locator('#close-catch').click({ force: true });
            await tick();
            expect((await snapshot()).phase).toBe('ready');
            await expect(page.locator('#cast-button')).toBeEnabled();
          });
          segmentCounts.push(successes);
          const completed = { speciesId: species.id, qteSuccessCount: successes, durationMs: Math.round(performance.now() - fishStarted) };
          progress.completed.push(completed); progress.current = null;
          console.log(JSON.stringify({ type: 'species-complete', range: [start + 1, end], completed: progress.completed.length, ...completed }));
        }
        // The next segment starts after a real save/reload. Also prove the last
        // fish of this segment can prepare another cast before that boundary.
        progress.stage = 'recast/save boundary';
        await page.locator('#cast-button').click(); await tick();
        await expect(phase(page)).toHaveAttribute('data-phase', 'aim');
        await page.locator('#cancel-cast').click(); await tick();
        await expect(phase(page)).toHaveAttribute('data-phase', 'ready');
        await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
        const saved = await readSpeciesSave(page);
        const nextCounts = [...confirmedCounts, ...segmentCounts];
        assertSpeciesSave(saved.data, end, nextCounts);
        const nextTime = new Date(await page.evaluate(() => Date.now()));
        await storageCheckpoint.capture();
        checkpointTime = nextTime;
        confirmedCounts = nextCounts;
        progress.stage = 'checkpoint committed';
      } finally {
        const summary = { range: [start + 1, end], ...progress, completedCount: progress.completed.length,
          totalCompleted: start + progress.completed.length, durationMs: Math.round(performance.now() - started) };
        console.log(JSON.stringify({ type: 'species-segment', ...summary }));
        await testInfo.attach('species-segment-progress', { body: JSON.stringify(summary), contentType: 'application/json' });
      }
    });
  }

  speciesTest('36 caught species: ordered discovered grid, unique storage and QTE save/reload', async ({ page, storageCheckpoint }, testInfo) => {
    expect(confirmedCounts).toHaveLength(36);
    await page.setViewportSize({ width: 800, height: 600 });
    await setup(page, { paused: true, time: checkpointTime });
    await assertRestoredCheckpoint(page, storageCheckpoint.previous, 36, confirmedCounts);
    await page.locator('#menu-button').click({ force: true });
    await page.locator('[data-view="encyclopedia"]').click({ force: true });
    expect(await page.locator('.fish-card > .fish-card-name').allTextContents()).toEqual(FISH_SPECIES.map(fish => fish.name));
    await expect(page.locator('button.fish-card')).toHaveCount(36);
    await expect(page.locator('div.fish-card')).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('encyclopedia-discovered.png'), animations: 'disabled' });
    await page.locator('#collection-back').click({ force: true });
    await page.locator('[data-view="storage"]').click({ force: true });
    await expect(page.locator('.stored-fish')).toHaveCount(36);
    const ids = await page.locator('.stored-fish').evaluateAll(nodes => nodes.map(node => node.dataset.catchId));
    expect(new Set(ids).size).toBe(36);
    const scroll = await page.locator('#collection-content').evaluate(el => { el.scrollTop = el.scrollHeight; return { top: el.scrollTop, height: el.scrollHeight, client: el.clientHeight }; });
    expect(scroll.height).toBeGreaterThan(scroll.client); expect(scroll.top).toBeGreaterThan(0);
    await page.locator('#collection-close').click({ force: true });
    await page.clock.resume(); await page.reload(); await expect(page.locator('#status')).toBeHidden();
    assertSpeciesSave((await readSpeciesSave(page)).data, 36, confirmedCounts);
    await page.locator('#menu-button').click(); await page.locator('[data-view="storage"]').click();
    await expect(page.locator('.stored-fish')).toHaveCount(36);
    expect(await page.locator('.stored-fish').evaluateAll(nodes => nodes.map(node => node.dataset.catchId))).toEqual(ids);
    await page.locator('#collection-back').click(); await page.locator('[data-view="encyclopedia"]').click();
    expect(await page.locator('.fish-card > .fish-card-name').allTextContents()).toEqual(FISH_SPECIES.map(fish => fish.name));
    await expect(page.locator('button.fish-card')).toHaveCount(36);
    await testInfo.attach('all-species-qte-counts', { body: JSON.stringify({ speciesIds: FISH_SPECIES.map(fish => fish.id), qteSuccessCounts: confirmedCounts }), contentType: 'application/json' });
  });
});
