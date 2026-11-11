import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SKY2_BASE, readSky2Transition, verifyStarConnection, replayStarCapture } from '../scripts/lib/sky2-source.js';
import { readMobileImplementation, mobileGit, replayMobileCamera } from '../scripts/lib/mobile-comparison-source.js';
import { compareMobileCapturePairWithSources } from '../scripts/compare-mobile-performance.mjs';
import { writeComparison } from '../scripts/compare-lake-scenery.mjs';
import { validateMobileEvidence } from '../scripts/ci-summary.js';
import { sky2FixtureCommit, starGateFixture } from './helpers/sky2-fixture.js';

test('Sky-2 source transition reverses only the complete lake connection and pins the star/observer blobs', async () => {
  const main = await readMobileImplementation(SKY2_BASE), pr = await readMobileImplementation(sky2FixtureCommit());
  const proof = await readSky2Transition(main, pr); assert.equal(proof.kind, 'clear-night-stars-Sky2');
  const before = await mobileGit('show', `${main.sha}:src/world/lake.js`), after = await mobileGit('show', `${pr.sha}:src/world/lake.js`);
  verifyStarConnection(before, after);
  assert.throws(() => verifyStarConnection(before, after + '\n'), /unrelated lake/);
  for (const path of ['src/world/lake.js', 'src/world/stars.js', 'src/world/night-fog.js', 'src/main.js',
    'src/rendering/camera.js', 'tests/browser/mobile-performance.spec.js', 'tests/helpers/star-snapshot.js']) {
    const source = await mobileGit('show', `${pr.sha}:${path}`);
    const invalid = await readMobileImplementation(sky2FixtureCommit({ [path]: source + '\n// unrelated\n' }));
    await assert.rejects(readSky2Transition(main, invalid), /Sky-2/);
  }
});

test('all 34 synthetic pairs and final gate replay exact star visibility/geometry/time; warmup and actual counters stay separate', async () => {
  const p = await starGateFixture();
  assert.equal(p.comparison.rows.length, 34);
  for (const row of p.comparison.rows) {
    const calls = row.id.endsWith('clear-night') ? 1 : 0;
    assert.equal(row.after.resources.calls - row.before.resources.calls, calls);
    assert.equal(row.after.actualResources.calls - row.before.actualResources.calls, calls);
    assert.equal(row.after.resources.geometries - row.before.resources.geometries, 1);
    assert.equal(row.after.resources.programs - row.before.resources.programs, 1);
    assert.equal(row.after.resources.textures, row.before.resources.textures);
  }
  const payload = { record: { files: p.files }, mobile: p };
  assert.equal(await validateMobileEvidence(payload, p.metadata), 34);
  const forged = structuredClone(payload); forged.mobile.comparison.rows[0].starComparison.proof.resources.textures = 1;
  await assert.rejects(validateMobileEvidence(forged, p.metadata), /report differs from captures/);
  const missing = structuredClone(payload); delete missing.record.files['test-results/mobile-comparison/pr-pc-clear-night.png'];
  await assert.rejects(validateMobileEvidence(missing, p.metadata), /Missing mobile artifact/);
});

test('unrelated geometry/program/texture/calls, non-CLEAR submissions, HUD movement, missing/forged sources and star buffer churn fail', async () => {
  const p = await starGateFixture();
  for (const [id, mutate] of [
    ...['geometries', 'programs', 'textures', 'triangles', 'calls'].flatMap(key => ['resources', 'actualResources'].map(pass =>
      ['pc-clear-night', entry => { entry.metrics[pass][key]++; }])),
    ['pc-day-tps', entry => { entry.metrics.starDisplay.draws.fixed = 1; entry.metrics.resources.calls++; }],
    ['pc-fog-night', entry => { entry.metrics.starDisplay.snapshot.visible = true; entry.metrics.starDisplay.draws.actual = 1; }],
    ['pc-dense-night', entry => { entry.metrics.starDisplay.snapshot.uniforms.starOpacity = .01; }],
    ['pc-clear-night', entry => { entry.metrics.starDisplay.snapshot.attributes.position.array[0]++; }],
    ['pc-clear-night', entry => { entry.metrics.starDisplay.snapshot.attributes.position.version++; }],
    ['pc-clear-night', entry => { entry.metrics.starDisplay.clockSeconds += 1; }],
    ['pc-clear-night', entry => { delete entry.metrics.starDisplay; }],
    ['pc-fight', entry => { entry.layout.panel.x++; }],
  ]) {
    const before = p.before.find(entry => entry.id === id), after = structuredClone(p.after.find(entry => entry.id === id));
    mutate(after); await assert.rejects(compareMobileCapturePairWithSources(before, after, p.metadata));
  }
  const metadata = structuredClone(p.metadata); metadata.implementations.pr.starsBlob = '0'.repeat(40);
  await assert.rejects(compareMobileCapturePairWithSources(p.before[0], p.after[0], metadata), /provenance differs/);
});

test('scenery grants only the cold CLEAR-night batch and rejects extra resources, camera/clock changes or fog stars', async () => {
  const main = await readMobileImplementation(SKY2_BASE), pr = await readMobileImplementation(sky2FixtureCommit());
  async function views(implementation) {
    const entries = [];
    for (const id of ['day-tps', 'day-fps', 'twilight', 'clear-night', 'fog-night', 'dense-night', 'portrait', 'landscape']) {
      const frames = [{ update: false, dt: 0, aspect: 1000 / 700, mode: 'sailing', phase: 'inactive', preparing: false, tracking: null }];
      const camera = { ...replayMobileCamera(implementation, frames), fov: 55 };
      const seconds = id === 'clear-night' ? 1710 : id === 'fog-night' ? 3971 * 360 + 270 : id === 'dense-night' ? 630 : 90;
      const metrics = { viewport: { width: 1000, height: 700 }, deviceScaleFactor: 1, savedClockSeconds: seconds,
        boat: [10, 20], heading: 0, waterTime: .25, fogStrength: 0, camera,
        cameraEvidence: { sha: implementation.sha, cameraBlob: implementation.cameraBlob, frames }, starDisplay: { clockSeconds: seconds } };
      const replay = await replayStarCapture(implementation, metrics, { warmed: false });
      metrics.starDisplay.snapshot = replay.snapshot; metrics.starDisplay.draws = replay.draws;
      metrics.resources = { calls: 31 + replay.draws.actual, triangles: 275444,
        geometries: 20 + Number(replay.initialized), textures: 4, programs: 10 + Number(replay.initialized) };
      entries.push([id, { metrics, image: '' }]);
    }
    return new Map(entries);
  }
  const before = await views(main), after = await views(pr), directory = await mkdtemp(join(tmpdir(), 'barb-sky2-scenery-'));
  try {
    const output = join(directory, 'comparison.html');
    assert.equal((await writeComparison(before, after, output)).length, 8);
    for (const [id, mutate] of [
      ...['geometries', 'programs', 'textures', 'calls', 'triangles'].map(key => ['clear-night', m => { m.resources[key]++; }]),
      ['fog-night', m => { m.starDisplay.draws.actual = 1; m.resources.calls++; }],
      ['clear-night', m => { m.camera.position[0]++; }], ['clear-night', m => { m.savedClockSeconds++; }],
    ]) {
      const bad = structuredClone(after); mutate(bad.get(id).metrics);
      await assert.rejects(writeComparison(before, bad, output));
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
