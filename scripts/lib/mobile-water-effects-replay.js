import assert from 'node:assert/strict';
import { Scene, PerspectiveCamera, Vector3, MeshBasicMaterial, DoubleSide } from 'three';
import { mobileGit, replayMobileCamera, expectedMobileResourceCamera } from './mobile-comparison-source.js';
import { nativeFishingState, fishingDisplayDraws, FISHING_PHASE_IDS } from './mobile-rod-reel-replay.js';
import { readMobileFightSource } from './mobile-fight-replay.js';

export const WATER_EFFECTS_BASE = 'b562b3f4d9d39ed38b05049e2981923bac175cfc';
export const WATER_EFFECTS_BLOB = '8fd4a573948271c9c673fe841f0c071c5a8e900a';
export const WATER_CAPTURE_BLOB = '14d2dff5ad346f80693c91306f0a1c6f37e5bc0e';
const EFFECTS = 'src/rendering/fishing-effects.js', FISHING = 'src/rendering/fishing.js';
const sourceText = (sha, path) => mobileGit('show', `${sha}:${path}`);
const allowedFiles = new Set([
  'src/main.js', FISHING, EFFECTS,
  'scripts/compare-mobile-performance.mjs', 'scripts/lib/mobile-comparison-source.js',
  'scripts/lib/mobile-rod-reel-replay.js', 'scripts/lib/mobile-water-effects-replay.js',
  'tests/fishing-effects.test.js', 'tests/mobile-water-effects-comparison.test.js',
  'tests/fishing-effects-rng.test.js',
  'tests/helpers/water-effects-fixture.js', 'tests/browser/mobile-performance.spec.js',
  'tests/browser/fishing-effects.spec.js', 'tests/browser/day-night-fixture.js',
  'tests/browser/lighting-resource-contract.js', 'tests/lighting-resource-contract.test.js',
]);

function reverse(source, edits, label) {
  for (const [after, before] of edits) {
    assert.equal(source.split(after).length, 2, `5F-1B: missing/duplicated ${label} connection`);
    source = source.replace(after, before);
  }
  return source;
}

// These are ALL production edits, not a path-only allowance. Reverse both
// complete connections byte for byte; the new module has a pinned full blob.
export function verifyWaterEffectsConnection(beforeMain, afterMain, beforeView, afterView) {
  assert.equal(reverse(afterMain, [
    ['let autosave, environmentAudio, audioSession, qteDelivery, qteHUD, rodReelView, fishingView;',
      'let autosave, environmentAudio, audioSession, qteDelivery, qteHUD, rodReelView;'],
    ['  fishingView = createFishingView(scene, camera);', '  const fishingView = createFishingView(scene, camera);'],
    ['    fishingView.dispose();\n', ''], ['  fishingView?.dispose();\n', ''],
  ], 'main'), beforeMain, '5F-1B: unrelated main source change');
  assert.equal(reverse(afterView, [
    ["import { createFishingEffects } from './fishing-effects.js';\n", ''],
    ['  const effects = createFishingEffects();\n  scene.add(group, effects.group);', '  scene.add(group);'],
    ['      const contact = getLurePosition(s);\n      effects.update(s, active, elapsed, contact.x, contact.z);\n', ''],
    ['    dispose() { effects.dispose(); },\n', ''],
  ], 'view'), beforeView, '5F-1B: unrelated fishing display change');
}

const moduleCache = new Map();
export async function readWaterEffectsSource(sha) {
  if (!moduleCache.has(sha)) moduleCache.set(sha, (async () => {
    const entry = await mobileGit('ls-tree', sha, '--', EFFECTS);
    if (!entry) return null;
    const text = await sourceText(sha, EFFECTS);
    assert(!/\bimport\s*\(|\brequire\s*\(/.test(text), '5F-1B: dynamic effect dependency');
    const rewritten = text.replace(/from '([^']+)'/g, (_, path) => {
      assert.equal(path, 'three', '5F-1B: unexpected effect dependency');
      return `from ${JSON.stringify(import.meta.resolve('three'))}`;
    });
    const module = await import(`data:text/javascript;base64,${Buffer.from(rewritten).toString('base64')}`);
    return { blob: entry.split(/\s+/)[2], ...module };
  })().catch(error => { moduleCache.delete(sha); throw error; }));
  return moduleCache.get(sha);
}

// Inspect actual buffers and the built-in shader contract. RGBA colors add a
// distinct USE_COLOR_ALPHA variant: no base mesh has a four-component color
// attribute. The complete-scene warmup uploads this one hidden geometry and
// program on every ID, even when the visible effect draws are zero.
export function inspectWaterEffectsFactory(factory) {
  let effects;
  const standard = new MeshBasicMaterial();
  try {
    const original = Math.random;
    let sharedCalls = 0;
    const spy = () => { sharedCalls++; return original(); };
    try {
      Math.random = spy;
      effects = factory();
      assert.equal(Math.random, spy, '5F-1B: UUID factory did not restore the caller RNG reference');
    } finally { Math.random = original; }
    assert.equal(sharedCalls, 0, '5F-1B: UUID factory consumed shared/domain randomness');
    assert.equal(effects.group.children.length, 1, '5F-1B: effect batch count');
    const mesh = effects.group.children[0], geometry = mesh.geometry, material = mesh.material;
    assert(mesh.isMesh && mesh.name === 'fishing-water-effects', '5F-1B: unknown effect batch');
    assert.equal(geometry.index, null); assert.deepEqual(geometry.groups, []);
    assert.deepEqual(Object.keys(geometry.attributes).sort(), ['color', 'position']);
    assert.equal(geometry.attributes.position.itemSize, 3); assert.equal(geometry.attributes.color.itemSize, 4);
    assert.equal(geometry.attributes.position.count, 3456); assert.equal(geometry.attributes.color.count, 3456);
    assert.deepEqual(geometry.drawRange, { start: 0, count: 3456 });
    assert.equal(material.type, 'MeshBasicMaterial');
    for (const [key, value] of Object.entries({ vertexColors: true, transparent: true, side: DoubleSide,
      forceSinglePass: true, fog: true, depthTest: true, depthWrite: false, opacity: 1,
      map: null, alphaMap: null, envMap: null, alphaTest: 0, alphaHash: false, wireframe: false })) assert.equal(material[key], value, `5F-1B: material ${key}`);
    assert.equal(material.onBeforeCompile, standard.onBeforeCompile);
    assert.equal(material.customProgramCacheKey, standard.customProgramCacheKey);
    assert.equal(mesh.frustumCulled, true); assert.equal(mesh.renderOrder, .75);
    assert.equal(mesh.castShadow, false); assert.equal(mesh.receiveShadow, false);
    return { geometries: 1, materials: 1, textures: 0, programs: 1, maximumCalls: 1, maximumTriangles: 1152 };
  } finally { effects?.dispose(); standard.dispose(); }
}

export async function readMobileWaterEffectsTransition(main, pr) {
  if (main.sha !== WATER_EFFECTS_BASE || main.fishingViewBlob === pr.fishingViewBlob) return null;
  assert.equal(main.fishingEffectsBlob, null, '5F-1B: base already contains effects');
  assert.equal(pr.fishingEffectsBlob, WATER_EFFECTS_BLOB, '5F-1B: unapproved effect source blob');
  assert.equal(await mobileGit('rev-parse', `${pr.sha}:tests/browser/mobile-performance.spec.js`), WATER_CAPTURE_BLOB,
    '5F-1B: unapproved capture/camera authority change');
  for (const key of ['lockBlob', 'indexBlob', 'viteBlob', 'cameraBlob', 'hudBlob', 'hudLogicBlob', 'resolutionBlob']) {
    assert.equal(pr[key], main[key], `5F-1B: changed invariant source ${key}`);
  }
  const files = (await mobileGit('diff', '--name-only', main.sha, pr.sha)).split('\n').filter(Boolean);
  assert(files.every(file => allowedFiles.has(file)), '5F-1B: unapproved file change');
  assert.deepEqual(files.filter(file => file.startsWith('src/')).sort(), ['src/main.js', FISHING, EFFECTS].sort(), '5F-1B: unrelated runtime source');
  verifyWaterEffectsConnection(await sourceText(main.sha, 'src/main.js'), await sourceText(pr.sha, 'src/main.js'),
    await sourceText(main.sha, FISHING), await sourceText(pr.sha, FISHING));
  const source = await readWaterEffectsSource(pr.sha);
  assert.equal(source.blob, WATER_EFFECTS_BLOB);
  return { kind: 'water-effects-5F1B', baseSha: main.sha, validationSha: pr.sha,
    before: { mainBlob: main.mainBlob, fishingViewBlob: main.fishingViewBlob, fishingEffectsBlob: null },
    after: { mainBlob: pr.mainBlob, fishingViewBlob: pr.fishingViewBlob, fishingEffectsBlob: source.blob },
    resources: inspectWaterEffectsFactory(source.createFishingEffects) };
}

const visible = object => Boolean(object.visible && (!object.parent || visible(object.parent)));
export function waterEffectMeshSnapshot(object) {
  return {
    visible: visible(object), position: object.position.toArray(), quaternion: object.quaternion.toArray().map(n => n === 0 ? 0 : n), scale: object.scale.toArray(),
    vertices: object.geometry.attributes.position.count, indices: object.geometry.index?.count ?? 0,
    drawRange: { ...object.geometry.drawRange }, positions: Array.from(object.geometry.attributes.position.array), colors: Array.from(object.geometry.attributes.color.array),
    boundingSphere: { center: object.geometry.boundingSphere.center.toArray(), radius: object.geometry.boundingSphere.radius },
    material: { type: object.material.type, vertexColors: object.material.vertexColors, side: object.material.side,
      forceSinglePass: object.material.forceSinglePass, transparent: object.material.transparent,
      depthTest: object.material.depthTest, depthWrite: object.material.depthWrite, fog: object.material.fog },
  };
}
const cameraFor = pose => {
  const camera = new PerspectiveCamera(55, pose.aspect, .1, 2400);
  camera.position.fromArray(pose.position); camera.quaternion.fromArray(pose.quaternion); camera.updateMatrixWorld();
  return camera;
};

export async function replayWaterEffectsDisplay(implementation, entry) {
  const frames = entry.metrics.cameraFrames, camera = cameraFor(replayMobileCamera(implementation, frames));
  const scene = new Scene(), tip = new Vector3();
  let view, equipment, source, fishing, elapsed = 0;
  try {
    if (FISHING_PHASE_IDS.includes(entry.id)) {
      const replay = await nativeFishingState(implementation, frames, frame => {
        ({ source, fishing, elapsed } = frame);
        if (!view) {
          view = source.createFishingView(scene, camera);
          equipment = source.createRodReelView(scene, camera, { equipment: { rodLevel: 1, reelLevel: 1 }, subscribe: () => () => {} });
        }
        equipment.update(true, fishing.state, elapsed);
        view.update(fishing, true, elapsed, equipment.copyTipWorld(tip));
      });
      assert.equal(replay.fishing.state.phase, entry.id.endsWith('bite') ? 'bite' : 'fight', '5F-1B: native capture phase');
    } else {
      // The other 25 captures never cast. Reproduce their inactive timeline
      // from each source; zero effects must hold through every ordinary frame.
      source = await readMobileFightSource(implementation.sha);
      fishing = source.createFishing({ random: () => .5 });
      const effects = await readWaterEffectsSource(implementation.sha);
      if (effects) {
        view = effects.createFishingEffects(); scene.add(view.group);
        for (const frame of frames) {
          assert.equal(frame.phase, frame.mode === 'fishing' ? 'ready' : 'inactive', '5F-1B: unexpected non-cast phase');
          assert(Number.isFinite(frame.dt) && frame.dt >= 0 && frame.dt <= .25, '5F-1B: invalid display time');
          if (frame.update) elapsed += frame.dt;
          else assert.equal(frame.dt, 0, '5F-1B: resize advances display time');
          const point = source.getLurePosition(fishing.state);
          view.update(fishing.state, frame.mode === 'fishing', elapsed, point.x, point.z);
        }
      } else for (const frame of frames) if (frame.update) elapsed += frame.dt;
    }
    scene.updateMatrixWorld(true);
    const mesh = scene.getObjectByName('fishing-water-effects');
    const existing = scene.children.find(o => o.children.some(c => c.isLine));
    const objects = existing ? Object.fromEntries(['ring', 'lure', 'shadow', 'line'].map((key, i) => [key, existing.children[i]])) : {};
    const meshes = Object.fromEntries(Object.entries(objects).map(([key, o]) => [key, {
      // Raw JSON serializes -0 as 0; retain exact nonzero components.
      visible: visible(o), position: o.position.toArray(), quaternion: o.quaternion.toArray().map(n => n === 0 ? 0 : n), scale: o.scale.toArray(),
      vertices: o.geometry.attributes.position.count, indices: o.geometry.index?.count ?? 0,
    }]));
    if (mesh) objects.waterEffects = mesh;
    return { phase: frames.at(-1).phase, elapsed,
      state: { phase: fishing.state.phase, revision: fishing.state.revision, time: fishing.state.time, reeling: fishing.state.reeling,
        origin: { ...fishing.state.origin }, heading: fishing.state.heading, distance: fishing.state.distance, lureId: fishing.state.lureId },
      mesh: mesh ? waterEffectMeshSnapshot(mesh) : null,
      meshes, line: objects.line ? Array.from(objects.line.geometry.attributes.position.array) : null,
      draws: { fixed: fishingDisplayDraws(objects, cameraFor(expectedMobileResourceCamera(camera.aspect))),
        actual: fishingDisplayDraws(objects, camera) } };
  } finally {
    view?.dispose?.(); equipment?.dispose();
    const geometries = new Set(), materials = new Set();
    scene.traverse(o => { if (o.geometry) geometries.add(o.geometry); if (o.material) materials.add(o.material); });
    for (const geometry of geometries) geometry.dispose(); for (const material of materials) material.dispose();
  }
}

export async function verifyWaterEffectsCapture(implementation, entry) {
  const observed = entry.metrics.fishingDisplay;
  assert(observed?.version === 1 && observed.passes?.fixed && observed.passes?.actual, '5F-1B: missing phase JSON');
  const expected = await replayWaterEffectsDisplay(implementation, entry);
  assert.equal(observed.phase, expected.phase, '5F-1B: observed phase differs');
  assert(Math.abs(observed.elapsed - expected.elapsed) <= 1e-9, '5F-1B: display timer differs');
  assert.deepEqual(observed.meshes.waterEffects ?? null, expected.mesh, '5F-1B: effect mesh/timer/buffer differs from source replay');
  for (const [key, mesh] of Object.entries(expected.meshes)) assert.deepEqual(observed.meshes[key], mesh, `5F-1B: existing ${key} display differs`);
  if (expected.line) assert.deepEqual(observed.line, expected.line, '5F-1B: original tip/water contact differs');
  for (const [pass, field] of [['fixed', 'resources'], ['actual', 'actualResources']]) {
    const camera = pass === 'fixed' ? expectedMobileResourceCamera(entry.metrics.camera.aspect) : { ...entry.metrics.camera, fov: 55 };
    assert.deepEqual(observed.passes[pass].camera, camera, '5F-1B: substituted camera');
    assert.deepEqual(observed.passes[pass].resources, entry.metrics[field], '5F-1B: substituted renderer counters');
    if (FISHING_PHASE_IDS.includes(entry.id)) assert.deepEqual(observed.passes[pass].draws, expected.draws[pass], '5F-1B: source submissions differ');
    else {
      assert.deepEqual(observed.passes[pass].draws.waterEffects ?? { calls: 0, triangles: 0 }, { calls: 0, triangles: 0 }, '5F-1B: inactive effect draws');
      assert.equal(expected.mesh?.visible ?? false, false, '5F-1B: inactive source effect visible');
    }
  }
  return expected;
}

export function expectedWaterEffectsResources(before, after, id, pass, b, a, proof) {
  assert(proof && b && a, '5F-1B: missing source proof');
  for (const counters of [before, after]) for (const key of ['calls', 'triangles', 'geometries', 'textures', 'programs']) {
    assert(Number.isSafeInteger(counters?.[key]) && counters[key] >= 0, `5F-1B: invalid counter ${key}`);
  }
  let effect = { calls: 0, triangles: 0 };
  if (FISHING_PHASE_IDS.includes(id)) {
    assert.equal(a.phase, b.phase, '5F-1B: phases differ');
    for (const key of ['origin', 'heading', 'lureId']) assert.deepEqual(a.state[key], b.state[key], '5F-1B: native state differs');
    for (const key of ['ring', 'lure', 'shadow', 'line']) assert.deepEqual(a.draws[pass][key], b.draws[pass][key], `5F-1B: existing ${key} draws changed`);
    assert.equal(b.draws[pass].waterEffects, undefined, '5F-1B: base submitted effects');
    effect = a.draws[pass].waterEffects;
    assert(effect && effect.calls <= proof.resources.maximumCalls && effect.triangles <= proof.resources.maximumTriangles, '5F-1B: excessive effect submissions');
  } else assert.equal(a.mesh?.visible ?? false, false, '5F-1B: allowance leaked to inactive ID');
  const expected = { ...before, calls: before.calls + effect.calls, triangles: before.triangles + effect.triangles,
    geometries: before.geometries + proof.resources.geometries, programs: before.programs + proof.resources.programs };
  assert.deepEqual(after, expected, `5F-1B: ${pass} resource regression`);
  return expected;
}
