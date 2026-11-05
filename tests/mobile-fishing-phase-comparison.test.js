import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Scene, Mesh, RingGeometry, CircleGeometry, MeshBasicMaterial, PerspectiveCamera, DoubleSide } from 'three';
import { mobileGit, readMobileImplementation, mobileSourceMetadata, replayMobileCamera } from '../scripts/lib/mobile-comparison-source.js';
import { FISHING_PHASE_BASE, FISHING_PHASE_IDS, verifyFishingPhaseConnection, readMobileFishingPhaseTransition,
  fishingDisplayDraws, expectedFishingPhaseResources } from '../scripts/lib/mobile-rod-reel-replay.js';
import { compareMobileCapturesWithSources, compareMobileCapturePairWithSources, MOBILE_CAPTURE_IDS } from '../scripts/compare-mobile-performance.mjs';
import { validateMobileEvidence } from '../scripts/ci-summary.js';
import { PHASE_VIEW_BLOB, phaseFixtureCommit, phaseCapture, fishingPhaseGateFixture } from './helpers/fishing-phase-fixture.js';

const exec = promisify(execFile);

test('5F-1A reverses only its complete reviewed display edits and rejects unrelated rendering changes', async () => {
  const before = await mobileGit('show', `${FISHING_PHASE_BASE}:src/rendering/fishing.js`), after = await mobileGit('show', PHASE_VIEW_BLOB);
  verifyFishingPhaseConnection(before, after);
  for (const [from, to] of [['s.distance * 0.18', 's.distance * 0.19'], ['fishing.settings.flightSeconds', '.9'],
    ['0.6, 1.5, 1', '0.6, 2, 1'], ["color: '#173d37'", "color: '#000000'"],
    ['positions[4] = 0.12', 'positions[4] = 0.15'], ['shadow.rotation.z = -s.heading', 'shadow.rotation.z = s.heading'],
    ['s.phase !== PHASE.AIM && rodTipWorld != null', 'rodTipWorld != null']]) {
    assert.notEqual(after.replace(from, to), after);
    assert.throws(() => verifyFishingPhaseConnection(before, after.replace(from, to)), /5F-1A/);
  }
});

test('5F-1A source proof is confined to its base, one exact product patch and unchanged build/save/input/camera sources', async () => {
  const base = await readMobileImplementation(FISHING_PHASE_BASE), head = await readMobileImplementation(phaseFixtureCommit());
  assert.equal((await readMobileFishingPhaseTransition(base, head)).kind, 'fishing-phase-5F1A');
  assert.equal(await readMobileFishingPhaseTransition(base, base), null);
  assert.equal(await readMobileFishingPhaseTransition({ ...base, sha: head.sha }, head), null);
  for (const key of ['lockBlob', 'indexBlob', 'viteBlob', 'mainBlob', 'cameraBlob', 'hudBlob', 'hudLogicBlob', 'resolutionBlob']) {
    await assert.rejects(readMobileFishingPhaseTransition(base, { ...head, [key]: '0'.repeat(40) }), /changed invariant source/);
  }
  const extra = phaseFixtureCommit({ 'src/game/fishing.js': (await mobileGit('show', `${base.sha}:src/game/fishing.js`)) + '\n// Unapproved extra change\n' });
  await assert.rejects(readMobileFishingPhaseTransition(base, await readMobileImplementation(extra)), /unrelated product source/);
  const save = phaseFixtureCommit({ 'tests/fixtures/saves/lighting-save-v1.json': '{}' });
  await assert.rejects(readMobileFishingPhaseTransition(base, await readMobileImplementation(save)), /changed fixture\/build input/);
});

test('submission replay distinguishes two-pass Ring, opaque lure, and frustum-culled meshes per camera', () => {
  const scene = new Scene(), material = new MeshBasicMaterial({ transparent: true, side: DoubleSide });
  const ring = new Mesh(new RingGeometry(.6, .7, 40), material), lure = new Mesh(new CircleGeometry(.5, 16), new MeshBasicMaterial());
  ring.position.z = lure.position.z = -10; scene.add(ring, lure);
  const camera = new PerspectiveCamera(55, 1, .1, 2400);
  try {
    assert.deepEqual(fishingDisplayDraws({ ring, lure }, camera), { ring: { calls: 2, triangles: 160 }, lure: { calls: 1, triangles: 16 } });
    lure.position.x = 100;
    assert.deepEqual(fishingDisplayDraws({ ring, lure }, camera).lure, { calls: 0, triangles: 0 });
    camera.position.x = 100;
    assert.deepEqual(fishingDisplayDraws({ ring, lure }, camera), { ring: { calls: 0, triangles: 0 }, lure: { calls: 1, triangles: 16 } });
    scene.visible = false;
    assert.deepEqual(fishingDisplayDraws({ ring, lure }, camera), { ring: { calls: 0, triangles: 0 }, lure: { calls: 0, triangles: 0 } });
  } finally { ring.geometry.dispose(); lure.geometry.dispose(); material.dispose(); lure.material.dispose(); }
});

test('only nine of the unchanged 34 IDs get source-replayed reductions; both renderer passes remain exact', async () => {
  const evidence = await fishingPhaseGateFixture();
  assert.equal(evidence.comparison.rows.length, 34);
  const changed = evidence.comparison.rows.filter(row => row.fishingPhaseComparison);
  assert.deepEqual(changed.map(row => row.id).sort(), [...FISHING_PHASE_IDS].sort());
  assert.equal(changed.length, 9);
  for (const row of changed) for (const pass of ['resources', 'actualResources']) {
    assert.equal(row.after[pass].calls - row.before[pass].calls, row.id.endsWith('bite') ? -1 : -3);
    assert.equal(row.after[pass].triangles - row.before[pass].triangles, row.id.endsWith('bite') ? -80 : -240);
    for (const key of ['geometries', 'textures', 'programs']) assert.equal(row.after[pass][key], row.before[pass][key]);
  }
  assert.equal(evidence.comparison.rows.filter(row => !row.fishingPhaseComparison).length, 25);
});

test('a mesh culled in the before camera grants zero reduction, and non-hidden submissions cannot change', () => {
  const draw = { ring: { calls: 2, triangles: 160 }, lure: { calls: 0, triangles: 0 }, shadow: { calls: 0, triangles: 0 }, line: { calls: 1, triangles: 0 } };
  const before = { phase: 'bite', state: { origin: { x: 10, z: 20 }, heading: 0, lureId: 'minnow' }, draws: { actual: draw } };
  const after = structuredClone(before), counters = { calls: 35, triangles: 276148, geometries: 28, textures: 4, programs: 14 };
  assert.deepEqual(expectedFishingPhaseResources(counters, counters, 'actual', before, after), counters);
  assert.throws(() => expectedFishingPhaseResources(counters, { ...counters, calls: 34, triangles: 276068 }, 'actual', before, after), /resource regression/);
  for (const value of [null, undefined, NaN, Infinity, -.5]) {
    assert.throws(() => expectedFishingPhaseResources({ ...counters, calls: value }, counters, 'actual', before, after), /invalid renderer counter/);
  }
  after.draws.actual.line.calls = 0;
  assert.throws(() => expectedFishingPhaseResources(counters, counters, 'actual', before, after), /non-hidden line/);
});

test('unknown IDs, unexpected increases/decreases and missing or substituted per-pass counters fail closed', async () => {
  const original = await fishingPhaseGateFixture();
  const cases = [
    ['unknown ID', p => { p.after[0].id = 'unrecognized'; }, /Missing\/duplicate mobile capture/],
    ['unaffected fixed', p => { p.after[0].metrics.resources.calls--; }, /resource regression/],
    ['unaffected actual', p => { p.after[0].metrics.actualResources.triangles--; }, /production-view resource regression/],
    ['missing JSON', p => { delete p.after.find(e => e.id === 'pc-bite').metrics.fishingDisplay; }, /missing fishing display JSON/],
    ['missing actual', p => { delete p.after.find(e => e.id === 'pc-fight').metrics.actualResources; }, /substituted actual renderer counters/],
    ['counter substitution', p => { const e = p.after.find(e => e.id === 'pc-fight'); e.metrics.resources = e.metrics.actualResources; }, /substituted fixed renderer counters/],
    ['pass substitution', p => { const e = p.after.find(e => e.id === 'pc-fight'); e.metrics.fishingDisplay.passes.fixed = e.metrics.fishingDisplay.passes.actual; }, /substituted fixed camera/],
    ['forged submissions', p => { p.after.find(e => e.id === 'pc-fight').metrics.fishingDisplay.passes.actual.draws.lure.calls = 1; }, /submissions differ/],
    ['old airborne end', p => { p.after.find(e => e.id === 'pc-fight').metrics.fishingDisplay.line[4] = Math.fround(.15); }, /actual line differs/],
  ];
  for (const pass of ['resources', 'actualResources']) for (const field of ['calls', 'triangles', 'geometries', 'textures', 'programs']) for (const amount of [-1, 1]) {
    cases.push([`${pass}/${field}/${amount}`, p => {
      const e = p.after.find(e => e.id === 'pc-bite');
      e.metrics[pass][field] += amount;
      e.metrics.fishingDisplay.passes[pass === 'resources' ? 'fixed' : 'actual'].resources[field] += amount;
    }, /resource regression/]);
  }
  for (const [label, mutate, error] of cases) {
    const p = structuredClone(original); mutate(p);
    await assert.rejects(compareMobileCapturesWithSources(p.before, p.after, p.metadata), error, label);
  }
});

test('forged SHA, camera, phase/time history, or merge parents cannot authorize 5F-1A', async () => {
  const original = await fishingPhaseGateFixture();
  for (const [label, mutate, error] of [
    ['SHA', p => { p.metadata.implementations.pr.fishingViewBlob = '0'.repeat(40); }, /implementation provenance differs/],
    ['camera', p => { const e = p.after.find(e => e.id === 'pc-bite'); e.metrics.camera.quaternion[0] += .01; e.metrics.cameraExpected = e.metrics.camera; }, /differs from source/],
    ['elapsed', p => { p.after.find(e => e.id === 'pc-bite').metrics.fishingDisplay.elapsed += .25; }, /elapsed differs/],
    ['phase', p => { p.after.find(e => e.id === 'pc-bite').metrics.fishingDisplay.phase = 'lure'; }, /display phase differs/],
    ['history', p => { p.after.find(e => e.id === 'pc-bite').metrics.cameraFrames.at(-1).phase = 'lure'; }, /phase differs from native source replay/],
  ]) {
    const p = structuredClone(original); mutate(p);
    await assert.rejects(compareMobileCapturesWithSources(p.before, p.after, p.metadata), error, label);
  }
  const p = structuredClone(original), head = p.metadata.headSha;
  const validation = await readMobileImplementation(phaseFixtureCommit({}, [head, FISHING_PHASE_BASE]));
  p.metadata.validationSha = validation.sha; p.metadata.implementations.pr = mobileSourceMetadata(validation);
  await assert.rejects(compareMobileCapturesWithSources(p.before, p.after, p.metadata), /not the recorded base\/HEAD merge/);
});

test('rotated-fight uses its dedicated 5F-1A proof and independently replays both histories with both rigs', async () => {
  const p = await fishingPhaseGateFixture();
  const base = await readMobileImplementation(p.metadata.baseSha), head = await readMobileImplementation(p.metadata.validationSha);
  const before = await phaseCapture(base, 'rotated-fight'), after = await phaseCapture(head, 'rotated-fight', .032);
  assert.notDeepEqual(before.metrics.camera, after.metrics.camera);
  const row = await compareMobileCapturePairWithSources(before, after, p.metadata);
  assert.equal(row.cameraComparison.normalizedHistories, 2);
  assert.equal(row.fishingPhaseComparison.proof.kind, 'fishing-phase-5F1A');
  assert.equal(row.castDisplayComparison, undefined);
  after.metrics.cameraFrames.at(-1).tracking.z += .25;
  after.metrics.camera = replayMobileCamera(head, after.metrics.cameraFrames); after.metrics.cameraExpected = after.metrics.camera;
  await assert.rejects(compareMobileCapturePairWithSources(before, after, p.metadata), /tracking z: differs from source FIGHT replay/);
});

test('the unchanged final gate replays all 34 pairs and rejects a tampered report or missing individual JSON', async () => {
  const p = await fishingPhaseGateFixture();
  const payload = { record: { files: p.files }, mobile: { metadata: p.metadata, before: p.before, after: p.after, comparison: p.comparison } };
  assert.equal(await validateMobileEvidence(payload, p.metadata), 34);
  const forged = structuredClone(payload);
  forged.mobile.comparison.rows.find(row => row.id === 'pc-bite').fishingPhaseComparison.beforeDraws.fixed.lure.calls = 0;
  await assert.rejects(validateMobileEvidence(forged, p.metadata), /report differs from captures/);
  delete payload.record.files['test-results/mobile-comparison/main-pc-bite.json'];
  await assert.rejects(validateMobileEvidence(payload, p.metadata), /Missing mobile artifact/);
});

test('the unchanged comparison CLI exits nonzero for a resource forgery before writing a report', async () => {
  const p = await fishingPhaseGateFixture(), root = await mkdtemp(join(tmpdir(), 'barb-phase-cli-'));
  try {
    p.after.find(entry => entry.id === 'pc-fight').metrics.resources.calls++;
    for (const entry of [...p.before, ...p.after]) entry.comparison = p.metadata;
    await writeFile(join(root, 'before.json'), JSON.stringify(p.before)); await writeFile(join(root, 'after.json'), JSON.stringify(p.after));
    await assert.rejects(exec(process.execPath, ['scripts/compare-mobile-performance.mjs', join(root, 'before.json'), join(root, 'after.json'), join(root, 'report.html')]),
      error => error.code === 1 && /substituted fixed renderer counters/.test(error.stderr));
  } finally { await rm(root, { recursive: true, force: true }); }
});
