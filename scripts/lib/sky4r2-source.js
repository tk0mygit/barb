import assert from 'node:assert/strict';
import { Color } from 'three';
import { mobileGit } from './mobile-comparison-source.js';
import { readAuroraSource, verifyAuroraCapture } from './sky4-source.js';
import { readAuroraTransition } from './sky4-motion-source.js';
import { SKY4R2_BLOBS } from './sky4r2-pins.js';
import { SKY4R2_EDITS } from './sky4r2-edits.js';

export const SKY4R2_BASE = '50bc6ebcca09e50b90c3a30c5dc8613255d85c6a';
export const SKY4R2_KIND = 'aurora-color-world-light-Sky4R2';
const MANIFEST = 'scripts/lib/sky4r2-pins.js', EDITS = 'scripts/lib/sky4r2-edits.js';
const BASE_BLOBS = Object.freeze({ 'src/world/aurora.js': '9506280741bddc9faeafaf9c88a98b6665da780a',
  'src/world/lake.js': '74e948aabe6d55fad7fe64afaf5d9943a01eb2eb', 'src/world/water.js': '11bdc38423f0a10075326f2481be23647971d224' });
const url = text => `data:text/javascript;base64,${Buffer.from(text).toString('base64')}`;
const cache = new Map();
export async function readWorldLightSource(sha) {
  if (!cache.has(sha)) cache.set(sha, (async () => {
    const aurora = await readAuroraSource(sha), dayNight = await mobileGit('show', `${sha}:src/world/day-night.js`), dayURL = url(dayNight);
    const water = (await mobileGit('show', `${sha}:src/world/water.js`)).replace(/from '([^']+)'/g, (_, dependency) => {
      assert(['three', './day-night.js'].includes(dependency), 'Sky-4R2: unknown water dependency');
      return `from ${JSON.stringify(dependency === 'three' ? import.meta.resolve('three') : dayURL)}`;
    });
    assert(!/\bimport\s*\(|\brequire\s*\(/.test(water), 'Sky-4R2: dynamic water dependency');
    return { ...aurora, ...await import(dayURL), ...await import(url(water)) };
  })().catch(error => { cache.delete(sha); throw error; }));
  return cache.get(sha);
}

export function verifySky4R2Product(path, before, after) {
  assert(SKY4R2_EDITS[path]?.length, 'Sky-4R2: unknown product path');
  for (const [old, reviewed] of SKY4R2_EDITS[path]) {
    assert.equal(after.split(reviewed).length, 2, `Sky-4R2: unapproved/missing product hunk ${path}`);
    after = after.replace(reviewed, old);
  }
  assert.equal(after, before, `Sky-4R2: unrelated product change ${path}`);
}

export async function readSky4R2Transition(main, pr, headSha) {
  assert.equal(main.sha, SKY4R2_BASE, 'Sky-4R2: unapproved base SHA');
  const parents = (await mobileGit('show', '-s', '--format=%P', pr.sha)).split(' ');
  if (headSha === undefined) {
    if (parents.length === 2) { assert.equal(parents[0], main.sha, 'Sky-4R2: inferred merge base differs'); headSha = parents[1]; }
    else headSha = pr.sha;
  }
  assert.match(headSha, /^[a-f0-9]{40}$/, 'Sky-4R2: full HEAD required');
  assert.equal(await mobileGit('rev-parse', `${headSha}^{commit}`), headSha);
  if (headSha !== pr.sha) {
    assert.deepEqual(parents, [main.sha, headSha], 'Sky-4R2: validation merge parents differ');
    assert.equal(await mobileGit('rev-parse', `${headSha}^{tree}`), await mobileGit('rev-parse', `${pr.sha}^{tree}`), 'Sky-4R2: HEAD/validation tree differs');
  }
  assert.equal(await mobileGit('merge-base', main.sha, headSha), main.sha, 'Sky-4R2: base is not ancestor');
  assert.deepEqual((await mobileGit('diff', '--name-only', main.sha, pr.sha, '--', 'src')).split('\n').sort(), Object.keys(BASE_BLOBS).sort(), 'Sky-4R2: unrelated runtime change');
  assert.equal(await mobileGit('diff', '--name-only', main.sha, pr.sha, '--', 'public', 'package.json', 'package-lock.json', 'index.html',
    'vite.config.js', 'playwright.config.js', '.github', 'scripts/ci-risk.js', 'scripts/ci-e2e.js', 'scripts/ci-summary.js', 'AGENTS.md'), '', 'Sky-4R2: build/assets/CI changed');
  const allowed = Object.keys(SKY4R2_BLOBS).filter(path => path.startsWith('scripts/lib/')).concat(MANIFEST).sort();
  assert.deepEqual((await mobileGit('diff', '--name-only', main.sha, pr.sha, '--', 'scripts/lib')).split('\n').sort(), allowed, 'Sky-4R2: historical replay changed');
  for (const path of ['scripts/lib/sky4-source.js', 'scripts/lib/sky4-source-pins.js', 'scripts/lib/sky4-motion-source.js', 'scripts/lib/sky4-motion-pins.js',
    'tests/helpers/star-snapshot.js', 'tests/helpers/meteor-snapshot.js', 'tests/helpers/aurora-snapshot.js', 'tests/helpers/aurora-event.js',
    'tests/helpers/sky2-fixture.js', 'tests/helpers/sky3-fixture.js', 'tests/sky4-comparison.test.js', 'tests/sky4-motion.test.js']) {
    assert.equal(await mobileGit('diff', '--name-only', main.sha, pr.sha, '--', path), '', `Sky-4R2: historical source changed ${path}`);
  }
  const literal = (text, comment, name) => {
    const prefix = `// ${comment}\nexport const ${name} = Object.freeze(`;
    assert(text.startsWith(prefix) && text.endsWith(');'), 'Sky-4R2: nonliteral source manifest');
    return JSON.parse(text.slice(prefix.length, -2));
  };
  assert.deepEqual(literal(await mobileGit('show', `${pr.sha}:${MANIFEST}`), 'Reviewed Sky-4R2 blobs; separate literal manifest avoids a circular self-hash.', 'SKY4R2_BLOBS'), SKY4R2_BLOBS, 'Sky-4R2: manifest differs');
  assert.deepEqual(literal(await mobileGit('show', `${pr.sha}:${EDITS}`), 'Reviewed Sky-4R2 product hunks; context and every other byte stay exact.', 'SKY4R2_EDITS'), SKY4R2_EDITS, 'Sky-4R2: approved hunks differ');
  for (const [path, blob] of Object.entries(SKY4R2_BLOBS)) {
    assert.match(await mobileGit('ls-tree', pr.sha, '--', path), /^100644 blob /, 'Sky-4R2: invalid source mode');
    assert.equal(await mobileGit('rev-parse', `${pr.sha}:${path}`), blob, `Sky-4R2: unapproved blob ${path}`);
  }
  for (const [path, blob] of Object.entries(BASE_BLOBS)) {
    assert.equal(await mobileGit('rev-parse', `${main.sha}:${path}`), blob, 'Sky-4R2: base product differs');
    verifySky4R2Product(path, await mobileGit('show', `${main.sha}:${path}`), await mobileGit('show', `${pr.sha}:${path}`));
  }
  const before = await readWorldLightSource(main.sha), after = await readWorldLightSource(pr.sha);
  assert.deepEqual(after.AURORA_CONFIG, before.AURORA_CONFIG, 'Sky-4R2: probability/timing/geometry changed');
  return { kind: SKY4R2_KIND, baseSha: main.sha, headSha, validationSha: pr.sha,
    before: BASE_BLOBS, after: Object.fromEntries(Object.keys(BASE_BLOBS).map(path => [path, SKY4R2_BLOBS[path]])), sources: SKY4R2_BLOBS,
    resources: { geometryDelta: 0, meshDelta: 0, materialDelta: 0, lightDelta: 0, textureDelta: 0, programDelta: 0, callDelta: 0,
      auroraCalls: 2, auroraTriangles: 3200, skyBatches: 4, shadowPassDelta: 0 } };
}

export async function readAuroraEvolution(main, pr, headSha) {
  if (main.sha === SKY4R2_BASE && (main.auroraBlob !== pr.auroraBlob || main.lakeBlob !== pr.lakeBlob || main.waterBlob !== pr.waterBlob
    || await mobileGit('ls-tree', pr.sha, '--', MANIFEST))) return readSky4R2Transition(main, pr, headSha);
  return readAuroraTransition(main, pr, headSha);
}

function waterValues(mesh) {
  const geometry = mesh.geometry, material = mesh.material, u = material.uniforms;
  return { attributes: Object.fromEntries(Object.entries(geometry.attributes).map(([key, a]) => [key,
    { itemSize: a.itemSize, count: a.count, version: a.version, bytes: a.array.byteLength }])),
    index: { count: geometry.index.count, version: geometry.index.version, bytes: geometry.index.array.byteLength },
    drawRange: { start: geometry.drawRange.start, count: Number.isFinite(geometry.drawRange.count) ? geometry.drawRange.count : geometry.index.count },
    material: { type: material.type, fog: material.fog, transparent: material.transparent, side: material.side,
      depthTest: material.depthTest, depthWrite: material.depthWrite, forceSinglePass: material.forceSinglePass, blending: material.blending,
      vertexShader: material.vertexShader, fragmentShader: material.fragmentShader },
    light: u.auroraStrength ? { color: u.auroraColor.value.toArray(), strength: u.auroraStrength.value, direction: u.auroraDirection.value.toArray() } : null };
}

export async function replayWorldLightCapture(implementation, metrics) {
  const source = await readWorldLightSource(implementation.sha), recorded = metrics.auroraDisplay?.clockSeconds;
  const time = metrics.auroraDisplay?.snapshot?.layers[0]?.uniforms.auroraTime;
  assert(Number.isFinite(recorded) && Number.isFinite(time), 'Sky-4R2: missing optical time');
  // verifyAuroraCapture validates this animation scalar against the native
  // clock with its existing 1e-10 bound and phase/wrap guard. Reconstruct the
  // exact original clock grid; grant no color/shape/resource tolerance.
  const seconds = recorded - recorded % 720 + time;
  assert(Math.abs(seconds - recorded) <= 1e-10, 'Sky-4R2: native clock differs');
  const clock = source.createGameClock(undefined, { elapsedSeconds: seconds }).state, fog = source.sampleNightFog(clock);
  const sample = source.sampleAurora(clock, fog.fogType), light = source.sampleAuroraLight?.(sample);
  const base = source.sampleDayNight(clock), ambient = source.sampleAuroraEnvironment?.(base, light)
    ?? { ambientSky: base.ambientSky, ambientGround: base.ambientGround, ambientIntensity: base.ambientIntensity };
  const boat = { x: metrics.boat?.[0] ?? 10, z: metrics.boat?.[1] ?? 20, speed: metrics.boatSpeed ?? 0 };
  const water = source.createWater();
  try {
    water.update(metrics.waterTime ?? 0, boat, base, light);
    const position = direction => [direction[0] * 200 + boat.x, direction[1] * 200, direction[2] * 200 + boat.z];
    return { seconds, base, ambient, water: waterValues(water.mesh), state: { model: light ? 'aurora-world-light-v1' : 'baseline',
      strength: light?.lightStrength ?? 0, color: light?.lightColor ?? [0, 0, 0], direction: light?.lightDirection ?? [0, 0], ambient },
      lights: [
        { type: 'HemisphereLight', castShadow: false, color: ambient.ambientSky, ground: ambient.ambientGround, intensity: ambient.ambientIntensity,
          position: [0, 1, 0], target: null, shadowMapSize: null, shadowTarget: false },
        { type: 'DirectionalLight', castShadow: true, color: base.sunColor, ground: null, intensity: base.sunIntensity,
          position: position(base.sunDirection), target: [boat.x, 0, boat.z], shadowMapSize: [1024, 1024], shadowTarget: true },
        { type: 'DirectionalLight', castShadow: false, color: new Color('#b8cdee').toArray(), ground: null, intensity: base.moonIntensity,
          position: position(base.moonDirection), target: [boat.x, 0, boat.z], shadowMapSize: null, shadowTarget: false },
      ] };
  } finally { water.mesh.geometry.dispose(); water.mesh.material.dispose(); }
}

export async function verifyWorldLightCapture(implementation, entry, options) {
  await verifyAuroraCapture(implementation, entry, options);
  const m = entry.metrics, actual = m.worldLight;
  assert(actual, 'Sky-4R2: missing world light evidence');
  assert.equal(actual.clockSeconds, m.auroraDisplay.clockSeconds, 'Sky-4R2: optical clocks differ');
  const expected = await replayWorldLightCapture(implementation, m);
  assert.equal(actual.model, expected.state.model, 'Sky-4R2: missing/foreign lighting model');
  assert.equal(actual.lights.length, 3, 'Sky-4R2: extra/missing light');
  const ids = actual.lights.map(light => light.id);
  assert(ids.every(id => Number.isSafeInteger(id) && id >= 0) && new Set(ids).size === 3, 'Sky-4R2: invalid light identity');
  assert.equal(actual.ambient.id, ids[0], 'Sky-4R2: wrong HemisphereLight owner');
  actual.lights.forEach(({ id, ...light }, i) => assert.deepEqual(light, expected.lights[i], 'Sky-4R2: lighting differs from source'));
  assert.deepEqual(actual.ambient, { id: ids[0], color: expected.ambient.ambientSky, ground: expected.ambient.ambientGround,
    intensity: expected.ambient.ambientIntensity }, 'Sky-4R2: ambient differs');
  const hemi = actual.hemisphereGPU;
  assert(hemi?.programKey && actual.water.gpu.programKeys.length === 1, 'Sky-4R2: missing actual GPU program');
  assert.deepEqual(hemi.sky, expected.ambient.ambientSky.map(v => Math.fround(v * expected.ambient.ambientIntensity)), 'Sky-4R2: sky light not uploaded');
  assert.deepEqual(hemi.ground, expected.ambient.ambientGround.map(v => Math.fround(v * expected.ambient.ambientIntensity)), 'Sky-4R2: ground light not uploaded');
  const { geometryId, materialId, gpu, gpuLight, ...values } = actual.water;
  assert.deepEqual(values, expected.water, 'Sky-4R2: water source/uniform/geometry differs');
  for (const id of [geometryId, materialId]) assert(Number.isSafeInteger(id) && id >= 0, 'Sky-4R2: invalid water identity');
  assert.notEqual(geometryId, m.auroraDisplay.snapshot.geometryId, 'Sky-4R2: foreign water geometry');
  const light = expected.water.light;
  assert.deepEqual(gpuLight, light ? { color: light.color.map(Math.fround), strength: Math.fround(light.strength), direction: light.direction.map(Math.fround) }
    : { color: null, strength: null, direction: null }, 'Sky-4R2: water light not uploaded');
  assert.equal(gpu.objects, 1); assert.equal(gpu.layers.length, 1); assert.equal(gpu.programInstances, 1);
  assert.equal(gpu.layers[0].geometryId, geometryId); assert.equal(gpu.layers[0].materialId, materialId);
  assert.deepEqual(gpu.layers[0].programKeys, gpu.programKeys, 'Sky-4R2: extra water program');
  const buffers = Object.entries(expected.water.attributes).map(([key, value]) => [key, value.bytes]).concat([['index', expected.water.index.bytes]]);
  assert.deepEqual(Object.keys(gpu.buffers).sort(), buffers.map(([key]) => key).sort(), 'Sky-4R2: extra/missing buffer');
  const bufferIds = [];
  for (const [key, bytes] of buffers) {
    const b = gpu.buffers[key]; assert(b && Number.isSafeInteger(b.id) && b.id > 0, 'Sky-4R2: missing buffer identity');
    assert.equal(b.bytes, bytes); assert.equal(b.uploads, 1, 'Sky-4R2: buffer uploaded again'); bufferIds.push(b.id);
  }
  assert.equal(new Set(bufferIds).size, bufferIds.length, 'Sky-4R2: buffers alias');
  return expected;
}
