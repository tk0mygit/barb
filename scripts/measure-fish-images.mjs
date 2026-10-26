// Local image-only measurement: real HTTP transfers and the production UI/domain
// modules, without software WebGL competing for the measurement browser's CPU.
// --ref serves tracked source directly from that Git commit (no extra checkout).
import { createServer } from 'node:http';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { biteFish, landFish } from '../tests/browser/fish-image-driver.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const ref = option('--ref', null), trials = Number(option('--trials', '5'));
const output = resolve(option('--output', 'test-results/fish-image-performance.json'));
const source = path => ref ? execFileSync('git', ['show', `${ref}:${path}`], { cwd: root }) : readFileSync(resolve(root, path));
const init = `
  import { createCatchCollection } from './src/game/catch-collection.js';
  import { createFishing } from './src/game/fishing.js';
  import { createFishingHUD } from './src/ui/fishing-hud.js';
  import { createCollectionMenu } from './src/ui/collection-menu.js';
  import { createAchievements } from './src/game/achievements.js';
  import { FISH_SPECIES, calculateFishWeightKg } from './src/game/fish-species.js';
  Math.random = () => window.imageRoll ?? 0;
  const collection = createCatchCollection(), fishing = createFishing({ collection });
  for (const fish of FISH_SPECIES) {
    const lengthCm = fish.weight.referenceLengthCm;
    collection.register({ schemaVersion: 1, id: 'seed-' + fish.id, speciesId: fish.id,
      lengthCm, weightKg: calculateFishWeightKg(fish.id, lengthCm), caughtAt: '2026-01-01T00:00:00Z' });
    collection.store('seed-' + fish.id);
  }
  const fixture = window.fixture = { collection, fishing };
  fixture.fishingHUD = createFishingHUD({ onPrepare() {}, onCancel() {}, onClose: () => fishing.closeResult(),
    onSell: () => fishing.sellResult(), onSelectLure: id => fishing.selectLure(id) });
  fixture.menu = createCollectionMenu({ collection, achievements: createAchievements({ collection }),
    canOpen: () => true, canPurchase: () => true, onOpenChange() {}, onSale() {}, onUpgrade() {} });
  fixture.menu.update(); document.querySelector('#status').hidden = true;
`;
const html = source('index.html').toString().replace('<script type="module" src="/src/main.js"></script>',
  `<link rel="stylesheet" href="./src/ui/style.css"><script type="module">${init}</script>`);
const files = new Map([['index.html', Buffer.from(html)]]);
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname.replace(/^\/barb\//, '') || 'index.html';
  if (path.includes('..') || (!path.startsWith('src/') && path !== 'index.html')) { res.writeHead(404).end(); return; }
  try {
    if (!files.has(path)) files.set(path, source(path));
    const body = files.get(path);
    const type = path.endsWith('.png') ? 'image/png' : path.endsWith('.svg') ? 'image/svg+xml'
      : path.endsWith('.css') ? 'text/css' : path.endsWith('.js') ? 'text/javascript' : 'text/html';
    res.writeHead(200, { 'content-type': type, 'content-length': body.length, 'cache-control': 'public, max-age=3600' }); res.end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/barb/`;
const browser = await chromium.launch({ ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
const rows = [];

async function observe(page, selector, start) {
  // Observe decoded, visible image at each rAF. This is a paint opportunity;
  // the separately timed composited screenshot below is the pixel confirmation.
  const readyAt = await page.evaluate(selector => new Promise((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error(`Image did not become visible: ${selector}`)), 15000);
    const check = () => {
      const image = document.querySelector(selector);
      if (image?.complete && image.naturalWidth && getComputedStyle(image).display !== 'none') {
        image.decode().then(() => requestAnimationFrame(() => { clearTimeout(deadline); resolve(performance.now()); }), () => requestAnimationFrame(check));
      } else requestAnimationFrame(check);
    }; requestAnimationFrame(check);
  }), selector);
  const frame = page.locator(selector).first().locator('..');
  const screenshot = await frame.screenshot();
  const confirmedAt = await page.evaluate(() => performance.now());
  const pixels = await page.evaluate(async ({ selector, base64 }) => {
    const actual = new Image(); actual.src = `data:image/png;base64,${base64}`; await actual.decode();
    const canvas = document.createElement('canvas'); canvas.width = actual.width; canvas.height = actual.height;
    const ctx = canvas.getContext('2d'); ctx.drawImage(actual, 0, 0);
    const shot = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    // A production fish must contribute opaque, non-background pixels in the
    // central area. Keep the screenshot as reviewable evidence too.
    let fishPixels = 0;
    for (let y = Math.floor(canvas.height * .3); y < canvas.height * .7; y++) {
      for (let x = Math.floor(canvas.width * .3); x < canvas.width * .7; x++) {
        const i = (y * canvas.width + x) * 4;
        if (Math.abs(shot[i] - 206) + Math.abs(shot[i + 1] - 213) + Math.abs(shot[i + 2] - 182) > 60) fishPixels++;
      }
    }
    const image = document.querySelector(selector), src = image.currentSrc;
    const transfers = performance.getEntriesByType('resource').filter(entry => entry.name === src);
    const transfer = transfers.at(-1);
    return { fishPixels, src, transfer: transfer ? { startMs: transfer.startTime, endMs: transfer.responseEnd,
      durationMs: transfer.duration, transferBytes: transfer.transferSize, encodedBytes: transfer.encodedBodySize } : null };
  }, { selector, base64: screenshot.toString('base64') });
  if (!pixels.fishPixels) throw new Error(`Screenshot did not show a fish: ${selector}`);
  return { paintOpportunityMs: readyAt - start, screenshotConfirmedMs: confirmedAt - start,
    responseEndRelativeMs: pixels.transfer ? pixels.transfer.endMs - start : null,
    ...pixels, screenshot };
}
try {
  for (const surface of ['RESULT', 'encyclopedia', 'storage']) for (let trial = 1; trial <= trials; trial++) {
    const context = await browser.newContext({ viewport: { width: 1000, height: 700 }, deviceScaleFactor: 1 });
    try {
      const page = await context.newPage(); await page.goto(url); await page.waitForFunction(() => Boolean(window.fixture));
      const cdp = await context.newCDPSession(page); await cdp.send('Network.enable');
      await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150,
        downloadThroughput: 1024 * 1024, uploadThroughput: 1024 * 1024, connectionType: 'cellular3g' });
      for (const temperature of ['cold', 'warm']) {
        let start, biteAt;
        if (surface === 'RESULT') {
          const bite = await biteFish(page); biteAt = bite.at;
          // A defined one-second lead models time spent fighting after BITE.
          // It is a measurement input, not a sleep used to pass an assertion.
          await page.evaluate(start => new Promise(resolve => {
            const frame = now => now - start >= 1000 ? resolve() : requestAnimationFrame(frame);
            requestAnimationFrame(frame);
          }), biteAt);
          start = (await landFish(page)).at;
        } else {
          await page.locator('#menu-button').click();
          start = await page.locator(`[data-view="${surface}"]`).evaluate(button => { const at = performance.now(); button.click(); return at; });
        }
        const selector = surface === 'RESULT' ? '#catch-image' : surface === 'encyclopedia' ? '.fish-card img' : '.stored-fish img';
        const result = await observe(page, selector, start);
        const screenshotPath = `${surface}-${trial}-${temperature}.png`;
        mkdirSync(dirname(output), { recursive: true }); writeFileSync(resolve(dirname(output), screenshotPath), result.screenshot);
        delete result.screenshot;
        const imageResources = await page.evaluate(() => performance.getEntriesByType('resource').filter(entry => /\/fish\/.+\.png$/.test(entry.name))
          .map(entry => ({ name: entry.name, startMs: entry.startTime, endMs: entry.responseEnd, transferBytes: entry.transferSize })));
        const reusedTransfer = result.transfer.startMs < (biteAt ?? start);
        rows.push({ surface, trial, temperature, start, biteAt, ...result, reusedTransfer, screenshotPath, imageResources });
        console.log(`${surface} ${trial} ${temperature}: paint ${result.paintOpportunityMs.toFixed(1)}ms, screenshot ${result.screenshotConfirmedMs.toFixed(1)}ms`);
        if (surface === 'RESULT') await page.locator('#close-catch').click();
        else await page.locator('#collection-close').click();
      }
    } finally { await context.close(); }
  }
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const summary = [];
for (const surface of ['RESULT', 'encyclopedia', 'storage']) for (const temperature of ['cold', 'warm']) {
  const selected = rows.filter(row => row.surface === surface && row.temperature === temperature);
  summary.push({ surface, temperature, trials: selected.length,
    paintMedianMs: median(selected.map(row => row.paintOpportunityMs)), paintMaxMs: Math.max(...selected.map(row => row.paintOpportunityMs)),
    screenshotMedianMs: median(selected.map(row => row.screenshotConfirmedMs)), screenshotMaxMs: Math.max(...selected.map(row => row.screenshotConfirmedMs)),
    transferMedianMs: median(selected.map(row => row.reusedTransfer ? 0 : row.transfer.durationMs)), transferMaxMs: Math.max(...selected.map(row => row.reusedTransfer ? 0 : row.transfer.durationMs)) });
}
writeFileSync(output, JSON.stringify({ ref: ref ?? 'working tree', chromium: browser.version(), viewport: '1000x700 DPR1',
  network: { latencyMs: 150, downloadBytesPerSecond: 1048576, uploadBytesPerSecond: 1048576 }, resultBiteLeadMs: 1000,
  scope: 'HTTP source-module fixture, production PNGs and real domain APIs; no WebGL; warm uses same context with HTTP and decoded caches; rAF is paint opportunity, screenshot is pixel confirmation upper bound',
  summary, rows }, null, 2));
console.log(JSON.stringify(summary, null, 2));
