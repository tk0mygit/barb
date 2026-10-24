import test from 'node:test';
import assert from 'node:assert/strict';
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
