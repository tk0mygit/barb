import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createRodReelView, sampleRodPitch } from '../src/rendering/rod-reel-view.js';
import { createCatchCollection } from '../src/game/catch-collection.js';
import { createGameplay } from '../src/game/gameplay.js';
import { createSaveData, restoreSaveData } from '../src/game/save-data.js';
import { PHASE } from '../src/game/fishing.js';

const phaseState = (phase, time = 1, revision = 0) => ({ phase, time, revision });
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
      fixture.view.update(true, phaseState(PHASE.READY), 1);
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
    for (let frame = 0; frame < 100; frame++) fixture.view.update(true, phaseState(PHASE.FIGHT), 1);
    assert.deepEqual(versions(fixture), afterPurchase);
    for (let index = 0; index < bufferIdentities.length; index++) assert.equal(attributes(fixture)[index].array, bufferIdentities[index]);
    assert.equal(fixture.rod.children[0].material, material); assert.equal(fixture.reel.children[0].material, material);
  } finally { fixture.view.dispose(); }
});

test('neutral tip keeps the strict 58%/57% projection across profiles and translated or rotated camera parents', () => {
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
        for (const phase of [PHASE.READY, PHASE.LURE, PHASE.BITE, PHASE.FIGHT, PHASE.LANDING]) {
          view.update(true, phaseState(phase), 1); view.group.updateMatrixWorld(true);
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
        view.update(true, phaseState(PHASE.READY), 1); view.group.updateMatrixWorld(true);
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

test('sailing and result screens hide the assembly while non-cast phases preserve the strict neutral pose', () => {
  const fixture = setup(), { view } = fixture;
  try {
    for (const phase of Object.values(PHASE)) {
      view.update(false, phaseState(phase), 1); assert.equal(view.group.visible, false);
      view.update(true, phaseState(phase), 1);
      assert.equal(view.group.visible, ![PHASE.RESULT, PHASE.FAILED].includes(phase));
    }
    view.update(true, phaseState(PHASE.READY), 1); view.group.updateMatrixWorld(true);
    const pose = view.group.matrixWorld.clone(), before = versions(fixture);
    for (const phase of [PHASE.LURE, PHASE.BITE, PHASE.FIGHT, PHASE.LANDING]) {
      view.update(true, phaseState(phase), 1); view.group.updateMatrixWorld(true);
      assert.deepEqual(view.group.matrixWorld, pose, `${phase}: neutral pose is unchanged`);
    }
    assert.deepEqual(versions(fixture), before);
  } finally { view.dispose(); }
});

test('phase-time sampler has exact takeback, forward, recovery and cancellation endpoints', () => {
  const takeback = Math.PI * 14 / 180, forward = -Math.PI * 8 / 180;
  close(sampleRodPitch(PHASE.AIM, 0), 0, 'initial AIM');
  close(sampleRodPitch(PHASE.AIM, 0.09), takeback / 2, 'half takeback');
  for (const time of [0.18, 1, 600]) close(sampleRodPitch(PHASE.AIM, time), takeback, 'stable AIM hold');
  close(sampleRodPitch(PHASE.CAST, 0, takeback), takeback, 'release continuity');
  close(sampleRodPitch(PHASE.CAST, 0.06, takeback), (takeback + forward) / 2, 'half forward');
  close(sampleRodPitch(PHASE.CAST, 0.12, takeback), forward, 'forward endpoint');
  close(sampleRodPitch(PHASE.CAST, 0.31, takeback), forward / 2, 'half recovery');
  for (const time of [0.5, 0.8, 60]) close(sampleRodPitch(PHASE.CAST, time, takeback), 0, 'recovered CAST');
  close(sampleRodPitch(PHASE.READY, 0, takeback), takeback, 'cancel continuity');
  close(sampleRodPitch(PHASE.READY, 0.11, takeback), takeback / 2, 'half cancellation');
  close(sampleRodPitch(PHASE.READY, 0.22, takeback), 0, 'cancel endpoint');
  for (const phase of [PHASE.LURE, PHASE.BITE, PHASE.FIGHT, PHASE.LANDING, PHASE.RESULT, PHASE.FAILED]) {
    close(sampleRodPitch(phase, 0, takeback), 0, `${phase}: no residual motion`);
  }
});

const matrixClose = (actual, expected, label) => actual.elements.forEach((value, index) => close(value, expected.elements[index], `${label}[${index}]`));
const worldMatrix = view => { view.group.updateWorldMatrix(true, true); return view.group.matrixWorld.clone(); };

test('30/60/144 fps and missed renders seek the same short-AIM cast pose without a last-frame dependency', () => {
  const release = 0.047, start = 10;
  const at = elapsed => elapsed < release
    ? phaseState(PHASE.AIM, elapsed, 1)
    : phaseState(PHASE.CAST, elapsed - release, 2);
  for (const sample of [release, release + 0.02, release + 0.12, release + 0.31, release + 0.5, release + 0.799]) {
    let reference;
    for (const fps of [30, 60, 144, 0]) {
      const { view } = setup();
      try {
        view.update(true, at(0), start);
        if (fps) for (let index = 1; index / fps < sample; index++) view.update(true, at(index / fps), start + index / fps);
        view.update(true, at(sample), start + sample);
        const pose = worldMatrix(view);
        if (reference) matrixClose(pose, reference, `${fps || 'single missed-frame seek'} fps at ${sample}`);
        else reference = pose;
        view.update(true, at(sample), start + sample);
        matrixClose(worldMatrix(view), pose, 'duplicate resize/menu render does not advance motion');
      } finally { view.dispose(); }
    }
  }
});

test('cancel and immediate recast preserve the exact boundary angle, then clear on discontinuity or hidden lifecycle', () => {
  const start = 20, cancel = 0.07;
  for (const cancelledTime of [0, 0.08, 0.22, 2]) {
    const dense = setup(), sparse = setup();
    try {
      for (const { view } of [dense, sparse]) view.update(true, phaseState(PHASE.AIM, 0, 1), start);
      dense.view.update(true, phaseState(PHASE.AIM, cancel, 1), start + cancel);
      for (const { view } of [dense, sparse]) view.update(true, phaseState(PHASE.READY, cancelledTime, 2), start + cancel + cancelledTime);
      matrixClose(worldMatrix(sparse.view), worldMatrix(dense.view), `late cancellation at ${cancelledTime}`);
      if (cancelledTime === 0) {
        dense.view.update(true, phaseState(PHASE.AIM, cancel, 1), start + cancel);
        matrixClose(worldMatrix(sparse.view), worldMatrix(dense.view), 'cancellation starts at actual AIM angle');
      }
    } finally { dense.view.dispose(); sparse.view.dispose(); }
  }
  const { view } = setup(), neutral = setup();
  try {
    view.update(true, phaseState(PHASE.AIM, 0.06, 1), start + 0.06);
    view.update(true, phaseState(PHASE.READY, 0.04, 2), start + 0.10);
    const beforeRecast = worldMatrix(view);
    view.update(true, phaseState(PHASE.AIM, 0, 3), start + 0.10);
    matrixClose(worldMatrix(view), beforeRecast, 'immediate recast starts from the recovering grip');
    view.update(true, phaseState(PHASE.READY, 0, 9), start + 1);
    neutral.view.update(true, phaseState(PHASE.READY, 0, 9), start + 1);
    matrixClose(worldMatrix(view), worldMatrix(neutral.view), 'unobserved revisions clear old history');
    for (const phase of [PHASE.RESULT, PHASE.FAILED]) {
      view.update(true, phaseState(PHASE.AIM, 1, 10), start + 2);
      view.update(true, phaseState(phase, 0, 11), start + 2);
      const out = new THREE.Vector3(99, 98, 97);
      assert.equal(view.copyTipWorld(out), null); assert.deepEqual(out.toArray(), [99, 98, 97]);
      view.update(true, phaseState(PHASE.READY, 0, 12), start + 2);
      matrixClose(worldMatrix(view), worldMatrix(neutral.view), `${phase} clears old history`);
    }
    view.update(true, phaseState(PHASE.AIM, 1, 13), start + 3);
    view.update(false, phaseState(PHASE.AIM, 1, 13), start + 3);
    assert.equal(view.copyTipWorld(new THREE.Vector3()), null);
    view.update(true, phaseState(PHASE.READY, 0, 14), start + 3);
    matrixClose(worldMatrix(view), worldMatrix(neutral.view), 'return to sailing clears old history');
    view.update(true, phaseState(PHASE.AIM, 1, 15), start + 4);
    view.update(true, phaseState(PHASE.READY, 0, 16), 0);
    matrixClose(worldMatrix(view), worldMatrix(neutral.view), 'clock-origin rollback clears old history');
  } finally { view.dispose(); neutral.view.dispose(); }
});

test('lifecycle reset clears canceled READY recovery without moving resources, while an ordinary cancel stays gentle', () => {
  const interrupted = setup(), ordinary = setup(), neutral = setup();
  const start = 10;
  try {
    neutral.view.update(true, phaseState(PHASE.READY, 0, 2), start + 1);
    const neutralPose = worldMatrix(neutral.view);
    for (const { view } of [interrupted, ordinary]) {
      view.update(true, phaseState(PHASE.AIM, 0, 1), start);
      view.update(true, phaseState(PHASE.AIM, 1, 1), start + 1);
      view.update(true, phaseState(PHASE.READY, 0, 2), start + 1);
      assert.notDeepEqual(worldMatrix(view), neutralPose, 'ordinary cancellation begins at the held takeback');
    }
    const beforeReset = worldMatrix(interrupted.view), beforeVersions = versions(interrupted);
    interrupted.view.resetMotion();
    matrixClose(worldMatrix(interrupted.view), beforeReset, 'reset changes no transform before the next display update');
    assert.deepEqual(versions(interrupted), beforeVersions, 'reset changes no geometry attributes');
    interrupted.view.update(true, phaseState(PHASE.READY, 0, 2), start + 1);
    matrixClose(worldMatrix(interrupted.view), neutralPose, 'same frozen READY resumes neutral after lifecycle reset');
    ordinary.view.update(true, phaseState(PHASE.READY, 0.11, 2), start + 1.11);
    assert.notDeepEqual(worldMatrix(ordinary.view), neutralPose, 'ordinary cancellation still eases toward neutral');
    ordinary.view.update(true, phaseState(PHASE.READY, 0.22, 2), start + 1.22);
    matrixClose(worldMatrix(ordinary.view), neutralPose, 'ordinary cancellation reaches neutral');
    interrupted.view.update(true, phaseState(PHASE.AIM, 1, 3), start + 3);
    interrupted.view.update(true, phaseState(PHASE.CAST, 0.07, 4), start + 3.07);
    const pausedCast = worldMatrix(interrupted.view);
    interrupted.view.update(true, phaseState(PHASE.CAST, 0.07, 4), start + 3.07);
    matrixClose(worldMatrix(interrupted.view), pausedCast, 'active CAST pause without reset retains the same accepted-time pose');
  } finally { interrupted.view.dispose(); ordinary.view.dispose(); neutral.view.dispose(); }
});

test('animated tip uses the actual model world transform at Lv1/5/10 with camera parents and grip-fixed rigid motion', () => {
  const funded = createCatchCollection(); fund(funded);
  for (const level of [1, 5, 10]) {
    const collection = createCatchCollection({ initialData: { catches: funded.catches, wallet: funded.wallet,
      equipment: { rodLevel: level, reelLevel: level } } });
    const fixture = setup(collection), { scene, camera, view, rod, reel } = fixture;
    const parent = new THREE.Group(); parent.position.set(11, 4, -19); parent.rotation.set(0.1, -1.3, 0.04);
    scene.add(parent); parent.add(camera); camera.position.set(-3, 2.15, 8); camera.rotation.set(-0.15, 0.6, 0, 'YXZ');
    const before = versions(fixture), identities = [rod.children[0].geometry.id, reel.children[0].geometry.id, rod.children[0].material.id];
    const buffers = attributes(fixture).map(attribute => attribute.array), out = new THREE.Vector3(), expected = new THREE.Vector3();
    try {
      for (const [width, height] of [[1280, 800], [390, 844], [844, 390], [360, 740]]) {
        camera.aspect = width / height; camera.updateProjectionMatrix(); scene.updateMatrixWorld(true);
        const cameraPose = camera.matrixWorld.clone(), projection = camera.projectionMatrix.clone();
        view.update(true, phaseState(PHASE.READY, 1, 0), 1);
        const neutralScale = view.group.scale.clone();
        const fixedGrip = view.group.localToWorld(new THREE.Vector3(0, 0.12, 0));
        for (const [phase, time, revision, elapsed] of [
          [PHASE.AIM, 0, 1, 2], [PHASE.AIM, 0.09, 1, 2.09], [PHASE.AIM, 1, 1, 3],
          [PHASE.CAST, 0, 2, 3], [PHASE.CAST, 0.06, 2, 3.06], [PHASE.CAST, 0.12, 2, 3.12],
          [PHASE.CAST, 0.31, 2, 3.31], [PHASE.CAST, 0.5, 2, 3.5], [PHASE.LURE, 0, 3, 3.8],
          [PHASE.FIGHT, 0, 4, 4],
        ]) {
          view.update(true, phaseState(phase, time, revision), elapsed);
          assert.equal(view.copyTipWorld(out), out);
          expected.fromArray(view.group.userData.tip).applyMatrix4(view.group.matrixWorld);
          assert.ok(out.distanceTo(expected) < 1e-12, `${phase}/${time}: actual local tip matches public world API`);
          assert.ok(view.group.localToWorld(expected.set(0, 0.12, 0)).distanceTo(fixedGrip) < 1e-12, 'grip pivot does not jump');
          assert.deepEqual(view.group.scale, neutralScale, 'motion does not stretch the assembly');
          matrixClose(camera.matrixWorld, cameraPose, 'view does not move camera');
          assert.deepEqual(camera.projectionMatrix, projection, 'view does not alter camera projection');
          out.set(999, 999, 999);
          view.copyTipWorld(out);
          assert.ok(out.distanceTo(expected.fromArray(view.group.userData.tip).applyMatrix4(view.group.matrixWorld)) < 1e-12, 'caller cannot mutate internal tip');
        }
      }
      assert.deepEqual(versions(fixture), before, 'transform-only animation leaves every attribute version intact');
      assert.deepEqual([rod.children[0].geometry.id, reel.children[0].geometry.id, rod.children[0].material.id], identities);
      assert.equal(reel.children[0].material, rod.children[0].material);
      attributes(fixture).forEach((attribute, index) => assert.equal(attribute.array, buffers[index]));
    } finally { view.dispose(); }
    const unchanged = new THREE.Vector3(8, 9, 10);
    assert.equal(view.copyTipWorld(unchanged), null); assert.deepEqual(unchanged.toArray(), [8, 9, 10]);
  }
});

test('all active animated vertices stay within every viewport throughout takeback and forward motion', () => {
  const collection = createCatchCollection(); fund(collection);
  const { camera, view, rod, reel } = setup(collection), point = new THREE.Vector3();
  try {
    for (let level = 1; level <= 10; level++) {
      if (level > 1) { assert.ok(collection.purchaseUpgrade('rod', level - 1)); assert.ok(collection.purchaseUpgrade('reel', level - 1)); }
      for (const [width, height] of [[1280, 800], [390, 844], [844, 390], [360, 740]]) {
        camera.aspect = width / height; camera.updateProjectionMatrix();
        for (const [phase, times, revision, started] of [[PHASE.AIM, [0, 0.045, 0.09, 0.135, 0.18, 20], 1, 1], [PHASE.CAST, [0, 0.03, 0.06, 0.09, 0.12, 0.215, 0.31, 0.405, 0.5, 0.799], 2, 21]]) {
          for (const time of times) {
            view.update(true, phaseState(phase, time, revision), started + time); view.group.updateWorldMatrix(true, true);
            for (const part of [rod, reel]) {
              const mesh = part.children[0], { geometry } = mesh;
              for (let index = geometry.drawRange.start; index < geometry.drawRange.start + geometry.drawRange.count; index++) {
                point.fromBufferAttribute(geometry.attributes.position, index).applyMatrix4(mesh.matrixWorld).project(camera);
                assert.ok(point.toArray().every(value => Number.isFinite(value) && value >= -1 && value <= 1),
                  `${width}×${height} ${part.name} Lv.${level} ${phase}/${time}: animated vertex leaves view volume ${point.toArray()}`);
                if (width === 844 && height === 390) {
                  // The native landscape controls measured in visual review
                  // end at CSS y=172. Check every submitted vertex against that
                  // envelope; browser coverage also reads the actual HUD DOM.
                  assert.ok((1 - point.y) * height / 2 >= 172,
                    `${part.name} Lv.${level} ${phase}/${time}: animated vertex enters the landscape control envelope`);
                }
              }
            }
          }
        }
      }
    }
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
  view.update(true, phaseState(PHASE.FIGHT), 1);
  assert.equal(rod.userData.level, 1); assert.equal(reel.userData.level, 1);
  assert.deepEqual(versions(fixture), before); assert.equal(view.group.parent, null);
});
