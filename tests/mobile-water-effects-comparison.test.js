import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mobileGit, readMobileImplementation, mobileSourceMetadata, replayMobileCamera } from '../scripts/lib/mobile-comparison-source.js';
import { WATER_EFFECTS_BASE, WATER_EFFECTS_BLOB, readMobileWaterEffectsTransition, verifyWaterEffectsConnection,
  inspectWaterEffectsFactory, readWaterEffectsSource } from '../scripts/lib/mobile-water-effects-replay.js';
import { verifyGameplayTestConnection } from '../scripts/lib/mobile-water-effects-replay.js';
import { compareMobileCapturesWithSources, compareMobileCapturePairWithSources } from '../scripts/compare-mobile-performance.mjs';
import { validateMobileEvidence } from '../scripts/ci-summary.js';
import { waterFixtureCommit, waterGateFixture, waterCapture } from './helpers/water-effects-fixture.js';

const exec = promisify(execFile);
test('only the approved separate deterministic restore test reverses exactly; default restore, limits, assertions and QTE defaults remain protected', async () => {
  const base = await readMobileImplementation(WATER_EFFECTS_BASE);
  const before = (await exec('git', ['show', `${base.sha}:tests/gameplay.test.js`])).stdout;
  const original = '  bite(restored.fishing); restored.fishing.hook(); assert.equal(restored.fishing.state.fight.qte.enabled, false);';
  const replacement = '  const controlled = restoreSaveData(original, {\n'
    + '    gameplayFactory: options => createGameplay({ ...options, random: () => 0.5 }),\n'
    + '  });\n'
    + '  bite(controlled.fishing); controlled.fishing.hook(); assert.equal(controlled.fishing.state.fight.qte.enabled, false);';
  const after = before.replace(original, replacement);
  assert.notEqual(after, before); verifyGameplayTestConnection(before, after);
  const proof = await readMobileWaterEffectsTransition(base, await readMobileImplementation(waterFixtureCommit({ 'tests/gameplay.test.js': after })));
  assert.match(proof.gameplayTest.beforeBlob, /^[a-f0-9]{40}$/); assert.match(proof.gameplayTest.afterBlob, /^[a-f0-9]{40}$/);
  assert.throws(() => verifyGameplayTestConnection(before, after + '\n'), /5F-1B/);
  await assert.rejects(readMobileWaterEffectsTransition(base,
    await readMobileImplementation(waterFixtureCommit({ 'tests/gameplay.test.js': after + '\n' }))), /5F-1B/);
  for (const [from, to] of [['n < 500', 'n < 600'], ['assert.equal(calls, 0);', ''],
    ['const restored = restoreSaveData(original);', 'const restored = restoreSaveData(original, { gameplayFactory: createGameplay });'],
    ['random: () => 0.5', 'random: () => 0.6'], ['random: () => 0.5', 'random: () => 0.5, qteEnabled: false'],
    ['assert.deepEqual(createSaveData(restored, { savedAt }), original);', ''],
    ['invalid and future saves never reach injected gameplay', 'renamed restore test']]) {
    const invalid = after.replace(from, to); assert.notEqual(invalid, after);
    assert.throws(() => verifyGameplayTestConnection(before, invalid), /5F-1B/);
    await assert.rejects(readMobileWaterEffectsTransition(base,
      await readMobileImplementation(waterFixtureCommit({ 'tests/gameplay.test.js': invalid }))), /5F-1B/);
  }
});
test('5F-1B proves its exact base, reversible complete wiring and one pinned new module, retaining 5F-1A', async () => {
  const base = await readMobileImplementation(WATER_EFFECTS_BASE), head = await readMobileImplementation(waterFixtureCommit());
  const proof = await readMobileWaterEffectsTransition(base, head);
  assert.equal(proof.kind, 'water-effects-5F1B'); assert.equal(proof.after.fishingEffectsBlob, WATER_EFFECTS_BLOB);
  assert.deepEqual(proof.resources, { geometries: 1, materials: 1, textures: 0, programs: 1, maximumCalls: 1, maximumTriangles: 1152 });
  assert.equal(await readMobileWaterEffectsTransition(base, base), null);
  assert.equal(await readMobileWaterEffectsTransition({ ...base, sha: '0'.repeat(40) }, head), null);
  for (const key of ['lockBlob', 'indexBlob', 'viteBlob', 'cameraBlob', 'hudBlob', 'hudLogicBlob', 'resolutionBlob', 'fishingEffectsBlob']) {
    await assert.rejects(readMobileWaterEffectsTransition(base, { ...head, [key]: '0'.repeat(40) }), /5F-1B/);
  }
  const beforeMain = await mobileGit('show', `${base.sha}:src/main.js`), afterMain = await mobileGit('show', `${head.sha}:src/main.js`);
  const beforeView = await mobileGit('show', `${base.sha}:src/rendering/fishing.js`), afterView = await mobileGit('show', `${head.sha}:src/rendering/fishing.js`);
  verifyWaterEffectsConnection(beforeMain, afterMain, beforeView, afterView);
  for (const [from, to] of [['s.distance * 0.18', 's.distance * 0.19'], ['positions[4] = 0.12', 'positions[4] = 0.15'],
    ['shadow.rotation.z = -s.heading', 'shadow.rotation.z = s.heading'], ['ring.visible = group.visible', 'ring.visible = active']]) {
    assert.notEqual(afterView.replace(from, to), afterView);
    assert.throws(() => verifyWaterEffectsConnection(beforeMain, afterMain, beforeView, afterView.replace(from, to)), /5F-1B/);
  }
  assert.throws(() => verifyWaterEffectsConnection(beforeMain, afterMain.replace('gameClock.step(frameSeconds)', 'gameClock.step(dt)'), beforeView, afterView), /unrelated main/);
});

test('domain/input/QTE, camera authority, fixtures, build, workflow and unapproved effects cannot hide in the proof', async () => {
  const base = await readMobileImplementation(WATER_EFFECTS_BASE);
  for (const path of ['src/game/fishing.js', 'src/input/fishing.js', 'src/game/fight-controller.js', 'src/rendering/camera.js',
    'src/ui/fishing-hud.js', 'src/world/water.js', 'package.json', 'tests/fixtures/saves/lighting-save-v1.json',
    '.github/workflows/pages.yml', 'scripts/ci-summary.js', 'tests/browser/mobile-capture.js', 'tests/browser/mobile-performance.spec.js']) {
    const text = await mobileGit('show', `${base.sha}:${path}`);
    const head = await readMobileImplementation(waterFixtureCommit({ [path]: text + '\n// Deliberate unapproved fixture mutation\n' }));
    await assert.rejects(readMobileWaterEffectsTransition(base, head), /5F-1B/, path);
  }
  const effects = await mobileGit('show', WATER_EFFECTS_BLOB);
  const head = await readMobileImplementation(waterFixtureCommit({ 'src/rendering/fishing-effects.js': effects.replace('.15 + random()', '.5 + random()') }));
  await assert.rejects(readMobileWaterEffectsTransition(base, head), /unapproved effect source blob/);
});

test('the factory inspection rejects extra draws, geometry, shader/texture customization or two-pass transparency', async () => {
  const source = await readWaterEffectsSource(waterFixtureCommit());
  for (const mutate of [e => { e.group.add(e.group.children[0].clone()); },
    e => { e.group.children[0].material.forceSinglePass = false; }, e => { e.group.children[0].material.depthTest = false; },
    e => { e.group.children[0].geometry.drawRange.count += 3; }, e => { e.group.children[0].material.map = {}; },
    e => { e.group.children[0].material.onBeforeCompile = () => {}; }]) {
    assert.throws(() => inspectWaterEffectsFactory(() => { const e = source.createFishingEffects(); mutate(e); return e; }), /5F-1B|Expected/);
  }
});

test('all 34 pairs permit only the exact warmed resource delta and replayed visible nine-ID batch submissions', async () => {
  const p = await waterGateFixture(); assert.equal(p.comparison.rows.length, 34);
  for (const row of p.comparison.rows) for (const pass of ['resources', 'actualResources']) {
    assert.equal(row.after[pass].geometries - row.before[pass].geometries, 1);
    assert.equal(row.after[pass].programs - row.before[pass].programs, 1);
    assert.equal(row.after[pass].textures, row.before[pass].textures);
    const expected = row.waterEffectsComparison.afterDraws[pass === 'resources' ? 'fixed' : 'actual'].waterEffects ?? { calls: 0, triangles: 0 };
    assert.equal(row.after[pass].calls - row.before[pass].calls, expected.calls);
    assert.equal(row.after[pass].triangles - row.before[pass].triangles, expected.triangles);
    if (!/bite$|fight$/.test(row.id)) assert.deepEqual(expected, { calls: 0, triangles: 0 });
  }
});

test('raw validation rejects missing phase JSON, false timers, camera substitutions, pool/buffer changes and draw forgeries', async () => {
  const p = await waterGateFixture();
  for (const [label, mutate, error] of [
    ['phase JSON', e => { delete e.metrics.fishingDisplay; }, /missing phase JSON/],
    ['phase', e => { e.metrics.fishingDisplay.phase = 'fight'; }, /observed phase/],
    ['timer', e => { e.metrics.fishingDisplay.elapsed += .25; }, /display timer/],
    ['birth replay', e => { e.metrics.fishingDisplay.meshes.waterEffects.positions[6000] += .1; }, /effect mesh\/timer\/buffer/],
    ['color replay', e => { e.metrics.fishingDisplay.meshes.waterEffects.colors[9000] += .1; }, /effect mesh\/timer\/buffer/],
    ['pool', e => { e.metrics.fishingDisplay.meshes.waterEffects.vertices *= 2; }, /effect mesh\/timer\/buffer/],
    ['camera', e => { e.metrics.fishingDisplay.passes.fixed.camera.position[1]++; }, /substituted camera/],
    ['extra draw', e => { e.metrics.fishingDisplay.passes.actual.draws.waterEffects.calls++; }, /source submissions/],
    ['counter substitute', e => { e.metrics.resources = e.metrics.actualResources; }, /substituted renderer/],
    ['ring visibility', e => { e.metrics.fishingDisplay.meshes.ring.visible = false; }, /existing ring display/],
  ]) {
    const before = structuredClone(p.before.find(e => e.id === 'pc-bite')), after = structuredClone(p.after.find(e => e.id === 'pc-bite'));
    mutate(after); await assert.rejects(compareMobileCapturePairWithSources(before, after, p.metadata), error, label);
  }
  const before = structuredClone(p.before[0]), after = structuredClone(p.after[0]);
  after.metrics.resources.calls++; after.metrics.fishingDisplay.passes.fixed.resources.calls++;
  await assert.rejects(compareMobileCapturePairWithSources(before, after, p.metadata), /resource regression/, '25-ID allowance cannot leak');
  const bad = structuredClone(p); bad.after[0].id = 'unrecognized';
  await assert.rejects(compareMobileCapturesWithSources(bad.before, bad.after, bad.metadata), /Missing\/duplicate/);
});

test('every renderer counter rejects both over- and under-allocation in both cameras, including inactive IDs', async () => {
  const p = await waterGateFixture();
  for (const id of ['pc-bite', 'portrait-day-tps']) for (const pass of ['resources', 'actualResources']) {
    for (const key of ['calls', 'triangles', 'geometries', 'textures', 'programs']) for (const amount of [-1, 1]) {
      const before = structuredClone(p.before.find(e => e.id === id)), after = structuredClone(p.after.find(e => e.id === id));
      after.metrics[pass][key] += amount;
      after.metrics.fishingDisplay.passes[pass === 'resources' ? 'fixed' : 'actual'].resources[key] += amount;
      await assert.rejects(compareMobileCapturePairWithSources(before, after, p.metadata), /resource regression/, `${id}/${pass}/${key}/${amount}`);
    }
  }
});

test('forged source SHA, camera expected values, missing history or reversed merge parents fail closed', async () => {
  const p = await waterGateFixture();
  for (const mutate of [q => { q.metadata.implementations.pr.fishingEffectsBlob = '0'.repeat(40); },
    q => { delete q.after.find(e => e.id === 'pc-bite').metrics.cameraFrames; },
    q => { const e = q.after.find(e => e.id === 'pc-bite'); e.metrics.camera.quaternion[0] += .01; e.metrics.cameraExpected = e.metrics.camera; }]) {
    const q = structuredClone(p); mutate(q);
    await assert.rejects(compareMobileCapturesWithSources(q.before, q.after, q.metadata));
  }
  const head = p.metadata.headSha;
  const merge = await readMobileImplementation(waterFixtureCommit({}, [WATER_EFFECTS_BASE, head]));
  const metadata = { ...p.metadata, validationSha: merge.sha, implementations: { ...p.metadata.implementations, pr: mobileSourceMetadata(merge) } };
  assert.equal((await compareMobileCapturesWithSources(p.before, p.after, metadata)).length, 34);
  const reversed = await readMobileImplementation(waterFixtureCommit({}, [head, WATER_EFFECTS_BASE]));
  metadata.validationSha = reversed.sha; metadata.implementations.pr = mobileSourceMetadata(reversed);
  await assert.rejects(compareMobileCapturesWithSources(p.before, p.after, metadata), /not the recorded base\/HEAD merge/);
});

test('rotated-fight retains both-history source camera normalization and rejects forged tracking', async () => {
  const p = await waterGateFixture(), base = await readMobileImplementation(p.metadata.baseSha), head = await readMobileImplementation(p.metadata.headSha);
  const before = await waterCapture(base, 'rotated-fight'), after = await waterCapture(head, 'rotated-fight', .032);
  const row = await compareMobileCapturePairWithSources(before, after, p.metadata);
  assert.equal(row.cameraComparison.normalizedHistories, 2);
  assert.equal(row.waterEffectsComparison.proof.kind, 'water-effects-5F1B');
  after.metrics.cameraFrames.at(-1).tracking.z += .25;
  after.metrics.camera = replayMobileCamera(head, after.metrics.cameraFrames); after.metrics.cameraExpected = after.metrics.camera;
  await assert.rejects(compareMobileCapturePairWithSources(before, after, p.metadata), /tracking z: differs/);
});

test('unchanged ci-required rechecks all raw pairs and rejects report-after-capture tampering or missing JSON', async () => {
  const p = await waterGateFixture(), payload = { record: { files: p.files }, mobile: {
    metadata: p.metadata, before: p.before, after: p.after, comparison: p.comparison } };
  assert.equal(await validateMobileEvidence(payload, p.metadata), 34);
  const forged = structuredClone(payload);
  forged.mobile.comparison.rows[0].waterEffectsComparison.proof.resources.programs++;
  await assert.rejects(validateMobileEvidence(forged, p.metadata), /report differs from captures/);
  delete payload.record.files['test-results/mobile-comparison/pr-pc-bite.json'];
  await assert.rejects(validateMobileEvidence(payload, p.metadata), /Missing mobile artifact/);
});

test('CLI rejects malformed/missing JSON or a forged draw with nonzero exit before report success', async () => {
  const p = await waterGateFixture(), root = await mkdtemp(join(tmpdir(), 'barb-water-cli-'));
  try {
    for (const e of [...p.before, ...p.after]) e.comparison = p.metadata;
    p.after.find(e => e.id === 'pc-bite').metrics.fishingDisplay.passes.fixed.draws.waterEffects.calls++;
    const before = join(root, 'main.json'), after = join(root, 'pr.json'), report = join(root, 'report.html');
    await writeFile(before, JSON.stringify(p.before)); await writeFile(after, JSON.stringify(p.after));
    await assert.rejects(exec(process.execPath, ['scripts/compare-mobile-performance.mjs', before, after, report]), e => e.code === 1 && /source submissions/.test(e.stderr));
    await writeFile(after, '{');
    await assert.rejects(exec(process.execPath, ['scripts/compare-mobile-performance.mjs', before, after, report]), e => e.code === 1);
    await rm(after);
    await assert.rejects(exec(process.execPath, ['scripts/compare-mobile-performance.mjs', before, after, report]), e => e.code === 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});
