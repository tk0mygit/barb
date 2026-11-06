import assert from 'node:assert/strict';
import { PerspectiveCamera, Scene, Vector3, MeshBasicMaterial, Object3D, DoubleSide, Frustum, Matrix4 } from 'three';
import { mobileGit, replayMobileCamera, expectedMobileResourceCamera } from './mobile-comparison-source.js';
import { readMobileFightSource } from './mobile-fight-replay.js';

const BASE = '936210d2d118e4e66e2e4426a198d626f84742e8';
const CAST_BASE = 'f2e87f9fd5262b99bb42af1fe835d7bd13307ade';
export const FISHING_PHASE_BASE = '6463b6e8a21ddad7b6cbb2c7c456d2054bc791fe';
export const FISHING_PHASE_IDS = Object.freeze(['portrait', 'landscape', 'small', 'pc']
  .flatMap(profile => [`${profile}-bite`, `${profile}-fight`]).concat('rotated-fight'));
const MODEL = 'src/rendering/rod-reel-model.js', VIEW = 'src/rendering/rod-reel-view.js';
const FISHING = 'src/rendering/fishing.js';
const allowedPaths = ['src/main.js', MODEL, VIEW].sort();
const sourceCache = new Map();
const fullSource = async (sha, path) => mobileGit('show', `${sha}:${path}`);
const optionalBlob = async (sha, path) => {
  const entry = await mobileGit('ls-tree', sha, '--', path);
  return entry ? entry.split(/\s+/)[2] : null;
};

// These are the complete additive production connections for this one Phase.
// Reversing them must recover the base main byte for byte; a path allowlist
// alone would let unrelated input/clock/save changes hide in main.js.
export function verifyRodReelMainConnection(before, after) {
  const additions = [
    "import { createRodReelView } from './rendering/rod-reel-view.js';\n",
    '  rodReelView = createRodReelView(scene, camera, collection);\n',
    "    rodReelView.update(boat.mode === 'fishing', fishing.state.phase);\n",
    '    rodReelView.dispose();\n',
    '  rodReelView?.dispose();\n',
  ];
  let restored = after;
  for (const addition of additions) {
    assert.equal(restored.split(addition).length, 2, 'Rod/reel production connection is missing or duplicated');
    restored = restored.replace(addition, '');
  }
  const declaration = 'let autosave, environmentAudio, audioSession, qteDelivery, qteHUD, rodReelView;';
  assert.equal(restored.split(declaration).length, 2, 'Rod/reel lifetime declaration differs');
  restored = restored.replace(declaration, 'let autosave, environmentAudio, audioSession, qteDelivery, qteHUD;');
  assert.equal(restored, before, 'Rod/reel transition changed unrelated production main source');
}

// This second, independent proof grants no resource delta. Reverse precisely
// the reviewed 5D-2 display wiring; target, flight, input and visibility logic
// outside these origin-only changes must recover the approved base exactly.
export function verifyCastDisplayConnection(beforeMain, afterMain, beforeFishing, afterFishing) {
  const reverse = (source, replacements, label) => {
    for (const [after, before] of replacements) {
      assert.equal(source.split(after).length, 2, `${label}: display connection is missing or duplicated`);
      source = source.replace(after, before);
    }
    return source;
  };
  const main = reverse(afterMain, [
    ['  const rodTipWorld = new THREE.Vector3();\n', ''],
    ["    rodReelView.update(boat.mode === 'fishing', fishing.state, elapsed);\n"
      + "    fishingView.update(fishing, boat.mode === 'fishing', elapsed, rodReelView.copyTipWorld(rodTipWorld));",
    "    fishingView.update(fishing, boat.mode === 'fishing', elapsed);\n"
      + "    rodReelView.update(boat.mode === 'fishing', fishing.state.phase);"],
    ['      rodReelView.update(true, fishing.state, elapsed);\n'
      + '      fishingView.update(fishing, true, elapsed, rodReelView.copyTipWorld(rodTipWorld));',
    '      fishingView.update(fishing, true, elapsed);'],
    ['      if (open && fishing.state.phase === PHASE.READY) rodReelView.resetMotion();\n', ''],
    ["    focused = false; focusRecovery = 'blurred'; cancelTouch(); ambientAudio.setPaused('blur', true);\n"
      + '    if (fishing.state.phase === PHASE.READY) rodReelView.resetMotion();',
    "    focused = false; focusRecovery = 'blurred'; cancelTouch(); ambientAudio.setPaused('blur', true);"],
    ['    if (document.hidden && fishing.state.phase === PHASE.READY) rodReelView.resetMotion();\n', ''],
    ["    cancelTouch(); ambientAudio.setPaused('page', true); autosave.flush();\n"
      + '    if (fishing.state.phase === PHASE.READY) rodReelView.resetMotion();',
    "    cancelTouch(); ambientAudio.setPaused('page', true); autosave.flush();"],
  ], 'main');
  assert.equal(main, beforeMain, 'Cast display changed unrelated production main source');
  const fishing = reverse(afterFishing, [
    ['  const point = new THREE.Vector3();\n', '  const point = new THREE.Vector3();\n  const lineOrigin = new THREE.Vector3();\n'],
    ['    update(fishing, active, elapsed, rodTipWorld) {', '    update(fishing, active, elapsed) {'],
    ["      line.visible = s.phase !== PHASE.AIM && rodTipWorld != null;\n"
      + "      // The scene-owned equipment has already followed the camera and applied\n"
      + "      // this frame's pose. Reuse its actual local-tip world coordinate.\n"
      + '      if (rodTipWorld) rodTipWorld.toArray(positions, 0);',
    "      line.visible = s.phase !== PHASE.AIM;\n"
      + "      // A virtual rod tip in the camera's 3D view volume, one metre ahead.\n"
      + '      // Scale with its frustum so yaw, tracking and aspect changes preserve a\n'
      + '      // natural slightly-right-of-centre projection (58%, 57%) on every screen.\n'
      + '      camera.updateMatrixWorld();\n'
      + '      const halfHeight = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / camera.zoom;\n'
      + '      lineOrigin.set(0.16 * halfHeight * camera.aspect, -0.14 * halfHeight, -1).applyMatrix4(camera.matrixWorld);\n'
      + '      lineOrigin.toArray(positions, 0);'],
  ], 'fishing');
  assert.equal(fishing, beforeFishing, 'Cast display changed unrelated fishing view source');
}

function compileSource(source, imports, label) {
  assert(!/\bimport\s*\(|\brequire\s*\(/.test(source), `${label}: dynamic replay dependencies`);
  const rewritten = source.replace(/\b(import\s+(?:[^'";]+?\s+from\s+)?|export\s+[^'";]+?\s+from\s+)(['"])([^'"\n]+)\2/g,
    (statement, prefix, quote, specifier) => {
      assert(Object.hasOwn(imports, specifier), `${label}: unexpected dependency ${specifier}`);
      return `${prefix}${JSON.stringify(imports[specifier])}`;
    });
  return `data:text/javascript;base64,${Buffer.from(rewritten).toString('base64')}`;
}

export async function compileRodReelSources(modelSource, viewSource) {
  const modelURL = compileSource(modelSource, { three: import.meta.resolve('three'),
    'three/addons/utils/BufferGeometryUtils.js': import.meta.resolve('three/addons/utils/BufferGeometryUtils.js') }, MODEL);
  const viewURL = compileSource(viewSource, { three: import.meta.resolve('three'), './rod-reel-model.js': modelURL }, VIEW);
  const model = await import(modelURL), view = await import(viewURL);
  assert.equal(typeof model.createRodReelModel, 'function', 'Missing exact-source rod/reel factory');
  assert.equal(typeof view.createRodReelView, 'function', 'Missing exact-source rod/reel view');
  return { createRodReelModel: model.createRodReelModel, createRodReelView: view.createRodReelView };
}

function meshTriangles(mesh) {
  const { geometry } = mesh, { start, count } = geometry.drawRange;
  assert.equal(start, 0, 'Rod/reel draw range must begin at zero');
  assert(Number.isSafeInteger(count) && count > 0 && count % 3 === 0, 'Invalid active rod/reel triangle range');
  assert(count <= (geometry.index?.count ?? geometry.attributes.position.count), 'Rod/reel draw range exceeds its buffer');
  assert.equal(geometry.groups.length, 0, 'Rod/reel geometry adds material draw groups');
  return count / 3;
}

// Inspect the actual factory rather than trusting an exported budget/expected
// count. Only two opaque, unculled, non-shadow meshes can add exactly two draws.
export function inspectRodReelFactory(createFactory) {
  const model = createFactory(), meshes = [];
  try {
    assert(model.group?.isGroup && model.rod?.isGroup && model.reel?.isGroup, 'Rod/reel must retain separate groups');
    assert.notEqual(model.rod, model.reel);
    assert.equal(model.rod.parent, model.group); assert.equal(model.reel.parent, model.group);
    model.group.traverse(object => { if (object.isMesh) meshes.push(object); });
    assert.equal(meshes.length, 2, 'Rod/reel must have exactly two meshes');
    assert(meshes.some(mesh => mesh.parent === model.rod) && meshes.some(mesh => mesh.parent === model.reel), 'Each equipment group must own one mesh');
    meshes.sort((a, b) => a.parent === model.rod ? -1 : b.parent === model.rod ? 1 : 0);
    const geometries = meshes.map(mesh => mesh.geometry), material = meshes[0].material;
    assert.equal(new Set(geometries).size, 2, 'Rod/reel must own exactly two geometries');
    assert.equal(meshes[1].material, material, 'Rod/reel must share one material');
    const standard = new MeshBasicMaterial();
    try {
      assert(material.isMeshBasicMaterial && material.vertexColors && material.side === DoubleSide, 'Rod/reel shader must match the existing lure');
      for (const [key, expected] of Object.entries({ depthTest: false, depthWrite: false, fog: true, transparent: false,
        opacity: 1, alphaTest: 0, alphaHash: false, wireframe: false, toneMapped: true, dithering: false,
        premultipliedAlpha: false, precision: null, clippingPlanes: null, map: null, alphaMap: null, envMap: null })) {
        assert.equal(material[key], expected, `Rod/reel material ${key} differs from the shared shader contract`);
      }
      assert.equal(material.color.getHex(), 0xffffff, 'Rod/reel vertex colors must use the standard white base');
      assert.equal(material.onBeforeCompile, standard.onBeforeCompile, 'Rod/reel custom shader is not supported');
      assert.equal(material.customProgramCacheKey, standard.customProgramCacheKey, 'Rod/reel custom program is not supported');
      assert.deepEqual(material.defines ?? {}, {}, 'Rod/reel shader defines changed');
    } finally { standard.dispose(); }
    for (const mesh of meshes) {
      assert.equal(mesh.type, 'Mesh');
      assert.equal(mesh.renderOrder, 0.5, 'Rod/reel must render before the existing lure guides');
      assert.equal(mesh.frustumCulled, false, 'Rod/reel draw count depends on diagnostic culling');
      assert.equal(mesh.castShadow, false); assert.equal(mesh.receiveShadow, false);
      assert.equal(mesh.onBeforeRender, Object3D.prototype.onBeforeRender, 'Rod/reel custom render callback is not supported');
      assert.deepEqual(Object.keys(mesh.geometry.attributes).sort(), ['color', 'position']);
      assert.equal(mesh.geometry.attributes.color.itemSize, 3);
      assert.equal(mesh.geometry.attributes.position.itemSize, 3);
      assert.deepEqual(mesh.geometry.morphAttributes, {});
    }
    const identities = meshes.map(mesh => ({ geometry: mesh.geometry,
      position: mesh.geometry.attributes.position, color: mesh.geometry.attributes.color, index: mesh.geometry.index }));
    const counts = () => {
      model.group.traverse(object => {
        assert.equal(object.visible, true, 'Level selection hides an equipment mesh');
        assert.equal(object.layers.mask, 1, 'Rod/reel changes diagnostic render layers');
      });
      meshes.forEach((mesh, index) => {
        assert.equal(mesh.geometry, identities[index].geometry, 'Level selection recreated a geometry');
        assert.equal(mesh.geometry.attributes.position, identities[index].position, 'Level selection replaced a vertex buffer');
        assert.equal(mesh.geometry.attributes.color, identities[index].color, 'Level selection replaced a color buffer');
        assert.equal(mesh.geometry.index, identities[index].index, 'Level selection replaced an index buffer');
        assert.equal(mesh.material, material, 'Level selection recreated a material');
      });
      return meshes.map(meshTriangles);
    };
    model.setLevels({ rodLevel: 1, reelLevel: 1 });
    const first = counts(), rodCounts = [], reelCounts = [];
    for (let level = 1; level <= 10; level++) {
      model.setLevels({ rodLevel: level, reelLevel: 1 }); rodCounts.push(counts()[0]);
      model.setLevels({ rodLevel: 1, reelLevel: level }); reelCounts.push(counts()[1]);
    }
    const maximumTriangles = Math.max(...rodCounts) + Math.max(...reelCounts);
    assert(maximumTriangles <= 2500, 'Rod/reel source exceeds the approved combined triangle budget');
    return { calls: 2, triangles: first[0] + first[1], geometries: 2, textures: 0, programs: 0,
      maximumTriangles, rodTriangles: rodCounts, reelTriangles: reelCounts };
  } finally { model.dispose(); }
}

export function inspectRodReelView(createView) {
  const scene = new Scene(), camera = new PerspectiveCamera(55, 1, .1, 2400), listeners = new Set();
  const equipment = { rodLevel: 1, reelLevel: 1 };
  const collection = { equipment, subscribe(callback) { listeners.add(callback); return () => listeners.delete(callback); } };
  const view = createView(scene, camera, collection);
  const animated = typeof view.copyTipWorld === 'function';
  const resources = [];
  view.group.traverse(object => { if (object.isMesh) resources.push([object, object.geometry, object.material,
    object.geometry.attributes.position, object.geometry.attributes.color,
    object.geometry.attributes.position.version, object.geometry.attributes.color.version]); });
  const out = new Vector3();
  const tipWorld = () => view.group.localToWorld(new Vector3(...view.group.userData.tip));
  const checkTip = () => {
    assert.equal(view.copyTipWorld(out), out, 'Rod/reel world-tip API must reuse the caller vector');
    assert(out.distanceTo(tipWorld()) <= 1e-10, 'Rod/reel world-tip API differs from the displayed model');
  };
  const update = (phase, time = 1, revision = 1, elapsed = time) => animated
    ? view.update(true, { phase, time, revision }, elapsed) : view.update(true, phase);
  try {
    assert.equal(listeners.size, 1, 'Rod/reel view must subscribe to canonical equipment');
    assert.equal(view.group.parent, scene, 'Rod/reel root is not owned by the rendered scene');
    assert.equal(view.group.visible, false, 'Rod/reel must start hidden in sailing');
    for (const aspect of [390 / 844, 844 / 390, 360 / 740, 1280 / 800]) {
      camera.aspect = aspect; camera.position.set(10, 2.15, 20); camera.rotation.set(.12, -.4, 0); camera.updateProjectionMatrix();
      const pose = { position: camera.position.toArray(), quaternion: camera.quaternion.toArray() };
      if (animated) {
        view.update(false, { phase: 'ready', time: 0, revision: 0 }, 0);
        assert.equal(view.copyTipWorld(out), null, 'Hidden rod/reel exposes an obsolete tip');
      }
      for (const phase of animated ? ['ready', 'lure', 'bite', 'fight', 'landing'] : ['ready', 'aim', 'cast', 'lure', 'bite', 'fight', 'landing']) {
        update(phase); assert.equal(view.group.visible, true, `Rod/reel hidden during ${phase}`);
        const projection = view.group.localToWorld(new Vector3(0, 1, 0)).project(camera);
        assert(Math.abs(projection.x - .16) < 1e-10 && Math.abs(projection.y + .14) < 1e-10, 'Rod/reel neutral view no longer matches the existing line projection');
        if (animated) checkTip();
      }
      if (animated) {
        assert.equal(typeof view.resetMotion, 'function', 'Cast display lifecycle reset is missing');
        const neutralScale = view.group.scale.clone();
        update('ready', 0, 2, 0);
        const neutral = tipWorld();
        update('aim', .18, 3, .18); checkTip();
        const held = tipWorld();
        assert(held.distanceTo(neutral) > 1e-3, 'AIM source has no visible takeback');
        update('aim', 5, 3, 5); checkTip();
        assert(held.distanceTo(tipWorld()) <= 1e-10, 'AIM pose does not hold after the takeback');
        for (const time of [0, .04, .12, .3, .5, .8]) {
          update('cast', time, 4, 5 + time); checkTip();
          const world = tipWorld(), matrix = view.group.matrixWorld.clone();
          if (time === 0) assert(world.distanceTo(held) <= 1e-10, 'CAST does not start at the held takeback');
          if (time === .12) {
            const neutralY = neutral.clone().project(camera).y;
            const takebackY = held.clone().project(camera).y;
            const forwardY = world.clone().project(camera).y;
            assert(world.distanceTo(neutral) > 1e-3 && (takebackY - neutralY) * (forwardY - neutralY) < 0,
              'CAST has no forward stroke beyond the neutral pose');
          }
          if (time >= .5) assert(world.distanceTo(neutral) <= 1e-10, 'CAST does not recover its exact neutral pose');
          update('cast', time, 4, 5 + time); checkTip();
          assert(world.distanceTo(tipWorld()) <= 1e-10, 'Repeated display updates advance the cast pose');
          assert.deepEqual(view.group.matrixWorld, matrix, 'Cast pose depends on render count');
          assert.deepEqual(view.group.scale, neutralScale, 'Cast motion stretches the rod/reel');
        }
        update('lure', 0, 5, 5.8); checkTip();
        const projection = tipWorld().project(camera);
        assert(Math.abs(projection.x - .16) < 1e-10 && Math.abs(projection.y + .14) < 1e-10, 'CAST leaves a stale LURE pose');
        update('aim', .18, 6, 6.18); checkTip();
        const cancelStart = tipWorld();
        update('ready', 0, 7, 6.18); checkTip();
        assert(tipWorld().distanceTo(cancelStart) <= 1e-10, 'Cancellation jumps directly out of the takeback');
        update('ready', .22, 7, 6.4); checkTip();
        assert(tipWorld().distanceTo(neutral) <= 1e-10, 'Cancellation retains an old takeback pose');
        update('aim', .18, 8, 7.18);
        update('ready', 0, 9, 7.18);
        view.resetMotion();
        update('ready', 0, 9, 7.18); checkTip();
        assert(tipWorld().distanceTo(neutral) <= 1e-10, 'Lifecycle resume replays a cancelled takeback');
      }
      for (const phase of ['result', 'failed']) {
        update(phase); assert.equal(view.group.visible, false);
        if (animated) assert.equal(view.copyTipWorld(out), null, `${phase}: obsolete tip remains readable`);
      }
      if (animated) view.update(false, { phase: 'ready', time: 0, revision: 0 }, 0);
      else view.update(false, 'ready');
      assert.equal(view.group.visible, false);
      assert.equal(camera.parent, null, 'Rod/reel reparented the production camera');
      assert.deepEqual({ position: camera.position.toArray(), quaternion: camera.quaternion.toArray() }, pose, 'Rod/reel changed the camera pose');
    }
    for (const [object, geometry, material, position, color, positionVersion, colorVersion] of resources) {
      assert.equal(object.geometry, geometry, 'Animation recreated a geometry');
      assert.equal(object.material, material, 'Animation recreated a material');
      assert.equal(geometry.attributes.position, position, 'Animation replaced a vertex buffer');
      assert.equal(geometry.attributes.color, color, 'Animation replaced a color buffer');
      assert.equal(position.version, positionVersion, 'Animation rewrote a vertex buffer');
      assert.equal(color.version, colorVersion, 'Animation rewrote a color buffer');
    }
    const meshes = [];
    view.group.traverse(object => { if (object.isMesh) meshes.push(object); });
    assert.deepEqual(meshes, resources.map(([object]) => object), 'Animation added or removed a mesh');
    assert.deepEqual(collection.equipment, { rodLevel: 1, reelLevel: 1 }, 'Rod/reel changed canonical equipment');
  } finally { view.dispose(); }
  assert.equal(listeners.size, 0); assert.equal(scene.children.length, 0);
  return { animated };
}

async function readSource(sha) {
  const modelBlob = await optionalBlob(sha, MODEL), viewBlob = await optionalBlob(sha, VIEW);
  if (!modelBlob && !viewBlob) return null;
  assert(modelBlob && viewBlob, 'Incomplete rod/reel source graph');
  const modules = await compileRodReelSources(await fullSource(sha, MODEL), await fullSource(sha, VIEW));
  const resources = inspectRodReelFactory(modules.createRodReelModel);
  const display = inspectRodReelView(modules.createRodReelView);
  return { sha, modelBlob, viewBlob, resources, display };
}

export async function readMobileRodReelSource(sha) {
  assert.match(sha ?? '', /^[a-f0-9]{40}$/, 'Expected a full rod/reel source SHA');
  if (!sourceCache.has(sha)) sourceCache.set(sha, readSource(sha).catch(error => { sourceCache.delete(sha); throw error; }));
  return sourceCache.get(sha);
}

export async function readMobileRodReelTransition(main, pr) {
  const before = await readMobileRodReelSource(main.sha), after = await readMobileRodReelSource(pr.sha);
  // Only this source-verified absent -> present introduction gets a delta.
  // Later model-to-model changes retain exact resources, just like other PRs.
  if (before || !after) return null;
  assert.equal(main.sha, BASE, 'Rod/reel introduction requires the approved base SHA');
  for (const key of ['lockBlob', 'indexBlob', 'viteBlob']) {
    assert.equal(pr[key], main[key], `Rod/reel transition changed build input ${key}`);
  }
  assert.equal(await fullSource(pr.sha, 'package.json'), await fullSource(main.sha, 'package.json'),
    'Rod/reel transition changed package metadata');
  const paths = (await mobileGit('diff', '--name-only', main.sha, pr.sha, '--', 'src')).split('\n').filter(Boolean).sort();
  assert.deepEqual(paths, allowedPaths, 'Rod/reel transition changed unrelated product source');
  verifyRodReelMainConnection(await fullSource(main.sha, 'src/main.js'), await fullSource(pr.sha, 'src/main.js'));
  const save = JSON.parse(await fullSource(pr.sha, 'tests/fixtures/saves/lighting-save-v1.json'));
  assert.deepEqual(save.collection.equipment, { rodLevel: 1, reelLevel: 1 }, 'Mobile rod/reel source replay requires the neutral fixture');
  return { before: { sha: main.sha, modelBlob: null, viewBlob: null }, after };
}

export async function readMobileCastDisplayTransition(main, pr) {
  if (main.sha !== CAST_BASE || main.fishingViewBlob === pr.fishingViewBlob) return null;
  for (const key of ['lockBlob', 'indexBlob', 'viteBlob', 'cameraBlob', 'hudBlob', 'hudLogicBlob', 'resolutionBlob']) {
    assert.equal(pr[key], main[key], `Cast display changed invariant source ${key}`);
  }
  const paths = (await mobileGit('diff', '--name-only', main.sha, pr.sha, '--', 'src')).split('\n').filter(Boolean).sort();
  assert.deepEqual(paths, ['src/main.js', FISHING, VIEW].sort(), 'Cast display changed unrelated product source');
  const [before, after, beforeMain, afterMain, beforeFishing, afterFishing, beforePackage, afterPackage] = await Promise.all([
    readMobileRodReelSource(main.sha), readMobileRodReelSource(pr.sha),
    fullSource(main.sha, 'src/main.js'), fullSource(pr.sha, 'src/main.js'),
    fullSource(main.sha, FISHING), fullSource(pr.sha, FISHING),
    fullSource(main.sha, 'package.json'), fullSource(pr.sha, 'package.json'),
  ]);
  assert(before && after, 'Cast display requires both existing rod/reel sources');
  assert.equal(before.display.animated, false, 'Cast display base is not the approved neutral view');
  assert.equal(after.display.animated, true, 'Cast display has no exact-source world-tip API');
  assert.equal(after.modelBlob, before.modelBlob, 'Cast display changed the existing model');
  assert.deepEqual(after.resources, before.resources, 'Cast display changed source-derived rendering resources');
  assert.equal(afterPackage, beforePackage, 'Cast display changed package metadata');
  verifyCastDisplayConnection(beforeMain, afterMain, beforeFishing, afterFishing);
  return { kind: 'rod-tip-display-5D2', baseSha: main.sha, validationSha: pr.sha,
    before: { mainBlob: main.mainBlob, fishingViewBlob: main.fishingViewBlob, viewBlob: before.viewBlob },
    after: { mainBlob: pr.mainBlob, fishingViewBlob: pr.fishingViewBlob, viewBlob: after.viewBlob },
    modelBlob: before.modelBlob, resources: 'exact' };
}

// Reverse only the reviewed display edits. The complete old view must return
// byte for byte; the approved base/path alone never grants an exception.
export function verifyFishingPhaseConnection(before, after) {
  const edits = [
    ["      group.visible = active && [PHASE.AIM, PHASE.CAST, PHASE.LURE, PHASE.BITE, PHASE.FIGHT].includes(s.phase);\n"
      + "      ring.visible = group.visible && [PHASE.AIM, PHASE.CAST, PHASE.LURE, PHASE.BITE].includes(s.phase);\n"
      + "      lure.visible = group.visible && [PHASE.CAST, PHASE.LURE].includes(s.phase);\n"
      + "      shadow.visible = group.visible && s.phase === PHASE.FIGHT;\n"
      + "      line.visible = group.visible && s.phase !== PHASE.AIM && rodTipWorld != null;",
    "      group.visible = active && ![PHASE.READY, PHASE.RESULT, PHASE.FAILED].includes(s.phase);"],
    ["      lure.rotation.y = -s.heading + Math.PI / 3;\n      // The water marker",
    "      lure.rotation.y = -s.heading + Math.PI / 3;\n      lure.visible = s.phase !== PHASE.AIM && s.phase !== PHASE.LANDING;\n      // The water marker"],
    ["      shadow.position.set(x, 0.11, z);\n"
      + "      // Only the radial axis is known; the symmetric ellipse has no head/tail.\n"
      + "      // Keep its existing bounded size, fog and boat-occluding depth contract.\n"
      + "      shadow.rotation.z = -s.heading;",
    "      shadow.visible = s.phase === PHASE.FIGHT;\n      shadow.position.set(x, 0.11, z);\n"
      + "      line.visible = s.phase !== PHASE.AIM && rodTipWorld != null;"],
    ["      if (s.phase === PHASE.BITE || s.phase === PHASE.FIGHT) {\n"
      + "        // The hidden lure's bob/action must not leave an airborne line end.\n"
      + "        // This water contact shares the shadow/marker's world x/z coordinate.\n"
      + "        positions[3] = x; positions[4] = 0.12; positions[5] = z;\n"
      + "      } else lure.position.toArray(positions, 3);",
    "      lure.position.toArray(positions, 3);"],
  ];
  let restored = after;
  for (const [replacement, original] of edits) {
    assert.equal(restored.split(replacement).length, 2, '5F-1A: missing or duplicated display edit');
    restored = restored.replace(replacement, original);
  }
  assert.equal(restored, before, '5F-1A: unrelated fishing view source change');
}

export async function readMobileFishingPhaseTransition(main, pr) {
  if (main.sha !== FISHING_PHASE_BASE || main.fishingViewBlob === pr.fishingViewBlob) return null;
  for (const key of ['lockBlob', 'indexBlob', 'viteBlob', 'mainBlob', 'cameraBlob', 'hudBlob', 'hudLogicBlob', 'resolutionBlob']) {
    assert.equal(pr[key], main[key], `5F-1A: changed invariant source ${key}`);
  }
  const paths = (await mobileGit('diff', '--name-only', main.sha, pr.sha, '--', 'src')).split('\n').filter(Boolean).sort();
  assert.deepEqual(paths, [FISHING], '5F-1A: unrelated product source');
  for (const file of ['package.json', 'tests/fixtures/saves/lighting-save-v1.json']) {
    assert.equal(await fullSource(main.sha, file), await fullSource(pr.sha, file), `5F-1A: changed fixture/build input ${file}`);
  }
  verifyFishingPhaseConnection(await fullSource(main.sha, FISHING), await fullSource(pr.sha, FISHING));
  return { kind: 'fishing-phase-5F1A', baseSha: main.sha, validationSha: pr.sha,
    before: { fishingViewBlob: main.fishingViewBlob }, after: { fishingViewBlob: pr.fishingViewBlob } };
}

const fishingSources = new Map();
async function loadFishingDisplaySource(sha) {
  const source = await readMobileFightSource(sha);
  const game = `data:text/javascript;base64,${Buffer.from(`export const PHASE = ${JSON.stringify(source.PHASE)};\nexport const getLurePosition = ${source.getLurePosition.toString()};`).toString('base64')}`;
  const lures = compileSource(await fullSource(sha, 'src/game/lures.js'), {}, 'lures');
  const models = compileSource(await fullSource(sha, 'src/rendering/lure-models.js'), {
    three: import.meta.resolve('three'), 'three/addons/utils/BufferGeometryUtils.js': import.meta.resolve('three/addons/utils/BufferGeometryUtils.js'),
    '../game/lures.js': lures }, 'lure models');
  const visuals = compileSource(await fullSource(sha, 'src/rendering/fishing-visuals.js'), {}, 'fishing visuals');
  const effectsBlob = await optionalBlob(sha, 'src/rendering/fishing-effects.js');
  const effects = effectsBlob ? compileSource(await fullSource(sha, 'src/rendering/fishing-effects.js'), {
    three: import.meta.resolve('three') }, 'fishing effects') : null;
  const view = compileSource(await fullSource(sha, FISHING), { three: import.meta.resolve('three'),
    '../game/fishing.js': game, './fishing-visuals.js': visuals, './lure-models.js': models,
    ...(effects ? { './fishing-effects.js': effects } : {}) }, FISHING);
  const equipment = await compileRodReelSources(await fullSource(sha, MODEL), await fullSource(sha, VIEW));
  return { ...source, ...equipment, ...await import(view) };
}

// Replay the native 150px cast and hold/release fixture from each exact game
// source. No measured lure position, tension or attached expected state drives
// this simulation. It also checks the pre-FIGHT phase/time history.
export async function nativeFishingState(implementation, frames, onFrame) {
  assert(Array.isArray(frames) && frames.length, '5F-1A: missing frame history');
  for (const frame of frames) {
    assert(Number.isFinite(frame.dt) && frame.dt >= 0 && frame.dt <= .25, '5F-1A: invalid frame duration');
    if (!frame.update) assert.equal(frame.dt, 0, '5F-1A: resize advances time');
  }
  if (!fishingSources.has(implementation.sha)) fishingSources.set(implementation.sha,
    loadFishingDisplaySource(implementation.sha).catch(error => { fishingSources.delete(implementation.sha); throw error; }));
  const source = await fishingSources.get(implementation.sha);
  const first = frames.findIndex(frame => frame.phase === 'cast');
  assert(first >= 0, '5F-1A: missing native cast history');
  const boat = { x: 10, z: 20, heading: 0 }, clock = source.createGameClock(undefined, { elapsedSeconds: 90 });
  const fishing = source.createFishing({ random: () => .5, getBoatPosition: () => boat,
    getEnvironment: position => ({ depthM: source.estimateWaterDepth(position), ...clock.state }) });
  let elapsed = 0, stage = 'initial';
  const input = source.createFishingInput(fishing);
  for (const frame of frames.slice(0, first)) if (frame.update) { elapsed += frame.dt; clock.step(frame.dt); }
  assert.equal(fishing.prepare(boat, 0), true); fishing.aim(0, 150); fishing.cast();
  for (const frame of frames.slice(first)) {
    assert.equal(frame.mode, 'fishing'); assert.equal(frame.preparing, false);
    assert(Number.isFinite(frame.dt) && frame.dt >= 0 && frame.dt <= .25, '5F-1A: invalid frame duration');
    if (frame.phase === 'fight' && fishing.state.phase === 'bite') assert.equal(fishing.hook(), true);
    if (frame.update) {
      elapsed += frame.dt; input.step(frame.dt, elapsed * 1000); fishing.step(frame.dt); clock.step(frame.dt);
    } else assert.equal(frame.dt, 0);
    assert.equal(fishing.state.phase, frame.phase, '5F-1A: phase differs from native source replay');
    onFrame?.({ source, fishing, elapsed, frame });
    if (frame.phase === 'fight') {
      if (stage === 'initial') { input.down(0, 0, elapsed * 1000); stage = 'holding'; }
      else if (stage === 'holding' && fishing.state.tension > .78) { input.up(elapsed * 1000); stage = 'relaxing'; }
    }
  }
  return { source, fishing, elapsed };
}

const nearDisplay = (actual, expected, label) => assert(Number.isFinite(actual) && Math.abs(actual - expected) <= 1e-9,
  `5F-1A: ${label} differs from source display replay`);
const effectiveVisible = object => Boolean(object.visible && (!object.parent || effectiveVisible(object.parent)));

// Expected submissions use each source's real geometry, draw range, two-pass
// transparency and bounding-sphere frustum culling, independently per camera.
export function fishingDisplayDraws(objects, camera) {
  camera.updateMatrixWorld();
  const frustum = new Frustum().setFromProjectionMatrix(new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
  return Object.fromEntries(Object.entries(objects).map(([key, mesh]) => {
    mesh.updateWorldMatrix(true, false);
    const drawn = effectiveVisible(mesh) && mesh.material.visible && camera.layers.test(mesh.layers)
      && (!mesh.frustumCulled || frustum.intersectsObject(mesh));
    const calls = drawn ? (mesh.material.transparent && mesh.material.side === DoubleSide && !mesh.material.forceSinglePass ? 2 : 1) : 0;
    assert.equal(mesh.geometry.groups.length, 0, '5F-1A: unexpected material groups');
    const available = mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count;
    const count = Math.max(0, Math.min(available - mesh.geometry.drawRange.start, mesh.geometry.drawRange.count));
    return [key, { calls, triangles: mesh.isMesh ? calls * count / 3 : 0 }];
  }));
}

function replayCamera(pose) {
  const camera = new PerspectiveCamera(55, pose.aspect, .1, 2400);
  camera.position.fromArray(pose.position); camera.quaternion.fromArray(pose.quaternion); camera.updateMatrixWorld();
  return camera;
}

export async function replayFishingPhaseDisplay(implementation, entry) {
  assert(FISHING_PHASE_IDS.includes(entry.id), '5F-1A: unsupported capture ID');
  const { source, fishing, elapsed } = await nativeFishingState(implementation, entry.metrics.cameraFrames);
  const camera = replayCamera(replayMobileCamera(implementation, entry.metrics.cameraFrames));
  const scene = new Scene(), view = source.createFishingView(scene, camera);
  const equipment = source.createRodReelView(scene, camera, { equipment: { rodLevel: 1, reelLevel: 1 }, subscribe: () => () => {} });
  try {
    equipment.update(true, fishing.state, elapsed);
    const tip = equipment.copyTipWorld(new Vector3());
    view.update(fishing, true, elapsed, tip); scene.updateMatrixWorld(true);
    const group = scene.children[0], [ring, lure, shadow, line] = group.children;
    const objects = { ring, lure, shadow, line };
    const meshes = Object.fromEntries(Object.entries(objects).map(([key, object]) => [key, {
      visible: effectiveVisible(object), position: object.position.toArray(), quaternion: object.quaternion.toArray(), scale: object.scale.toArray(),
      vertices: object.geometry.attributes.position.count, indices: object.geometry.index?.count ?? 0,
    }]));
    const phase = entry.id.endsWith('bite') ? 'bite' : 'fight';
    assert.equal(fishing.state.phase, phase, '5F-1A: final native phase differs');
    const result = { version: 1, phase, elapsed, meshes, line: Array.from(line.geometry.attributes.position.array),
      draws: { fixed: fishingDisplayDraws(objects, replayCamera(expectedMobileResourceCamera(camera.aspect))),
        actual: fishingDisplayDraws(objects, camera) },
      state: { phase, origin: { ...fishing.state.origin }, heading: fishing.state.heading, distance: fishing.state.distance,
        lureId: fishing.state.lureId, time: fishing.state.time } };
    // Check the new contact independently of the view's endpoint assignment.
    if (implementation.sha !== FISHING_PHASE_BASE) {
      const position = source.getLurePosition(fishing.state);
      assert.deepEqual(result.line, [...tip.toArray(), position.x, .12, position.z].map(Math.fround), '5F-1A: independent water contact differs');
    }
    return result;
  } finally {
    equipment.dispose();
    scene.traverse(object => { object.geometry?.dispose(); if (!Array.isArray(object.material)) object.material?.dispose(); });
  }
}

export async function verifyFishingPhaseCapture(implementation, entry) {
  if (!FISHING_PHASE_IDS.includes(entry.id)) return null;
  const observed = entry.metrics.fishingDisplay;
  assert(observed?.version === 1 && observed.passes?.fixed && observed.passes?.actual, '5F-1A: missing fishing display JSON');
  const expected = await replayFishingPhaseDisplay(implementation, entry);
  assert.equal(observed.phase, expected.phase, '5F-1A: display phase differs');
  nearDisplay(observed.elapsed, expected.elapsed, 'elapsed');
  for (const [key, mesh] of Object.entries(expected.meshes)) {
    const actual = observed.meshes?.[key]; assert(actual, `5F-1A: missing ${key} mesh`);
    for (const field of ['visible', 'vertices', 'indices']) assert.equal(actual[field], mesh[field], `5F-1A: ${key} ${field} differs`);
    for (const field of ['position', 'quaternion', 'scale']) {
      assert.equal(actual[field]?.length, mesh[field].length, `5F-1A: missing ${key} ${field}`);
      mesh[field].forEach((value, i) => nearDisplay(actual[field][i], value, `${key} ${field}[${i}]`));
    }
  }
  assert.deepEqual(observed.line, expected.line, '5F-1A: actual line differs from source/water contact');
  for (const [pass, metric] of [['fixed', 'resources'], ['actual', 'actualResources']]) {
    const camera = pass === 'fixed' ? expectedMobileResourceCamera(entry.metrics.camera.aspect) : { ...entry.metrics.camera, fov: 55 };
    assert.deepEqual(observed.passes[pass].camera, camera, `5F-1A: substituted ${pass} camera`);
    assert.deepEqual(observed.passes[pass].resources, entry.metrics[metric], `5F-1A: substituted ${pass} renderer counters`);
    assert.deepEqual(observed.passes[pass].draws, expected.draws[pass], `5F-1A: ${pass} submissions differ from source culling`);
  }
  return expected;
}

export function expectedFishingPhaseResources(before, after, pass, beforeReplay, afterReplay) {
  assert(before && after && beforeReplay && afterReplay, '5F-1A: missing verified resource evidence');
  for (const counters of [before, after]) for (const key of ['calls', 'triangles', 'geometries', 'textures', 'programs']) {
    assert(Number.isSafeInteger(counters[key]) && counters[key] >= 0, `5F-1A: invalid renderer counter ${key}`);
  }
  assert.equal(beforeReplay.phase, afterReplay.phase, '5F-1A: capture phases differ');
  for (const key of ['origin', 'heading', 'lureId']) assert.deepEqual(afterReplay.state[key], beforeReplay.state[key], `5F-1A: native ${key} differs`);
  const removed = beforeReplay.phase === 'bite' ? ['lure'] : ['ring', 'lure'];
  let calls = 0, triangles = 0;
  for (const key of ['ring', 'lure', 'shadow', 'line']) {
    const b = beforeReplay.draws[pass][key], a = afterReplay.draws[pass][key];
    if (removed.includes(key)) {
      assert.deepEqual(a, { calls: 0, triangles: 0 }, '5F-1A: removed mesh still submits');
      calls += b.calls; triangles += b.triangles;
    } else assert.deepEqual(a, b, `5F-1A: non-hidden ${key} submissions changed`);
  }
  const expected = { ...before, calls: before.calls - calls, triangles: before.triangles - triangles };
  assert.deepEqual(after, expected, `5F-1A: ${pass} resource regression`);
  return expected;
}

export function expectedRodReelResources(before, id, transition) {
  if (!transition) return null;
  assert(/^(portrait|landscape|small|pc|pc-hidpi)-(day-tps|day-fps|clear-night|fog-night|dense-night)$|^(portrait|landscape|small|pc)-(bite|fight)$|^rotated-fight$/.test(id), 'Unknown rod/reel capture ID');
  const fishing = /^(portrait|landscape|small|pc|pc-hidpi)-day-fps$|^(portrait|landscape|small|pc)-(bite|fight)$|^rotated-fight$/.test(id);
  const resources = transition.after.resources;
  return { ...before, calls: before.calls + (fishing ? resources.calls : 0),
    triangles: before.triangles + (fishing ? resources.triangles : 0), geometries: before.geometries + resources.geometries };
}

export function verifyRodReelCapture(entry) {
  const frame = entry.metrics.cameraFrames.at(-1);
  assert(frame, `${entry.id}: missing rod/reel view history`);
  const phase = entry.id.endsWith('day-fps') ? 'ready' : entry.id.endsWith('bite') ? 'bite'
    : entry.id.endsWith('fight') ? 'fight' : 'inactive';
  assert.equal(frame.mode, phase === 'inactive' ? 'sailing' : 'fishing', `${entry.id}: rod/reel capture mode differs`);
  assert.equal(frame.phase, phase, `${entry.id}: rod/reel capture phase differs`);
}
