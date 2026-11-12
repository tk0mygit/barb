import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SKY4_BASE, readSky4Transition, replayAuroraCapture, verifyAuroraCapture, expectedAuroraResources } from '../scripts/lib/sky4-source.js';
import { SKY4_SOURCE_BLOBS } from '../scripts/lib/sky4-source-pins.js';
import { readMobileImplementation, mobileGit } from '../scripts/lib/mobile-comparison-source.js';
import { compareMobileCapturePairWithSources } from '../scripts/compare-mobile-performance.mjs';
import { validateMobileEvidence } from '../scripts/ci-summary.js';
import { sky4FixtureCommit, auroraGateFixture, auroraCapture, auroraGPUFixture } from './helpers/sky4-fixture.js';

test('Sky-4 accepts only the Sky-3 main, exact runtime/observer/replay blobs and minimal reversible wiring', async () => {
  const main = await readMobileImplementation(SKY4_BASE), pr = await readMobileImplementation(sky4FixtureCommit());
  const proof = await readSky4Transition(main, pr); assert.equal(proof.kind, 'clear-night-aurora-Sky4');
  for (const path of ['src/world/lake.js', 'src/world/aurora.js', 'src/world/stars.js', 'src/world/meteor.js',
    'src/world/night-fog.js', 'src/game/game-clock.js', 'src/game/save-data.js', 'src/game/fishing.js', 'src/main.js',
    'src/rendering/camera.js', 'src/ui/fishing-hud.js', 'package.json', 'package-lock.json', 'public/unrelated.txt',
    ...Object.keys(SKY4_SOURCE_BLOBS).filter(path => !path.startsWith('src/'))]) {
    const source = path.startsWith('public/') ? '' : await mobileGit('show', `${pr.sha}:${path}`);
    await assert.rejects(readSky4Transition(main, await readMobileImplementation(sky4FixtureCommit({ [path]: source + '\n// unrelated\n' }))), /Sky-4/);
  }
  await assert.rejects(readSky4Transition(await readMobileImplementation('eb3d77b310110aa49958292064774b4d35446c73'), pr), /unapproved base/);
});

test('all 34 synthetic pairs and final gate independently replay exact two-layer costs; 68 image completeness stays mandatory', async () => {
  const p = await auroraGateFixture(); assert.equal(p.comparison.rows.length, 34);
  for (const row of p.comparison.rows) for (const pass of ['resources', 'actualResources']) {
    const active = row.id.endsWith('clear-night');
    assert.equal(row.after[pass].calls - row.before[pass].calls, active ? 2 : 0);
    assert.equal(row.after[pass].triangles - row.before[pass].triangles, active ? 3200 : 0);
    assert.equal(row.after[pass].geometries - row.before[pass].geometries, 1);
    assert.equal(row.after[pass].programs - row.before[pass].programs, 1);
    assert.equal(row.after[pass].textures, row.before[pass].textures);
  }
  assert.equal(await validateMobileEvidence({ record: { files: p.files }, mobile: p }, p.metadata), 34);
  const forged = structuredClone(p); forged.comparison.rows[0].auroraComparison.proof.resources.maximumCalls++;
  await assert.rejects(validateMobileEvidence({ record: { files: p.files }, mobile: forged }, p.metadata), /report differs/);
  const missing = { ...p.files }; delete missing['test-results/mobile-comparison/pr-pc-clear-night.png'];
  await assert.rejects(validateMobileEvidence({ record: { files: missing }, mobile: p }, p.metadata), /Missing mobile artifact/);
});

test('resource, scalar, geometry, shader, identity, GPU upload, draw, clock, layout and provenance tampering fail', async () => {
  const p = await auroraGateFixture(), before = p.before.find(e => e.id === 'pc-clear-night'), original = p.after.find(e => e.id === 'pc-clear-night');
  for (const mutate of [
    ...['calls', 'triangles', 'geometries', 'programs', 'textures'].flatMap(key => ['resources', 'actualResources'].map(pass => m => { m[pass][key]++; })),
    m => { m.auroraDisplay.draws.actual[0].calls++; }, m => { m.auroraDisplay.draws.fixed[1].triangles++; },
    m => { m.auroraDisplay.snapshot.attributes.position.array[0]++; }, m => { m.auroraDisplay.snapshot.indexVersion++; },
    m => { m.auroraDisplay.snapshot.layers[1].uniforms.auroraLayer = 0; },
    m => { m.auroraDisplay.snapshot.layers[0].uniforms.auroraHue += 1e-9; },
    m => { m.auroraDisplay.snapshot.layers[0].uniforms.auroraTime += 1e-8; },
    m => { m.auroraDisplay.snapshot.layers[0].uniforms.auroraOpacity -= .01; },
    m => { m.auroraDisplay.snapshot.layers[0].material.fragmentShader += ' '; },
    m => { m.auroraDisplay.snapshot.layers.pop(); }, m => { m.auroraDisplay.gpu.objects++; },
    m => { m.auroraDisplay.gpu.layers[1].geometryId++; }, m => { m.auroraDisplay.gpu.layers[1].materialId++; },
    m => { m.auroraDisplay.gpu.programKeys.push('extra'); }, m => { m.auroraDisplay.gpu.programInstances++; },
    m => { m.auroraDisplay.gpu.layers[1].programKeys = ['other-program']; },
    m => { m.auroraDisplay.gpu.buffers.uv.uploads++; }, m => { m.auroraDisplay.gpu.buffers.position.bytes++; },
    m => { m.auroraDisplay.gpu.buffers.index.id = m.auroraDisplay.gpu.buffers.uv.id; },
    m => { m.auroraDisplay.clockSeconds++; }, m => { m.cameraFrames[0].clockDt = NaN; },
    m => { m.starDisplay.snapshot.uniforms.starOpacity += .01; }, m => { m.meteorDisplay.snapshot.visible = true; },
    m => { delete m.auroraDisplay; }, m => { delete m.actualResources; },
  ]) {
    const after = structuredClone(original); mutate(after.metrics);
    await assert.rejects(compareMobileCapturePairWithSources(before, after, p.metadata));
  }
  const metadata = structuredClone(p.metadata); metadata.implementations.pr.auroraBlob = '0'.repeat(40);
  await assert.rejects(compareMobileCapturePairWithSources(before, original, metadata), /provenance differs/);
  const bite = structuredClone(p.after.find(e => e.id === 'pc-bite')); bite.layout.panel.x++;
  await assert.rejects(compareMobileCapturePairWithSources(p.before.find(e => e.id === bite.id), bite, p.metadata));
});

test('cold vs warm, opposite camera and past-night uploads are independently replayed; only two animation scalars admit roundoff', async () => {
  const pr = await readMobileImplementation(sky4FixtureCommit()), entry = await auroraCapture(pr, 'pc-clear-night');
  const cold = await replayAuroraCapture(pr, entry.metrics, { warmed: false }); assert.equal(cold.initialized, true);
  const opposite = structuredClone(entry.metrics); opposite.camera.quaternion = [0, 1, 0, 0];
  const away = await replayAuroraCapture(pr, opposite); assert.equal(away.draws.actual.reduce((n, r) => n + r.calls, 0), 0);
  assert.equal(away.draws.fixed.reduce((n, r) => n + r.calls, 0), 2);
  const tiny = structuredClone(entry); tiny.metrics.auroraDisplay.snapshot.layers[0].uniforms.auroraTime += 5e-11;
  await verifyAuroraCapture(pr, tiny);
  const past = structuredClone(entry.metrics), seconds = past.savedClockSeconds;
  past.cameraFrames.push({ ...past.cameraFrames[0], update: true, clockDt: 180, dt: .25 });
  past.auroraDisplay.clockSeconds = past.starDisplay.clockSeconds = past.meteorDisplay.clockSeconds = seconds + 180;
  const replay = await replayAuroraCapture(pr, past, { warmed: false });
  assert.equal(replay.state.visible, false); assert.equal(replay.initialized, true);
  Object.assign(past.auroraDisplay, { snapshot: replay.snapshot, draws: replay.draws, gpu: auroraGPUFixture(replay) });
  await verifyAuroraCapture(pr, { id: entry.id, metrics: past }, { warmed: false });
  for (const pass of ['fixed', 'actual']) {
    const before = { calls: 31, triangles: 100, geometries: 20, programs: 10, textures: 4 };
    const base = { draws: { [pass]: [] }, initialized: false };
    const expected = { ...before, calls: 33, triangles: 3300, geometries: 21, programs: 11 };
    expectedAuroraResources(before, expected, base, cold, pass);
    assert.throws(() => expectedAuroraResources(before, { ...expected, calls: 34 }, base, cold, pass));
  }
});

test('comparison CLI awaits source replay and final aggregation rejects either camera regression', async () => {
  const p = await auroraGateFixture(), directory = await mkdtemp(join(tmpdir(), 'barb-sky4-cli-'));
  try {
    p.after[0].metrics.actualResources.calls++;
    await assert.rejects(validateMobileEvidence({ record: { files: p.files }, mobile: p }, p.metadata), /Sky-4: actual resource regression/);
    const before = join(directory, 'main.json'), after = join(directory, 'pr.json');
    await writeFile(before, JSON.stringify(p.before)); await writeFile(after, JSON.stringify(p.after));
    const result = spawnSync(process.execPath, ['scripts/compare-mobile-performance.mjs', before, after,
      join(directory, 'comparison.html'), 'regression', p.metadata.baseSha, p.metadata.headSha], { encoding: 'utf8' });
    assert.equal(result.status, 1); assert.match(result.stderr, /Sky-4: actual resource regression/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
