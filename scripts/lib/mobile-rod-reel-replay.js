import assert from 'node:assert/strict';
import { PerspectiveCamera, Scene, Vector3, MeshBasicMaterial, Object3D, DoubleSide } from 'three';
import { mobileGit } from './mobile-comparison-source.js';

const BASE = '936210d2d118e4e66e2e4426a198d626f84742e8';
const MODEL = 'src/rendering/rod-reel-model.js', VIEW = 'src/rendering/rod-reel-view.js';
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
  try {
    assert.equal(listeners.size, 1, 'Rod/reel view must subscribe to canonical equipment');
    assert.equal(view.group.parent, scene, 'Rod/reel root is not owned by the rendered scene');
    assert.equal(view.group.visible, false, 'Rod/reel must start hidden in sailing');
    for (const aspect of [390 / 844, 844 / 390, 360 / 740, 1280 / 800]) {
      camera.aspect = aspect; camera.position.set(10, 2.15, 20); camera.rotation.set(.12, -.4, 0); camera.updateProjectionMatrix();
      const pose = { position: camera.position.toArray(), quaternion: camera.quaternion.toArray() };
      for (const phase of ['ready', 'aim', 'cast', 'lure', 'bite', 'fight', 'landing']) {
        view.update(true, phase); assert.equal(view.group.visible, true, `Rod/reel hidden during ${phase}`);
        const projection = view.group.localToWorld(new Vector3(0, 1, 0)).project(camera);
        assert(Math.abs(projection.x - .16) < 1e-10 && Math.abs(projection.y + .14) < 1e-10, 'Rod/reel view no longer matches the virtual line projection');
      }
      for (const phase of ['result', 'failed']) { view.update(true, phase); assert.equal(view.group.visible, false); }
      view.update(false, 'ready'); assert.equal(view.group.visible, false);
      assert.equal(camera.parent, null, 'Rod/reel reparented the production camera');
      assert.deepEqual({ position: camera.position.toArray(), quaternion: camera.quaternion.toArray() }, pose, 'Rod/reel changed the camera pose');
    }
    assert.deepEqual(collection.equipment, { rodLevel: 1, reelLevel: 1 }, 'Rod/reel changed canonical equipment');
  } finally { view.dispose(); }
  assert.equal(listeners.size, 0); assert.equal(scene.children.length, 0);
}

async function readSource(sha) {
  const modelBlob = await optionalBlob(sha, MODEL), viewBlob = await optionalBlob(sha, VIEW);
  if (!modelBlob && !viewBlob) return null;
  assert(modelBlob && viewBlob, 'Incomplete rod/reel source graph');
  const modules = await compileRodReelSources(await fullSource(sha, MODEL), await fullSource(sha, VIEW));
  const resources = inspectRodReelFactory(modules.createRodReelModel);
  inspectRodReelView(modules.createRodReelView);
  return { sha, modelBlob, viewBlob, resources };
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
