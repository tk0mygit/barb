import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readMobileImplementation, mobileGit } from '../scripts/lib/mobile-comparison-source.js';
import { SKY4R2_BASE, readSky4R2Transition, readAuroraEvolution, verifySky4R2Product, readWorldLightSource } from '../scripts/lib/sky4r2-source.js';
import { compareMobileCapturePairWithSources } from '../scripts/compare-mobile-performance.mjs';
import { validateMobileEvidence } from '../scripts/ci-summary.js';
import { writeComparison } from '../scripts/compare-lake-scenery.mjs';
import { worldFixtureCommit, worldGateFixture, worldCapture } from './helpers/sky4r2-fixture.js';

test('R2 transition binds the accepted base, exact three product edits, final observers, HEAD and merge tree', async () => {
  const main = await readMobileImplementation(SKY4R2_BASE), pr = await readMobileImplementation(worldFixtureCommit());
  assert.equal((await readAuroraEvolution(main, pr)).kind, 'aurora-color-world-light-Sky4R2');
  const merge = await readMobileImplementation(worldFixtureCommit({}, main.sha, pr.sha));
  await readSky4R2Transition(main, merge, pr.sha);
  await assert.rejects(readSky4R2Transition(main, merge, main.sha), /merge parents/);
  const stars = await mobileGit('show', `${main.sha}:src/world/stars.js`);
  const badHead = worldFixtureCommit({ 'src/world/stars.js': stars + '\n// hidden head change' });
  await assert.rejects(readSky4R2Transition(main, await readMobileImplementation(worldFixtureCommit({}, main.sha, badHead)), badHead), /tree differs/);
  for (const path of ['src/world/aurora.js', 'src/world/lake.js', 'src/world/water.js']) {
    const base = await mobileGit('show', `${main.sha}:${path}`), next = await mobileGit('show', `${pr.sha}:${path}`);
    verifySky4R2Product(path, base, next);
    assert.throws(() => verifySky4R2Product(path, base, base));
    assert.throws(() => verifySky4R2Product(path, base, next + '\n// unrelated'));
  }
  for (const path of ['src/world/stars.js', 'src/world/meteor.js', 'src/world/night-fog.js', 'src/game/game-clock.js', 'src/main.js',
    'src/game/save-data.js', 'src/world/aurora.js', 'src/world/water.js', 'src/world/lake.js', 'scripts/lib/sky4-source.js',
    'scripts/lib/sky4-source-pins.js', 'scripts/lib/sky4-motion-source.js', 'scripts/lib/sky4-motion-pins.js', 'scripts/lib/sky4r2-source.js',
    'scripts/lib/sky4r2-edits.js', 'scripts/lib/sky4r2-pins.js', 'tests/helpers/aurora-world-light-observer.js',
    'tests/browser/day-night-fixture.js', 'tests/browser/lighting-resource-contract.js', 'tests/browser/aurora.spec.js',
    'scripts/lib/ci-artifacts.js', 'scripts/compare-mobile-performance.mjs', 'scripts/compare-lake-scenery.mjs']) {
    const text = await mobileGit('show', `${pr.sha}:${path}`);
    await assert.rejects(readAuroraEvolution(main, await readMobileImplementation(worldFixtureCommit({ [path]: text + '\n// unrelated' }))), /Sky-4R2/);
  }
  await assert.rejects(readSky4R2Transition(await readMobileImplementation('8986d7d06b5742f0cd0788dc5fc6d2ea8f4d0190'), pr), /unapproved base/);
});

test('R2 replay retains all 34 synthetic pairs, both cameras and final 68-image provenance/completeness gate', async () => {
  const p = await worldGateFixture(); assert.equal(p.comparison.rows.length, 34);
  for (const row of p.comparison.rows) {
    assert.equal(row.auroraComparison.proof.kind, 'aurora-color-world-light-Sky4R2');
    assert.deepEqual(row.after.resources, row.before.resources); assert.deepEqual(row.after.actualResources, row.before.actualResources);
  }
  assert.equal(await validateMobileEvidence({ record: { files: p.files }, mobile: p }, p.metadata), 34);
  const bad = structuredClone(p); bad.comparison.rows[0].auroraComparison.proof.resources.lightDelta = 1;
  await assert.rejects(validateMobileEvidence({ record: { files: p.files }, mobile: bad }, p.metadata), /report differs/);
  const missing = { ...p.files }; delete missing['test-results/mobile-comparison/main-pc-clear-night.png'];
  await assert.rejects(validateMobileEvidence({ record: { files: missing }, mobile: p }, p.metadata), /Missing mobile artifact/);
});

test('old shader evidence, foreign buffers/programs, extra draws/textures and CLI/final-gate regressions fail', async () => {
  const p = await worldGateFixture(), before = p.before.find(e => e.id === 'pc-clear-night'), good = p.after.find(e => e.id === before.id);
  for (const change of [m => { m.auroraDisplay.snapshot = before.metrics.auroraDisplay.snapshot; },
    m => { m.worldLight = before.metrics.worldLight; },
    m => { m.worldLight.lights.push(m.worldLight.lights[0]); },
    m => { m.worldLight.lights[0].intensity += .01; },
    m => { m.worldLight.ambient.color[0] += .000001; },
    m => { m.worldLight.hemisphereGPU.sky[0] += .000001; },
    m => { m.worldLight.water.gpuLight.strength = 0; },
    m => { m.worldLight.water.gpu.buffers.position.uploads++; },
    m => { m.worldLight.water.gpu.programKeys.push('extra'); },
    m => { m.worldLight.water.material.fragmentShader += '// extra'; },
    m => { m.auroraDisplay.gpu.layers[1].programKeys = ['foreign']; }, m => { m.auroraDisplay.gpu.buffers.uv.uploads++; },
    m => { m.auroraDisplay.draws.actual[0].calls++; }, m => { m.auroraDisplay.draws.fixed[1].triangles++; },
    ...['resources', 'actualResources'].flatMap(pass => ['calls', 'triangles', 'geometries', 'programs', 'textures'].map(key => m => { m[pass][key]++; }))]) {
    const bad = structuredClone(good); change(bad.metrics);
    await assert.rejects(compareMobileCapturePairWithSources(before, bad, p.metadata));
  }
  p.after[0].metrics.actualResources.calls++;
  await assert.rejects(validateMobileEvidence({ record: { files: p.files }, mobile: p }, p.metadata), /actual resource regression/);
  const dir = await mkdtemp(join(tmpdir(), 'barb-world-cli-'));
  try {
    await writeFile(join(dir, 'main.json'), JSON.stringify(p.before)); await writeFile(join(dir, 'pr.json'), JSON.stringify(p.after));
    const result = spawnSync(process.execPath, ['scripts/compare-mobile-performance.mjs', join(dir, 'main.json'), join(dir, 'pr.json'),
      join(dir, 'comparison.html'), 'regression', p.metadata.baseSha, p.metadata.headSha], { encoding: 'utf8' });
    assert.equal(result.status, 1); assert.match(result.stderr, /actual resource regression/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('cold scenery uses the world-light source transition and rejects every extra resource without a generic fallback', async () => {
  const main = await readMobileImplementation(SKY4R2_BASE), pr = await readMobileImplementation(worldFixtureCommit());
  const views = async implementation => {
    const rows = [];
    for (const id of ['day-tps', 'day-fps', 'twilight', 'clear-night', 'fog-night', 'dense-night', 'portrait', 'landscape']) {
      const entry = await worldCapture(implementation, `pc-${['twilight', 'portrait', 'landscape'].includes(id) ? 'day-tps' : id}`, { warmed: false }), m = entry.metrics;
      m.camera = { ...m.camera, fov: 55 }; m.cameraEvidence = { sha: implementation.sha, cameraBlob: implementation.cameraBlob, frames: m.cameraFrames };
      m.resources = m.actualResources; delete m.fixedResources;
      Object.assign(m, { deviceScaleFactor: 1, boat: [10, 20], heading: 0, waterTime: .25, fogStrength: 0 }); rows.push([id, { metrics: m, image: '' }]);
    }
    return new Map(rows);
  };
  const before = await views(main), after = await views(pr), dir = await mkdtemp(join(tmpdir(), 'barb-world-scenery-'));
  try {
    const output = join(dir, 'comparison.html'), rows = await writeComparison(before, after, output);
    assert.equal(rows.length, 8); assert(rows.every(row => row.auroraComparison.kind === 'aurora-color-world-light-Sky4R2'));
    for (const key of ['calls', 'triangles', 'geometries', 'programs', 'textures']) {
      const bad = structuredClone(after); bad.get('clear-night').metrics.resources[key]++;
      await assert.rejects(writeComparison(before, bad, output), /actual resource regression/);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});


// Color/Vector2 additions must not consume UUID/shared game entropy.
test('R2 water construction consumes exactly the baseline RNG sequence and update consumes none', async () => {
  const main = await readWorldLightSource(SKY4R2_BASE), pr = await readWorldLightSource(worldFixtureCommit());
  const saved = Math.random, counts = [];
  try {
    for (const source of [main, pr]) {
      let count = 0; Math.random = () => { count++; return .5; };
      const water = source.createWater(), before = count;
      const clock = source.createGameClock(undefined, { elapsedSeconds: 18990 }).state, fog = source.sampleNightFog(clock);
      const sample = source.sampleAurora(clock, fog.fogType), light = source.sampleAuroraLight?.(sample);
      water.update(10, { x: 10, z: 20, speed: 0 }, source.sampleDayNight(clock), light);
      assert.equal(count, before); counts.push(count); water.mesh.geometry.dispose(); water.mesh.material.dispose();
    }
  } finally { Math.random = saved; }
  assert.equal(counts[1], counts[0]);
});
