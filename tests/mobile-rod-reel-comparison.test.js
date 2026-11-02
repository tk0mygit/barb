import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MOBILE_CAPTURE_IDS, compareMobileCapturePair } from '../scripts/compare-mobile-performance.mjs';
import { compileRodReelSources, inspectRodReelFactory, inspectRodReelView, readMobileRodReelSource,
  verifyRodReelMainConnection, verifyCastDisplayConnection, readMobileCastDisplayTransition,
  expectedRodReelResources, verifyRodReelCapture } from '../scripts/lib/mobile-rod-reel-replay.js';
import { mobileGit } from '../scripts/lib/mobile-comparison-source.js';
import { validateMobileEvidence } from '../scripts/ci-summary.js';
import { mobileGateFixture } from './helpers/mobile-gate-fixture.js';

const BASE = '936210d2d118e4e66e2e4426a198d626f84742e8';
const CAST_BASE = 'f2e87f9fd5262b99bb42af1fe835d7bd13307ade';
const modelSource = await readFile(new URL('../src/rendering/rod-reel-model.js', import.meta.url), 'utf8');
const viewSource = await readFile(new URL('../src/rendering/rod-reel-view.js', import.meta.url), 'utf8');
const modules = await compileRodReelSources(modelSource, viewSource);
const resources = inspectRodReelFactory(modules.createRodReelModel);
// Deliberately synthetic unit identities, never passed off as browser/Git
// provenance. Production entry points independently reload both real SHAs.
const transition = { before: { sha: BASE, modelBlob: null, viewBlob: null },
  after: { sha: 'f'.repeat(40), modelBlob: 'a'.repeat(40), viewBlob: 'b'.repeat(40), resources } };
const counters = { calls: 31, triangles: 275444, geometries: 24, textures: 4, programs: 12 };

test('exact factory source yields two persistent meshes, all 20 level counts and the reused shader', () => {
  assert.equal(resources.calls, 2); assert.equal(resources.geometries, 2);
  assert.equal(resources.textures, 0); assert.equal(resources.programs, 0);
  assert.equal(resources.rodTriangles.length, 10); assert.equal(resources.reelTriangles.length, 10);
  assert.equal(resources.triangles, resources.rodTriangles[0] + resources.reelTriangles[0]);
  assert(resources.maximumTriangles <= 2500);
  inspectRodReelView(modules.createRodReelView);
});

test('the approved base genuinely has no rod/reel factory or view', async () => {
  assert.equal(await readMobileRodReelSource(BASE), null);
  await assert.rejects(readMobileRodReelSource('main'), /full rod\/reel source SHA/);
});

test('production integration exactly reverses to the approved base and rejects unrelated edits', async () => {
  const before = await mobileGit('show', `${BASE}:src/main.js`);
  // Construct the introduction from its reviewed base. Do not require every
  // future PR's working main to remain byte-identical to this Phase's source.
  const additions = [
    ["import { createFishingView } from './rendering/fishing.js';", "\nimport { createRodReelView } from './rendering/rod-reel-view.js';"],
    ['  const fishingView = createFishingView(scene, camera);', '\n  rodReelView = createRodReelView(scene, camera, collection);'],
    ["    fishingView.update(fishing, boat.mode === 'fishing', elapsed);", "\n    rodReelView.update(boat.mode === 'fishing', fishing.state.phase);"],
    ['    qteHUD?.dispose(); qteDelivery?.retire();', '\n    rodReelView.dispose();'],
    ['  autosave?.dispose(); qteHUD?.dispose(); qteDelivery?.retire();', '\n  rodReelView?.dispose();'],
  ];
  let after = before.replace('let autosave, environmentAudio, audioSession, qteDelivery, qteHUD;',
    'let autosave, environmentAudio, audioSession, qteDelivery, qteHUD, rodReelView;');
  for (const [anchor, addition] of additions) {
    assert.equal(after.split(anchor).length, 2);
    after = after.replace(anchor, anchor + addition);
  }
  verifyRodReelMainConnection(before, after);
  assert.throws(() => verifyRodReelMainConnection(before, after.replace('renderer.toneMappingExposure = 0.9', 'renderer.toneMappingExposure = 0.8')), /unrelated production main source/);
  assert.throws(() => verifyRodReelMainConnection(before, after.replace("    rodReelView.update(boat.mode === 'fishing', fishing.state.phase);\n", '')), /missing or duplicated/);
});

test('replay rejects a larger dependency graph instead of loading the working checkout', async () => {
  await assert.rejects(compileRodReelSources("import x from '../game/equipment.js';\n" + modelSource, viewSource), /unexpected dependency/);
  await assert.rejects(compileRodReelSources(modelSource, "import('three');\n" + viewSource), /dynamic replay dependencies/);
});

test('factory inspection rejects culling, shadow, shader, draw-range and regeneration changes', () => {
  for (const mutate of [
    mesh => { mesh.renderOrder = 1; },
    mesh => { mesh.frustumCulled = true; }, mesh => { mesh.castShadow = true; },
    mesh => { mesh.material.fog = false; }, mesh => { mesh.material.transparent = true; },
    mesh => { mesh.geometry.setDrawRange(0, Infinity); },
    mesh => { mesh.material.onBeforeCompile = () => {}; },
  ]) assert.throws(() => inspectRodReelFactory(() => {
    const model = modules.createRodReelModel(); mutate(model.rod.children.find(child => child.isMesh)); return model;
  }));
  assert.throws(() => inspectRodReelFactory(() => {
    const model = modules.createRodReelModel(), original = model.setLevels;
    model.setLevels = levels => {
      original(levels);
      const mesh = model.rod.children.find(child => child.isMesh), old = mesh.geometry;
      mesh.geometry = old.clone(); old.dispose();
    };
    return model;
  }), /recreated a geometry/);
});

test('the 34 existing IDs gain exactly two warmup geometries; only 14 fishing views gain draws', () => {
  const rows = MOBILE_CAPTURE_IDS.map(id => ({ id, after: expectedRodReelResources(counters, id, transition) }));
  assert.equal(rows.length, 34);
  assert.equal(rows.filter(row => row.after.calls === counters.calls + 2).length, 14);
  assert.equal(rows.filter(row => row.after.calls === counters.calls).length, 20);
  for (const { after } of rows) {
    assert.equal(after.geometries, counters.geometries + 2);
    assert.equal(after.textures, counters.textures); assert.equal(after.programs, counters.programs);
    assert.equal(after.triangles - counters.triangles, after.calls === counters.calls ? 0 : resources.triangles);
  }
  assert.equal(expectedRodReelResources(counters, 'pc-day-fps', null), null);
  assert.throws(() => expectedRodReelResources(counters, 'unknown', transition), /Unknown rod\/reel capture ID/);
});

function pair(id = 'pc-day-fps') {
  const metrics = { viewport: { width: 1280, height: 800 }, dpr: 1, pixelRatio: 1,
    buffer: { width: 1280, height: 800 }, pixels: 1280 * 800,
    camera: { position: [10, 2.15, 20], quaternion: [0, 0, 0, 1], aspect: 1.6 },
    savedClockSeconds: 90, boat: [10, 20], waterTime: .25, fogStrength: 0,
    resources: { ...counters }, actualResources: { ...counters } };
  const before = { id, metrics }, after = structuredClone(before);
  after.metrics.resources = expectedRodReelResources(counters, id, transition);
  after.metrics.actualResources = expectedRodReelResources(counters, id, transition);
  const metadata = { mode: 'regression', baseSha: BASE, headSha: transition.after.sha, validationSha: transition.after.sha,
    implementations: { main: { sha: BASE, cameraBlob: 'c'.repeat(40) }, pr: { sha: transition.after.sha, cameraBlob: 'c'.repeat(40) } } };
  return { before, after, metadata, sources: { rodReelTransition: transition } };
}

test('the pair comparator keeps exact diagnostic and actual-view counters outside the proven delta', () => {
  for (const id of ['pc-day-fps', 'portrait-day-tps']) {
    const p = pair(id), row = compareMobileCapturePair(p.before, p.after, p.metadata, p.sources);
    assert.equal(row.rodReelComparison, transition);
    for (const pass of ['resources', 'actualResources']) for (const field of Object.keys(counters)) {
      const changed = pair(id); changed.after.metrics[pass][field]++;
      assert.throws(() => compareMobileCapturePair(changed.before, changed.after, changed.metadata, changed.sources), /resource regression/, `${id}/${pass}/${field}`);
    }
    const missing = pair(id); delete missing.after.metrics.actualResources;
    assert.throws(() => compareMobileCapturePair(missing.before, missing.after, missing.metadata, missing.sources), /missing production-view resources/);
    assert.throws(() => compareMobileCapturePair(p.before, p.after, p.metadata), /resource regression/);
  }
});

test('the gear allowance verifies the existing native capture modes and phases', () => {
  for (const id of MOBILE_CAPTURE_IDS) {
    const phase = id.endsWith('day-fps') ? 'ready' : id.endsWith('bite') ? 'bite' : id.endsWith('fight') ? 'fight' : 'inactive';
    const entry = { id, metrics: { cameraFrames: [{ phase, mode: phase === 'inactive' ? 'sailing' : 'fishing' }] } };
    verifyRodReelCapture(entry);
    entry.metrics.cameraFrames[0].phase = 'landing';
    assert.throws(() => verifyRodReelCapture(entry), /capture phase differs/);
  }
});

test('cast display wiring recovers the approved main and fishing source exactly', async () => {
  const [beforeMain, beforeFishing, main, fishing] = await Promise.all([
    mobileGit('show', `${CAST_BASE}:src/main.js`), mobileGit('show', `${CAST_BASE}:src/rendering/fishing.js`),
    readFile(new URL('../src/main.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/rendering/fishing.js', import.meta.url), 'utf8'),
  ]);
  const afterMain = main.trim(), afterFishing = fishing.trim();
  verifyCastDisplayConnection(beforeMain, afterMain, beforeFishing, afterFishing);
  for (const changed of [
    afterMain.replace('renderer.toneMappingExposure = 0.9', 'renderer.toneMappingExposure = 0.8'),
    afterMain.replace('rodReelView.copyTipWorld(rodTipWorld)', 'null'),
    afterMain.replace('    const activeTarget =', '    elapsed += .1;\n    const activeTarget ='),
    afterMain.replace('if (document.hidden && fishing.state.phase === PHASE.READY)', 'if (document.hidden)'),
  ]) {
    assert.notEqual(changed, afterMain);
    assert.throws(() => verifyCastDisplayConnection(beforeMain, changed, beforeFishing, afterFishing), /unrelated production main source|missing or duplicated/);
  }
  for (const changed of [
    afterFishing.replace('s.distance * 0.18', 's.distance * 0.19'),
    afterFishing.replace('fishing.settings.flightSeconds', '0.9'),
    afterFishing.replace('lure.position.toArray(positions, 3)', 'lure.position.toArray(positions, 0)'),
  ]) {
    assert.notEqual(changed, afterFishing);
    assert.throws(() => verifyCastDisplayConnection(beforeMain, afterMain, beforeFishing, changed), /unrelated fishing view source/);
  }
});

test('cast display exception is bounded to its approved base and unchanged invariant sources', async () => {
  assert.equal(await readMobileCastDisplayTransition({ sha: BASE, fishingViewBlob: 'a' }, { sha: CAST_BASE, fishingViewBlob: 'b' }), null);
  assert.equal(await readMobileCastDisplayTransition({ sha: CAST_BASE, fishingViewBlob: 'a' }, { sha: CAST_BASE, fishingViewBlob: 'a' }), null);
  for (const key of ['lockBlob', 'indexBlob', 'viteBlob', 'cameraBlob', 'hudBlob', 'hudLogicBlob', 'resolutionBlob']) {
    await assert.rejects(readMobileCastDisplayTransition({ sha: CAST_BASE, fishingViewBlob: 'a', [key]: 'a' },
      { sha: 'f'.repeat(40), fishingViewBlob: 'b', [key]: 'b' }), /changed invariant source/);
  }
});

test('exact-source animation inspection rejects a stale world-tip API and altered neutral pose', () => {
  assert.throws(() => inspectRodReelView((...args) => {
    const view = modules.createRodReelView(...args), copy = view.copyTipWorld;
    view.copyTipWorld = out => { const result = copy(out); if (result) result.x += .001; return result; };
    return view;
  }), /world-tip API differs from the displayed model/);
  assert.throws(() => inspectRodReelView((...args) => {
    const view = modules.createRodReelView(...args), update = view.update;
    view.update = (...values) => { update(...values); view.group.position.x += .001; };
    return view;
  }), /neutral view no longer matches/);
  assert.throws(() => inspectRodReelView((...args) => {
    const view = modules.createRodReelView(...args), update = view.update;
    view.update = (active, state, elapsed) => update(active, state.phase === 'cast'
      ? { ...state, phase: 'aim', time: Math.max(.18, state.time) } : state, elapsed);
    return view;
  }), /no forward stroke beyond the neutral pose/);
});

function castPair() {
  const p = pair();
  p.after.metrics.resources = { ...counters }; p.after.metrics.actualResources = { ...counters };
  p.metadata.baseSha = CAST_BASE;
  p.metadata.implementations.main = { sha: CAST_BASE, cameraBlob: 'c'.repeat(40), mainBlob: 'd'.repeat(40), fishingViewBlob: 'e'.repeat(40) };
  Object.assign(p.metadata.implementations.pr, { mainBlob: '1'.repeat(40), fishingViewBlob: '2'.repeat(40) });
  p.sources = { castDisplayTransition: { kind: 'rod-tip-display-5D2', baseSha: CAST_BASE,
    validationSha: p.metadata.validationSha, resources: 'exact',
    before: { mainBlob: 'd'.repeat(40), fishingViewBlob: 'e'.repeat(40) },
    after: { mainBlob: '1'.repeat(40), fishingViewBlob: '2'.repeat(40) } } };
  return p;
}

test('5D-2 grants zero resource allowance and rejects forged proof provenance', () => {
  const p = castPair(), row = compareMobileCapturePair(p.before, p.after, p.metadata, p.sources);
  assert.equal(row.castDisplayComparison, p.sources.castDisplayTransition);
  assert.equal(row.resourceTransition, undefined); assert.equal(row.rodReelComparison, undefined);
  for (const pass of ['resources', 'actualResources']) for (const field of Object.keys(counters)) {
    const changed = castPair(); changed.after.metrics[pass][field]++;
    assert.throws(() => compareMobileCapturePair(changed.before, changed.after, changed.metadata, changed.sources), /resource regression/);
  }
  for (const mutate of [
    proof => { proof.kind = 'rod-reel-5D1'; }, proof => { proof.baseSha = BASE; },
    proof => { proof.validationSha = '0'.repeat(40); }, proof => { proof.resources = '+2'; },
    proof => { proof.before.mainBlob = '0'.repeat(40); }, proof => { proof.after.fishingViewBlob = '0'.repeat(40); },
  ]) {
    const changed = castPair(); mutate(changed.sources.castDisplayTransition);
    assert.throws(() => compareMobileCapturePair(changed.before, changed.after, changed.metadata, changed.sources), /cast display|Cast display/);
  }
  const missing = castPair(); delete missing.after.metrics.actualResources;
  assert.throws(() => compareMobileCapturePair(missing.before, missing.after, missing.metadata, missing.sources), /missing production-view resources/);
});

test('final Mobile gate recomputes source proof and rejects a serialized cast exception', async () => {
  const evidence = await mobileGateFixture();
  const payload = { record: { files: evidence.files }, mobile: {
    metadata: evidence.metadata, before: evidence.before, after: evidence.after, comparison: evidence.comparison,
  } };
  payload.mobile.comparison.rows[0].castDisplayComparison = { kind: 'rod-tip-display-5D2', resources: 'exact' };
  await assert.rejects(validateMobileEvidence(payload, evidence.metadata), /report differs from captures/);
  delete payload.mobile.comparison.rows[0].castDisplayComparison;
  payload.mobile.metadata.implementations.pr.fishingViewBlob = '0'.repeat(40);
  await assert.rejects(validateMobileEvidence(payload, evidence.metadata), /implementation provenance differs/);
});
