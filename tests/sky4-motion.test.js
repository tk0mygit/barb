import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Frustum, Matrix4, PerspectiveCamera } from 'three';
import { readMobileImplementation, mobileGit } from '../scripts/lib/mobile-comparison-source.js';
import { SKY4_MOTION_BASE, readAuroraTransition, readSky4MotionTransition, verifyAuroraMotionEdit } from '../scripts/lib/sky4-motion-source.js';
import { readAuroraSource, replayAuroraCapture } from '../scripts/lib/sky4-source.js';
import { compareMobileCapturePairWithSources } from '../scripts/compare-mobile-performance.mjs';
import { validateMobileEvidence } from '../scripts/ci-summary.js';
import { writeComparison } from '../scripts/compare-lake-scenery.mjs';
import { motionFixtureCommit, motionGateFixture } from './helpers/sky4-motion-fixture.js';
import { auroraCapture } from './helpers/sky4-fixture.js';

test('motion transition binds the exact merged base, tuned blobs, literal manifest and validation merge parents', async () => {
  const main = await readMobileImplementation(SKY4_MOTION_BASE), pr = await readMobileImplementation(motionFixtureCommit());
  assert.equal((await readAuroraTransition(main, pr)).kind, 'clear-night-aurora-motion-Sky4');
  const merge = await readMobileImplementation(motionFixtureCommit({}, main.sha, pr.sha));
  await readSky4MotionTransition(main, merge, pr.sha);
  await assert.rejects(readSky4MotionTransition(main, merge, main.sha), /merge parents/);
  const old = await mobileGit('show', `${main.sha}:src/world/aurora.js`), tuned = await mobileGit('show', `${pr.sha}:src/world/aurora.js`);
  verifyAuroraMotionEdit(old, tuned);
  for (const change of [old, tuned.replace('probability: .20', 'probability: .19'), tuned.replace('fadeSeconds: 15', 'fadeSeconds: 12'),
    tuned.replace('timeWrapSeconds: 720', 'timeWrapSeconds: 180'), tuned.replace('0.03490658503988', '0.035'),
    tuned.replace('0.34 - auroraLayer', '0.40 - auroraLayer'), tuned.replace('vec3(0.035, 0.53, 0.22)', 'vec3(1.0)'), tuned + '\n// unrelated']) {
    assert.throws(() => verifyAuroraMotionEdit(old, change), /outside approved/);
    await assert.rejects(readAuroraTransition(main, await readMobileImplementation(motionFixtureCommit({ 'src/world/aurora.js': change }))), /Sky-4 motion/);
  }
  for (const path of ['src/world/lake.js', 'src/world/stars.js', 'src/world/meteor.js', 'src/world/night-fog.js', 'src/game/game-clock.js',
    'src/game/save-data.js', 'src/main.js', 'package-lock.json', 'scripts/lib/sky4-source.js', 'scripts/lib/sky4-source-pins.js',
    'scripts/lib/sky2-source.js', 'scripts/lib/sky3-source.js', 'tests/helpers/sky4-fixture.js', 'tests/helpers/aurora-snapshot.js',
    'scripts/compare-mobile-performance.mjs', 'scripts/lib/sky4-motion-source.js', 'scripts/lib/sky4-motion-pins.js']) {
    const text = await mobileGit('show', `${pr.sha}:${path}`);
    await assert.rejects(readAuroraTransition(main, await readMobileImplementation(motionFixtureCommit({ [path]: text + '\n// unrelated' }))), /Sky-4 motion/);
  }
  await assert.rejects(readSky4MotionTransition(await readMobileImplementation('9277dbef6d7a2ab39c9f257041d519384c704635'), pr), /unapproved base/);
});

test('motion replay retains all 34 synthetic pairs, both cameras and final 68-image provenance/completeness gate', async () => {
  const p = await motionGateFixture(); assert.equal(p.comparison.rows.length, 34);
  for (const row of p.comparison.rows) {
    assert.equal(row.auroraComparison.proof.kind, 'clear-night-aurora-motion-Sky4');
    assert.deepEqual(row.after.resources, row.before.resources); assert.deepEqual(row.after.actualResources, row.before.actualResources);
  }
  assert.equal(await validateMobileEvidence({ record: { files: p.files }, mobile: p }, p.metadata), 34);
  const bad = structuredClone(p); bad.comparison.rows[0].auroraComparison.proof.tuning.speedMultiplier = 1;
  await assert.rejects(validateMobileEvidence({ record: { files: p.files }, mobile: bad }, p.metadata), /report differs/);
  const missing = { ...p.files }; delete missing['test-results/mobile-comparison/main-pc-clear-night.png'];
  await assert.rejects(validateMobileEvidence({ record: { files: missing }, mobile: p }, p.metadata), /Missing mobile artifact/);
});

test('old shader evidence, foreign buffers/programs, extra draws/textures and CLI/final-gate regressions fail', async () => {
  const p = await motionGateFixture(), before = p.before.find(e => e.id === 'pc-clear-night'), good = p.after.find(e => e.id === before.id);
  for (const change of [m => { m.auroraDisplay.snapshot = before.metrics.auroraDisplay.snapshot; },
    m => { m.auroraDisplay.gpu.layers[1].programKeys = ['foreign']; }, m => { m.auroraDisplay.gpu.buffers.uv.uploads++; },
    m => { m.auroraDisplay.draws.actual[0].calls++; }, m => { m.auroraDisplay.draws.fixed[1].triangles++; },
    ...['resources', 'actualResources'].flatMap(pass => ['calls', 'triangles', 'geometries', 'programs', 'textures'].map(key => m => { m[pass][key]++; }))]) {
    const bad = structuredClone(good); change(bad.metrics);
    await assert.rejects(compareMobileCapturePairWithSources(before, bad, p.metadata));
  }
  p.after[0].metrics.actualResources.calls++;
  await assert.rejects(validateMobileEvidence({ record: { files: p.files }, mobile: p }, p.metadata), /actual resource regression/);
  const dir = await mkdtemp(join(tmpdir(), 'barb-motion-cli-'));
  try {
    await writeFile(join(dir, 'main.json'), JSON.stringify(p.before)); await writeFile(join(dir, 'pr.json'), JSON.stringify(p.after));
    const result = spawnSync(process.execPath, ['scripts/compare-mobile-performance.mjs', join(dir, 'main.json'), join(dir, 'pr.json'),
      join(dir, 'comparison.html'), 'regression', p.metadata.baseSha, p.metadata.headSha], { encoding: 'utf8' });
    assert.equal(result.status, 1); assert.match(result.stderr, /actual resource regression/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('cold scenery uses the motion source transition and rejects every extra resource without a generic fallback', async () => {
  const main = await readMobileImplementation(SKY4_MOTION_BASE), pr = await readMobileImplementation(motionFixtureCommit());
  const views = async implementation => {
    const rows = [];
    for (const id of ['day-tps', 'day-fps', 'twilight', 'clear-night', 'fog-night', 'dense-night', 'portrait', 'landscape']) {
      const entry = await auroraCapture(implementation, `pc-${['twilight', 'portrait', 'landscape'].includes(id) ? 'day-tps' : id}`, { warmed: false }), m = entry.metrics;
      m.camera = { ...m.camera, fov: 55 }; m.cameraEvidence = { sha: implementation.sha, cameraBlob: implementation.cameraBlob, frames: m.cameraFrames };
      m.resources = m.actualResources; delete m.fixedResources;
      Object.assign(m, { deviceScaleFactor: 1, boat: [10, 20], heading: 0, waterTime: .25, fogStrength: 0 }); rows.push([id, { metrics: m, image: '' }]);
    }
    return new Map(rows);
  };
  const before = await views(main), after = await views(pr), dir = await mkdtemp(join(tmpdir(), 'barb-motion-scenery-'));
  try {
    const output = join(dir, 'comparison.html'), rows = await writeComparison(before, after, output);
    assert.equal(rows.length, 8); assert(rows.every(row => row.auroraComparison.kind === 'clear-night-aurora-motion-Sky4'));
    for (const key of ['calls', 'triangles', 'geometries', 'programs', 'textures']) {
      const bad = structuredClone(after); bad.get('clear-night').metrics.resources[key]++;
      await assert.rejects(writeComparison(before, bad, output), /actual resource regression/);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('tuned displacement stays within the padded bound, culls behind and preserves integer-period wrap', async () => {
  const source = await readAuroraSource(motionFixtureCommit()), aurora = source.createAurora();
  try {
    const [a, b] = aurora.meshes, g = a.geometry;
    assert.equal(g, b.geometry); assert.equal(a.material.vertexShader, b.material.vertexShader); assert.equal(a.material.fragmentShader, b.material.fragmentShader);
    const k = Number(a.material.vertexShader.match(/auroraTime \* ([\d.]+)/)[1]);
    assert.equal(k, 4 * .00872664625997);
    const position = g.attributes.position, uv = g.attributes.uv, c = g.boundingSphere.center;
    for (const time of [0, 2, 5, 10, 90, 719.999999, 720, 2 ** 40 % 720]) for (const layer of [0, 1]) for (let i = 0; i < position.count; i++) {
      const u = uv.getX(i), v = uv.getY(i), t = time % 720 * k, p = 2.9 + layer * .8;
      const x = position.getX(i) + 45 * Math.sin(u * 10 + t * 3 + p) * Math.sin(v * 2.4 + .2);
      const y = position.getY(i) + 29 * Math.sin(u * 15 - t * 2 + p), z = position.getZ(i);
      assert(Math.hypot(x - c.x, y - c.y, z - c.z) <= g.boundingSphere.radius);
    }
    for (const harmonic of [2, 3, 4]) for (const phase of [0, .8, 2.9]) {
      assert(Math.abs(Math.sin(720 * k * harmonic + phase) - Math.sin(phase)) < 1e-10);
      assert(Math.abs(Math.sin((720 - 1e-7) * k * harmonic + phase) - Math.sin(1e-7 * k * harmonic + phase)) < 3e-8);
    }
    const camera = new PerspectiveCamera(55, 1, .1, 2400); camera.rotation.y = Math.PI; camera.updateMatrixWorld();
    assert.equal(new Frustum().setFromProjectionMatrix(new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)).intersectsObject(a), false);
    const pr = await readMobileImplementation(motionFixtureCommit()), entry = await auroraCapture(pr, 'pc-clear-night');
    const away = structuredClone(entry.metrics); away.camera.quaternion = [0, 1, 0, 0];
    const replay = await replayAuroraCapture(pr, away, { warmed: false }); assert.equal(replay.draws.actual.reduce((n, r) => n + r.calls, 0), 0);
  } finally { aurora.dispose(); }
});
