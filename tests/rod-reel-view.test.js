import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createRodReelView } from '../src/rendering/rod-reel-view.js';
import { createCatchCollection } from '../src/game/catch-collection.js';
import { createGameplay } from '../src/game/gameplay.js';
import { createSaveData, restoreSaveData } from '../src/game/save-data.js';
import { PHASE } from '../src/game/fishing.js';

const savedAt = '2026-11-02T00:00:00.000Z';
function fund(collection, id = 'income') {
  collection.register({ schemaVersion: 1, id, speciesId: 'black-bass', lengthCm: 50,
    weightKg: 2000, qteSuccessCount: 0, caughtAt: savedAt });
  assert.equal(collection.sellUnassigned(id).total, 200000);
}
function setup(collection = createCatchCollection()) {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(55, 1, 0.1, 2400);
  const view = createRodReelView(scene, camera, collection);
  const rod = view.group.getObjectByName('fishing-rod'), reel = view.group.getObjectByName('fishing-reel');
  return { scene, camera, collection, view, rod, reel };
}
const attributes = ({ rod, reel }) => [rod, reel].flatMap(part => {
  const geometry = part.children[0].geometry;
  return [geometry.attributes.position, geometry.attributes.color];
});
const versions = fixture => attributes(fixture).map(attribute => attribute.version);
const close = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-12, `${label}: ${actual} != ${expected}`);

test('initial canonical equipment restores every level independently without writing gameplay state', () => {
  const funded = createCatchCollection(); fund(funded);
  for (let rodLevel = 1; rodLevel <= 10; rodLevel++) {
    const reelLevel = 11 - rodLevel;
    const collection = createCatchCollection({ initialData: {
      catches: funded.catches, wallet: funded.wallet, equipment: { rodLevel, reelLevel },
    } });
    const before = collection.snapshot, fixture = setup(collection);
    try {
      assert.equal(fixture.rod.userData.level, rodLevel);
      assert.equal(fixture.reel.userData.level, reelLevel);
      assert.deepEqual(collection.snapshot, before);
      assert.equal(collection.equipment, before.equipment);
      assert.equal(collection.wallet, before.wallet);
      assert.equal(fixture.view.group.visible, false);
      assert.equal(fixture.view.group.parent, fixture.scene);
    } finally { fixture.view.dispose(); }
  }
});

test('V1 and V2 restoration displays the canonical restored equipment before the first visible frame', () => {
  const original = createGameplay(); fund(original.collection);
  for (let level = 1; level < 5; level++) assert.ok(original.collection.purchaseUpgrade('rod', level));
  for (let level = 1; level < 10; level++) assert.ok(original.collection.purchaseUpgrade('reel', level));
  const current = createSaveData(original, { savedAt });
  for (const saveVersion of [1, 2]) {
    const data = JSON.parse(JSON.stringify(current)); data.saveVersion = saveVersion;
    if (saveVersion === 1) for (const record of data.collection.catches) delete record.qteSuccessCount;
    const restored = restoreSaveData(data), before = createSaveData(restored, { savedAt });
    const fixture = setup(restored.collection);
    try {
      assert.equal(fixture.rod.userData.level, 5); assert.equal(fixture.reel.userData.level, 10);
      fixture.view.update(true, PHASE.READY);
      assert.deepEqual(createSaveData(restored, { savedAt }), before);
      assert.equal(restored.fishing.state.phase, PHASE.READY);
      assert.equal(restored.boat.mode, 'sailing');
    } finally { fixture.view.dispose(); }
  }
});

test('purchases synchronize immediately while rendering is paused and unrelated collection events do not rewrite buffers', () => {
  const collection = createCatchCollection(); fund(collection);
  const fixture = setup(collection);
  try {
    const bufferIdentities = attributes(fixture).map(attribute => attribute.array);
    const material = fixture.rod.children[0].material;
    const before = versions(fixture), snapshot = collection.snapshot;
    assert.ok(collection.purchaseUpgrade('rod', 1));
    assert.equal(fixture.rod.userData.level, 2); assert.equal(fixture.reel.userData.level, 1);
    const purchased = versions(fixture);
    assert.ok(purchased[0] > before[0] && purchased[1] > before[1]);
    assert.deepEqual(purchased.slice(2), before.slice(2));
    assert.equal(fixture.view.group.visible, false, 'no view update ran during the purchase');
    assert.deepEqual(snapshot.equipment, { rodLevel: 1, reelLevel: 1 });
    assert.ok(collection.purchaseUpgrade('reel', 1));
    assert.equal(fixture.reel.userData.level, 2);
    const afterPurchase = versions(fixture);
    fund(collection, 'unrelated-sale');
    assert.deepEqual(versions(fixture), afterPurchase, 'sale notifications retain the same levels');
    for (let frame = 0; frame < 100; frame++) fixture.view.update(true, PHASE.FIGHT);
    assert.deepEqual(versions(fixture), afterPurchase);
    for (let index = 0; index < bufferIdentities.length; index++) assert.equal(attributes(fixture)[index].array, bufferIdentities[index]);
    assert.equal(fixture.rod.children[0].material, material); assert.equal(fixture.reel.children[0].material, material);
  } finally { fixture.view.dispose(); }
});

test('tip remains at the existing virtual-line projection across profiles and translated or rotated camera parents', () => {
  const fixture = setup(), { scene, camera, view, collection } = fixture;
  const parent = new THREE.Group(); parent.position.set(3, 5, -8); parent.rotation.set(0.1, 1.2, -0.05);
  scene.add(parent); parent.add(camera);
  const state = collection.snapshot, children = [...parent.children];
  try {
    for (const [width, height] of [[1280, 800], [390, 844], [844, 390], [360, 740]]) {
      for (const [x, y, z, pitch, yaw] of [[0, 2.15, 30, 0, 0], [22, 1.7, -54, -0.17, 2.1], [-14, 8, 2, 0.2, -1.9]]) {
        camera.position.set(x, y, z); camera.rotation.set(pitch, yaw, 0, 'YXZ');
        camera.aspect = width / height; camera.updateProjectionMatrix(); scene.updateMatrixWorld(true);
        const position = camera.position.clone(), quaternion = camera.quaternion.toArray();
        const projection = camera.projectionMatrix.clone();
        for (const phase of [PHASE.READY, PHASE.AIM, PHASE.CAST, PHASE.FIGHT]) {
          view.update(true, phase); view.group.updateMatrixWorld(true);
          const tip = new THREE.Vector3(...view.group.userData.tip).applyMatrix4(view.group.matrixWorld).project(camera);
          close((tip.x + 1) / 2, 0.58, `${width}x${height} ${phase} horizontal tip`);
          close((1 - tip.y) / 2, 0.57, `${width}x${height} ${phase} vertical tip`);
          assert.ok(tip.z > -1 && tip.z < 1, 'tip remains inside the camera view volume');
        }
        assert.deepEqual(camera.position, position); assert.deepEqual(camera.quaternion.toArray(), quaternion);
        assert.deepEqual(camera.projectionMatrix, projection);
        assert.equal(camera.fov, 55); assert.equal(camera.near, 0.1); assert.equal(camera.far, 2400);
        assert.equal(camera.parent, parent); assert.deepEqual(parent.children, children);
      }
    }
    assert.deepEqual(collection.snapshot, state);
  } finally { view.dispose(); }
});

test('all active rod and reel vertices remain inside each supported viewport at every level', () => {
  const collection = createCatchCollection(); fund(collection);
  const fixture = setup(collection), { camera, view, rod, reel } = fixture;
  const point = new THREE.Vector3();
  try {
    for (let level = 1; level <= 10; level++) {
      if (level > 1) {
        assert.ok(collection.purchaseUpgrade('rod', level - 1));
        assert.ok(collection.purchaseUpgrade('reel', level - 1));
      }
      for (const [width, height] of [[1280, 800], [390, 844], [844, 390], [360, 740]]) {
        camera.aspect = width / height; camera.updateProjectionMatrix();
        view.update(true, PHASE.READY); view.group.updateMatrixWorld(true);
        for (const part of [rod, reel]) {
          const mesh = part.children[0], { geometry } = mesh;
          const min = new THREE.Vector3(Infinity, Infinity, Infinity), max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
          // The butt is nearer than the tip. Project the active submitted
          // vertices so perspective magnification cannot hide an edge overflow.
          for (let index = geometry.drawRange.start; index < geometry.drawRange.start + geometry.drawRange.count; index++) {
            point.fromBufferAttribute(geometry.attributes.position, index).applyMatrix4(mesh.matrixWorld).project(camera);
            assert.ok(point.toArray().every(Number.isFinite), `${part.name} Lv.${level}: invalid projected vertex`);
            min.min(point); max.max(point);
          }
          for (const axis of ['x', 'y', 'z']) {
            assert.ok(min[axis] >= -1 && max[axis] <= 1,
              `${width}x${height} ${part.name} Lv.${level}: ${axis} bounds ${min[axis]}..${max[axis]} leave the view volume`);
          }
        }
      }
    }
  } finally { view.dispose(); }
});

test('sailing and result screens hide the assembly while every active fishing phase keeps a static pose', () => {
  const fixture = setup(), { view } = fixture;
  try {
    for (const phase of Object.values(PHASE)) {
      view.update(false, phase); assert.equal(view.group.visible, false);
      view.update(true, phase);
      assert.equal(view.group.visible, ![PHASE.RESULT, PHASE.FAILED].includes(phase));
    }
    view.update(true, PHASE.READY); view.group.updateMatrixWorld(true);
    const pose = view.group.matrixWorld.clone(), before = versions(fixture);
    for (const phase of [PHASE.AIM, PHASE.CAST, PHASE.LURE, PHASE.BITE, PHASE.FIGHT, PHASE.LANDING]) {
      view.update(true, phase); view.group.updateMatrixWorld(true);
      assert.deepEqual(view.group.matrixWorld, pose, `${phase}: no cast or reel animation`);
    }
    assert.deepEqual(versions(fixture), before);
  } finally { view.dispose(); }
});

test('dispose unsubscribes once, releases each owned resource once and cannot revive after later purchases', () => {
  const collection = createCatchCollection(); fund(collection);
  const subscribe = collection.subscribe;
  let subscriptions = 0, unsubscribes = 0;
  collection.subscribe = listener => {
    subscriptions++;
    const unsubscribe = subscribe(listener);
    return () => { unsubscribes++; unsubscribe(); };
  };
  const fixture = setup(collection), { view, scene, rod, reel } = fixture;
  const resources = [rod.children[0].geometry, reel.children[0].geometry, rod.children[0].material];
  const disposals = resources.map(() => 0);
  resources.forEach((resource, index) => resource.addEventListener('dispose', () => { disposals[index]++; }));
  const before = versions(fixture);
  assert.equal(subscriptions, 1);
  view.dispose(); view.dispose();
  assert.equal(unsubscribes, 1); assert.deepEqual(disposals, [1, 1, 1]);
  assert.equal(view.group.parent, null); assert.deepEqual(scene.children, []);
  assert.ok(collection.purchaseUpgrade('rod', 1)); assert.ok(collection.purchaseUpgrade('reel', 1));
  view.update(true, PHASE.FIGHT);
  assert.equal(rod.userData.level, 1); assert.equal(reel.userData.level, 1);
  assert.deepEqual(versions(fixture), before); assert.equal(view.group.parent, null);
});
