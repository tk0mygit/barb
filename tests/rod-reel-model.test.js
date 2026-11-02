import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { createRodReelModel, ROD_REEL_APPEARANCES } from '../src/rendering/rod-reel-model.js';
import { createLureModel } from '../src/rendering/lure-models.js';
import { LURES } from '../src/game/lures.js';

const mesh = group => group.children[0];
const geometry = group => mesh(group).geometry;
function signature(group) {
  const value = geometry(group), active = value.drawRange.count * 3;
  return createHash('sha256').update(Buffer.from(value.attributes.position.array.buffer, 0, active * 4)).digest('hex');
}

test('rod and reel have separate responsibilities, fixed buffers and a shared lure-compatible material', () => {
  const model = createRodReelModel();
  try {
    assert.ok(model.rod instanceof THREE.Group); assert.ok(model.reel instanceof THREE.Group);
    assert.notEqual(model.rod, model.reel);
    assert.deepEqual(model.group.children, [model.rod, model.reel]);
    assert.notEqual(geometry(model.rod), geometry(model.reel));
    assert.equal(mesh(model.rod).material, mesh(model.reel).material);
    const material = mesh(model.rod).material;
    assert.equal(material.type, 'MeshBasicMaterial'); assert.equal(material.vertexColors, true);
    assert.equal(material.side, THREE.DoubleSide); assert.equal(material.depthTest, false);
    assert.equal(material.depthWrite, false); assert.equal(material.fog, true);
    assert.equal(material.map, null);
    for (const part of [model.rod, model.reel]) {
      assert.equal(part.children.length, 1);
      assert.deepEqual(Object.keys(geometry(part).attributes).sort(), ['color', 'position']);
      assert.equal(geometry(part).index, null);
      assert.equal(part.userData.level, 1);
    }
    assert.deepEqual(model.group.userData.tip, [0, 1, 0]);
  } finally { model.dispose(); }
});

test('the static rod and reel draw after the world but before every actual lure, preserving crossing near casts', () => {
  const model = createRodReelModel(), lure = createLureModel();
  const lureGeometries = new Set(), worldOrder = new THREE.Object3D().renderOrder;
  try {
    // The existing lure factory owns four cached variants but has no dispose
    // API. Collect all of them before assertions so failure cleanup is complete.
    for (const { id } of LURES) {
      lure.select(id); lureGeometries.add(lure.mesh.geometry);
    }
    for (const { id } of LURES) {
      lure.select(id);
      for (const level of [1, 5, 10]) {
        model.setLevels({ rodLevel: level, reelLevel: level });
        for (const part of [model.rod, model.reel]) {
          assert.ok(mesh(part).renderOrder > worldOrder, 'world geometry must not paint over the first-person equipment');
          assert.ok(mesh(part).renderOrder < lure.mesh.renderOrder, `${id} must remain visible where its projection crosses ${part.name}`);
        }
      }
    }
  } finally {
    model.dispose();
    for (const value of lureGeometries) value.dispose();
    lure.mesh.material.dispose();
  }
});

test('all twenty appearances have independent structural geometry, useful labelled details and bounded submitted work', () => {
  const model = createRodReelModel(), rodSignatures = new Set(), reelSignatures = new Set();
  try {
    for (let level = 1; level <= 10; level++) {
      model.setLevels({ rodLevel: level, reelLevel: level });
      rodSignatures.add(signature(model.rod)); reelSignatures.add(signature(model.reel));
      let triangles = 0;
      for (const kind of ['rod', 'reel']) {
        const part = model[kind], resource = geometry(part);
        assert.equal(part.userData.level, level); assert.equal(part.userData.band, Math.ceil(level / 2));
        assert.equal(part.userData.appearance, ROD_REEL_APPEARANCES[kind][level - 1]);
        assert.ok(part.userData.parts.length >= 7); assert.ok(Object.isFrozen(part.userData.parts));
        assert.equal(part.userData.triangles, resource.drawRange.count / 3);
        assert.ok(resource.drawRange.count <= resource.attributes.position.count);
        assert.ok(resource.boundingBox.min.toArray().every(Number.isFinite));
        assert.ok(resource.boundingBox.max.toArray().every(Number.isFinite));
        triangles += part.userData.triangles;
      }
      assert.ok(triangles <= 1500, `Lv.${level}: ${triangles} exceeds the factory budget`);
      assert.ok(model.rod.userData.parts.includes('tip-guide'));
      assert.ok(model.reel.userData.parts.includes('spool-rim'));
    }
    assert.equal(rodSignatures.size, 10, 'colours are excluded from the structural signatures');
    assert.equal(reelSignatures.size, 10, 'colours are excluded from the structural signatures');
  } finally { model.dispose(); }
});

test('level changes are independent and selecting the same levels does not rewrite or replace resources', () => {
  const model = createRodReelModel();
  try {
    const rodGeometry = geometry(model.rod), reelGeometry = geometry(model.reel), material = mesh(model.rod).material;
    const reelSignature = signature(model.reel), version = reelGeometry.attributes.position.version;
    assert.equal(model.setLevels({ rodLevel: 10, reelLevel: 1 }), true);
    assert.equal(signature(model.reel), reelSignature); assert.equal(reelGeometry.attributes.position.version, version);
    const attributes = [rodGeometry.attributes.position, rodGeometry.attributes.color, reelGeometry.attributes.position, reelGeometry.attributes.color];
    const versions = attributes.map(value => value.version);
    for (let i = 0; i < 100; i++) assert.equal(model.setLevels({ rodLevel: 10, reelLevel: 1 }), false);
    assert.deepEqual(attributes.map(value => value.version), versions);
    assert.equal(geometry(model.rod), rodGeometry); assert.equal(geometry(model.reel), reelGeometry);
    assert.equal(mesh(model.rod).material, material); assert.equal(mesh(model.reel).material, material);
    assert.equal(model.rod.userData.level, 10); assert.equal(model.reel.userData.level, 1);
  } finally { model.dispose(); }
});

test('invalid level boundaries reject atomically without changing either model or caller state', () => {
  const model = createRodReelModel();
  try {
    model.setLevels({ rodLevel: 3, reelLevel: 7 });
    const invalid = [undefined, null, 0, -1, 11, 1.5, '2', NaN, Infinity, 2n];
    const signatures = [signature(model.rod), signature(model.reel)];
    const versions = [geometry(model.rod).attributes.position.version, geometry(model.reel).attributes.position.version];
    for (const value of invalid) for (const levels of [{ rodLevel: value, reelLevel: 8 }, { rodLevel: 4, reelLevel: value }]) {
      assert.throws(() => model.setLevels(levels), RangeError);
      assert.deepEqual([signature(model.rod), signature(model.reel)], signatures);
      assert.deepEqual([geometry(model.rod).attributes.position.version, geometry(model.reel).attributes.position.version], versions);
      assert.equal(model.rod.userData.level, 3); assert.equal(model.reel.userData.level, 7);
    }
    const state = Object.freeze({ rodLevel: 6, reelLevel: 2 });
    model.setLevels(state); assert.deepEqual(state, { rodLevel: 6, reelLevel: 2 });
  } finally { model.dispose(); }
});

test('all one hundred level pairs and repeated scene changes retain two geometries and one material until one owned disposal', () => {
  const model = createRodReelModel(), scene = new THREE.Scene();
  const resources = [geometry(model.rod), geometry(model.reel), mesh(model.rod).material];
  const attributes = resources.slice(0, 2).flatMap(value => Object.values(value.attributes));
  const arrays = attributes.map(value => value.array);
  const geometryBefore = new THREE.BufferGeometry(), materialBefore = new THREE.MeshBasicMaterial(), objectBefore = new THREE.Object3D();
  const disposals = [0, 0, 0]; resources.forEach((value, index) => value.addEventListener('dispose', () => disposals[index]++));
  for (let repeat = 0; repeat < 3; repeat++) for (let rodLevel = 1; rodLevel <= 10; rodLevel++) for (let reelLevel = 1; reelLevel <= 10; reelLevel++) {
    scene.add(model.group); model.group.visible = !model.group.visible;
    model.setLevels({ rodLevel, reelLevel });
    assert.equal(geometry(model.rod), resources[0]); assert.equal(geometry(model.reel), resources[1]);
    assert.equal(mesh(model.rod).material, resources[2]); assert.equal(mesh(model.reel).material, resources[2]);
    assert.deepEqual(resources.slice(0, 2).flatMap(value => Object.values(value.attributes)), attributes);
    attributes.forEach((value, index) => assert.equal(value.array, arrays[index]));
    assert.deepEqual(disposals, [0, 0, 0]); model.group.removeFromParent();
  }
  const geometryAfter = new THREE.BufferGeometry(), materialAfter = new THREE.MeshBasicMaterial(), objectAfter = new THREE.Object3D();
  assert.equal(geometryAfter.id, geometryBefore.id + 1, 'no intermediate Geometry construction during 300 selections');
  assert.equal(materialAfter.id, materialBefore.id + 1, 'no intermediate Material construction during 300 selections');
  assert.equal(objectAfter.id, objectBefore.id + 1, 'no intermediate Object/Mesh construction during 300 selections');
  geometryBefore.dispose(); geometryAfter.dispose(); materialBefore.dispose(); materialAfter.dispose();
  scene.add(model.group); model.dispose(); model.dispose();
  assert.deepEqual(disposals, [1, 1, 1]); assert.equal(model.group.parent, null);
  assert.throws(() => model.setLevels({ rodLevel: 1, reelLevel: 1 }), /disposed/);
});

test('construction disposes every intermediate geometry and retains only the rod and reel buffers', () => {
  const before = new THREE.BufferGeometry(), released = [];
  const original = THREE.BufferGeometry.prototype.dispose;
  let model, after;
  try {
    THREE.BufferGeometry.prototype.dispose = function () { released.push(this.id); return original.call(this); };
    model = createRodReelModel(); after = new THREE.BufferGeometry();
    const live = new Set([geometry(model.rod).id, geometry(model.reel).id]);
    const expected = [];
    for (let id = before.id + 1; id < after.id; id++) if (!live.has(id)) expected.push(id);
    assert.ok(expected.length >= 6, 'shared primitive templates must be exercised');
    assert.equal(new Set(released).size, released.length, 'no intermediate is disposed twice');
    assert.deepEqual(released.slice().sort((a, b) => a - b), expected);
  } finally {
    THREE.BufferGeometry.prototype.dispose = original;
    model?.dispose(); before.dispose(); after?.dispose();
  }
});
