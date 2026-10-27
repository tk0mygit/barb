import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { createTerrain, terrainHeightAt } from '../src/world/terrain.js';
import { LAKE, shoreRadius } from '../src/world/config.js';
import { FISHING_SPOTS } from '../src/world/fishing-spots.js';
import { isNavigableBoatPosition } from '../src/game/boat.js';

const BASELINE_TERRAIN_TRIANGLES = 195096;
const named = (terrain, name) => {
  const mesh = terrain.getObjectByName(name);
  assert.ok(mesh?.isMesh, name);
  return mesh;
};
const near = (a, b, message, tolerance = 1e-4) =>
  assert.ok(Math.abs(a - b) <= tolerance, `${message}: ${a} != ${b}`);
const vector = (attribute, index) => new THREE.Vector3().fromBufferAttribute(attribute, index);
const finite = (values, label) => {
  for (const value of values) assert.ok(Number.isFinite(value), `${label}: ${value}`);
};

function dispose(terrain) {
  const geometries = new Set(), materials = new Set();
  terrain.traverse(mesh => {
    if (mesh.geometry) geometries.add(mesh.geometry);
    if (mesh.material) materials.add(mesh.material);
  });
  geometries.forEach(geometry => geometry.dispose());
  materials.forEach(material => material.dispose());
}

test('scenery geometry, instance transforms and colors are deterministic and finite', () => {
  const first = createTerrain(), second = createTerrain();
  try {
    assert.deepEqual(first.children.map(mesh => mesh.name), second.children.map(mesh => mesh.name));
    for (const mesh of first.children) {
      const other = named(second, mesh.name);
      assert.equal(mesh.geometry.attributes.position.count, other.geometry.attributes.position.count);
      for (const [name, attribute] of Object.entries(mesh.geometry.attributes)) {
        finite(attribute.array, `${mesh.name}.${name}`);
        assert.deepEqual(attribute.array, other.geometry.getAttribute(name).array, `${mesh.name}.${name}`);
        if (name === 'color') for (const value of attribute.array) assert.ok(value >= 0 && value <= 1);
      }
      const positions = mesh.geometry.attributes.position, normals = mesh.geometry.attributes.normal;
      assert.ok(positions.count > 2);
      assert.equal(normals.count, positions.count);
      for (let i = 0; i < normals.count; i++) near(vector(normals, i).length(), 1, `${mesh.name} normal ${i}`, 1e-3);
      const vertexCount = mesh.geometry.index?.count ?? positions.count;
      assert.equal(vertexCount % 3, 0);
      if (mesh.geometry.index) {
        for (const index of mesh.geometry.index.array) assert.ok(index >= 0 && index < positions.count, mesh.name);
        assert.deepEqual(mesh.geometry.index.array, other.geometry.index.array);
      } else assert.equal(other.geometry.index, null);
      mesh.geometry.computeBoundingSphere();
      finite([...mesh.geometry.boundingSphere.center, mesh.geometry.boundingSphere.radius], `${mesh.name} bounds`);
      assert.ok(mesh.geometry.boundingSphere.radius > 0);
      if (mesh.isInstancedMesh) {
        assert.equal(mesh.count, other.count);
        finite(mesh.instanceMatrix.array, `${mesh.name} matrices`);
        assert.deepEqual(mesh.instanceMatrix.array, other.instanceMatrix.array);
        const matrix = new THREE.Matrix4();
        for (let i = 0; i < mesh.count; i++) {
          mesh.getMatrixAt(i, matrix);
          assert.ok(matrix.determinant() > 0, `${mesh.name} instance ${i} scale`);
        }
        if (mesh.instanceColor) {
          finite(mesh.instanceColor.array, `${mesh.name} colors`);
          assert.deepEqual(mesh.instanceColor.array, other.instanceColor.array);
          for (const value of mesh.instanceColor.array) assert.ok(value >= 0 && value <= 1);
        }
      }
    }
  } finally { dispose(first); dispose(second); }
});

test('850 rooted trees share foliage resources and stay outside the sailing area', () => {
  const terrain = createTerrain();
  try {
    const trunks = named(terrain, 'tree-trunks');
    const crowns = ['tree-conifers', 'tree-broadleaves'].map(name => named(terrain, name));
    assert.ok(trunks.isInstancedMesh);
    assert.equal(trunks.count, 850);
    assert.deepEqual(crowns.map(mesh => mesh.count), [650, 200]);
    assert.ok(crowns.every(mesh => mesh.isInstancedMesh));
    assert.equal(crowns[0].material, crowns[1].material);
    assert.equal(named(terrain, 'shore-rocks').count, 90);
    const matrix = new THREE.Matrix4(), roots = [];
    for (let i = 0; i < trunks.count; i++) {
      trunks.getMatrixAt(i, matrix);
      const root = new THREE.Vector3(0, -0.5, 0).applyMatrix4(matrix);
      near(root.y, terrainHeightAt(root.x, root.z), `trunk ${i} root`, 2e-4);
      assert.ok(Math.hypot(root.x, root.z) > shoreRadius(Math.atan2(root.z, root.x)) + 6, `trunk ${i} clearance`);
      roots.push(root);
    }
    // Each crown belongs to one trunk; verify the actual transform positions,
    // rather than merely checking the independent instance totals.
    const unmatched = new Set(roots.map((_, index) => index));
    for (const crown of crowns) for (let i = 0; i < crown.count; i++) {
      crown.getMatrixAt(i, matrix);
      const center = new THREE.Vector3().setFromMatrixPosition(matrix);
      const rootIndex = roots.findIndex((root, index) => unmatched.has(index)
        && Math.hypot(root.x - center.x, root.z - center.z) < 1e-3);
      assert.ok(rootIndex >= 0, `${crown.name} ${i} has a trunk`);
      assert.ok(center.y > roots[rootIndex].y, `${crown.name} ${i} above root`);
      unmatched.delete(rootIndex);
    }
    assert.equal(unmatched.size, 0);
    // Check against the rendered triangles independently of the helper used
    // to place trees. This catches analytic heights drifting from mesh slopes.
    const ground = named(terrain, 'lake-shore');
    ground.updateMatrixWorld();
    const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
    for (let i = 0; i < roots.length; i += 13) {
      const root = roots[i];
      ray.ray.origin.set(root.x, 1000, root.z);
      const hit = ray.intersectObject(ground, false)[0];
      assert.ok(hit, `rendered ground below trunk ${i}`);
      near(terrainHeightAt(root.x, root.z), hit.point.y, `rendered height at trunk ${i}`, 2e-4);
    }
  } finally { dispose(terrain); }
});

test('terrain height sampling follows both rendered triangle halves around the full lake', () => {
  const terrain = createTerrain();
  try {
    const geometry = named(terrain, 'lake-shore').geometry;
    const positions = geometry.attributes.position, indices = geometry.index.array;
    // Triangle centroids have an exact barycentric height. An odd stride
    // exercises both diagonals, every radial band and the angular wrap.
    for (let triangle = 0; triangle < indices.length / 3; triangle += 17) {
      const centroid = new THREE.Vector3();
      for (let corner = 0; corner < 3; corner++) centroid.add(vector(positions, indices[triangle * 3 + corner]));
      centroid.multiplyScalar(1 / 3);
      const height = terrainHeightAt(centroid.x, centroid.z);
      assert.ok(Number.isFinite(height), `triangle ${triangle} finite height`);
      near(height, centroid.y, `triangle ${triangle} interpolated height`, 2e-4);
    }
  } finally { dispose(terrain); }
});

test('shore, both crowns and all mountain ridges close their position, color and normal seams', () => {
  const terrain = createTerrain();
  try {
    for (const [name, columns] of [
      ['lake-shore', LAKE.segments + 1], ['tree-conifers', 8], ['tree-broadleaves', 8],
      ['mountain-ridge-0', 129], ['mountain-ridge-1', 129], ['mountain-ridge-2', 129],
    ]) {
      const geometry = named(terrain, name).geometry;
      const rows = geometry.attributes.position.count / columns;
      assert.ok(Number.isInteger(rows) && rows > 1, `${name} angular grid`);
      for (let row = 0; row < rows; row++) {
        const first = row * columns, last = first + columns - 1;
        for (const attributeName of ['position', 'color', 'normal']) {
          const attribute = geometry.attributes[attributeName];
          assert.ok(attribute, `${name}.${attributeName}`);
          for (let axis = 0; axis < 3; axis++) near(
            attribute.array[first * 3 + axis], attribute.array[last * 3 + axis],
            `${name}.${attributeName} seam row ${row} axis ${axis}`, 1e-6,
          );
        }
      }
    }
  } finally { dispose(terrain); }
});

test('scenery remains inside the mesh, triangle and resource budgets', () => {
  const terrain = createTerrain();
  try {
    const meshes = [];
    terrain.traverse(object => { if (object.isMesh) meshes.push(object); });
    assert.equal(meshes.length, 8);
    assert.ok(meshes.every(mesh => mesh.parent === terrain), 'no individual tree meshes');
    const triangles = meshes.reduce((sum, mesh) => sum
      + (mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count) / 3 * (mesh.isInstancedMesh ? mesh.count : 1), 0);
    assert.ok(triangles <= BASELINE_TERRAIN_TRIANGLES * 1.15, `${triangles} scenery triangles`);
    assert.ok(new Set(meshes.map(mesh => mesh.geometry)).size <= 8);
    assert.ok(new Set(meshes.map(mesh => mesh.material)).size <= 7);
    for (const mesh of meshes) {
      assert.equal(mesh.material.type, 'MeshStandardMaterial');
      assert.equal(mesh.material.fog, true);
      assert.equal(mesh.material.map, null, mesh.name);
    }
  } finally { dispose(terrain); }
});

test('visual refinement preserves the public shore, navigation margin and three 20m fishing spots', () => {
  assert.deepEqual(LAKE, { radius: 145, boatMargin: 7, segments: 160 });
  assert.deepEqual(FISHING_SPOTS.map(({ id, x, z, radius, hitMultiplier }) => ({ id, x, z, radius, hitMultiplier })), [
    { id: 'north-water', x: 0, z: -65, radius: 20, hitMultiplier: 1.5 },
    { id: 'west-water', x: -75, z: 15, radius: 20, hitMultiplier: 1.5 },
    { id: 'east-water', x: 70, z: -35, radius: 20, hitMultiplier: 1.5 },
  ]);
  for (let step = 0; step < 720; step++) {
    const angle = step / 720 * Math.PI * 2;
    const expected = 145 + 13 * Math.sin(angle * 3 + 0.4) + 8 * Math.cos(angle * 5) + 4 * Math.sin(angle * 9);
    near(shoreRadius(angle), expected, 'unchanged shore', 1e-12);
    const limit = expected - 7;
    assert.ok(isNavigableBoatPosition({ x: Math.cos(angle) * limit, z: Math.sin(angle) * limit }));
    assert.equal(isNavigableBoatPosition({ x: Math.cos(angle) * (limit + 0.01), z: Math.sin(angle) * (limit + 0.01) }), false);
    for (const spot of FISHING_SPOTS) assert.ok(isNavigableBoatPosition({
      x: spot.x + Math.cos(angle) * spot.radius, z: spot.z + Math.sin(angle) * spot.radius,
    }));
  }
  const terrain = createTerrain();
  try {
    const positions = named(terrain, 'lake-shore').geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i), z = positions.getZ(i);
      assert.ok(Math.hypot(x, z) > shoreRadius(Math.atan2(z, x)) - LAKE.boatMargin + 1, `ground vertex ${i} sailing clearance`);
    }
  } finally { dispose(terrain); }
});

// Byte fingerprints from main 6c92a1c6d004580144db72011bf5999fa5a2e651,
// Three.js 0.186.1. G-1 may change only conifer position/color/normal values.
// Include every untouched geometry and all instance buffers, including rocks:
// a change to PRNG consumption must not silently move or recolor later objects.
const g0Buffers = {
  'lake-shore': ['1d057bba361609f35aaa0cd05217e2c6c5f84d857f7d44aac01c9688678ec8c3'],
  'tree-trunks': ['f7a28dfe414427abe4e15f453f7dfff9705205a0ff0166d2934b0e4155e60262', '9ac17a09345940b55e9171bdee04296279a68ffbac1f3bceed40eb5125dba738'],
  'tree-conifers': [null, '752e9686811a57ca406b1cf6a9b6131b6e84cce1e335d8fdd1d1d7abf8d9fff9'],
  'tree-broadleaves': ['986ed0dd486d323612e664efa222a5b615b76c22eb4bfe651bbe9216f623725e', '495771cde44a1cabfc57c268c8a79e11e6d19d7c409d0dc764afa66182c33e19'],
  'shore-rocks': ['70da1a6fc2e69bca8c96dde13fca8e6078aa259d2fc0d2fac13eb59e225347c2', '5101bef8fc1ea21afd0be2365a8d54882a8d5feaedc1839b4d8039775aa6b104'],
  'mountain-ridge-0': ['a59e8ff8ea19c797a393ae7589108b139c764b5fc7887233dec75db7c97b18f1'],
  'mountain-ridge-1': ['9b9038dc29c86a17cef811be230121eda324af659f470c7cac6875893ba8fc20'],
  'mountain-ridge-2': ['0ba66efc2f12095b80673cd3268a230fedec37ed7bdd7adb512ea7f45b60ded0'],
};
const bufferDigest = arrays => {
  const hash = createHash('sha256');
  for (const array of arrays) hash.update(Buffer.from(array.buffer, array.byteOffset, array.byteLength));
  return hash.digest('hex');
};

test('G-1 preserves all G-0 instance buffers, other geometry bytes and material configuration', () => {
  const terrain = createTerrain();
  try {
    assert.deepEqual(terrain.children.map(mesh => mesh.name), Object.keys(g0Buffers));
    assert.equal(new Set(terrain.children.map(mesh => mesh.geometry)).size, 8);
    assert.equal(new Set(terrain.children.map(mesh => mesh.material)).size, 7);
    assert.equal(named(terrain, 'tree-conifers').material, named(terrain, 'tree-broadleaves').material);
    for (const mesh of terrain.children) {
      const [geometryDigest, instanceDigest] = g0Buffers[mesh.name], geometry = mesh.geometry;
      if (geometryDigest) assert.equal(bufferDigest([
        ...Object.keys(geometry.attributes).sort().map(name => geometry.attributes[name].array),
        ...(geometry.index ? [geometry.index.array] : []),
      ]), geometryDigest, `${mesh.name} geometry bytes`);
      if (instanceDigest) assert.equal(bufferDigest([
        mesh.instanceMatrix.array, ...(mesh.instanceColor ? [mesh.instanceColor.array] : []),
      ]), instanceDigest, `${mesh.name} instance matrix/color bytes`);
      assert.equal(mesh.parent, terrain);
      assert.equal(mesh.frustumCulled, true);
      assert.equal(mesh.castShadow, false);
      assert.equal(mesh.receiveShadow, mesh.name === 'lake-shore');
      assert.equal(mesh.material.side, mesh.name === 'lake-shore' || mesh.name.startsWith('mountain-') ? THREE.DoubleSide : THREE.FrontSide);
      assert.equal(mesh.material.transparent, false);
      assert.equal(mesh.material.opacity, 1);
      assert.equal(mesh.material.alphaTest, 0);
      assert.equal(mesh.material.alphaHash, false);
      assert.equal(mesh.material.flatShading, false);
      assert.equal(mesh.material.depthWrite, true);
      assert.equal(mesh.material.roughness, 1);
      assert.equal(mesh.material.metalness, 0);
      assert.equal(Object.values(mesh.material).some(value => value?.isTexture), false);
    }
  } finally { dispose(terrain); }
});

test('conifer crown keeps 196 outward-wound triangles and a closed, unit-normal angular seam', () => {
  const terrain = createTerrain();
  try {
    const geometry = named(terrain, 'tree-conifers').geometry;
    assert.deepEqual(Object.keys(geometry.attributes).sort(), ['color', 'normal', 'position']);
    const positions = geometry.attributes.position, normals = geometry.attributes.normal;
    assert.equal(positions.count, 120);
    assert.equal(geometry.index.count, 588);
    assert.equal(bufferDigest([geometry.index.array]), '78005b47c8c5d2c277a1435013ef6f8301fd68fca7092bcc5cbf8cf19d2542bb', 'G-0 index bytes and winding');
    const centers = Array.from({ length: 15 }, (_, row) => {
      const center = new THREE.Vector3();
      for (let col = 0; col < 7; col++) center.add(vector(positions, row * 8 + col));
      return center.multiplyScalar(1 / 7);
    });
    for (let row = 0; row < 15; row++) for (const name of ['position', 'color', 'normal']) {
      const attribute = geometry.attributes[name];
      assert.deepEqual(vector(attribute, row * 8), vector(attribute, row * 8 + 7), `${name} seam ${row}`);
    }
    for (let i = 0; i < positions.count; i++) {
      finite(vector(positions, i).toArray(), `conifer vertex ${i}`);
      const normal = vector(normals, i), row = Math.floor(i / 8);
      near(normal.length(), 1, `conifer normal ${i}`, 1e-6);
      if (row < 14) {
        const radial = vector(positions, i).sub(centers[row]).setY(0);
        assert.ok(normal.dot(radial) > 0, `conifer normal ${i} points outward`);
      }
      if (row > 0) assert.ok(positions.getY(i) > positions.getY(i - 8), `conifer ring ${i} does not fold over`);
    }
    let collapsedTipFaces = 0;
    const indices = geometry.index.array;
    for (let i = 0; i < indices.length; i += 3) {
      const ids = Array.from(indices.slice(i, i + 3)), [a, b, c] = ids.map(index => vector(positions, index));
      const cross = b.clone().sub(a).cross(c.clone().sub(a));
      if (cross.lengthSq() < 1e-18) {
        assert.equal(ids.filter(index => index >= 112).length, 2, 'only the existing collapsed tip faces');
        collapsedTipFaces++;
      } else {
        const center = ids.reduce((sum, index) => sum.add(centers[Math.floor(index / 8)]), new THREE.Vector3()).multiplyScalar(1 / 3);
        const radial = a.clone().add(b).add(c).multiplyScalar(1 / 3).sub(center).setY(0);
        assert.ok(cross.dot(radial) > 0, `conifer triangle ${i / 3} winding`);
      }
    }
    assert.equal(collapsedTipFaces, 7);
  } finally { dispose(terrain); }
});
