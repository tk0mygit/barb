import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareMobileCaptures, compareMobileCapturePair, writeMobileComparison, MOBILE_CAPTURE_IDS } from '../scripts/compare-mobile-performance.mjs';
import { HISTORICAL_MOBILE_BASE, mobileGit, readMobileImplementation, mobileSourceMetadata, expectedMobileResolution, replayMobileCamera, assertMobileWorkingSource } from '../scripts/lib/mobile-comparison-source.js';
import { createCameraRig } from '../src/rendering/camera.js';
import { validateMobileEvidence } from '../scripts/ci-summary.js';

const MAIN = 'a22ce01531befa55230fb186579731b8a3b9aeb6';
const current = await readMobileImplementation(MAIN), legacy = await readMobileImplementation(HISTORICAL_MOBILE_BASE);
const g1Base = await readMobileImplementation('6c92a1c6d004580144db72011bf5999fa5a2e651');
// Synthetic reviewed-source fixture: no dependency on a WIP commit surviving
// squash merge or branch deletion. Real working/Git provenance is tested below.
const sharedB = { ...g1Base, sha: 'f'.repeat(40),
  sourceTree: 'b2b8cd1d51494a6332633c59f1ad580cd489a151',
  terrainBlob: '4035462c3a09c46e20510e86a663da9d772a5d07',
  crownTextureBlob: 'f867ba84e5ed9727004ba313232078d61469c25d' };
const g2Base = await readMobileImplementation('89de7dd3ba9fdfb3bb736c9d23ab62e7fdfc6b02');
const densitySource = { ...g2Base, sha: 'e'.repeat(40),
  sourceTree: '62a706d6e942b955a8100022677cb343fbe56c21', terrainBlob: 'd2cd4ccf2a97d788c807f778c300ba4d1414641d' };
const profiles = {
  portrait: { width: 390, height: 844, dpr: 2, touch: true }, landscape: { width: 844, height: 390, dpr: 2, touch: true },
  small: { width: 360, height: 740, dpr: 3, touch: true }, pc: { width: 1280, height: 800, dpr: 1 }, 'pc-hidpi': { width: 1280, height: 800, dpr: 2 },
};
const box = (x, y, width, height) => ({ x, y, width, height, left: x, right: x + width, top: y, bottom: y + height });

function metadata(historical = false) {
  return { mode: historical ? 'historical-improvement' : 'regression', baseSha: historical ? HISTORICAL_MOBILE_BASE : MAIN,
    headSha: MAIN, validationSha: MAIN, implementations: { main: mobileSourceMetadata(historical ? legacy : current), pr: mobileSourceMetadata(current) } };
}
// Synthetic records exercise the report's acceptance rules; these values are
// never presented as browser measurements or substituted for E2E captures.
function captures(historical = false) {
  const series = implementation => MOBILE_CAPTURE_IDS.map(id => {
    const profile = id === 'rotated-fight' ? profiles.landscape : profiles[Object.keys(profiles).sort((a, b) => b.length - a.length).find(p => id.startsWith(`${p}-`))];
    const { width, height, dpr } = profile;
    const expected = expectedMobileResolution(implementation, profile);
    const entry = { id, metrics: { viewport: { width, height }, dpr, ...expected, pixels: expected.buffer.width * expected.buffer.height,
      camera: { position: [10, 2.15, 20], quaternion: [0, 0, 0, 1], aspect: expected.aspect }, savedClockSeconds: 90,
      boat: [10, 20], waterTime: 0.25, fogStrength: 0,
      resources: { calls: 26, triangles: 221152, geometries: 23, textures: 3, programs: 11 } } };
    if (/-bite$|-fight$/.test(id)) {
      const oldMobile = implementation === legacy && !id.startsWith('pc');
      const panel = box(20, height - (oldMobile ? 160 : 140), oldMobile ? 320 : 300, oldMobile ? 120 : 80);
      entry.layout = { viewport: { width, height }, phase: id.endsWith('bite') ? 'bite' : 'fight', panel,
        occupancy: panel.width * panel.height / (width * height) * 100, reticle: box(width / 2 - 6, height / 2 - 6, 12, 12),
        meter: box(panel.x + 5, panel.y + 20, 200, 18), buttons: [{ id: 'return-button', ...box(width - 50, height - 40, 30, 30) }],
        header: box(10, 10, 80, 25), notices: [], scrollWidth: width, pointerEvents: 'none', hit: 'scene' };
    }
    return entry;
  });
  return [series(historical ? legacy : current), series(current)];
}

test('the exact optimized and pre-4C-2A SHA implementations give independently correct ratios/buffers', () => {
  const ratios = [1.5, 1.5, 1.5, 1, 1.75], buffers = [[585, 1266], [1266, 585], [540, 1110], [1280, 800], [2240, 1400]];
  for (const [index, profile] of Object.values(profiles).entries()) {
    const r = expectedMobileResolution(current, profile);
    assert.equal(r.pixelRatio, ratios[index]); assert.deepEqual(r.buffer, { width: buffers[index][0], height: buffers[index][1] });
    assert.equal(expectedMobileResolution(legacy, profile).pixelRatio, Math.min(profile.dpr, 1.75));
  }
  assert.deepEqual(expectedMobileResolution(current, profiles.landscape), { pixelRatio: 1.5, buffer: { width: 1266, height: 585 }, aspect: 844 / 390 });
  assert.equal(current.resolutionBlob, '175a5e75df1c7a48aa28c63785ca71d7835af32a');
  assert.equal(current.resolutionModel, 'mobile-budget'); assert.equal(legacy.resolutionModel, 'legacy-1.75');
});

test('low and invalid DPR validation still uses the actual optimized source', () => {
  for (const dpr of [0.5, 1]) assert.equal(expectedMobileResolution(current, { ...profiles.portrait, dpr }).pixelRatio, dpr);
  for (const dpr of [0, -1, NaN, Infinity, undefined]) assert.equal(expectedMobileResolution(current, { ...profiles.portrait, dpr }).pixelRatio, 1);
});

test('unrecognized old implementations and missing SHAs cannot silently become legacy 1.75', async () => {
  await assert.rejects(readMobileImplementation('main'), /full mobile implementation SHA/);
  await assert.rejects(readMobileImplementation('df2d10b17385352209a54ea44f73bc7d67198fcc'), /unrecognized rendering implementation/);
});

test('normal current-main regression accepts 34 unchanged pairs and exactly 0% reduction', () => {
  const rows = compareMobileCaptures(...captures(), metadata());
  assert.equal(rows.length, 34); assert(rows.every(row => row.pixelReduction === 0));
});

function sharedBCaptures() {
  const [before, after] = captures();
  for (const entry of after) entry.metrics.resources.textures = 4;
  return { before, after, data: { mode: 'regression', baseSha: g1Base.sha, headSha: sharedB.sha, validationSha: sharedB.sha,
    implementations: { main: mobileSourceMetadata(g1Base), pr: mobileSourceMetadata(sharedB) } } };
}

function densityCaptures() {
  const [before, after] = captures();
  for (const entry of [...before, ...after]) entry.metrics.resources.textures = 4;
  for (const entry of after) entry.metrics.resources.triangles += 54000;
  return { before, after, data: { mode: 'regression', baseSha: g2Base.sha, headSha: densitySource.sha, validationSha: densitySource.sha,
    implementations: { main: mobileSourceMetadata(g2Base), pr: mobileSourceMetadata(densitySource) } } };
}

test('only the exact G-2 to G-2.5 runtime/build transition permits 250 * 216 triangles across all 34 pairs', () => {
  const p = densityCaptures(), rows = compareMobileCaptures(p.before, p.after, p.data);
  assert.equal(rows.length, 34);
  assert(rows.every(row => row.resourceTransition === 'forest-G2.5: triangles +54000, all other resources exact'));
  for (const delta of [0, 1, 32400, 53999, 54001, 75600, 151200, 1e9]) {
    const pair = densityCaptures(); pair.after[0].metrics.resources.triangles = pair.before[0].metrics.resources.triangles + delta;
    assert.throws(() => compareMobileCaptures(pair.before, pair.after, pair.data), /resource regression/, `delta ${delta}`);
  }
  for (const field of ['calls', 'geometries', 'textures', 'programs']) {
    const pair = densityCaptures(); pair.after[0].metrics.resources[field]++;
    assert.throws(() => compareMobileCaptures(pair.before, pair.after, pair.data), /resource regression/, field);
  }
});

test('forest delta rejects unknown source/build/full-SHA provenance and does not recur in later PRs', () => {
  for (const target of ['main', 'pr']) for (const field of ['sourceTree', 'terrainBlob', 'crownTextureBlob', 'lockBlob', 'indexBlob', 'viteBlob', 'sha']) {
    const p = densityCaptures(); p.data.implementations[target][field] = 'b'.repeat(40);
    assert.throws(() => compareMobileCaptures(p.before, p.after, p.data), /resource regression/, `${target}.${field}`);
  }
  for (const field of ['baseSha', 'validationSha']) {
    const p = densityCaptures(); p.data[field] = 'b'.repeat(40);
    assert.throws(() => compareMobileCaptures(p.before, p.after, p.data), /resource regression/, field);
  }
  const p = densityCaptures(); p.data.baseSha = densitySource.sha; p.data.implementations.main = mobileSourceMetadata(densitySource);
  for (const entry of p.before) entry.metrics.resources.triangles += 54000;
  assert(compareMobileCaptures(p.before, p.after, p.data).every(row => !row.resourceTransition));
  for (const delta of [1, 54000, 75600, 1e9]) {
    const after = structuredClone(p.after); after[0].metrics.resources.triangles += delta;
    assert.throws(() => compareMobileCaptures(p.before, after, p.data), /resource regression/);
  }
  const unknown = metadata(), [before, after] = captures(); unknown.resourceTransition = 'forest-G2.5'; after[0].metrics.resources.triangles++;
  assert.throws(() => compareMobileCaptures(before, after, unknown), /resource regression/);
  const [historicalBefore, historicalAfter] = captures(true); historicalAfter[0].metrics.resources.triangles += 54000;
  assert.throws(() => compareMobileCaptures(historicalBefore, historicalAfter, metadata(true)), /resource regression/);
});

test('only the reviewed shared-B source tree accepts exactly one crown map and no program increase', () => {
  const { before, after, data } = sharedBCaptures();
  const rows = compareMobileCaptures(before, after, data);
  assert.equal(rows.length, 34);
  assert(rows.every(row => row.resourceTransition === 'shared-crown-B: texture +1, all other resources exact'));
  for (const field of ['calls', 'triangles', 'geometries', 'textures', 'programs']) {
    const pair = sharedBCaptures(); pair.after[0].metrics.resources[field]++;
    assert.throws(() => compareMobileCaptures(pair.before, pair.after, pair.data), /resource regression/, field);
  }
  const absent = sharedBCaptures(); absent.after[0].metrics.resources.textures = 3;
  assert.throws(() => compareMobileCaptures(absent.before, absent.after, absent.data), /resource regression/);
  const badBase = sharedBCaptures(); badBase.before[0].metrics.resources.textures = 4;
  assert.throws(() => compareMobileCaptures(badBase.before, badBase.after, badBase.data), /verified three-texture base/);
});

test('unknown runtime/build identities and misleading flags cannot obtain the crown-map delta', () => {
  for (const target of ['main', 'pr']) for (const field of ['sourceTree', 'terrainBlob', 'crownTextureBlob', 'lockBlob', 'indexBlob', 'viteBlob']) {
    const pair = sharedBCaptures(); pair.data.implementations[target][field] = 'b'.repeat(40);
    assert.throws(() => compareMobileCaptures(pair.before, pair.after, pair.data), /resource regression/, `${target}.${field}`);
  }
  for (const field of ['baseSha', 'validationSha']) {
    const pair = sharedBCaptures(); pair.data[field] = 'b'.repeat(40);
    assert.throws(() => compareMobileCaptures(pair.before, pair.after, pair.data), /resource regression/);
  }
  const [before, after] = captures(), data = metadata();
  data.resourceTransition = 'shared-crown-B'; after[0].metrics.resources.textures++;
  assert.throws(() => compareMobileCaptures(before, after, data), /resource regression/);
});

test('subsequent textured-to-textured PRs retain exact resources with no recurring +1 allowance', () => {
  const { before, after, data } = sharedBCaptures();
  data.baseSha = sharedB.sha; data.implementations.main = mobileSourceMetadata(sharedB);
  for (const entry of before) entry.metrics.resources.textures = 4;
  const rows = compareMobileCaptures(before, after, data);
  assert(rows.every(row => !row.resourceTransition));
  after[0].metrics.resources.textures++;
  assert.throws(() => compareMobileCaptures(before, after, data), /resource regression/);
});

test('historical resolution improvement never inherits the crown texture allowance', () => {
  const [before, after] = captures(true); after[0].metrics.resources.textures++;
  assert.throws(() => compareMobileCaptures(before, after, metadata(true)), /resource regression/);
});

test('runtime tree, terrain/texture and build-input provenance is read from Git and checked against working files', async () => {
  const working = await readMobileImplementation(await mobileGit('rev-parse', 'HEAD'));
  await assertMobileWorkingSource(working);
  for (const field of ['terrainBlob', 'crownTextureBlob', 'lockBlob', 'indexBlob', 'viteBlob', 'sourceTree']) {
    await assert.rejects(assertMobileWorkingSource({ ...working, [field]: 'b'.repeat(40) }), /differs/);
  }
  const dir = await mkdtemp(join(tmpdir(), 'barb-crown-provenance-'));
  try {
    const pair = sharedBCaptures(), image = fileURLToPath(new URL('./fixtures/fish-assets/transparent-test.png', import.meta.url));
    pair.data.headSha = pair.data.validationSha = working.sha;
    pair.data.implementations.pr = mobileSourceMetadata(working);
    pair.data.implementations.pr.sourceTree = 'b'.repeat(40);
    for (const entry of pair.after) entry.metrics.resources.textures = 3; // Let exact resource checks reach source revalidation.
    for (const entry of [...pair.before, ...pair.after]) entry.image = image;
    await assert.rejects(writeMobileComparison(pair.before, pair.after, join(dir, 'forged.html'), pair.data), /implementation provenance differs/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('final gate requires all 34 pairs, their report, provenance and every image/record', () => {
  const data = metadata(), [before, after] = captures();
  const files = Object.fromEntries(['comparison-metadata.json', 'main.json', 'pr.json', 'comparison.html', 'comparison.json',
    ...['main', 'pr'].flatMap(target => MOBILE_CAPTURE_IDS.flatMap(id => [`${target}-${id}.png`, `${target}-${id}.json`]))]
    .map(file => [`test-results/mobile-comparison/${file}`, 'synthetic-manifest-hash']));
  const payload = { record: { files }, mobile: { metadata: data, before, after,
    comparison: { metadata: data, rows: compareMobileCaptures(before, after, data) } } };
  assert.equal(validateMobileEvidence(payload, data), 34);
  for (const file of Object.keys(files)) {
    const missing = structuredClone(payload); delete missing.record.files[file];
    assert.throws(() => validateMobileEvidence(missing, data), /Missing mobile artifact/);
  }
  for (const key of ['baseSha', 'headSha', 'validationSha']) {
    assert.throws(() => validateMobileEvidence(payload, { ...data, [key]: 'b'.repeat(40) }), /differs/);
  }
  const partial = structuredClone(payload); partial.mobile.before.pop();
  assert.throws(() => validateMobileEvidence(partial, data), /all 25 render and 9 HUD/);
  const mixed = structuredClone(payload); mixed.mobile.comparison.rows[0].id = 'substituted';
  assert.throws(() => validateMobileEvidence(mixed, data), /report differs/);
  const incomplete = structuredClone(payload);
  incomplete.record.files['test-results/mobile-comparison/comparison-incomplete.json'] = 'hash';
  assert.throws(() => validateMobileEvidence(incomplete, data), /Incomplete mobile comparison/);
});

test('a local selected pair keeps resource/HUD checks while the full report still requires all 34', () => {
  const [before, after] = captures();
  const b = before.find(entry => entry.id === 'portrait-fight'), a = after.find(entry => entry.id === b.id);
  assert.equal(compareMobileCapturePair(b, a, metadata()).id, b.id);
  assert.throws(() => compareMobileCaptures([b], [a], metadata()), /all 25 render and 9 HUD/);
  a.metrics.resources.programs++;
  assert.throws(() => compareMobileCapturePair(b, a, metadata()), /resource regression/);
});

for (const [label, id, ratio] of [['mobile pixel increase', 'portrait-day-tps', 1.75], ['desktop quality reduction', 'pc-hidpi-day-tps', 1]]) {
  test(`regression rejects ${label}`, () => {
    const [before, after] = captures(), m = after.find(c => c.id === id).metrics;
    m.pixelRatio = ratio; m.buffer = { width: Math.floor(m.viewport.width * ratio), height: Math.floor(m.viewport.height * ratio) }; m.pixels = m.buffer.width * m.buffer.height;
    assert.throws(() => compareMobileCaptures(before, after, metadata()), /pixel ratio regression/);
  });
}

test('incorrect drawing buffer dimensions fail even when their pixel area is unchanged', () => {
  const [before, after] = captures(), m = after[0].metrics;
  m.buffer = { width: m.buffer.height, height: m.buffer.width };
  assert.throws(() => compareMobileCaptures(before, after, metadata()), /drawing buffer dimensions/);
});

test('HUD area and position regressions cannot pass as 0% pixel reduction', () => {
  for (const change of [s => { s.panel = box(20, s.panel.y, 310, 85); s.occupancy = s.panel.width * s.panel.height / (s.viewport.width * s.viewport.height) * 100; },
    s => { s.panel = box(21, s.panel.y, s.panel.width, s.panel.height); }]) {
    const [before, after] = captures(); change(after.find(c => c.id === 'portrait-fight').layout);
    assert.throws(() => compareMobileCaptures(before, after, metadata()), /HUD .*regression/);
  }
});

for (const target of ['reticle', 'controls']) test(`HUD overlap with ${target} fails even if both baselines share it`, () => {
  const [before, after] = captures();
  for (const entries of [before, after]) {
    const s = entries.find(c => c.id === 'portrait-fight').layout;
    if (target === 'reticle') s.reticle = s.panel; else s.buttons[0] = s.panel;
  }
  assert.throws(() => compareMobileCaptures(before, after, metadata()), /HUD overlaps/);
});

for (const resource of ['calls', 'triangles', 'geometries', 'textures', 'programs']) test(`a ${resource} resource regression is rejected`, () => {
  const [before, after] = captures(); after[0].metrics.resources[resource]++;
  assert.throws(() => compareMobileCaptures(before, after, metadata()), /resource regression/);
});

test('historical mode keeps >=20% mobile reduction and smaller HUD, with an explicit verified base only', () => {
  const pair = captures(true), rows = compareMobileCaptures(...pair, metadata(true));
  assert(rows.filter(row => !row.id.startsWith('pc')).every(row => row.pixelReduction >= 20));
  assert.throws(() => compareMobileCaptures(...pair, { ...metadata(true), baseSha: MAIN }), /explicit pre-4C-2A SHA/);
  assert.throws(() => compareMobileCaptures(...pair, metadata()), /pixel ratio regression/);
  assert.throws(() => compareMobileCaptures(...captures(), metadata(true)), /historical mobile pixel reduction/);
  const unchangedHUD = captures(true);
  unchangedHUD[0].find(c => c.id === 'portrait-fight').layout = structuredClone(unchangedHUD[1].find(c => c.id === 'portrait-fight').layout);
  assert.throws(() => compareMobileCaptures(...unchangedHUD, metadata(true)), /historical HUD area did not shrink/);
});

test('comparison rejects incomplete/duplicate pairs, mixed clocks, mixed source provenance and unknown modes', () => {
  const [before, after] = captures();
  assert.throws(() => compareMobileCaptures(before.slice(1), after, metadata()), /all 25 render and 9 HUD/);
  const duplicate = structuredClone(after); duplicate[1] = duplicate[0];
  assert.throws(() => compareMobileCaptures(before, duplicate, metadata()), /Missing\/duplicate/);
  const clock = structuredClone(after); clock[0].metrics.savedClockSeconds++;
  assert.throws(() => compareMobileCaptures(before, clock, metadata()), /savedClockSeconds differs/);
  const mixed = structuredClone(after); mixed[0].comparison = { ...metadata(), headSha: 'b'.repeat(40) };
  assert.throws(() => compareMobileCaptures(before, mixed, metadata()), /mixed comparison provenance/);
  assert.throws(() => compareMobileCaptures(before, after, { ...metadata(), mode: 'auto-pass' }), /Unknown mobile comparison mode/);
});

function preparedCaptures() {
  const [before, after] = captures(), data = metadata();
  data.implementations.pr = { ...data.implementations.pr, cameraBlob: 'b'.repeat(40),
    cameraModel: 'prepared-horizontal-aft-1.25', hudModel: 'cast-upper-controls' };
  for (const entry of [...before, ...after]) {
    entry.metrics.cameraExpected = structuredClone(entry.metrics.camera);
    entry.metrics.resourceCamera = { position: [10, 8.5, 38], quaternion: [0, 0, 0, 1], aspect: entry.metrics.camera.aspect, fov: 55 };
  }
  for (const entry of after.filter(entry => entry.id.endsWith('bite'))) {
    entry.metrics.camera.position = [10, 2.15, 21.25];
    entry.metrics.cameraExpected = structuredClone(entry.metrics.camera);
    const s = entry.layout, { width, height } = s.viewport, portrait = width <= 640 && height > 500;
    const left = width <= 640 || height <= 500 ? 22 : 42, top = portrait ? 88 : height <= 500 ? 84 : 100;
    const panelWidth = portrait ? width - 44 : 320;
    s.panel = box(left, top, panelWidth, 99);
    s.occupancy = s.panel.width * s.panel.height / (width * height) * 100;
    const actionLeft = portrait ? left : width - left - 420;
    const actionTop = portrait ? top + 99 + 8 : top;
    s.buttons = [{ id: 'return-button', ...box(actionLeft, actionTop + 38, ((portrait ? panelWidth : 420) - 8) / 2, 50) }];
  }
  return { before, after, data };
}

test('prepared cast camera and upper BITE HUD have explicit expected geometry while other comparisons stay strict', () => {
  const { before, after, data } = preparedCaptures();
  assert.equal(compareMobileCaptures(before, after, data).length, 34);
  for (const [label, mutate, error] of [
    ['prepared viewpoint', a => { a.metrics.camera.position[2] += 0.01; a.metrics.cameraExpected.position[2] += 0.01; }, /camera position/],
    ['HUD x', a => { a.layout.panel = box(23, 88, 346, 99); }, /cast HUD panel placement|HUD occupancy/],
    ['HUD height', a => { a.layout.panel.height++; a.layout.panel.bottom++; }, /cast HUD panel placement|HUD occupancy/],
    ['return button', a => { a.layout.buttons[0].x++; }, /cast return button placement/],
    ['resource pass pose', a => { a.metrics.resourceCamera.fov = 56; }, /diagnostic resource camera differs/],
  ]) {
    const pair = preparedCaptures(); mutate(pair.after.find(entry => entry.id === 'portrait-bite'));
    assert.throws(() => compareMobileCaptures(pair.before, pair.after, pair.data), error, label);
  }
  const pair = preparedCaptures();
  pair.after.find(entry => entry.id === 'portrait-fight').layout.panel.x++;
  assert.throws(() => compareMobileCaptures(pair.before, pair.after, pair.data), /HUD panel regression/);
});

test('camera replay uses each source rig and exact recorded updates, including fixed preparation and fight tracking', () => {
  const frames = [{ update: false, dt: 0, aspect: 390 / 844, mode: 'sailing', phase: 'inactive' },
    ...Array.from({ length: 12 }, () => ({ update: true, dt: 0.25, aspect: 390 / 844, mode: 'fishing', phase: 'ready', tracking: null })),
    { update: true, dt: 0.25, aspect: 390 / 844, mode: 'fishing', phase: 'aim', tracking: null },
    { update: true, dt: 0.25, aspect: 390 / 844, mode: 'fishing', phase: 'bite', tracking: null }];
  const actual = { createCameraRig, cameraModel: 'prepared-horizontal-aft-1.25' };
  const prepared = replayMobileCamera(actual, frames);
  assert.deepEqual(prepared.position, [10, 2.15, 21.25]);
  assert.deepEqual(prepared.quaternion, [0, 0, 0, 1]);
  const old = replayMobileCamera(current, frames);
  assert.notDeepEqual(old.position, prepared.position);
  frames.push({ update: true, dt: 0.016, aspect: 390 / 844, mode: 'fishing', phase: 'fight', tracking: { x: 10, z: -8 } });
  const fight = replayMobileCamera(actual, frames);
  assert.deepEqual(fight.position, prepared.position);
  assert.notDeepEqual(fight.quaternion, prepared.quaternion);
  assert.throws(() => replayMobileCamera(actual, []), /Missing camera frame history/);
});

test('HTML/JSON retain all 34 image pairs, measurements, purpose, base and HEAD SHA', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'barb-mobile-report-'));
  try {
    const [before, after] = captures(), image = fileURLToPath(new URL('./fixtures/fish-assets/transparent-test.png', import.meta.url));
    for (const entry of [...before, ...after]) entry.image = image;
    const output = join(dir, 'comparison.html'); await writeMobileComparison(before, after, output, metadata());
    const json = JSON.parse(await readFile(join(dir, 'comparison.json'), 'utf8')), html = await readFile(output, 'utf8');
    assert.equal(json.metadata.mode, 'regression'); assert.equal(json.metadata.baseSha, MAIN); assert.equal(json.metadata.headSha, MAIN);
    assert.equal(json.rows.length, 34); assert.equal((html.match(/<article /g) ?? []).length, 34); assert.equal((html.match(/data:image\/png;base64/g) ?? []).length, 68);
    assert.deepEqual(json.rows[0].before, before[0].metrics);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
