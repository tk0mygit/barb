import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import { FISH_SPECIES } from '../src/game/fish-species.js';
import { validateFishImage } from './lib/fish-image-validation.js';
import { measureArtworkAlpha, assertArtworkAlpha } from './lib/fish-artwork-alpha.js';
import { ORIGINAL_FISH_SPECIES_IDS } from '../src/game/fish-roster.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const escapeHTML = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');

async function filesBelow(directory) {
  const files = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, item.name);
    if (item.isDirectory()) files.push(...await filesBelow(path));
    else files.push({ path: relative(root, path), bytes: await readFile(path) });
  }
  return files;
}

function metadata(bytes) {
  const chunks = [];
  for (let offset = 8; offset < bytes.length;) {
    const length = bytes.readUInt32BE(offset), type = bytes.toString('ascii', offset + 4, offset + 8);
    chunks.push({ type, data: bytes.subarray(offset + 8, offset + 8 + length) });
    offset += length + 12;
  }
  const srgb = chunks.find(chunk => chunk.type === 'sRGB');
  assert.ok(srgb && srgb.data.length === 1 && srgb.data[0] <= 3, 'Artwork must declare sRGB');
  return { chunks: chunks.map(chunk => chunk.type), colorSpace: 'sRGB', interlace: bytes[28] };
}

async function renderSheet(page, entries, destination, columns, title) {
  await page.setViewportSize({ width: columns * 640 + 48, height: Math.ceil(entries.length / columns) * 342 + 112 });
  await page.setContent(`<!doctype html><html lang="ja"><meta charset="utf-8"><style>
    *{box-sizing:border-box}body{margin:0;padding:24px;background:#dce2dc;color:#243731;font:18px system-ui,sans-serif}
    h1{font-size:26px;margin:0 0 7px}p{font-size:14px;margin:0 0 18px;color:#40554b}
    .grid{display:grid;grid-template-columns:repeat(${columns},640px);gap:12px 0}
    figure{margin:0;height:330px;padding:0 8px}img{display:block;width:624px;height:273px;object-fit:contain}
    figcaption{padding:3px 16px;font-size:19px}small{display:block;font-size:14px;color:#4a5c53;margin-top:3px}
    </style><h1>${escapeHTML(title)}</h1><p>AI-generated artwork · original 12 and approved Phase 6-A 8 · human morphology review is separate from automatic validation</p>
    <div class="grid">${entries.map(entry => `<figure><img src="${entry.dataURI}"><figcaption>${escapeHTML(entry.name)}<small>${entry.id}</small></figcaption></figure>`).join('')}</div></html>`);
  await page.locator('img').evaluateAll(images => Promise.all(images.map(image => image.decode())));
  await page.screenshot({ path: destination, fullPage: true });
}

// Reusable from the production artwork browser test so Actions' existing
// test-results upload retains the exact source images' review artifacts.
export async function generateFishArtworkReport({ outputDirectory = join(root, 'test-results/fish-artwork-review'), browser, page: suppliedPage } = {}) {
  outputDirectory = resolve(outputDirectory);
  await mkdir(outputDirectory, { recursive: true });
  const approved = JSON.parse(await readFile(join(root, 'docs/artwork/phase6/approved-6a.json'), 'utf8'));
  const entries = await Promise.all(FISH_SPECIES.map(async fish => {
    const path = `src/assets/fish/${fish.id}.png`, bytes = await readFile(join(root, path));
    const format = validateFishImage(path, bytes), png = metadata(bytes);
    assert.deepEqual(format, { format: 'png', width: 1280, height: 560, bitDepth: 8, colorType: 6, transparent: true }, path);
    assert.equal(png.interlace, 0, `${path}: non-interlaced`);
    assert.ok(bytes.length <= 800 * 1024, `${path}: exceeds 800 KiB`);
    return { id: fish.id, name: fish.name, path, bytes: bytes.length, sha256: sha256(bytes), ...format, ...png,
      productionMethod: ORIGINAL_FISH_SPECIES_IDS.includes(fish.id)
        ? 'Original twelve AI-generated illustrations; previously normalized/padded PNGs, unchanged in Phase 6-A'
        : 'Phase 6-A approved AI-generated PNG; copied byte-for-byte, no alpha adjustment, resize or re-encoding',
      dataURI: `data:image/png;base64,${bytes.toString('base64')}` };
  }));
  assert.equal(entries.length, 20);
  assert.deepEqual(entries.slice(12).map(entry => entry.id), approved.images.map(entry => entry.speciesId));
  for (const row of approved.images) {
    const entry = entries.find(entry => entry.id === row.speciesId);
    assert.equal(entry.sha256, row.sha256, row.speciesId); assert.equal(entry.bytes, row.bytes, row.speciesId);
  }
  assert.equal(new Set(entries.map(entry => entry.sha256)).size, 20, 'All artworks must differ');
  const totalImageBytes = entries.reduce((total, entry) => total + entry.bytes, 0);
  assert.equal(totalImageBytes, 11012560, 'Exact approved twenty-image total');
  assert.ok(totalImageBytes <= 20 * 1024 * 1024, 'Phase 6 artwork review threshold');

  let ownedBrowser;
  if (!browser && !suppliedPage) {
    ownedBrowser = await chromium.launch({ ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
    browser = ownedBrowser;
  }
  const context = suppliedPage ? undefined : await browser.newContext({ deviceScaleFactor: 1 });
  try {
    const page = suppliedPage ?? await context.newPage();
    await page.addScriptTag({ content: measureArtworkAlpha.toString() });
    for (const entry of entries) {
      const decoded = await page.evaluate(async dataURI => {
        const image = new Image(); image.src = dataURI; await image.decode();
        const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
        const ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.drawImage(image, 0, 0);
        const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height), width = canvas.width, height = canvas.height;
        return window.measureArtworkAlpha(data, width, height);
      }, entry.dataURI);
      assertArtworkAlpha(decoded, { legacy: ORIGINAL_FISH_SPECIES_IDS.includes(entry.id), id: entry.id });
      assert.equal(decoded.decodedWidth, entry.width); assert.equal(decoded.decodedHeight, entry.height);
      Object.assign(entry, decoded);
    }
    await renderSheet(page, entries, join(outputDirectory, 'contact-sheet.png'), 3, 'BARB · Phase 6-A · 20 fish artworks');
    await renderSheet(page, entries.filter(entry => ['black-bass', 'bluegill'].includes(entry.id)),
      join(outputDirectory, 'prototype-comparison.png'), 2, 'BARB · Largemouth bass / Bluegill · Style comparison');
  } finally {
    if (context) await context.close();
    if (ownedBrowser) await ownedBrowser.close();
  }

  const builtFiles = await filesBelow(join(root, 'dist'));
  const assets = builtFiles.filter(file => file.path.startsWith('dist/assets/'));
  for (const entry of entries) {
    const built = assets.find(file => sha256(file.bytes) === entry.sha256);
    assert.ok(built, `${entry.id}: exact production PNG missing from build`);
    entry.builtPath = built.path;
  }
  const builtPNGs = assets.filter(file => file.path.endsWith('.png'));
  assert.equal(builtPNGs.length, 20, 'Only the twenty production fish PNGs are emitted');
  assert.ok(builtPNGs.every(file => entries.some(entry => entry.sha256 === sha256(file.bytes))), 'Unapproved PNG in production');
  assert.ok(!builtFiles.some(file => /\.zip$/i.test(file.path)), 'Source ZIP in production');
  const fixture = await readFile(join(root, 'tests/fixtures/fish-assets/transparent-test.png'));
  assert.ok(!builtFiles.some(file => sha256(file.bytes) === sha256(fixture)
    || /(?:transparent-test|fish-assets-fixture)/.test(file.path)
    || file.bytes.includes(Buffer.from(fixture.toString('base64')))), 'Test PNG leaked into production build');
  const report = {
    totalImageBytes, totalImageMiB: totalImageBytes / 1024 ** 2,
    buildAssetBytes: assets.reduce((total, file) => total + file.bytes.length, 0),
    buildTotalBytes: builtFiles.reduce((total, file) => total + file.bytes.length, 0),
    buildAssetCount: assets.length, testFixtureInProduction: false,
    validation: 'Structural PNG validation and Chromium decoding; eight-pixel clear margins, original opaque checks and Phase 6-A near-opaque body/soft-contour checks. Visual approval is a separate human/PM review.',
    images: entries.map(({ dataURI, ...entry }) => entry),
  };
  await writeFile(join(outputDirectory, 'artwork-quality.json'), JSON.stringify(report, null, 2) + '\n');
  await writeFile(join(outputDirectory, 'artwork-quality.md'), `# BARB Phase 6-A artwork quality\n\n` +
    `AI-generated illustrations: original twelve previously normalized PNGs retained unchanged; eight approved Phase 6-A PNGs copied without processing. Public SHA ledger: docs/artwork/phase6/approved-6a.json. Morphology approval and applicable service/license terms require separate review.\n\n` +
    `20 PNG total: ${totalImageBytes.toLocaleString('en-US')} bytes (${report.totalImageMiB.toFixed(3)} MiB). ` +
    `Build assets: ${report.buildAssetBytes.toLocaleString('en-US')} bytes; all dist files: ${report.buildTotalBytes.toLocaleString('en-US')} bytes.\n\n` +
    `All images: 1280×560, PNG RGBA8, non-interlaced, sRGB; decoded successfully. All outer-border pixels have alpha=0. Test PNG absent from production.\n\n` +
    `| Fish | ID | Bytes | Transparent | Partial alpha | Opaque | Near opaque ≥250 | Soft contour | Margin errors |\n| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |\n` +
    report.images.map(entry => `| ${entry.name} | ${entry.id} | ${entry.bytes} | ${entry.transparentPixels} | ${entry.partialAlphaPixels} | ${entry.opaquePixels} | ${entry.nearOpaquePixels} | ${entry.softEdgePixels} | ${entry.nontransparentBorderPixels} |`).join('\n') +
    `\n\nContact sheet: [contact-sheet.png](contact-sheet.png). Prototype comparison: [prototype-comparison.png](prototype-comparison.png). ` +
    `SHA256, nontransparent bounds, PNG chunks and built asset paths: [artwork-quality.json](artwork-quality.json).\n\n` +
    `These automatic checks do not establish anatomical or artistic quality. Inspect every image and the UI captures before approval.\n`);
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const report = await generateFishArtworkReport({ outputDirectory: process.argv[2] });
  console.log(JSON.stringify({ images: report.images.length, totalImageBytes: report.totalImageBytes,
    buildAssetBytes: report.buildAssetBytes, outputDirectory: resolve(process.argv[2] ?? 'test-results/fish-artwork-review') }, null, 2));
}
