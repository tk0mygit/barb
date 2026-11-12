import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { PerspectiveCamera } from 'three';
import { mobileGit, replayMobileCamera } from './mobile-comparison-source.js';
import { readStarSource, SKY2_STARS_BLOB } from './sky2-source.js';
import { fishingDisplayDraws } from './mobile-rod-reel-replay.js';
import { meteorSnapshot } from '../../tests/helpers/meteor-snapshot.js';

export const SKY3_BASE = 'eb3d77b310110aa49958292064774b4d35446c73';
export const SKY3_METEOR_BLOB = 'c928d4204148e2906a90f3d426afde16125d9e4c';
export const SKY3_OBSERVER_BLOBS = Object.freeze({
  'tests/browser/mobile-performance.spec.js': 'c3c06b33d3814e923d35760503e658ec6975cf5c',
  'tests/browser/day-night-fixture.js': 'b2a23bb4af92750036b6f73484856987fa1b92ad',
  'tests/browser/lake-scenery.spec.js': 'c8de620b573c7d98c3fa8b30de1c0822975c6ea9',
  'tests/helpers/meteor-snapshot.js': 'ee22821b9a6c7f7abd76f87daa5d8cae0f61968d',
});
const LAKE = 'src/world/lake.js', METEOR = 'src/world/meteor.js';
const exec = promisify(execFile);
const text = async (sha, path) => (await exec('git', ['show', `${sha}:${path}`])).stdout;
const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;

export function verifyMeteorConnection(before, after) {
  for (const addition of ["import { createMeteor } from './meteor.js';\n",
    '  const meteor = createMeteor();\n  scene.add(meteor.mesh);\n',
    '      meteor.update(clock, boat, nightFog.fogType);\n']) {
    assert.equal(after.split(addition).length, 2, 'Sky-3: missing/duplicated lake connection');
    after = after.replace(addition, '');
  }
  assert.equal(after, before, 'Sky-3: unrelated lake change');
}

const cache = new Map();
export async function readMeteorSource(sha) {
  if (!cache.has(sha)) cache.set(sha, (async () => {
    const clockAndFog = await readStarSource(sha);
    const entry = await mobileGit('ls-tree', sha, '--', METEOR);
    if (!entry) return clockAndFog;
    const source = await text(sha, METEOR);
    assert(!/\bimport\s*\(|\brequire\s*\(/.test(source), 'Sky-3: dynamic dependency');
    const rewritten = source.replace(/from '([^']+)'/g, (_, path) => {
      assert.equal(path, 'three', 'Sky-3: unexpected dependency'); return `from ${JSON.stringify(import.meta.resolve('three'))}`;
    });
    return { ...clockAndFog, ...await import(moduleUrl(rewritten)) };
  })().catch(error => { cache.delete(sha); throw error; }));
  return cache.get(sha);
}

export async function readSky3Transition(main, pr) {
  if (main.sha !== SKY3_BASE || !pr.meteorBlob) return null;
  assert.equal(main.meteorBlob, null, 'Sky-3: base already has meteor');
  assert.equal(pr.meteorBlob, SKY3_METEOR_BLOB, 'Sky-3: unapproved meteor source');
  assert.equal(main.starsBlob, SKY2_STARS_BLOB, 'Sky-3: existing star source changed');
  for (const key of ['starsBlob', 'lockBlob', 'indexBlob', 'viteBlob', 'mainBlob', 'cameraBlob',
    'hudBlob', 'hudLogicBlob', 'resolutionBlob', 'fishingViewBlob', 'fishingEffectsBlob']) {
    assert.equal(pr[key], main[key], `Sky-3: unrelated source ${key}`);
  }
  assert.equal(await mobileGit('merge-base', main.sha, pr.sha), main.sha, 'Sky-3: base is not an ancestor');
  assert.deepEqual((await mobileGit('diff', '--name-only', main.sha, pr.sha, '--', 'src')).split('\n').sort(), [LAKE, METEOR], 'Sky-3: unrelated runtime change');
  assert.equal(await text(pr.sha, 'package.json'), await text(main.sha, 'package.json'), 'Sky-3: package changed');
  assert.equal(await mobileGit('diff', '--name-only', main.sha, pr.sha, '--', 'public'), '', 'Sky-3: public assets changed');
  for (const [path, blob] of Object.entries({ [METEOR]: SKY3_METEOR_BLOB, ...SKY3_OBSERVER_BLOBS })) {
    assert.match(await mobileGit('ls-tree', pr.sha, '--', path), /^100644 blob /, 'Sky-3: invalid file mode/type');
    assert.equal(await mobileGit('rev-parse', `${pr.sha}:${path}`), blob, `Sky-3: unapproved source ${path}`);
  }
  assert.match(await mobileGit('ls-tree', pr.sha, '--', LAKE), /^100644 blob /, 'Sky-3: invalid lake file type');
  verifyMeteorConnection(await text(main.sha, LAKE), await text(pr.sha, LAKE));
  const source = await readMeteorSource(pr.sha), original = Math.random;
  let meteor, calls = 0;
  const spy = () => { calls++; return original(); };
  try { Math.random = spy; meteor = source.createMeteor(); assert.equal(Math.random, spy); }
  finally { Math.random = original; meteor?.dispose(); }
  assert.equal(calls, 0, 'Sky-3: shared random consumed');
  assert.deepEqual(source.METEOR_CONFIG, { probability: .005, slots: 18, slotSeconds: 10, duration: 1.1,
    daySeconds: 180, nightSeconds: 180, radius: 1200 }, 'Sky-3: unapproved probability/timing');
  return { kind: 'clear-night-meteor-Sky3', baseSha: main.sha, validationSha: pr.sha,
    before: { lakeBlob: main.lakeBlob, meteorBlob: null, starsBlob: main.starsBlob },
    after: { lakeBlob: pr.lakeBlob, meteorBlob: pr.meteorBlob, starsBlob: pr.starsBlob }, observers: SKY3_OBSERVER_BLOBS,
    resources: { geometries: 1, programs: 1, textures: 0, maximumCalls: 1, maximumTriangles: 2 } };
}

const cameraFor = pose => {
  const camera = new PerspectiveCamera(55, pose.aspect, .1, 2400);
  camera.position.fromArray(pose.position); camera.quaternion.fromArray(pose.quaternion); camera.updateMatrixWorld(); return camera;
};
export function meteorValues(snapshot) {
  if (!snapshot) return null;
  const { geometryId, materialId, ...values } = snapshot; return values;
}
export async function replayMeteorCapture(implementation, metrics, { warmed = true } = {}) {
  const source = await readMeteorSource(implementation.sha), seconds = metrics.meteorDisplay?.clockSeconds;
  assert(Number.isFinite(seconds) && seconds >= metrics.savedClockSeconds && seconds < metrics.savedClockSeconds + 3600, 'Sky-3: invalid clock evidence');
  const clock = source.createGameClock(undefined, { elapsedSeconds: seconds }).state, fog = source.sampleNightFog(clock);
  let meteor;
  try {
    if (source.createMeteor) {
      meteor = source.createMeteor(); meteor.update(clock, { x: metrics.boat?.[0] ?? 10, z: metrics.boat?.[1] ?? 20 }, fog.fogType);
    }
    const draw = pose => meteor ? fishingDisplayDraws({ meteor: meteor.mesh }, cameraFor(pose)).meteor : { calls: 0, triangles: 0 };
    const draws = { fixed: draw(metrics.resourceCamera ?? metrics.camera), actual: draw(metrics.camera) };
    const snapshot = meteor ? meteorSnapshot(meteor.mesh) : null;
    let initialized = Boolean(meteor && warmed);
    if (meteor && !warmed) {
      // Cold counters retain any earlier native render's upload even after the
      // 1.1s window ends. Replay that history instead of treating visibility at
      // the final capture as the entire GPU lifetime.
      const frames = metrics.cameraFrames ?? metrics.cameraEvidence?.frames;
      assert(frames?.length, 'Sky-3: missing cold render history');
      const historyClock = source.createGameClock(undefined, { elapsedSeconds: metrics.savedClockSeconds });
      for (let i = 0; i < frames.length; i++) {
        if (frames[i].update) historyClock.step(frames[i].clockDt);
        const state = historyClock.state, weather = source.sampleNightFog(state);
        meteor.update(state, { x: metrics.boat?.[0] ?? 10, z: metrics.boat?.[1] ?? 20 }, weather.fogType);
        if (meteor.mesh.visible && draw(replayMobileCamera(implementation, frames.slice(0, i + 1))).calls) initialized = true;
      }
    }
    return { snapshot, draws, initialized,
      state: { timeOfDay: clock.timeOfDay, fogType: fog.fogType, nightIndex: Math.floor(seconds / 360),
        slotIndex: clock.timeOfDay === 'night' ? Math.floor((clock.cycleSeconds - 180) / 10) : -1,
        visible: snapshot?.visible ?? false } };
  } finally { meteor?.dispose(); }
}

export async function verifyMeteorCapture(implementation, entry, options) {
  const m = entry.metrics, evidence = m.meteorDisplay;
  assert(evidence, `${entry.id}: missing Sky-3 evidence`);
  const replay = await replayMeteorCapture(implementation, m, options);
  const actual = meteorValues(evidence.snapshot), expected = meteorValues(replay.snapshot);
  if (expected) {
    assert(actual, 'Sky-3: missing meteor snapshot');
    const { meteorProgress: p, meteorOpacity: opacity, ...other } = actual.uniforms ?? {};
    const { meteorProgress: ep, meteorOpacity: eo, ...expectedOther } = expected.uniforms;
    // Only clock-derived scalar uniforms admit the observed clock roundoff.
    // Visibility, slot and every spatial/buffer/material value remain exact.
    for (const [a, b] of [[p, ep], [opacity, eo]]) {
      assert(Number.isFinite(a) && a >= 0 && a <= 1 && Math.abs(a - b) <= 1e-10, 'Sky-3: animation differs from clock');
    }
    assert.deepEqual({ ...actual, uniforms: other }, { ...expected, uniforms: expectedOther }, 'Sky-3: meteor differs from source');
    const gpu = evidence.gpu;
    assert(gpu && Number.isSafeInteger(gpu.geometryId) && Number.isSafeInteger(gpu.materialId), 'Sky-3: missing GPU identities');
    assert.equal(gpu.geometryId, evidence.snapshot.geometryId); assert.equal(gpu.materialId, evidence.snapshot.materialId);
    assert.equal(gpu.objects, 1, 'Sky-3: duplicated meteor object');
    assert.equal(new Set(gpu.programKeys).size, Number(replay.initialized), 'Sky-3: invalid shader identity');
    assert.equal(gpu.programKeys.length, Number(replay.initialized), 'Sky-3: extra/missing shader');
    assert.equal(gpu.programInstances, Number(replay.initialized), 'Sky-3: extra/missing GPU program');
    assert.notEqual(gpu.geometryId, m.starDisplay?.snapshot?.geometryId, 'Sky-3: shared star geometry');
    assert.notEqual(gpu.materialId, m.starDisplay?.snapshot?.materialId, 'Sky-3: shared star material');
  } else {
    assert.deepEqual(actual, null, 'Sky-3: unexpected base meteor'); assert.equal(evidence.gpu, null, 'Sky-3: unexpected base GPU');
  }
  assert.deepEqual(evidence.draws, replay.draws, 'Sky-3: submissions differ from clock/weather/source culling');
  if (m.fixedResources) assert.deepEqual(m.fixedResources, m.resources, 'Sky-3: substituted fixed counters');
  assert(m.starDisplay && Math.abs(m.starDisplay.clockSeconds - evidence.clockSeconds) <= 1e-10, 'Sky-3: optical clocks differ');
  const frames = m.cameraFrames ?? m.cameraEvidence?.frames;
  assert(frames?.length && frames.every(frame => Number.isFinite(frame.clockDt)), 'Sky-3: missing native clock history');
  const elapsed = m.savedClockSeconds + frames.reduce((sum, frame) => sum + (frame.update ? frame.clockDt : 0), 0);
  assert(Math.abs(elapsed - evidence.clockSeconds) < 1e-7, 'Sky-3: clock differs from native history');
  return replay;
}

export function expectedMeteorResources(before, after, beforeReplay, afterReplay, pass) {
  assert(before && after && beforeReplay && afterReplay, 'Sky-3: missing resource replay');
  for (const counters of [before, after]) for (const key of ['calls', 'triangles', 'geometries', 'programs', 'textures']) {
    assert(Number.isSafeInteger(counters[key]) && counters[key] >= 0, `Sky-3: invalid ${key}`);
  }
  const b = beforeReplay.draws[pass], a = afterReplay.draws[pass];
  const expected = { ...before, calls: before.calls + a.calls - b.calls, triangles: before.triangles + a.triangles - b.triangles,
    geometries: before.geometries + Number(afterReplay.initialized) - Number(beforeReplay.initialized),
    programs: before.programs + Number(afterReplay.initialized) - Number(beforeReplay.initialized) };
  assert.deepEqual(after, expected, `Sky-3: ${pass} resource regression`);
  return expected;
}
