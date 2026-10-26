import { test, expect } from './diagnostics-fixture.js';
import { openUIFixture } from './ui-fixture.js';
import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { build } from 'vite';
import { fishSpeciesSandbox } from '../helpers/fish-species-sandbox.js';
import { FISH_SPECIES, BLACK_BASS, calculateFishWeightKg } from '../../src/game/fish-species.js';
import { createCatchCollection } from '../../src/game/catch-collection.js';
import { createAchievements } from '../../src/game/achievements.js';
import { createBoatState } from '../../src/game/boat.js';
import { createGameClock } from '../../src/game/game-clock.js';
import { createSaveData } from '../../src/game/save-data.js';
import { generateFishArtworkReport } from '../../scripts/report-fish-artwork.mjs';

const png = readFileSync(new URL('../fixtures/fish-assets/transparent-test.png', import.meta.url));
const svg = readFileSync(new URL('../fixtures/fish-assets/transparent-test.svg', import.meta.url));
function legacySave() {
  const collection = createCatchCollection(), achievements = createAchievements({ collection, now: () => 1000 });
  collection.register({ schemaVersion: 1, id: 'legacy-bass', speciesId: 'black-bass', lengthCm: 40, weightKg: 1.1, caughtAt: '2026-01-01T00:00:00.000Z' });
  collection.store('legacy-bass');
  return createSaveData({ collection, achievements, boat: createBoatState(), clock: createGameClock() }, { savedAt: '2026-01-01T00:00:00.000Z' });
}

async function checkImage(image, pngImage) {
  await expect(image).toBeVisible();
  await image.evaluate(img => img.decode());
  const state = await image.evaluate(img => {
    const box = img.getBoundingClientRect(), frame = img.parentElement.getBoundingClientRect(), style = getComputedStyle(img);
    return { width: img.naturalWidth, height: img.naturalHeight, fit: style.objectFit, background: style.backgroundColor,
      inside: box.left >= frame.left && box.right <= frame.right + 1 && box.top >= frame.top && box.bottom <= frame.bottom + 1,
      widthFits: frame.width <= innerWidth, src: img.currentSrc, alt: img.alt };
  });
  expect(state.width / state.height).toBeCloseTo(pngImage ? 40 / 64 : 640 / 280, 2);
  expect(state.fit).toBe('contain'); expect(state.background).toBe('rgba(0, 0, 0, 0)');
  expect(state.inside && state.widthFits).toBe(true); expect(state.alt).toContain('ブラックバス');
  expect(new URL(state.src).pathname.startsWith('/barb/')).toBe(true);
  if (pngImage) {
    const frame = image.locator('..');
    const screenshot = await frame.screenshot();
    const pixels = await image.evaluate(async (img, base64) => {
      const capture = new Image(); capture.src = 'data:image/png;base64,' + base64; await capture.decode();
      const canvas = document.createElement('canvas'); canvas.width = capture.width; canvas.height = capture.height;
      const ctx = canvas.getContext('2d'); ctx.drawImage(capture, 0, 0);
      const scale = Math.min(capture.width / img.naturalWidth, capture.height / img.naturalHeight);
      const left = (capture.width - img.naturalWidth * scale) / 2;
      return [5, 18, 32].map(x => [...ctx.getImageData(Math.floor(left + x * scale), Math.floor(capture.height / 2), 1, 1).data]);
    }, screenshot.toString('base64'));
    expect(pixels[0]).toEqual([206, 213, 182, 255]); // frame visible through clear pixels
    for (const [index, expected] of [140, 178, 171, 255].entries()) expect(Math.abs(pixels[1][index] - expected)).toBeLessThanOrEqual(3);
    expect(pixels[2][2]).toBe(160); expect(pixels[2][3]).toBe(255);
  }
}

for (const touch of [false, true]) for (const pngImage of [false, true]) {
  test(`${touch ? 'touch' : 'mouse'}: ${pngImage ? 'transparent PNG' : 'SVG'} in restored grid, detail, storage and catch result`, async ({ createContext }) => {
    const context = await createContext({ viewport: touch ? { width: 390, height: 844 } : { width: 1000, height: 700 }, hasTouch: touch, isMobile: touch });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => { Math.random = () => 0; });
    const click = locator => touch ? locator.tap() : locator.click();
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    await page.route('**/barb/fish-test.png', async route => { await gate; return route.fulfill({ body: png, contentType: 'image/png' }); });
    await page.route('**/barb/fish-test.svg', route => route.fulfill({ body: svg, contentType: 'image/svg+xml' }));
    await openUIFixture(page, legacySave(), { pngFishImage: pngImage, svgFishImage: !pngImage });
    await click(page.locator('#menu-button')); await click(page.locator('[data-view="encyclopedia"]'));
    await expect(page.locator('.fish-card')).toHaveCount(12);
    const unknown = page.locator('div.fish-card');
    await expect(unknown).toHaveCount(11);
    const masked = await unknown.evaluateAll(nodes => nodes.map(node => node.outerHTML).join(''));
    for (const fish of FISH_SPECIES.slice(1)) {
      expect(masked).not.toContain(fish.name); expect(masked).not.toContain(fish.description);
      expect(masked).not.toContain(fish.id); expect(masked).not.toContain(new URL(fish.image).pathname);
    }
    expect(new Set(await unknown.locator('img').evaluateAll(nodes => nodes.map(node => node.src))).size).toBe(1);
    const discovered = page.locator('button.fish-card img'), frame = discovered.locator('..');
    const before = await frame.boundingBox(); release();
    await checkImage(discovered, pngImage);
    expect(await frame.boundingBox()).toEqual(before);
    const sizes = touch ? [{ width: 390, height: 844 }, { width: 844, height: 390 }] : [{ width: 1000, height: 700 }];
    for (const size of sizes) {
      await page.setViewportSize(size);
      await checkImage(discovered, pngImage);
      await click(page.locator('button.fish-card'));
      await expect(page.locator('.fish-description')).toHaveText(BLACK_BASS.description);
      await checkImage(page.locator('.fish-detail img'), pngImage);
      await click(page.locator('#collection-back')); await click(page.locator('#collection-back'));
      await click(page.locator('[data-view="storage"]'));
      await checkImage(page.locator('[data-catch-id="legacy-bass"] img'), pngImage);
      await click(page.locator('#collection-back')); await click(page.locator('[data-view="encyclopedia"]'));
    }
    await click(page.locator('#collection-close'));
    // Public domain APIs drive a real catch. No phase or record injection.
    expect(await page.evaluate(() => {
      const fishing = fixture.fishing;
      fishing.prepare({ x: 0, z: 30 }, 0); fishing.aim(0, 180); fishing.cast();
      for (let i = 0; i < 3000 && fishing.state.phase !== 'bite'; i++) fishing.step(1 / 60);
      fishing.hook();
      for (let i = 0; i < 1800 && fishing.state.phase === 'fight'; i++) {
        fishing.reel(fishing.state.tension < 0.65); fishing.step(1 / 60);
      }
      fishing.step(2);
      fixture.fishingHUD.update(fishing, true, { timeOfDay: 'day', cycleProgress: 0 });
      return fishing.state.phase;
    })).toBe('result');
    for (const size of sizes) { await page.setViewportSize(size); await checkImage(page.locator('#catch-image'), pngImage); }
    await click(page.locator('#close-catch'));
    await expect(page.locator('#catch-dialog')).toBeHidden();
    await page.reload(); await page.waitForFunction(() => Boolean(window.fixture));
    await click(page.locator('#menu-button')); await click(page.locator('[data-view="storage"]'));
    await checkImage(page.locator('[data-catch-id="legacy-bass"] img'), pngImage);
    expect(await page.evaluate(() => ({ version: fixture.restored.collection.catches[0].schemaVersion,
      count: fixture.collection.encyclopedia[0].count, wallet: fixture.collection.wallet.balance }))).toEqual({ version: 1, count: 1, wallet: 0 });
    expect(errors).toEqual([]);
  });
}

test('Vite builds static SVG/PNG references for /barb/ and the browser loads emitted and inlined PNG', async ({ page }) => {
  const sandbox = await fishSpeciesSandbox(null, { svg: true, png: true });
  try {
    await writeFile(join(sandbox.root, 'index.html'), '<script type="module">import { FISH_SPECIES } from "/src/game/fish-species.js"; for (const fish of FISH_SPECIES) { const image = new Image(); image.src = fish.image; image.alt = fish.name; document.body.append(image); }</script>');
    for (const inline of [false, true]) {
      const result = await build({ root: sandbox.root, configFile: false, base: '/barb/', logLevel: 'silent',
        build: { write: false, assetsInlineLimit: inline ? Infinity : 0 } });
      const files = new Map(result.output.map(file => [file.fileName, file.type === 'asset' ? file.source : file.code]));
      await page.route('**/barb/**', route => {
        const name = new URL(route.request().url()).pathname.replace('/barb/', '');
        const body = files.get(name || 'index.html');
        return body === undefined ? route.abort() : route.fulfill({ body, contentType: name.endsWith('.png') ? 'image/png' : name.endsWith('.svg') ? 'image/svg+xml' : name.endsWith('.js') ? 'text/javascript' : 'text/html' });
      });
      await page.goto('./'); await expect(page.locator('img')).toHaveCount(12);
      await page.locator('img').evaluateAll(images => Promise.all(images.map(img => img.decode())));
      const loadedImages = await page.locator('img').evaluateAll(images => images.map(img => ({ src: img.currentSrc, width: img.naturalWidth, height: img.naturalHeight })));
      for (const image of loadedImages.slice(1)) {
        expect(image.width / image.height).toBeCloseTo(640 / 280, 2);
        if (inline) expect(image.src).toMatch(/^data:image\/svg\+xml,/);
        else expect(new URL(image.src).pathname).toMatch(/^\/barb\/assets\/[\w-]+\.svg$/);
      }
      const loaded = loadedImages[0];
      expect([loaded.width, loaded.height]).toEqual([40, 64]);
      if (inline) expect(loaded.src).toMatch(/^data:image\/png;base64,/);
      else {
        expect(new URL(loaded.src).pathname).toMatch(/^\/barb\/assets\/fixture-[\w-]+\.png$/);
        const response = await page.evaluate(async src => {
          const response = await fetch(src);
          return { status: response.status, type: response.headers.get('content-type'), bytes: [...new Uint8Array(await response.arrayBuffer())] };
        }, loaded.src);
        expect(response.status).toBe(200); expect(response.type).toBe('image/png');
        expect(Buffer.from(response.bytes).equals(png)).toBe(true);
      }
      await page.unroute('**/barb/**');
    }
  } finally { await sandbox.dispose(); }
});

function allSpeciesLegacySave() {
  const collection = createCatchCollection(), achievements = createAchievements({ collection, now: () => 1000 });
  for (const fish of FISH_SPECIES) {
    const lengthCm = fish.weight.referenceLengthCm;
    const record = collection.register({ schemaVersion: 1, id: `legacy-${fish.id}`, speciesId: fish.id,
      lengthCm, weightKg: calculateFishWeightKg(fish.id, lengthCm), caughtAt: '2026-01-01T00:00:00.000Z' });
    collection.store(record.id);
  }
  return createSaveData({ collection, achievements, boat: createBoatState(), clock: createGameClock() }, { savedAt: '2026-01-01T00:00:00.000Z' });
}

async function checkProductionImage(image, fish, { inspectPixels = false } = {}) {
  await image.scrollIntoViewIfNeeded();
  await expect(image).toBeVisible();
  await expect(image).toHaveAttribute('src', /.+/);
  const state = await image.evaluate(async (img, inspectPixels) => {
    await img.decode();
    const box = img.getBoundingClientRect(), frame = img.parentElement.getBoundingClientRect();
    const result = { src: img.currentSrc, width: img.naturalWidth, height: img.naturalHeight, alt: img.alt,
      fit: getComputedStyle(img).objectFit, loading: img.loading,
      inside: box.left >= frame.left && box.right <= frame.right + 1 && box.top >= frame.top && box.bottom <= frame.bottom + 1,
      widthFits: frame.width <= innerWidth };
    if (inspectPixels) {
      const canvas = document.createElement('canvas'); canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0);
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let borderNonTransparent = 0, transparentPixels = 0, opaquePixels = 0;
      for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
        const alpha = pixels[(y * canvas.width + x) * 4 + 3];
        if (alpha === 0) transparentPixels++;
        if (alpha === 255) opaquePixels++;
        if ((x === 0 || y === 0 || x === canvas.width - 1 || y === canvas.height - 1) && alpha !== 0) borderNonTransparent++;
      }
      const hash = await crypto.subtle.digest('SHA-256', pixels);
      Object.assign(result, { borderNonTransparent, transparentPixels, opaquePixels,
        decodedSha256: [...new Uint8Array(hash)].map(value => value.toString(16).padStart(2, '0')).join('') });
    }
    return result;
  }, inspectPixels);
  expect([state.width, state.height]).toEqual([1280, 560]);
  expect(state.fit).toBe('contain'); expect(state.inside && state.widthFits).toBe(true);
  expect(state.alt).toContain(fish.name);
  expect(new URL(state.src).pathname).toBe(`/barb/src/assets/fish/${fish.id}.png`);
  if (inspectPixels) {
    expect(state.borderNonTransparent).toBe(0);
    expect(state.transparentPixels).toBeGreaterThan(0);
    expect(state.opaquePixels).toBeGreaterThan(0);
  }
  return state;
}

// Keep actual production startup separate from the source-module UI fixture.
// Defining static image URLs must not initiate twelve PNG downloads.
test('production startup and undiscovered encyclopedia do not preload fish PNGs', async ({ page }, testInfo) => {
  const requests = [], failures = [];
  page.on('request', request => { if (request.resourceType() === 'image') requests.push(request.url()); });
  page.on('requestfailed', request => failures.push({ url: request.url(), error: request.failure()?.errorText }));
  await page.goto('./'); await expect(page.locator('#status')).toBeHidden();
  await expect(page.locator('#catch-image')).not.toHaveAttribute('src');
  const initialImages = [...requests];
  await page.locator('#menu-button').click(); await page.locator('[data-view="encyclopedia"]').click();
  await expect(page.locator('div.fish-card')).toHaveCount(12);
  await expect(page.locator('button.fish-card')).toHaveCount(0);
  const cards = await page.locator('.fish-card').evaluateAll(nodes => nodes.map(node => node.outerHTML).join(''));
  for (const fish of FISH_SPECIES) {
    expect(cards).not.toContain(fish.name); expect(cards).not.toContain(fish.description);
    expect(cards).not.toContain(`${fish.id}.png`);
  }
  expect(new Set(await page.locator('.fish-card img').evaluateAll(images => images.map(img => img.src))).size).toBe(1);
  expect(await page.locator('.fish-card img').evaluateAll(images => images.every(img => img.loading === 'lazy'))).toBe(true);
  expect(requests.filter(url => /\.png(?:$|\?)/.test(url))).toEqual([]);
  expect(await page.locator('link[rel="preload"][as="image"]').count()).toBe(0);
  expect(failures).toEqual([]);
  const report = { scope: 'production Vite build, fresh save', initialImages,
    encyclopediaImages: requests, fishPngBytes: 0,
    resources: await page.evaluate(() => performance.getEntriesByType('resource').filter(entry => entry.initiatorType === 'img')
      .map(entry => ({ name: entry.name, transferSize: entry.transferSize, encodedBodySize: entry.encodedBodySize, decodedBodySize: entry.decodedBodySize, duration: entry.duration }))) };
  const path = testInfo.outputPath('startup-image-loading.json');
  await writeFile(path, JSON.stringify(report, null, 2));
  await testInfo.attach('startup-image-loading', { path, contentType: 'application/json' });
});

const artworkViewports = [
  { label: 'desktop', viewport: { width: 1280, height: 800 }, touch: false },
  { label: 'mobile-portrait', viewport: { width: 390, height: 844 }, touch: true },
  { label: 'mobile-landscape', viewport: { width: 844, height: 390 }, touch: true },
];

// Observe real dispose() calls without changing loading, input or cancellation.
// Match a disposal to the exact in-flight Request, never a URL-wide exception.
async function observeCollectionImageRequests(page) {
  const requests = new Map(), pending = new Set(), disposals = new Map();
  page.on('request', request => {
    if (request.resourceType() !== 'image') return;
    requests.set(request, { id: requests.size + 1, url: request.url(), outcome: 'pending' });
    pending.add(request);
  });
  page.on('requestfinished', request => {
    if (requests.has(request)) requests.get(request).outcome = 'finished';
    pending.delete(request);
  });
  page.on('requestfailed', request => {
    if (requests.has(request)) Object.assign(requests.get(request), { outcome: 'failed', error: request.failure()?.errorText });
    pending.delete(request);
  });
  await page.exposeBinding('recordFishImageDisposal', (_, { phase, key, ...sample }) => {
    if (phase === 'before') {
      const candidates = [...pending].filter(request => request.url() === sample.url);
      disposals.set(key, { before: sample, request: candidates.length === 1 ? candidates[0] : null });
    } else if (disposals.has(key)) disposals.get(key).after = sample;
  });
  await page.addInitScript(() => {
    let transition, serial = 0;
    document.addEventListener('click', event => {
      const button = event.target.closest?.('button');
      if (!event.isTrusted || !button?.matches('button.fish-card, #collection-back, #collection-close, [data-view]')) return;
      transition = { event, trigger: button.id || button.dataset.view || `fish-slot-${button.dataset.slot}` };
    }, true);
    const remove = Element.prototype.removeAttribute;
    Element.prototype.removeAttribute = function(name) {
      if (name !== 'src' || !(this instanceof HTMLImageElement) || !transition?.event.eventPhase || !this.closest('#collection-content')) return remove.apply(this, arguments);
      const key = `${performance.timeOrigin}:${++serial}`;
      const before = { url: this.src, complete: this.complete, connected: this.isConnected,
        transition: { trigger: transition.trigger, trusted: transition.event.isTrusted },
        title: document.querySelector('#collection-title').textContent, stack: new Error().stack };
      window.recordFishImageDisposal({ phase: 'before', key, ...before });
      const result = remove.apply(this, arguments);
      queueMicrotask(() => window.recordFishImageDisposal({ phase: 'after', key, src: this.getAttribute('src'),
        connected: this.isConnected, title: document.querySelector('#collection-title').textContent,
        dialogOpen: document.querySelector('#collection-dialog').open }));
      return result;
    };
  });
  return async () => {
    await expect.poll(() => pending.size).toBe(0);
    await page.evaluate(() => {}); // Flush the observer bindings after the native action.
    const expectedCancellations = [], unexpectedFailures = [];
    for (const [request, record] of requests) {
      if (record.outcome !== 'failed') continue;
      const matches = [...disposals.entries()].filter(([, disposal]) => {
        const { before, after } = disposal;
        return disposal.request === request && record.error === 'net::ERR_ABORTED'
          && /^\/barb\/src\/assets\/fish\/[\w-]+\.png$/.test(new URL(record.url).pathname)
          && before.complete === false && before.connected && before.transition.trusted
          && /at Object\.dispose \([^\n]*\/src\/ui\/fish-image-loader\.js:\d+:\d+\)/.test(before.stack)
          && /at (render|finishClose) \([^\n]*\/src\/ui\/collection-menu\.js:\d+:\d+\)/.test(before.stack)
          && after?.src === null && ((!after.connected && after.dialogOpen && after.title !== before.title)
            || (before.transition.trigger === 'collection-close' && !after.dialogOpen));
      });
      if (matches.length === 1) expectedCancellations.push({ ...record, disposalKey: matches[0][0] });
      else unexpectedFailures.push(record);
    }
    return { requests: [...requests.values()], expectedCancellations, unexpectedFailures,
      disposals: [...disposals].map(([key, { request, ...record }]) => ({ key, requestId: requests.get(request)?.id ?? null, ...record })) };
  };
}

test('collection image audit identifies native dispose cancellation and subsequent production decode', async ({ createContext }, testInfo) => {
  const context = await createContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  const audit = await observeCollectionImageRequests(page);
  await openUIFixture(page, allSpeciesLegacySave());
  let release, started;
  const gate = new Promise(resolve => { release = resolve; }), requested = new Promise(resolve => { started = resolve; });
  let first = true;
  await page.route('**/barb/src/assets/fish/black-bass.png', async route => {
    if (first) { first = false; started(); await gate; }
    await route.fallback();
  });
  await page.locator('#menu-button').tap(); await page.locator('[data-view="encyclopedia"]').tap();
  await requested;
  const failed = page.waitForEvent('requestfailed', request => request.url().endsWith('/black-bass.png'));
  await page.locator('button.fish-card').nth(2).tap();
  expect((await failed).failure()?.errorText).toBe('net::ERR_ABORTED');
  release();
  await checkProductionImage(page.locator('.fish-detail img'), FISH_SPECIES[2]);
  await page.locator('#collection-back').tap();
  await checkProductionImage(page.locator('button.fish-card img').first(), BLACK_BASS, { inspectPixels: true });
  const report = await audit();
  const path = testInfo.outputPath('image-request-audit.json');
  await writeFile(path, JSON.stringify(report, null, 2));
  await testInfo.attach('image-request-audit', { path, contentType: 'application/json' });
  expect(report.unexpectedFailures).toEqual([]);
  expect(report.expectedCancellations).toHaveLength(1);
  expect(report.expectedCancellations[0].url).toMatch(/\/black-bass\.png$/);
});

for (const error of ['aborted', 'failed']) {
  test(`collection image audit rejects an active image network ${error}`, async ({ page }) => {
    const audit = await observeCollectionImageRequests(page);
    await openUIFixture(page, allSpeciesLegacySave());
    await page.route('**/barb/src/assets/fish/black-bass.png', route => route.abort(error));
    const failed = page.waitForEvent('requestfailed', request => request.url().endsWith('/black-bass.png'));
    await page.locator('#menu-button').click(); await page.locator('[data-view="encyclopedia"]').click();
    const request = await failed;
    await expect(page.locator('button.fish-card img').first()).toHaveJSProperty('complete', true);
    expect(await page.locator('button.fish-card img').first().evaluate(image => image.decode().then(() => true, () => false))).toBe(false);
    const report = await audit();
    expect(report.expectedCancellations).toEqual([]);
    expect(report.unexpectedFailures).toEqual([{ id: 1, url: request.url(), outcome: 'failed', error: request.failure().errorText }]);
  });
}

for (const { label, viewport, touch } of artworkViewports) {
  test(`${label}: twelve production PNGs decode and agree in legacy grid, detail, storage and catches`, async ({ createContext }, testInfo) => {
    const context = await createContext({ viewport, hasTouch: touch, isMobile: touch });
    const page = await context.newPage(), errors = [], imageResponses = [], pendingResponses = [];
    const imageRequestAudit = await observeCollectionImageRequests(page);
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => {
      if (/\/src\/assets\/fish\/[\w-]+\.png$/.test(new URL(response.url()).pathname)) {
        pendingResponses.push(response.body().then(body => imageResponses.push({ url: response.url(), status: response.status(), bytes: body.length })));
      }
    });
    await page.addInitScript(() => { Math.random = () => window.artworkRoll ?? 0; });
    const click = locator => touch ? locator.tap() : locator.click();
    await openUIFixture(page, allSpeciesLegacySave());
    expect(imageResponses).toEqual([]);
    expect(await page.evaluate(() => fixture.restored.collection.catches.every(record => record.schemaVersion === 1 && !('image' in record) && !('imageUrl' in record)))).toBe(true);
    await click(page.locator('#menu-button')); await click(page.locator('[data-view="encyclopedia"]'));
    await expect(page.locator('button.fish-card')).toHaveCount(12);
    await expect(page.locator('div.fish-card')).toHaveCount(0);
    const gridImages = new Map(), decoded = [];
    // Compare resolved layout sizes exactly: viewport-relative DOMRects lose
    // floating-point precision when the scroll position changes.
    const framesBefore = await page.locator('.fish-card .fish-image-frame').evaluateAll(nodes => nodes.map(node => ({ width: getComputedStyle(node).width, height: getComputedStyle(node).height })));
    for (const [index, fish] of FISH_SPECIES.entries()) {
      const state = await checkProductionImage(page.locator('button.fish-card img').nth(index), fish, { inspectPixels: true });
      // A fish is promoted from deferred/lazy to eager only when its frame
      // enters the pane. fish-image-loading.spec verifies the initial boundary
      // and request concurrency before any scrolling or completed downloads.
      expect(state.loading).toBe('eager'); gridImages.set(fish.id, state.src); decoded.push({ speciesId: fish.id, ...state });
    }
    expect(new Set(decoded.map(image => image.src)).size).toBe(12);
    expect(new Set(decoded.map(image => image.decodedSha256)).size).toBe(12);
    expect(await page.locator('.fish-card .fish-image-frame').evaluateAll(nodes => nodes.map(node => ({ width: getComputedStyle(node).width, height: getComputedStyle(node).height })))).toEqual(framesBefore);
    await page.locator('.fish-card').first().scrollIntoViewIfNeeded();
    await page.locator('#collection-dialog').screenshot({ path: testInfo.outputPath(`${label}-encyclopedia.png`) });
    await Promise.all(pendingResponses);
    const gridLoading = [...imageResponses];
    expect(new Set(gridLoading.map(response => response.url)).size).toBe(12);
    expect(gridLoading.every(response => response.status === 200)).toBe(true);
    for (const [index, fish] of FISH_SPECIES.entries()) {
      await click(page.locator('button.fish-card').nth(index));
      const detail = await checkProductionImage(page.locator('.fish-detail img'), fish);
      expect(detail.src).toBe(gridImages.get(fish.id)); expect(detail.loading).toBe('eager');
      await expect(page.locator('.fish-description')).toHaveText(fish.description);
      if (['black-bass', 'bluegill', 'northern-pike'].includes(fish.id)) {
        await page.locator('#collection-dialog').screenshot({ path: testInfo.outputPath(`${label}-detail-${fish.id}.png`) });
      }
      await click(page.locator('#collection-back'));
    }
    await click(page.locator('#collection-back')); await click(page.locator('[data-view="storage"]'));
    await expect(page.locator('.stored-fish')).toHaveCount(12);
    for (const fish of FISH_SPECIES) {
      const state = await checkProductionImage(page.locator(`[data-catch-id="legacy-${fish.id}"] img`), fish);
      expect(state.src).toBe(gridImages.get(fish.id)); expect(state.loading).toBe('eager');
    }
    await page.locator('.stored-fish').first().scrollIntoViewIfNeeded();
    await page.locator('#collection-dialog').screenshot({ path: testInfo.outputPath(`${label}-storage.png`) });
    await click(page.locator('#collection-close'));
    // Exercise the real fishing domain transitions for all twelve species. RNG
    // selects a probability interval; catches/phases are never assigned by tests.
    for (const fish of FISH_SPECIES) {
      const caught = await page.evaluate(async speciesId => {
        const { getSpeciesProbabilities } = await import('/barb/src/game/fish-encounters.js');
        const fishing = fixture.fishing;
        fixture.fishingHUD.update(fishing, true, { timeOfDay: 'day', cycleProgress: 0 });
        window.artworkRoll = 0;
        fishing.prepare({ x: 0, z: 30 }, 0); fishing.aim(0, 180); fishing.cast();
        for (let i = 0; i < 120 && fishing.state.phase === 'cast'; i++) fishing.step(1 / 60);
        const entries = getSpeciesProbabilities(fishing.state.lureId, fishing.getConditions());
        const index = entries.findIndex(entry => entry.speciesId === speciesId);
        window.artworkRoll = entries.slice(0, index).reduce((sum, entry) => sum + entry.probability, 0) + entries[index].probability / 2;
        for (let i = 0; i < 1000 && fishing.state.phase === 'lure'; i++) fishing.step(1 / 60);
        fishing.hook();
        for (let i = 0; i < 1800 && fishing.state.phase === 'fight'; i++) {
          fishing.reel(fishing.state.tension < 0.65); fishing.step(1 / 60);
        }
        fishing.step(2);
        fixture.fishingHUD.update(fishing, true, { timeOfDay: 'day', cycleProgress: 0 });
        return { phase: fishing.state.phase, speciesId: fishing.state.catch?.speciesId };
      }, fish.id);
      expect(caught).toEqual({ phase: 'result', speciesId: fish.id });
      const catchImage = await checkProductionImage(page.locator('#catch-image'), fish);
      expect(catchImage.src).toBe(gridImages.get(fish.id));
      if (['black-bass', 'bluegill', 'northern-pike'].includes(fish.id)) {
        await page.locator('#catch-dialog').screenshot({ path: testInfo.outputPath(`${label}-catch-${fish.id}.png`) });
      }
      await click(page.locator('#close-catch'));
      await expect(page.locator('#catch-dialog')).toBeHidden();
    }
    await page.reload(); await page.waitForFunction(() => Boolean(window.fixture));
    await click(page.locator('#menu-button')); await click(page.locator('[data-view="storage"]'));
    for (const fish of FISH_SPECIES) {
      const state = await checkProductionImage(page.locator(`[data-catch-id="legacy-${fish.id}"] img`), fish);
      expect(state.src).toBe(gridImages.get(fish.id));
    }
    const imageRequests = await imageRequestAudit();
    errors.push(...imageRequests.unexpectedFailures.map(({ url, error }) => `${url}: ${error}`));
    const report = { scope: 'real UI/domain modules with schema-v1 restored save; complete encyclopedia after scrolling every lazy card; original production PNGs, no HTTP compression', viewport,
      initialFishPngCount: 0, gridLoadedImages: gridLoading,
      gridImageBytes: gridLoading.reduce((sum, response) => sum + response.bytes, 0),
      decodedImages: decoded, imageErrors: errors, imageRequests };
    const path = testInfo.outputPath(`${label}-image-loading.json`);
    await writeFile(path, JSON.stringify(report, null, 2));
    await testInfo.attach(`${label}-image-loading`, { path, contentType: 'application/json' });
    expect(errors).toEqual([]);
    if (label === 'desktop') {
      const reviewContext = await createContext({ viewport: { width: 1280, height: 800 } });
      const reviewDirectory = testInfo.outputPath('artwork-review');
      await generateFishArtworkReport({ outputDirectory: reviewDirectory, page: await reviewContext.newPage() });
      for (const name of ['contact-sheet.png', 'prototype-comparison.png', 'artwork-quality.json', 'artwork-quality.md']) {
        await testInfo.attach(name, { path: join(reviewDirectory, name), contentType: name.endsWith('.png') ? 'image/png' : name.endsWith('.json') ? 'application/json' : 'text/markdown' });
      }
    }
  });
}
