import { test, expect } from './diagnostics-fixture.js';
import { openUIFixture } from './ui-fixture.js';
import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { build } from 'vite';
import { fishSpeciesSandbox } from '../helpers/fish-species-sandbox.js';
import { FISH_SPECIES, BLACK_BASS } from '../../src/game/fish-species.js';
import { createCatchCollection } from '../../src/game/catch-collection.js';
import { createAchievements } from '../../src/game/achievements.js';
import { createBoatState } from '../../src/game/boat.js';
import { createGameClock } from '../../src/game/game-clock.js';
import { createSaveData } from '../../src/game/save-data.js';

const png = readFileSync(new URL('../fixtures/fish-assets/transparent-test.png', import.meta.url));
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
    await openUIFixture(page, legacySave(), { pngFishImage: pngImage });
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
  const sandbox = await fishSpeciesSandbox(null, { png: true });
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
