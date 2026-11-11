import assert from 'node:assert/strict';
import { PerspectiveCamera } from 'three';
import { mobileGit } from './mobile-comparison-source.js';
import { fishingDisplayDraws } from './mobile-rod-reel-replay.js';
import { starSnapshot } from '../../tests/helpers/star-snapshot.js';

export const SKY2_BASE = '242bcac5d3e4c65d14ca7b525c8b37929091b07a';
export const SKY2_STARS_BLOB = '1578014b0afeb0024b5eefdc4ea775df37ed16c8';
export const SKY2_CAPTURE_BLOB = 'ed27af6491b6617dce0dda9463a2c2f518f93ed1';
export const SKY2_SNAPSHOT_BLOB = '1f22de436d34987e4db8015cb9fc984c799f2649';
const STARS = 'src/world/stars.js', LAKE = 'src/world/lake.js';
const text = (sha, path) => mobileGit('show', `${sha}:${path}`);
const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;

export function verifyStarConnection(before, after) {
  for (const connection of ["import { createStars } from './stars.js';\n",
    '  const stars = createStars();\n  scene.add(stars.points);\n',
    '      stars.update(clock, boat, nightFog.fogType);\n']) {
    assert.equal(after.split(connection).length, 2, 'Sky-2: missing/duplicated lake connection');
    after = after.replace(connection, '');
  }
  assert.equal(after, before, 'Sky-2: unrelated lake change');
}

const cache = new Map();
export async function readStarSource(sha) {
  if (!cache.has(sha)) cache.set(sha, (async () => {
    const clock = await text(sha, 'src/game/game-clock.js');
    const fog = (await text(sha, 'src/world/night-fog.js')).replace("'../game/game-clock.js'", JSON.stringify(moduleUrl(clock)));
    const stars = await mobileGit('ls-tree', sha, '--', STARS);
    const source = stars ? await text(sha, STARS) : null;
    if (source) assert(!/\bimport\s*\(|\brequire\s*\(/.test(source), 'Sky-2: dynamic dependency');
    const rewritten = source?.replace(/from '([^']+)'/g, (_, path) => {
      assert.equal(path, 'three', 'Sky-2: unexpected dependency'); return `from ${JSON.stringify(import.meta.resolve('three'))}`;
    });
    return { ...(await import(moduleUrl(clock))), ...(await import(moduleUrl(fog))),
      ...(rewritten ? await import(moduleUrl(rewritten)) : {}) };
  })().catch(error => { cache.delete(sha); throw error; }));
  return cache.get(sha);
}

export async function readSky2Transition(main, pr) {
  if (main.sha !== SKY2_BASE || !pr.starsBlob) return null;
  assert.equal(main.starsBlob, null, 'Sky-2: base already has stars');
  assert.equal(pr.starsBlob, SKY2_STARS_BLOB, 'Sky-2: unapproved star source');
  for (const key of ['lockBlob', 'indexBlob', 'viteBlob', 'mainBlob', 'cameraBlob', 'hudBlob', 'hudLogicBlob', 'resolutionBlob', 'fishingViewBlob', 'fishingEffectsBlob']) {
    assert.equal(pr[key], main[key], `Sky-2: unrelated source ${key}`);
  }
  assert.deepEqual((await mobileGit('diff', '--name-only', main.sha, pr.sha, '--', 'src')).split('\n').sort(), [LAKE, STARS], 'Sky-2: unrelated runtime change');
  assert.equal(await text(pr.sha, 'package.json'), await text(main.sha, 'package.json'), 'Sky-2: package metadata changed');
  assert.equal(await mobileGit('diff', '--name-only', main.sha, pr.sha, '--', 'public'), '', 'Sky-2: delivery assets changed');
  for (const path of [LAKE, STARS, 'tests/browser/mobile-performance.spec.js', 'tests/helpers/star-snapshot.js']) {
    assert.match(await mobileGit('ls-tree', pr.sha, '--', path), /^100644 blob /, 'Sky-2: invalid file mode/type');
  }
  assert.equal(await mobileGit('rev-parse', `${pr.sha}:tests/browser/mobile-performance.spec.js`), SKY2_CAPTURE_BLOB, 'Sky-2: unapproved observer source');
  assert.equal(await mobileGit('rev-parse', `${pr.sha}:tests/helpers/star-snapshot.js`), SKY2_SNAPSHOT_BLOB, 'Sky-2: unapproved snapshot source');
  verifyStarConnection(await text(main.sha, LAKE), await text(pr.sha, LAKE));
  const source = await readStarSource(pr.sha), original = Math.random;
  let stars, sharedCalls = 0;
  const spy = () => { sharedCalls++; return original(); };
  try { Math.random = spy; stars = source.createStars(); assert.equal(Math.random, spy); }
  finally { Math.random = original; stars?.dispose(); }
  assert.equal(sharedCalls, 0, 'Sky-2: domain random consumed');
  return { kind: 'clear-night-stars-Sky2', baseSha: main.sha, validationSha: pr.sha,
    before: { lakeBlob: main.lakeBlob, starsBlob: null }, after: { lakeBlob: pr.lakeBlob, starsBlob: pr.starsBlob },
    captureBlob: SKY2_CAPTURE_BLOB, snapshotBlob: SKY2_SNAPSHOT_BLOB,
    resources: { geometries: 1, programs: 1, textures: 0, maximumCalls: 1, vertices: 240 } };
}

const cameraFor = pose => {
  const camera = new PerspectiveCamera(55, pose.aspect, .1, 2400);
  camera.position.fromArray(pose.position); camera.quaternion.fromArray(pose.quaternion); camera.updateMatrixWorld(); return camera;
};
export function starValues(snapshot) {
  if (!snapshot) return null;
  const { geometryId, materialId, ...values } = snapshot;
  return values;
}
export async function replayStarCapture(implementation, metrics, { warmed = true } = {}) {
  const source = await readStarSource(implementation.sha);
  const seconds = metrics.starDisplay.clockSeconds;
  assert(Number.isFinite(seconds) && seconds >= metrics.savedClockSeconds && seconds < metrics.savedClockSeconds + 3600, 'Sky-2: invalid clock evidence');
  const clock = source.createGameClock(undefined, { elapsedSeconds: seconds }).state;
  const fog = source.sampleNightFog(clock);
  let stars;
  try {
    if (source.createStars) {
      stars = source.createStars(); stars.update(clock, { x: metrics.boat?.[0] ?? 10, z: metrics.boat?.[1] ?? 20 }, fog.fogType);
      stars.points.material.uniforms.starPixelRatio.value = Math.max(.5, Math.min(2, metrics.pixelRatio ?? 1));
    }
    const snapshot = stars ? starSnapshot(stars.points) : null;
    const draw = pose => stars ? fishingDisplayDraws({ stars: stars.points }, cameraFor(pose)).stars.calls : 0;
    return { snapshot, draws: { fixed: metrics.resourceCamera ? draw(metrics.resourceCamera) : draw(metrics.camera), actual: draw(metrics.camera) },
      initialized: Boolean(stars && (warmed || snapshot.visible)), timeOfDay: clock.timeOfDay, fogType: fog.fogType };
  } finally { stars?.dispose(); }
}

export async function verifyStarCapture(implementation, entry, options) {
  const m = entry.metrics;
  assert(m.starDisplay, `${entry.id}: missing Sky-2 evidence`);
  const replay = await replayStarCapture(implementation, m, options);
  assert.deepEqual(starValues(m.starDisplay.snapshot), starValues(replay.snapshot), `${entry.id}: stars differ from source`);
  assert.deepEqual(m.starDisplay.draws, replay.draws, `${entry.id}: star submissions differ from source`);
  if (m.fixedResources) assert.deepEqual(m.fixedResources, m.resources, `${entry.id}: fixed resources differ`);
  // Clock comes from independent surface-fog/HUD observation. Native capture
  // histories also bind active elapsed time, before any star uniforms are read.
  if (m.cameraFrames?.every(frame => Number.isFinite(frame.clockDt))) {
    const elapsed = m.savedClockSeconds + m.cameraFrames.reduce((sum, frame) => sum + (frame.update ? frame.clockDt : 0), 0);
    assert(Math.abs(elapsed - m.starDisplay.clockSeconds) < 1e-7, `${entry.id}: star clock differs from native history`);
  }
  return replay;
}

export function expectedStarResources(before, after, beforeReplay, afterReplay, pass, warmed = true) {
  assert(beforeReplay && afterReplay, 'Sky-2: missing source replay');
  const expected = { ...before, calls: before.calls + afterReplay.draws[pass] - beforeReplay.draws[pass],
    geometries: before.geometries + Number(afterReplay.initialized) - Number(beforeReplay.initialized),
    programs: before.programs + Number(afterReplay.initialized) - Number(beforeReplay.initialized) };
  assert.deepEqual(after, expected, `Sky-2: ${warmed ? 'warmed' : 'cold'} ${pass} resource regression`);
  return expected;
}
