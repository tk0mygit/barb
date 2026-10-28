import * as THREE from 'three';
import { LAKE, shoreRadius, randomGenerator } from './config.js';
import { sceneryNoise, ridgeNoise } from './scenery-noise.js';
import { createConiferTexture, CONIFER_TEXTURE_MEAN } from './conifer-texture.js';
import { createForestPlacement } from './forest-placement.js';

export const FOREST_COUNTS = Object.freeze({ total: 1100, conifers: 843, broadleaves: 257 });

// More samples near the waterline, with the original outer skirt extent.
// Neither this mesh nor its height sampler participates in lake collision.
const offsets = [-5, 0, 2.5, 5.5, 9, 14, 20, 28, 38, 50, 64, 80, 98, 118, 140, 164, 190, 218, 248, 279, 299];
const tau = Math.PI * 2;
const smooth = (a, b, v) => THREE.MathUtils.smoothstep(v, a, b);
function groundVertex(ring, segment) {
  const angle = (segment % LAKE.segments) / LAKE.segments * tau;
  const offset = offsets[ring], r = shoreRadius(angle) + offset;
  const x = Math.cos(angle) * r, z = Math.sin(angle) * r;
  const relief = sceneryNoise(x * 0.025, z * 0.025, 181) - 0.5;
  const y = ring === 0 ? -1.4 : 0.65 + offset * 0.11
    + Math.max(0, offset - 10) * 0.06 * (Math.sin(x * 0.04) + Math.cos(z * 0.037))
    + smooth(0, 30, offset) * relief * 3.5;
  return [Math.fround(x), Math.fround(y), Math.fround(z)];
}
function triangleHeight(x, z, a, b, c) {
  const denominator = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
  const u = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / denominator;
  const v = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / denominator;
  return { inside: u >= -1e-5 && v >= -1e-5 && u + v <= 1.00001, height: u * a[1] + v * b[1] + (1 - u - v) * c[1] };
}

// Initialization only: meet the exact Float32 triangles of the rendered slope.
export function terrainHeightAt(x, z) {
  return sampleHeight(x, z, groundVertex);
}

function sampleHeight(x, z, vertex) {
  const angle = (Math.atan2(z, x) + tau) % tau;
  const segment = Math.min(LAKE.segments - 1, Math.floor(angle / tau * LAKE.segments));
  for (let ring = 0; ring < offsets.length - 1; ring++) {
    const a = vertex(ring, segment), b = vertex(ring, segment + 1);
    const c = vertex(ring + 1, segment), d = vertex(ring + 1, segment + 1);
    for (const triangle of [[a, b, c], [b, d, c]]) {
      const sample = triangleHeight(x, z, ...triangle);
      if (sample.inside) return sample.height;
    }
  }
  return NaN;
}

function closeNormals(geometry, columns, rows) {
  const normals = geometry.attributes.normal, normal = new THREE.Vector3();
  for (let row = 0; row < rows; row++) {
    const first = row * columns, last = first + columns - 1;
    normal.set(normals.getX(first) + normals.getX(last), normals.getY(first) + normals.getY(last), normals.getZ(first) + normals.getZ(last)).normalize();
    normals.setXYZ(first, normal.x, normal.y, normal.z); normals.setXYZ(last, normal.x, normal.y, normal.z);
  }
}

function createCrown(broadleaf) {
  const positions = [], colors = [], indices = [], sides = 7, levels = 14;
  const uvs = [];
  const profile = [0.60, 0.88, 0.80, 0.84, 0.70, 0.75, 0.60, 0.60, 0.48, 0.46, 0.35, 0.29, 0.21, 0.13, 0];
  for (let level = 0; level <= levels; level++) {
    const t = level / levels;
    for (let side = 0; side <= sides; side++) {
      const angle = (side % sides) / sides * tau;
      // Stagger bough tips around the crown instead of stacking sharp skirts
      // at the same height. End rings stay fixed; the broadleaf path is unchanged.
      const envelope = Math.sin(Math.PI * t);
      const direction = broadleaf ? angle : angle + 0.11 * Math.sin(t * 8) + 0.035 * Math.sin(angle * 3 + t * 13);
      const height = broadleaf || level === 0 || level === levels ? t
        : t + envelope * (0.018 * Math.sin(angle * 3 + t * 18) + 0.008 * Math.cos(angle * 2 - t * 11));
      const edge = broadleaf ? 1 + 0.23 * Math.sin(angle * 3 + t * 9) + 0.09 * Math.cos(angle * 2 - t * 6)
        : 1 + 0.10 * Math.sin(angle * 3 + t * 18) + 0.07 * Math.cos(angle * 2 - t * 11);
      const radius = (broadleaf ? Math.sin(Math.PI * t) ** 0.65 * (0.94 + Math.sin(t * 23) * 0.1) : profile[level]) * edge;
      positions.push(Math.cos(direction) * radius + Math.sin(t * 3.1) * 0.12, height, Math.sin(direction) * radius);
      const light = broadleaf ? 0.76 + t * 0.24 : 0.78 + t * 0.17
        + envelope * (0.04 * Math.sin(angle * 3 + t * 18) + 0.025 * Math.cos(angle * 2 - t * 11));
      colors.push(light * 0.97, light, light * 0.94);
      uvs.push(side / sides, t);
      if (level < levels && side < sides) {
        const a = level * (sides + 1) + side, b = a + sides + 1;
        indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices); geometry.computeVertexNormals(); closeNormals(geometry, sides + 1, levels + 1);
  return geometry;
}

export function createTerrain() {
  const group = new THREE.Group(); group.name = 'lake-scenery';
  const random = randomGenerator(), positions = [], colors = [], indices = [];
  const sand = new THREE.Color('#96917a'), grass = new THREE.Color('#61705a');
  const soil = new THREE.Color('#77745f'), stone = new THREE.Color('#85877c'), color = new THREE.Color();
  for (let ring = 0; ring < offsets.length; ring++) {
    for (let i = 0; i <= LAKE.segments; i++) {
      const [x, y, z] = groundVertex(ring, i), offset = offsets[ring];
      positions.push(x, y, z);
      const broad = sceneryNoise(x * 0.035, z * 0.035, 91), patch = sceneryNoise(x * 0.13, z * 0.13, 29);
      const growth = smooth(1.5 + broad * 9, 17 + broad * 19, offset + (patch - 0.5) * 8);
      color.copy(sand).lerp(grass, growth);
      color.lerp(soil, smooth(0.48, 0.8, broad) * growth * 0.38);
      color.lerp(stone, smooth(16, 42, y) * (0.18 + patch * 0.27));
      color.multiplyScalar(0.91 + patch * 0.13 + broad * 0.07); colors.push(color.r, color.g, color.b);
      if (ring < offsets.length - 1 && i < LAKE.segments) {
        const a = ring * (LAKE.segments + 1) + i, b = a + LAKE.segments + 1;
        indices.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices); geometry.computeVertexNormals(); closeNormals(geometry, LAKE.segments + 1, offsets.length);
  const ground = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide }));
  ground.name = 'lake-shore'; ground.receiveShadow = true; group.add(ground);

  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.25, 0.5, 1, 5), new THREE.MeshStandardMaterial({ color: '#655a49', roughness: 1 }), FOREST_COUNTS.total);
  const foliageMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 });
  const foliageTexture = createConiferTexture();
  foliageMaterial.map = foliageTexture;
  foliageMaterial.color.setScalar(1 / CONIFER_TEXTURE_MEAN);
  // Both crowns own the same material; its existing cleanup releases one map.
  foliageMaterial.addEventListener('dispose', () => foliageTexture.dispose());
  const conifers = new THREE.InstancedMesh(createCrown(false), foliageMaterial, FOREST_COUNTS.conifers);
  const broadleaves = new THREE.InstancedMesh(createCrown(true), foliageMaterial, FOREST_COUNTS.broadleaves);
  trunks.name = 'tree-trunks'; conifers.name = 'tree-conifers'; broadleaves.name = 'tree-broadleaves';
  const dummy = new THREE.Object3D(), treeColor = new THREE.Color();
  const evergreen = new THREE.Color('#405a48'), leaf = new THREE.Color('#637053');
  const pale = new THREE.Color('#7c8966'), shade = new THREE.Color('#344b42');
  const placeTree = createForestPlacement();
  const additionalRandom = randomGenerator(25071), legacyRandom = random;
  let additionalConifer = 650, additionalBroadleaf = 200;
  const crownPoint = new THREE.Vector3();
  // Reuse the already rounded rendered vertices for the extra crown checks.
  // The old 850 height calls and their results are untouched. No second mesh
  // or retained height cache is needed, and no ground noise is recomputed here.
  const extraHeightAt = (x, z) => sampleHeight(x, z, (ring, segment) => {
    const start = (ring * (LAKE.segments + 1) + segment % LAKE.segments) * 3;
    return positions.slice(start, start + 3);
  });
  for (let i = 0; i < FOREST_COUNTS.total; i++) {
    // Never extend seed 71: rocks must receive exactly their original sequence.
    const random = i < 850 ? legacyRandom : additionalRandom;
    let x, z;
    // Coherent groves and openings, with bounded deterministic rejection.
    for (let attempt = 0; attempt < 12; attempt++) {
      const angle = random() * tau, offset = 11 + random() ** 1.35 * 168;
      const radius = shoreRadius(angle) + offset;
      x = Math.cos(angle) * radius; z = Math.sin(angle) * radius;
      if (random() < 0.22 + sceneryNoise(x * 0.028, z * 0.028, 311) * 0.78) break;
    }
    // Legacy ID 650..849 stays broadleaf; appended IDs use an independent
    // interleaved 270:80 schedule whose lower-count candidates are prefixes.
    const extra = i - 850;
    const broadleaf = i < 850 ? i >= 650 : Math.floor((extra + 1) * 80 / 350) > Math.floor(extra * 80 / 350);
    const h = 8 + random() * 13, w = h * (broadleaf ? 0.24 + random() * 0.09 : 0.16 + random() * 0.08);
    const yaw = random() * tau, aspect = 0.78 + random() * 0.38;
    const crownRadius = w * Math.max(1, aspect) * (broadleaf ? 1.3 : 1.1);
    const foliage = broadleaf ? broadleaves : conifers;
    if (i < 850) ({ x, z } = placeTree(i, x, z, crownRadius));
    else ({ x, z } = placeTree.add(i, x, z, crownRadius, (px, pz) => {
      const rootY = extraHeightAt(px, pz);
      if (!Number.isFinite(rootY)) return false;
      dummy.rotation.set(0, yaw, 0);
      dummy.position.set(px, rootY + h * (broadleaf ? 0.36 : 0.13), pz);
      dummy.scale.set(w, h * (broadleaf ? 0.67 : 0.87), w * aspect); dummy.updateMatrix();
      const vertices = foliage.geometry.attributes.position;
      for (let v = 0; v < vertices.count; v++) {
        crownPoint.fromBufferAttribute(vertices, v).applyMatrix4(dummy.matrix);
        const groundY = extraHeightAt(crownPoint.x, crownPoint.z);
        if (!Number.isFinite(groundY) || crownPoint.y <= groundY) return false;
      }
      return true;
    }));
    const y = terrainHeightAt(x, z);
    dummy.rotation.set(0, yaw, 0); dummy.position.set(x, y + h * 0.28, z);
    dummy.scale.set(0.65 + h * 0.025, h * 0.56, 0.65 + h * 0.025);
    dummy.updateMatrix(); trunks.setMatrixAt(i, dummy.matrix);
    const index = i < 850 ? (broadleaf ? i - 650 : i) : (broadleaf ? additionalBroadleaf++ : additionalConifer++);
    treeColor.copy(broadleaf ? leaf : evergreen).lerp(random() < 0.3 ? pale : shade, random() * 0.4);
    treeColor.multiplyScalar(0.88 + random() * 0.23);
    dummy.position.set(x, y + h * (broadleaf ? 0.36 : 0.13), z);
    dummy.scale.set(w, h * (broadleaf ? 0.67 : 0.87), w * aspect);
    dummy.updateMatrix(); foliage.setMatrixAt(index, dummy.matrix); foliage.setColorAt(index, treeColor);
  }
  group.add(trunks, conifers, broadleaves);
  const rocks = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1 }), 90);
  rocks.name = 'shore-rocks';
  for (let i = 0; i < 90; i++) {
    const angle = random() * tau, offset = random() * 5, r = shoreRadius(angle) + offset;
    const x = Math.cos(angle) * r, z = Math.sin(angle) * r;
    dummy.position.set(x, terrainHeightAt(x, z) - 0.25, z);
    dummy.rotation.set(random(), random() * tau, random());
    dummy.scale.set(0.8 + random() * 2.3, 0.45 + random() * 1.1, 0.8 + random() * 1.7);
    dummy.updateMatrix(); rocks.setMatrixAt(i, dummy.matrix);
    treeColor.set('#85897c').lerp(soil, random() * 0.35); rocks.setColorAt(i, treeColor);
  }
  group.add(rocks);

  // Three continuous slopes with overlapping skirts avoid horizon gaps.
  for (let ridge = 0; ridge < 3; ridge++) {
    const verts = [], tints = [], faces = [], n = 128, base = 385 + ridge * 145;
    const ridgeTint = new THREE.Color(['#596f68', '#738784', '#8e9e9a'][ridge]);
    for (let row = 0; row < 5; row++) {
      for (let i = 0; i <= n; i++) {
        const a = (i % n) / n * tau;
        const broad = ridgeNoise(a, 7, 807 + ridge * 31), detail = ridgeNoise(a, 31, 233 + ridge * 41);
        const fine = ridgeNoise(a, 67, 109 + ridge * 17);
        const peak = 42 + ridge * 18 + broad * 54 + detail * 58 + fine * 26;
        const radius = base + [0, 38, 78, 115, 215][row] + (row === 0 ? 0 : (detail - 0.5) * 32);
        const height = row === 0 || row === 4 ? -12 : peak * [0, 0.18 + fine * 0.12, 0.48 + detail * 0.2, 1, 0][row];
        verts.push(Math.cos(a) * radius, height, Math.sin(a) * radius);
        color.copy(ridgeTint).multiplyScalar(0.85 + row * 0.025 + broad * 0.09 + detail * 0.07 + fine * 0.035);
        tints.push(color.r, color.g, color.b);
        if (row < 4 && i < n) {
          const k = row * (n + 1) + i, next = k + n + 1;
          faces.push(k, k + 1, next, k + 1, next + 1, next);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(tints, 3));
    geo.setIndex(faces); geo.computeVertexNormals(); closeNormals(geo, n + 1, 5);
    const mountain = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide }));
    mountain.name = `mountain-ridge-${ridge}`; group.add(mountain);
  }
  return group;
}
