import assert from 'node:assert/strict';
import { PerspectiveCamera } from 'three';
import { mobileGit, replayMobileCamera } from './mobile-comparison-source.js';
import { readMeteorSource, SKY3_METEOR_BLOB } from './sky3-source.js';
import { SKY2_STARS_BLOB } from './sky2-source.js';
import { fishingDisplayDraws } from './mobile-rod-reel-replay.js';
import { auroraSnapshot } from '../../tests/helpers/aurora-snapshot.js';
import { SKY4_SOURCE_BLOBS } from './sky4-source-pins.js';

export const SKY4_BASE = '9277dbef6d7a2ab39c9f257041d519384c704635';
const AURORA = 'src/world/aurora.js', LAKE = 'src/world/lake.js';
const cache = new Map();
export async function readAuroraSource(sha) {
  if (!cache.has(sha)) cache.set(sha, (async () => {
    const existing = await readMeteorSource(sha);
    if (!await mobileGit('ls-tree', sha, '--', AURORA)) return existing;
    const source = await mobileGit('show', `${sha}:${AURORA}`);
    assert(!/\bimport\s*\(|\brequire\s*\(/.test(source), 'Sky-4: dynamic dependency');
    const rewritten = source.replace(/from '([^']+)'/g, (_, path) => {
      assert.equal(path, 'three', 'Sky-4: unexpected dependency'); return `from ${JSON.stringify(import.meta.resolve('three'))}`;
    });
    return { ...existing, ...await import(`data:text/javascript;base64,${Buffer.from(rewritten).toString('base64')}`) };
  })().catch(error => { cache.delete(sha); throw error; }));
  return cache.get(sha);
}

export function verifyAuroraConnection(before, after) {
  for (const addition of ["import { createAurora } from './aurora.js';\n",
    '  const aurora = createAurora();\n  scene.add(...aurora.meshes);\n',
    '      aurora.update(clock, boat, nightFog.fogType);\n']) {
    assert.equal(after.split(addition).length, 2, 'Sky-4: missing/duplicated lake connection');
    after = after.replace(addition, '');
  }
  assert.equal(after, before, 'Sky-4: unrelated lake change');
}

export async function readSky4Transition(main, pr) {
  if (main.auroraBlob === pr.auroraBlob) return null;
  assert.equal(main.sha, SKY4_BASE, 'Sky-4: unapproved base SHA');
  assert.equal(main.auroraBlob, null, 'Sky-4: base already has aurora');
  assert.equal(pr.auroraBlob, SKY4_SOURCE_BLOBS[AURORA], 'Sky-4: unapproved aurora source');
  assert.equal(main.starsBlob, SKY2_STARS_BLOB, 'Sky-4: existing stars changed');
  assert.equal(main.meteorBlob, SKY3_METEOR_BLOB, 'Sky-4: existing meteor changed');
  for (const key of ['starsBlob', 'meteorBlob', 'lockBlob', 'indexBlob', 'viteBlob', 'mainBlob', 'cameraBlob',
    'hudBlob', 'hudLogicBlob', 'resolutionBlob', 'fishingViewBlob', 'fishingEffectsBlob']) {
    assert.equal(pr[key], main[key], `Sky-4: unrelated source ${key}`);
  }
  assert.equal(await mobileGit('merge-base', main.sha, pr.sha), main.sha, 'Sky-4: base is not an ancestor');
  assert.deepEqual((await mobileGit('diff', '--name-only', main.sha, pr.sha, '--', 'src')).split('\n').sort(), [AURORA, LAKE], 'Sky-4: unrelated runtime change');
  assert.equal(await mobileGit('diff', '--name-only', main.sha, pr.sha, '--', 'public', 'package.json', 'package-lock.json',
    'index.html', 'vite.config.js', 'playwright.config.js', '.github', 'scripts/ci-risk.js', 'scripts/ci-e2e.js'), '', 'Sky-4: build/assets/CI selection changed');
  assert.deepEqual((await mobileGit('diff', '--name-only', main.sha, pr.sha, '--', 'scripts/lib')).split('\n').sort(),
    ['scripts/lib/mobile-comparison-source.js', 'scripts/lib/sky4-source-pins.js', 'scripts/lib/sky4-source.js'],
    'Sky-4: legacy replay/helper changed');
  assert.equal(await mobileGit('diff', '--name-only', main.sha, pr.sha, '--',
    'tests/helpers/star-snapshot.js', 'tests/helpers/meteor-snapshot.js'), '', 'Sky-4: existing observer changed');
  const manifest = await mobileGit('show', `${pr.sha}:scripts/lib/sky4-source-pins.js`);
  const declaration = manifest.match(/^\/\/ Final reviewed Git blobs\. The separate manifest avoids a circular self-hash\.\nexport const SKY4_SOURCE_BLOBS = Object\.freeze\((\{[\s\S]*\})\);$/);
  assert(declaration, 'Sky-4: nonliteral source manifest');
  assert.deepEqual(JSON.parse(declaration[1]), SKY4_SOURCE_BLOBS, 'Sky-4: recorded manifest differs from replay');
  for (const [path, blob] of Object.entries(SKY4_SOURCE_BLOBS)) {
    assert.match(await mobileGit('ls-tree', pr.sha, '--', path), /^100644 blob /, 'Sky-4: invalid file mode/type');
    assert.equal(await mobileGit('rev-parse', `${pr.sha}:${path}`), blob, `Sky-4: unapproved source ${path}`);
  }
  assert.match(await mobileGit('ls-tree', pr.sha, '--', LAKE), /^100644 blob /, 'Sky-4: invalid lake file');
  // mobileGit trims outer whitespace, so use the same canonical text on both.
  verifyAuroraConnection(await mobileGit('show', `${main.sha}:${LAKE}`), await mobileGit('show', `${pr.sha}:${LAKE}`));
  const source = await readAuroraSource(pr.sha), original = Math.random;
  let aurora, calls = 0;
  const spy = () => { calls++; return original(); };
  try { Math.random = spy; aurora = source.createAurora(); assert.equal(Math.random, spy); }
  finally { Math.random = original; aurora?.dispose(); }
  assert.equal(calls, 0, 'Sky-4: shared RNG consumed');
  assert.deepEqual(source.AURORA_CONFIG, { probability: .20, daySeconds: 180, nightSeconds: 180,
    fadeSeconds: 15, timeWrapSeconds: 720, radius: 1350, columns: 80, rows: 10, layers: 2 }, 'Sky-4: unapproved timing/probability/geometry');
  return { kind: 'clear-night-aurora-Sky4', baseSha: main.sha, validationSha: pr.sha,
    before: { lakeBlob: main.lakeBlob, auroraBlob: null, starsBlob: main.starsBlob, meteorBlob: main.meteorBlob },
    after: { lakeBlob: pr.lakeBlob, auroraBlob: pr.auroraBlob, starsBlob: pr.starsBlob, meteorBlob: pr.meteorBlob },
    sources: SKY4_SOURCE_BLOBS, resources: { geometries: 1, materials: 2, programs: 1, buffers: 3, textures: 0,
      maximumCalls: 2, maximumTriangles: 3200 } };
}

const cameraFor = pose => {
  const camera = new PerspectiveCamera(55, pose.aspect, .1, 2400);
  camera.position.fromArray(pose.position); camera.quaternion.fromArray(pose.quaternion); camera.updateMatrixWorld(); return camera;
};
export function auroraValues(snapshot) {
  if (!snapshot) return null;
  const { geometryId, layers, ...values } = snapshot;
  return { ...values, layers: layers.map(({ geometryId, materialId, ...layer }) => ({ ...layer, uniforms: { ...layer.uniforms } })) };
}
export async function replayAuroraCapture(implementation, metrics, { warmed = true } = {}) {
  const source = await readAuroraSource(implementation.sha), seconds = metrics.auroraDisplay?.clockSeconds;
  assert(Number.isFinite(seconds) && seconds >= metrics.savedClockSeconds && seconds < metrics.savedClockSeconds + 3600, 'Sky-4: invalid clock evidence');
  const clock = source.createGameClock(undefined, { elapsedSeconds: seconds }).state, fog = source.sampleNightFog(clock);
  let aurora;
  try {
    aurora = source.createAurora?.(); aurora?.update(clock, { x: metrics.boat?.[0] ?? 10, z: metrics.boat?.[1] ?? 20 }, fog.fogType);
    const draw = pose => aurora ? Object.values(fishingDisplayDraws(Object.fromEntries(aurora.meshes.map((mesh, i) => [i, mesh])), cameraFor(pose))) : [];
    const draws = { fixed: draw(metrics.resourceCamera ?? metrics.camera), actual: draw(metrics.camera) };
    const snapshot = aurora ? auroraSnapshot(aurora.meshes) : null;
    const initializedLayers = aurora ? [warmed, warmed] : [];
    if (aurora && !warmed) {
      const frames = metrics.cameraFrames ?? metrics.cameraEvidence?.frames;
      assert(frames?.length, 'Sky-4: missing cold render history');
      const historyClock = source.createGameClock(undefined, { elapsedSeconds: metrics.savedClockSeconds });
      for (let i = 0; i < frames.length; i++) {
        if (frames[i].update) historyClock.step(frames[i].clockDt);
        const state = historyClock.state, weather = source.sampleNightFog(state);
        aurora.update(state, { x: metrics.boat?.[0] ?? 10, z: metrics.boat?.[1] ?? 20 }, weather.fogType);
        const submissions = draw(replayMobileCamera(implementation, frames.slice(0, i + 1)));
        submissions.forEach((row, layer) => { if (row.calls) initializedLayers[layer] = true; });
      }
    }
    return { snapshot, draws, initializedLayers, initialized: initializedLayers.some(Boolean),
      state: { timeOfDay: clock.timeOfDay, fogType: fog.fogType, nightIndex: Math.floor(seconds / 360),
        selected: source.sampleAurora?.(clock, fog.fogType).selected ?? false, visible: snapshot?.layers.some(layer => layer.visible) ?? false } };
  } finally { aurora?.dispose(); }
}

export async function verifyAuroraCapture(implementation, entry, options) {
  const m = entry.metrics, evidence = m.auroraDisplay;
  assert(evidence, `${entry.id}: missing Sky-4 evidence`);
  const replay = await replayAuroraCapture(implementation, m, options);
  const actual = auroraValues(evidence.snapshot), expected = auroraValues(replay.snapshot);
  if (expected) {
    assert(actual && actual.layers.length === 2, 'Sky-4: missing two layers');
    for (let layer = 0; layer < 2; layer++) {
      for (const key of ['auroraTime', 'auroraOpacity']) {
        const a = actual.layers[layer].uniforms[key], e = expected.layers[layer].uniforms[key];
        assert(Number.isFinite(a) && Math.abs(a - e) <= 1e-10, `Sky-4: ${key} differs from clock`);
        const band = t => [Math.floor(t / 360), t % 360 < 180 ? 'day' : t % 360 < 195 ? 'fade-in' : t % 360 < 345 ? 'night' : 'fade-out'];
        if (key === 'auroraTime') {
          assert(a >= 0 && a < 720, 'Sky-4: invalid wrapped time');
          assert.deepEqual(band(a), band(e), 'Sky-4: time crosses phase/fade/wrap boundary');
        } else assert(a >= 0 && a <= 1, 'Sky-4: invalid opacity');
        actual.layers[layer].uniforms[key] = e;
      }
    }
    assert.deepEqual(actual, expected, 'Sky-4: geometry/color/shape/material differs from source');
    const gpu = evidence.gpu, snapshot = evidence.snapshot;
    assert(gpu && gpu.objects === 2 && gpu.layers.length === 2, 'Sky-4: missing/extra meshes');
    assert(Number.isSafeInteger(snapshot.geometryId) && snapshot.geometryId >= 0, 'Sky-4: invalid geometry identity');
    assert.equal(new Set(snapshot.layers.map(layer => layer.materialId)).size, 2, 'Sky-4: material ownership differs');
    for (let i = 0; i < 2; i++) {
      const layer = snapshot.layers[i], observed = gpu.layers[i];
      assert.equal(layer.geometryId, snapshot.geometryId, 'Sky-4: geometry is not shared');
      assert(Number.isSafeInteger(layer.materialId) && layer.materialId >= 0, 'Sky-4: invalid material identity');
      assert.equal(observed.geometryId, layer.geometryId); assert.equal(observed.materialId, layer.materialId);
      assert.equal(observed.programKeys.length, Number(replay.initializedLayers[i]), 'Sky-4: early/missing layer program');
      assert.deepEqual(observed.programKeys, replay.initializedLayers[i] ? gpu.programKeys : [], 'Sky-4: shader program is not shared');
      assert.notEqual(layer.materialId, m.meteorDisplay?.snapshot?.materialId); assert.notEqual(layer.materialId, m.starDisplay?.snapshot?.materialId);
    }
    assert.equal(gpu.programKeys.length, Number(replay.initialized), 'Sky-4: early/extra shader');
    assert.equal(gpu.programInstances, Number(replay.initialized), 'Sky-4: extra/missing GPU shader');
    assert.notEqual(snapshot.geometryId, m.meteorDisplay?.snapshot?.geometryId); assert.notEqual(snapshot.geometryId, m.starDisplay?.snapshot?.geometryId);
    assert.deepEqual(Object.keys(gpu.buffers).sort(), ['index', 'position', 'uv'], 'Sky-4: extra/missing buffers');
    const ids = [];
    for (const [key, bytes] of [['position', expected.attributes.position.array.length * 4], ['uv', expected.attributes.uv.array.length * 4], ['index', expected.indices.length * 2]]) {
      const buffer = gpu.buffers[key];
      if (!replay.initialized) assert.equal(buffer, null, 'Sky-4: unused geometry uploaded early');
      else {
        assert(buffer && Number.isSafeInteger(buffer.id) && buffer.id > 0, 'Sky-4: missing GPU buffer');
        assert.equal(buffer.bytes, bytes, 'Sky-4: GPU buffer size changed'); assert.equal(buffer.uploads, 1, 'Sky-4: immutable buffer uploaded again'); ids.push(buffer.id);
      }
    }
    assert.equal(new Set(ids).size, ids.length, 'Sky-4: GPU buffers alias');
  } else { assert.equal(actual, null, 'Sky-4: unexpected base aurora'); assert.equal(evidence.gpu, null, 'Sky-4: unexpected base GPU'); }
  assert.deepEqual(evidence.draws, replay.draws, 'Sky-4: real submissions differ from source/culling');
  for (const optical of [m.starDisplay, m.meteorDisplay]) assert(optical && Math.abs(optical.clockSeconds - evidence.clockSeconds) <= 1e-10, 'Sky-4: optical clocks differ');
  const frames = m.cameraFrames ?? m.cameraEvidence?.frames;
  assert(frames?.length && frames.every(frame => Number.isFinite(frame.clockDt)), 'Sky-4: missing native clock history');
  const elapsed = m.savedClockSeconds + frames.reduce((sum, frame) => sum + (frame.update ? frame.clockDt : 0), 0);
  assert(Math.abs(elapsed - evidence.clockSeconds) < 1e-7, 'Sky-4: clock differs from native history');
  return replay;
}

export function expectedAuroraResources(before, after, beforeReplay, afterReplay, pass) {
  assert(before && after && beforeReplay && afterReplay, 'Sky-4: missing resource replay');
  for (const counts of [before, after]) for (const key of ['calls', 'triangles', 'geometries', 'programs', 'textures'])
    assert(Number.isSafeInteger(counts[key]) && counts[key] >= 0, `Sky-4: invalid ${key}`);
  const sum = (replay, key) => replay.draws[pass].reduce((n, row) => n + row[key], 0);
  const expected = { ...before, calls: before.calls + sum(afterReplay, 'calls') - sum(beforeReplay, 'calls'),
    triangles: before.triangles + sum(afterReplay, 'triangles') - sum(beforeReplay, 'triangles'),
    geometries: before.geometries + Number(afterReplay.initialized) - Number(beforeReplay.initialized),
    programs: before.programs + Number(afterReplay.initialized) - Number(beforeReplay.initialized) };
  assert.deepEqual(after, expected, `Sky-4: ${pass} resource regression`); return expected;
}
