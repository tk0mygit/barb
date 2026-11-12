import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SKY3_BASE, readSky3Transition, verifyMeteorConnection, replayMeteorCapture, verifyMeteorCapture, expectedMeteorResources } from '../scripts/lib/sky3-source.js';
import { readMobileImplementation, mobileGit, replayMobileCamera } from '../scripts/lib/mobile-comparison-source.js';
import { compareMobileCapturePairWithSources, compareMobileCapturesWithSources } from '../scripts/compare-mobile-performance.mjs';
import { writeComparison } from '../scripts/compare-lake-scenery.mjs';
import { validateMobileEvidence } from '../scripts/ci-summary.js';
import { sky3FixtureCommit, meteorGateFixture, meteorCapture } from './helpers/sky3-fixture.js';
import { findMeteorEvent } from './helpers/meteor-event.js';
import { replayStarCapture } from '../scripts/lib/sky2-source.js';

test('Sky-3 requires the exact Sky-2 main, meteor/observer blobs and reversible three-line lake wiring', async () => {
  const main = await readMobileImplementation(SKY3_BASE), pr = await readMobileImplementation(sky3FixtureCommit());
  const proof = await readSky3Transition(main, pr); assert.equal(proof.kind, 'clear-night-meteor-Sky3');
  const before = await mobileGit('show', `${main.sha}:src/world/lake.js`), after = await mobileGit('show', `${pr.sha}:src/world/lake.js`);
  verifyMeteorConnection(before, after); assert.throws(() => verifyMeteorConnection(before, after + '\n'), /unrelated lake/);
  for (const path of ['src/world/lake.js', 'src/world/meteor.js', 'src/world/stars.js', 'src/world/night-fog.js', 'src/main.js',
    'src/rendering/camera.js', 'src/ui/fishing-hud.js', 'src/rendering/rod-reel-view.js', 'package.json', 'package-lock.json',
    'public/unrelated.txt', 'tests/browser/mobile-performance.spec.js', 'tests/browser/day-night-fixture.js',
    'tests/browser/lake-scenery.spec.js', 'tests/helpers/meteor-snapshot.js']) {
    const source = path.startsWith('public/') ? '' : await mobileGit('show', `${pr.sha}:${path}`);
    const bad = await readMobileImplementation(sky3FixtureCommit({ [path]: source + '\n// unrelated\n' }));
    await assert.rejects(readSky3Transition(main, bad), /Sky-3/);
  }
});

test('all 34 synthetic pairs keep both camera passes exact with warmed +1 geometry/program and zero inactive calls/textures', async () => {
  const p = await meteorGateFixture(); assert.equal(p.comparison.rows.length, 34);
  for (const row of p.comparison.rows) for (const key of ['resources', 'actualResources']) {
    assert.deepEqual(row.after[key], { ...row.before[key], geometries: row.before[key].geometries + 1, programs: row.before[key].programs + 1 });
    assert.equal(row.meteorComparison.afterState.visible, false);
  }
  assert.equal(await validateMobileEvidence({ record: { files: p.files }, mobile: p }, p.metadata), 34);
  const forged = structuredClone(p); forged.comparison.rows[0].meteorComparison.proof.resources.textures = 1;
  await assert.rejects(validateMobileEvidence({ record: { files: p.files }, mobile: forged }, p.metadata), /report differs/);
  const missing = structuredClone(p.files); delete missing['test-results/mobile-comparison/pr-pc-clear-night.png'];
  await assert.rejects(validateMobileEvidence({ record: { files: missing }, mobile: p }, p.metadata), /Missing mobile artifact/);
});

test('extra resources in either pass, inactive submissions, forged clock/phase, buffers, IDs, shader/HUD and provenance fail', async () => {
  const p = await meteorGateFixture();
  for (const [id, mutate] of [
    ...['calls', 'triangles', 'geometries', 'programs', 'textures'].flatMap(key => ['resources', 'actualResources'].map(pass =>
      ['pc-clear-night', e => { e.metrics[pass][key]++; }])),
    ['pc-day-tps', e => { e.metrics.meteorDisplay.draws.fixed.calls = 1; e.metrics.resources.calls++; }],
    ['pc-fog-night', e => { e.metrics.meteorDisplay.snapshot.visible = true; }],
    ['pc-dense-night', e => { e.metrics.meteorDisplay.snapshot.uniforms.meteorOpacity = .01; }],
    ['pc-clear-night', e => { e.metrics.meteorDisplay.snapshot.attributes.position.array[0]++; }],
    ['pc-clear-night', e => { e.metrics.meteorDisplay.snapshot.attributes.position.version++; }],
    ['pc-clear-night', e => { e.metrics.meteorDisplay.gpu.geometryId++; }],
    ['pc-clear-night', e => { e.metrics.meteorDisplay.gpu.materialId++; }],
    ['pc-clear-night', e => { e.metrics.meteorDisplay.gpu.programKeys.push('extra'); }],
    ['pc-clear-night', e => { e.metrics.meteorDisplay.gpu.programInstances++; }],
    ['pc-clear-night', e => { e.metrics.meteorDisplay.gpu.objects++; }],
    ['pc-clear-night', e => { e.metrics.meteorDisplay.clockSeconds++; }],
    ['pc-clear-night', e => { delete e.metrics.meteorDisplay; }],
    ['pc-clear-night', e => { delete e.metrics.actualResources; }],
    ['pc-clear-night', e => { e.metrics.starDisplay.snapshot.uniforms.starOpacity += .01; }],
    ['pc-fight', e => { e.layout.panel.x++; }],
  ]) {
    const b = p.before.find(e => e.id === id), a = structuredClone(p.after.find(e => e.id === id));
    mutate(a); await assert.rejects(compareMobileCapturePairWithSources(b, a, p.metadata));
  }
  const metadata = structuredClone(p.metadata); metadata.implementations.pr.meteorBlob = '0'.repeat(40);
  await assert.rejects(compareMobileCapturePairWithSources(p.before[0], p.after[0], metadata), /provenance differs/);
});

test('ordinary winning saved clocks independently replay the active ribbon and separate camera culling; 5.8s restore never restarts', async () => {
  const pr = await readMobileImplementation(sky3FixtureCommit()), event = findMeteorEvent(), entry = await meteorCapture(pr, 'pc-clear-night');
  const m = entry.metrics;
  m.savedClockSeconds = m.meteorDisplay.clockSeconds = m.starDisplay.clockSeconds = event.start + .8;
  const replay = await replayMeteorCapture(pr, m); m.meteorDisplay.snapshot = replay.snapshot; m.meteorDisplay.draws = replay.draws;
  m.meteorDisplay.gpu.geometryId = replay.snapshot.geometryId; m.meteorDisplay.gpu.materialId = replay.snapshot.materialId;
  assert(replay.snapshot.visible); assert.equal(replay.draws.actual.calls, 1); assert.equal(replay.draws.actual.triangles, 2);
  assert(Math.abs(replay.snapshot.uniforms.meteorProgress - .8 / 1.1) < 1e-9);
  await verifyMeteorCapture(pr, entry);
  const opposite = structuredClone(m); opposite.camera.quaternion = [0, 1, 0, 0];
  const culled = await replayMeteorCapture(pr, opposite); assert.equal(culled.draws.actual.calls, 0); assert.equal(culled.draws.fixed.calls, 1);
  const reset = structuredClone(entry); reset.metrics.meteorDisplay.snapshot.uniforms.meteorProgress = 0;
  await assert.rejects(verifyMeteorCapture(pr, reset), /animation differs/);
  for (const pass of ['fixed', 'actual']) {
    const before = { calls: 31, triangles: 100, geometries: 20, programs: 10, textures: 4 };
    const base = { draws: { [pass]: { calls: 0, triangles: 0 } }, initialized: false };
    const expected = { ...before, calls: before.calls + replay.draws[pass].calls, triangles: before.triangles + replay.draws[pass].triangles, geometries: 21, programs: 11 };
    expectedMeteorResources(before, expected, base, replay, pass);
    assert.throws(() => expectedMeteorResources(before, { ...expected, calls: expected.calls + 1 }, base, replay, pass));
  }
});

test('cold replay retains the one earlier upload after the meteor ends and rejects a fabricated GPU lifetime', async () => {
  const pr = await readMobileImplementation(sky3FixtureCommit()), event = findMeteorEvent(), entry = await meteorCapture(pr, 'pc-clear-night');
  const m = entry.metrics, first = { update: false, dt: 0, clockDt: 0, aspect: m.camera.aspect, mode: 'sailing', phase: 'inactive', tracking: null };
  m.cameraFrames = [first, { ...first, update: true, dt: .25, clockDt: 2 }];
  m.camera = replayMobileCamera(pr, m.cameraFrames);
  m.savedClockSeconds = event.start + .3; m.meteorDisplay.clockSeconds = m.starDisplay.clockSeconds = m.savedClockSeconds + 2;
  const replay = await replayMeteorCapture(pr, m, { warmed: false });
  assert.equal(replay.snapshot.visible, false); assert.equal(replay.initialized, true); assert.equal(replay.draws.actual.calls, 0);
  m.meteorDisplay.snapshot = replay.snapshot; m.meteorDisplay.draws = replay.draws;
  m.meteorDisplay.gpu.geometryId = replay.snapshot.geometryId; m.meteorDisplay.gpu.materialId = replay.snapshot.materialId;
  await verifyMeteorCapture(pr, entry, { warmed: false });
  const forged = structuredClone(entry); forged.metrics.cameraFrames.shift();
  await assert.rejects(verifyMeteorCapture(pr, forged, { warmed: false }), /shader identity|extra\/missing shader/);
});

test('scenery cold comparison grants only the exact rendered meteor delta; no generic +3calls/+15% fallback', async () => {
  const main = await readMobileImplementation(SKY3_BASE), pr = await readMobileImplementation(sky3FixtureCommit()), event = findMeteorEvent();
  async function views(implementation) {
    const entries = [];
    for (const id of ['day-tps', 'day-fps', 'twilight', 'clear-night', 'fog-night', 'dense-night', 'portrait', 'landscape']) {
      const frames = [{ update: false, dt: 0, clockDt: 0, aspect: 1000 / 700, mode: 'sailing', phase: 'inactive', tracking: null }];
      const camera = { ...replayMobileCamera(implementation, frames), fov: 55 };
      const seconds = id === 'clear-night' ? event.start + .55 : id === 'fog-night' ? 3971 * 360 + 270 : id === 'dense-night' ? 630 : 90;
      const metrics = { viewport: { width: 1000, height: 700 }, deviceScaleFactor: 1, savedClockSeconds: seconds,
        boat: [10, 20], heading: 0, waterTime: .25, fogStrength: 0, camera,
        cameraEvidence: { sha: implementation.sha, cameraBlob: implementation.cameraBlob, frames }, starDisplay: { clockSeconds: seconds }, meteorDisplay: { clockSeconds: seconds } };
      const stars = await replayStarCapture(implementation, metrics, { warmed: false }), meteor = await replayMeteorCapture(implementation, metrics, { warmed: false });
      metrics.starDisplay.snapshot = stars.snapshot; metrics.starDisplay.draws = stars.draws;
      metrics.meteorDisplay.snapshot = meteor.snapshot; metrics.meteorDisplay.draws = meteor.draws;
      metrics.meteorDisplay.gpu = meteor.snapshot ? { geometryId: meteor.snapshot.geometryId, materialId: meteor.snapshot.materialId,
        programKeys: meteor.initialized ? ['synthetic-unit-meteor'] : [], programInstances: Number(meteor.initialized), objects: 1 } : null;
      metrics.resources = { calls: 31 + meteor.draws.actual.calls, triangles: 275444 + meteor.draws.actual.triangles,
        geometries: 20 + Number(meteor.initialized), textures: 4, programs: 10 + Number(meteor.initialized) };
      entries.push([id, { metrics, image: '' }]);
    }
    return new Map(entries);
  }
  const before = await views(main), after = await views(pr), directory = await mkdtemp(join(tmpdir(), 'barb-sky3-scenery-'));
  try {
    const output = join(directory, 'comparison.html'); assert.equal((await writeComparison(before, after, output)).length, 8);
    for (const [id, mutate] of [
      ...['calls', 'triangles', 'geometries', 'programs', 'textures'].map(key => ['clear-night', m => { m.resources[key]++; }]),
      ['fog-night', m => { m.meteorDisplay.snapshot.visible = true; }],
      ['clear-night', m => { m.meteorDisplay.snapshot.uniforms.meteorProgress = 0; }],
      ['clear-night', m => { m.camera.position[0]++; }],
    ]) { const bad = structuredClone(after); mutate(bad.get(id).metrics); await assert.rejects(writeComparison(before, bad, output)); }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('mobile comparison CLI awaits Sky-3 source replay and exits nonzero for an actual-camera regression', async () => {
  const p = await meteorGateFixture(), directory = await mkdtemp(join(tmpdir(), 'barb-sky3-cli-'));
  try {
    p.after[0].metrics.actualResources.calls++;
    const before = join(directory, 'main.json'), after = join(directory, 'pr.json');
    await writeFile(before, JSON.stringify(p.before)); await writeFile(after, JSON.stringify(p.after));
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/compare-mobile-performance.mjs', import.meta.url)),
      before, after, join(directory, 'comparison.html'), 'regression', p.metadata.baseSha, p.metadata.headSha], { encoding: 'utf8' });
    assert.equal(result.status, 1); assert.match(result.stderr, /Sky-3: actual resource regression/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
