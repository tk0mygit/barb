import test from 'node:test';
import assert from 'node:assert/strict';
import { BoxGeometry, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene, Vector3 } from 'three';
import { readFileSync } from 'node:fs';
import { createObservationTracker, createCelestialObservation, OBSERVATION_SECONDS } from '../src/rendering/celestial-observation.js';
import { createCelestialVisibility, auroraAlpha, meteorAlpha } from '../src/rendering/celestial-visibility.js';
import { createObservationOcclusion } from '../src/rendering/observation-occlusion.js';
import { createGameClock } from '../src/game/game-clock.js';
import { createAurora } from '../src/world/aurora.js';
import { createMeteor } from '../src/world/meteor.js';
import { findAuroraNight } from './helpers/aurora-event.js';
import { findMeteorEvent } from './helpers/meteor-event.js';

const at = seconds => createGameClock(undefined, { elapsedSeconds: seconds }).state;
const viewport = { width: 1000, height: 700 };
const clear = { update() {}, isClear: () => true };
const nativeCamera = (width = 1000, height = 700) => {
  const camera = new PerspectiveCamera(55, width / height, .1, 2400);
  camera.position.set(10, 8.5, 38); camera.lookAt(10, 2.5, 2); camera.updateMatrixWorld(); return camera;
};
const auroraSeconds = findAuroraNight({ forward: true }) * 360 + 270, event = findMeteorEvent();

for (const kind of ['aurora', 'meteor']) for (const fps of [30, 60, 120, 144]) {
  test(`${kind}: real-time threshold at ${fps}fps, first frame zero and one notice only`, () => {
    const awards = [], tracker = createObservationTracker({ onObservation: value => awards.push(value) });
    const target = OBSERVATION_SECONDS[kind] * 1000, origin = 123456;
    tracker.frame(kind, 'same', origin, true); assert.deepEqual(awards, []);
    for (let frame = 1; frame / fps * 1000 < target - 1e-6; frame++) tracker.frame(kind, 'same', origin + frame / fps * 1000, true);
    assert.deepEqual(awards, []);
    tracker.frame(kind, 'same', origin + target, true); assert.deepEqual(awards, [kind]);
    for (let frame = 1; frame < 50; frame++) tracker.frame(kind, 'same', origin + target + frame * 1000 / fps, true);
    tracker.reset(); tracker.frame(kind, 'another', origin + 3000, true); assert.deepEqual(awards, [kind]);
    assert.equal(tracker.needs(kind), false);
  });
}

for (const kind of ['aurora', 'meteor']) test(`${kind}: invalid/missing frames, identity, duplicate time and long gaps break continuity`, () => {
  for (const interruption of ['invisible', 'other-event', 'long-gap', 'duplicate', 'backwards', 'reset', 'nan']) {
    const awards = [], tracker = createObservationTracker({ onObservation: value => awards.push(value) });
    const target = OBSERVATION_SECONDS[kind] * 1000;
    tracker.frame(kind, 'night', 0, true);
    for (let t = 50; t < target; t += 50) tracker.frame(kind, 'night', t, true);
    let resumed = target;
    if (interruption === 'invisible') tracker.frame(kind, 'night', target - 1, false);
    if (interruption === 'other-event') tracker.frame(kind, 'slot', target - 1, true);
    if (interruption === 'long-gap') resumed += 10000;
    if (interruption === 'duplicate') tracker.frame(kind, 'night', target - 50, true);
    if (interruption === 'backwards') tracker.frame(kind, 'night', -100, true);
    if (interruption === 'nan') tracker.frame(kind, 'night', NaN, true);
    if (interruption === 'reset') tracker.reset();
    tracker.frame(kind, 'night', resumed, true); assert.deepEqual(awards, [], interruption);
  }
});

test('sub-threshold, exact and above-threshold intervals work without a fixed frame count, including huge event IDs', () => {
  for (const kind of ['aurora', 'meteor']) for (const offset of [-.01, 0, .01]) {
    const awards = [], tracker = createObservationTracker({ onObservation: value => awards.push(value) });
    const duration = OBSERVATION_SECONDS[kind] * 1000 + offset;
    tracker.frame(kind, `${Number.MAX_SAFE_INTEGER}:17`, 1000, true);
    for (let t = 100; t < duration; t += 100) tracker.frame(kind, `${Number.MAX_SAFE_INTEGER}:17`, 1000 + t, true);
    tracker.frame(kind, `${Number.MAX_SAFE_INTEGER}:17`, 1000 + duration, true);
    assert.equal(awards.length, offset < 0 ? 0 : 1);
  }
  const awards = [], tracker = createObservationTracker({ recorded: ['aurora'], onObservation: x => awards.push(x) });
  for (const t of [0, 200, 400, 600]) for (const kind of ['aurora', 'toString', 'invalid']) tracker.frame(kind, 1, t, true);
  assert.deepEqual(awards, []);
});

test('actual aurora triangles and moving meteor light are visible in native viewports; far/behind/offscreen/transparent patches fail', () => {
  const aurora = createAurora(), meteor = createMeteor();
  try {
    aurora.update(at(auroraSeconds), { x: 10, z: 20 }, 'CLEAR');
    meteor.update(at(event.start + .55), { x: 10, z: 20 }, 'CLEAR');
    [...aurora.meshes, meteor.mesh].forEach(mesh => mesh.updateMatrixWorld());
    for (const [width, height] of [[1000, 700], [390, 844], [844, 390], [568, 320]]) {
      const camera = nativeCamera(width, height), visibility = createCelestialVisibility(camera, clear);
      visibility.begin({ width, height });
      assert(aurora.meshes.some(visibility.aurora), `aurora ${width}x${height}`);
      assert(visibility.meteor(meteor.mesh), `meteor ${width}x${height}`);
      camera.lookAt(10, 2.5, 1000); camera.updateMatrixWorld(); visibility.begin({ width, height });
      assert.equal(aurora.meshes.some(visibility.aurora), false); assert.equal(visibility.meteor(meteor.mesh), false);
      camera.lookAt(1000, 2.5, 38); camera.updateMatrixWorld(); visibility.begin({ width, height });
      assert.equal(visibility.meteor(meteor.mesh), false);
      camera.lookAt(10, 2.5, 2); camera.far = 100; camera.updateProjectionMatrix(); camera.updateMatrixWorld();
      visibility.begin({ width, height }); assert.equal(aurora.meshes.some(visibility.aurora), false); assert.equal(visibility.meteor(meteor.mesh), false);
    }
    const visibility = createCelestialVisibility(nativeCamera(), clear);
    visibility.begin({ ...viewport, occlusions: [{ left: 0, top: 0, right: 1000, bottom: 700 }] });
    assert.equal(aurora.meshes.some(visibility.aurora), false); assert.equal(visibility.meteor(meteor.mesh), false);
    for (const mesh of aurora.meshes) mesh.material.uniforms.auroraOpacity.value = 1e-9;
    meteor.mesh.material.uniforms.meteorOpacity.value = 1e-9;
    visibility.begin(viewport); assert.equal(aurora.meshes.some(visibility.aurora), false); assert.equal(visibility.meteor(meteor.mesh), false);
    const au = aurora.meshes[0].material.uniforms, mu = meteor.mesh.material.uniforms;
    au.auroraOpacity.value = 1; mu.meteorOpacity.value = 1;
    assert.equal(auroraAlpha(0, .4, au), 0); assert.equal(auroraAlpha(.5, 1, au), 0);
    assert.equal(meteorAlpha(1, .5, mu), 0); assert.equal(meteorAlpha(.1, 0, mu), 0);
  } finally { aurora.dispose(); meteor.dispose(); }
});

test('foreground index blocks actual mountain triangles, tree instances, dynamic moon and camera-contained objects', () => {
  const eye = new Vector3(), direction = new Vector3(0, 0, -1);
  for (const kind of ['mountain', 'tree', 'moon', 'inside']) {
    const scene = new Scene(), group = new Group(); group.name = 'lake-scenery'; scene.add(group);
    const geometry = new BoxGeometry(4, 4, 2), material = new MeshBasicMaterial();
    const object = kind === 'tree' ? new InstancedMesh(geometry, material, 1) : new Mesh(geometry, material);
    if (kind === 'tree') object.setMatrixAt(0, new Matrix4().makeTranslation(0, 0, -5));
    else object.position.z = kind === 'inside' ? 0 : -5;
    (kind === 'mountain' || kind === 'tree' ? group : scene).add(object);
    const index = createObservationOcclusion(scene); index.update();
    assert.equal(index.isClear(eye, direction, 100, .001), false, kind);
    if (kind !== 'inside') assert.equal(index.isClear(eye, new Vector3(1, 0, 0), 100, .001), true, kind);
    if (kind === 'moon') {
      object.visible = false; index.update(); assert.equal(index.isClear(eye, direction, 100, .001), true);
      object.visible = true; object.position.x = 20; scene.updateMatrixWorld(); index.update();
      assert.equal(index.isClear(eye, direction, 100, .001), true);
    }
    geometry.dispose(); material.dispose();
  }
});

function rendered() {
  const scene = new Scene(), camera = nativeCamera(), aurora = createAurora(), meteor = createMeteor(), awards = [];
  scene.add(...aurora.meshes, meteor.mesh);
  meteor.update(at(event.start + .4), { x: 10, z: 20 }, 'CLEAR');
  let mode = 'normal', lost = false;
  const renderer = {
    info: { render: { calls: 0 } }, getContext: () => ({ isContextLost: () => lost }), getRenderTarget: () => null,
    render() {
      scene.updateMatrixWorld();
      if (mode === 'no-submit') return;
      const args = [renderer, scene, camera, meteor.mesh.geometry, meteor.mesh.material, null];
      meteor.mesh.onBeforeRender(...args);
      if (mode !== 'zero-draw') renderer.info.render.calls++;
      meteor.mesh.onAfterRender(...args);
      if (mode === 'exception') throw Error('render failed after submit');
    },
  };
  const observer = createCelestialObservation({ renderer, scene, camera, targets: { aurora: aurora.meshes, meteor: meteor.mesh },
    onObservation: kind => awards.push(kind), getViewport: () => viewport });
  return { renderer, observer, awards, set mode(value) { mode = value; }, set lost(value) { lost = value; },
    dispose() { observer.dispose(); aurora.dispose(); meteor.dispose(); } };
}

test('normal completed render plus actual submit is required; blocked/zero/failed/context-lost frames cannot bank time', () => {
  for (const reason of ['disabled', 'no-submit', 'zero-draw', 'exception', 'context-lost', 'reset']) {
    const fixture = rendered();
    try {
      const frame = (now, enabled = true) => fixture.observer.renderFrame(now, at(event.start + .4), () => enabled);
      frame(0); frame(50);
      if (reason === 'disabled') frame(60, false);
      if (reason === 'reset') fixture.observer.reset();
      if (['no-submit', 'zero-draw', 'exception'].includes(reason)) {
        fixture.mode = reason;
        if (reason === 'exception') assert.throws(() => frame(60), /render failed/); else frame(60);
        fixture.mode = 'normal';
      }
      if (reason === 'context-lost') { fixture.lost = true; frame(60); fixture.lost = false; }
      frame(100); assert.deepEqual(fixture.awards, [], reason);
      frame(150); assert.deepEqual(fixture.awards, [], reason);
      frame(200); assert.deepEqual(fixture.awards, ['meteor'], reason);
      frame(220); assert.deepEqual(fixture.awards, ['meteor']);
    } finally { fixture.dispose(); }
  }
});

test('observation preserves RNG, resources, transforms, shader uniforms and live optical samples', () => {
  const fixture = rendered(), random = Math.random;
  try {
    Math.random = () => { throw Error('Observation consumed shared RNG'); };
    fixture.observer.renderFrame(0, at(event.start + .4), () => true);
    fixture.observer.renderFrame(100, at(event.start + .4), () => true);
    assert.deepEqual(fixture.awards, ['meteor']);
  } finally { Math.random = random; fixture.dispose(); }
  const source = readFileSync(new URL('../src/world/aurora.js', import.meta.url), 'utf8');
  for (const fragment of ['point.x += 45.0', 'point.y += 29.0', '0.03490658503988', 'u + 0.031', '+ 0.013', '0.15 + 0.077', '+ 0.049', '(0.44 - auroraLayer * 0.08)']) assert(source.includes(fragment));
});
