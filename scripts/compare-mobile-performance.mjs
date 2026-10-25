import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { HISTORICAL_MOBILE_BASE, readMobileImplementation, mobileSourceMetadata } from './lib/mobile-comparison-source.js';

export const MOBILE_COMPARISON_MODES = ['regression', 'historical-improvement'];
export const MOBILE_CAPTURE_IDS = [
  ...['portrait', 'landscape', 'small', 'pc', 'pc-hidpi'].flatMap(profile =>
    ['day-tps', 'day-fps', 'clear-night', 'fog-night', 'dense-night'].map(scene => `${profile}-${scene}`)),
  ...['portrait', 'landscape', 'small', 'pc'].flatMap(profile => [`${profile}-bite`, `${profile}-fight`]),
  'rotated-fight',
];
const separated = (a, b, margin) => a.right + margin <= b.left || b.right + margin <= a.left
  || a.bottom + margin <= b.top || b.bottom + margin <= a.top;

function checkLayout(s, id) {
  assert(s, `${id}: missing HUD layout`);
  const p = s.panel;
  assert(p.left >= 8 && p.top >= 8 && p.right <= s.viewport.width - 8 && p.bottom <= s.viewport.height - 8, `${id}: HUD outside viewport`);
  assert.equal(s.occupancy, p.width * p.height / (s.viewport.width * s.viewport.height) * 100, `${id}: HUD occupancy`);
  assert(separated(p, s.reticle, 12), `${id}: HUD overlaps reticle`);
  for (const r of [...s.buttons, s.header, ...s.notices]) assert(separated(p, r, 8), `${id}: HUD overlaps controls/header/notices`);
  assert.equal(s.pointerEvents, 'none', `${id}: HUD blocks input`);
  assert.equal(s.hit, 'scene', `${id}: HUD hit target`);
  assert.equal(s.scrollWidth, s.viewport.width, `${id}: horizontal overflow`);
}

export function compareMobileCaptures(before, after, metadata) {
  assert(MOBILE_COMPARISON_MODES.includes(metadata.mode), 'Unknown mobile comparison mode');
  for (const key of ['baseSha', 'headSha', 'validationSha']) assert.match(metadata[key] ?? '', /^[a-f0-9]{40}$/, `Missing ${key}`);
  if (metadata.mode === 'historical-improvement') {
    assert.equal(metadata.baseSha, HISTORICAL_MOBILE_BASE, 'Historical comparison requires the explicit pre-4C-2A SHA');
    assert.equal(metadata.implementations.main.resolutionModel, 'legacy-1.75');
    assert.equal(metadata.implementations.pr.resolutionModel, 'mobile-budget');
  }
  assert.equal(before.length, 34, 'Expected all 25 render and 9 HUD captures');
  assert.equal(before.length, after.length);
  for (const entries of [before, after]) assert.deepEqual(entries.map(c => c.id).sort(), [...MOBILE_CAPTURE_IDS].sort(), 'Missing/duplicate mobile capture');
  return before.map(b => {
    const a = after.find(a => a.id === b.id);
    assert(a, `Missing comparison ${b.id}`);
    for (const entry of [b, a]) {
      if (entry.comparison) assert.deepEqual(entry.comparison, metadata, `${b.id}: mixed comparison provenance`);
      const m = entry.metrics;
      assert.deepEqual(m.buffer, { width: Math.floor(m.viewport.width * m.pixelRatio), height: Math.floor(m.viewport.height * m.pixelRatio) }, `${b.id}: drawing buffer dimensions`);
      assert.equal(m.pixels, m.buffer.width * m.buffer.height, `${b.id}: drawing buffer pixels`);
    }
    for (const key of ['viewport', 'dpr', 'savedClockSeconds', 'boat', 'waterTime', 'fogStrength', 'camera']) {
      assert.deepEqual(a.metrics[key], b.metrics[key], `${b.id}: ${key} differs`);
    }
    assert.deepEqual(a.metrics.resources, b.metrics.resources, `${b.id}: resource regression`);
    const pixelReduction = (1 - a.metrics.pixels / b.metrics.pixels) * 100;
    if (metadata.mode === 'regression') {
      // With unchanged rendering, both increasing cost and reducing quality
      // are regressions. Do not let equal *area* hide different dimensions.
      assert.equal(a.metrics.pixelRatio, b.metrics.pixelRatio, `${b.id}: pixel ratio regression`);
      assert.deepEqual(a.metrics.buffer, b.metrics.buffer, `${b.id}: drawing buffer regression`);
      assert.equal(a.metrics.pixels, b.metrics.pixels, `${b.id}: pixel regression`);
    } else if (!b.id.startsWith('pc')) assert(pixelReduction >= 20, `${b.id}: historical mobile pixel reduction`);
    else assert.equal(a.metrics.pixels, b.metrics.pixels, `${b.id}: desktop pixels`);
    if (/-bite$|-fight$/.test(b.id)) {
      checkLayout(a.layout, b.id);
      if (metadata.mode === 'regression') {
        checkLayout(b.layout, b.id);
        for (const key of ['viewport', 'panel', 'occupancy', 'reticle', 'meter', 'buttons', 'header', 'notices', 'scrollWidth']) {
          assert.deepEqual(a.layout[key], b.layout[key], `${b.id}: HUD ${key} regression`);
        }
      } else if (b.id.endsWith('fight') && !b.id.startsWith('pc')) {
        assert(a.layout.occupancy < b.layout.occupancy, `${b.id}: historical HUD area did not shrink`);
      }
    }
    return { id: b.id, before: b.metrics, after: a.metrics,
      pixelReduction,
      ...(b.layout ? { beforeLayout: b.layout, afterLayout: a.layout } : {}) };
  });
}

export async function writeMobileComparison(before, after, output, metadata = before[0]?.comparison) {
  assert(metadata, 'Comparison mode and source SHAs are required (old captures need explicit CLI arguments)');
  const rows = compareMobileCaptures(before, after, metadata);
  // Re-verify the recorded source SHAs when combining separately collected
  // JSON as well as when called directly from the E2E spec.
  for (const [target, sha] of [['main', metadata.baseSha], ['pr', metadata.validationSha]]) {
    const source = mobileSourceMetadata(await readMobileImplementation(sha));
    assert.deepEqual(metadata.implementations[target], source, `${target}: implementation provenance differs`);
  }
  const images = await Promise.all(before.map(async b => {
    const a = after.find(a => a.id === b.id);
    assert(b.image && a.image, `${b.id}: missing comparison image`);
    return [await readFile(b.image), await readFile(a.image)];
  }));
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output.replace(/\.html$/, '.json'), JSON.stringify({ metadata, rows }, null, 2));
  const figures = rows.map((r, index) => `<article id="${r.id}"><h2>${r.id}</h2><p>buffer ${r.before.buffer.width}×${r.before.buffer.height} → ${r.after.buffer.width}×${r.after.buffer.height}; pixel reduction ${r.pixelReduction.toFixed(2)}%${r.beforeLayout ? `; HUD ${r.beforeLayout.occupancy.toFixed(2)}% → ${r.afterLayout.occupancy.toFixed(2)}%` : ''}</p><div>${images[index].map((image, i) => `<figure><figcaption>${i ? 'PR' : 'main'}</figcaption><img src="data:image/png;base64,${image.toString('base64')}"></figure>`).join('')}</div><details><summary>Metrics / layout</summary><pre>${JSON.stringify({ before: r.before, after: r.after, beforeLayout: r.beforeLayout, afterLayout: r.afterLayout }, null, 2)}</pre></details></article>`).join('');
  await writeFile(output, `<!doctype html><html lang="ja"><meta charset="utf-8"><title>BARB mobile comparison</title><style>body{background:#142329;color:#eee;font:15px system-ui;margin:24px}article{border-top:1px solid #789;padding:20px 0}article>div{display:flex;align-items:start;gap:12px}figure{margin:0;max-width:49%}img{max-width:100%;height:auto}pre{white-space:pre-wrap}</style><h1>BARB mobile comparison: ${metadata.mode}</h1><pre>${JSON.stringify(metadata, null, 2)}</pre><p>Production builds, boat (10,20), heading 0, saved clock, viewport / DPR and native fishing input fixed. Software Chromium / SwiftShader, single sample: setup→ready and 6 ordinary frames (96ms virtual time), Node monotonic wall clock and CDP TaskDuration. Includes automation overhead and waits; these are not device FPS or GPU timings. HUD images use actual BITE / FIGHT state transitions. Raw JSON accompanies this report. Regression mode expects unchanged resolution/resources/layout; historical-improvement requires the explicit pre-4C-2A SHA and the original ≥20% mobile pixel reduction and smaller fight HUD.</p>${figures}</html>`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [beforeFile, afterFile, output, mode, baseSha, headSha] = process.argv.slice(2);
  const before = JSON.parse(await readFile(beforeFile)), after = JSON.parse(await readFile(afterFile));
  const metadata = mode ? { mode, baseSha, headSha, validationSha: headSha, implementations: {
    main: mobileSourceMetadata(await readMobileImplementation(baseSha)), pr: mobileSourceMetadata(await readMobileImplementation(headSha)) } } : before[0]?.comparison;
  await writeMobileComparison(before, after, output, metadata);
}
