import * as THREE from 'three';
import { LAKE, PALETTE, shoreRadius, randomGenerator } from './config.js';

export function createTerrain() {
  const group = new THREE.Group();
  const random = randomGenerator();
  const positions = [], colors = [], indices = [];
  const rings = 24;
  const sand = new THREE.Color(PALETTE.shore);
  const grass = new THREE.Color(PALETTE.grass);
  for (let ring = 0; ring <= rings; ring++) {
    for (let i = 0; i <= LAKE.segments; i++) {
      const angle = i / LAKE.segments * Math.PI * 2;
      const offset = ring === 0 ? -5 : (ring - 1) * 13;
      const radius = shoreRadius(angle) + offset;
      const x = Math.cos(angle) * radius, z = Math.sin(angle) * radius;
      const height = ring === 0 ? -1.4 : 0.65 + offset * 0.11 + Math.max(0, offset - 10) * 0.06 * (Math.sin(x * 0.04) + Math.cos(z * 0.037));
      positions.push(x, height, z);
      const color = sand.clone().lerp(grass, Math.min(1, Math.max(0, offset) / 22)).multiplyScalar(0.92 + random() * 0.16);
      colors.push(color.r, color.g, color.b);
      if (ring < rings && i < LAKE.segments) {
        const a = ring * (LAKE.segments + 1) + i, b = a + LAKE.segments + 1;
        indices.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const ground = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide }));
  ground.receiveShadow = true;
  group.add(ground);

  const count = 850;
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.25, 0.5, 1, 5), new THREE.MeshStandardMaterial({ color: '#655343' }), count);
  // Layered, uneven boughs give the evergreen silhouettes a natural edge.
  const boughPoints = [];
  for (let level = 0; level <= 14; level++) {
    const t = level / 14;
    boughPoints.push(new THREE.Vector2((1 - t) * (level % 2 ? 0.68 : 1), t - 0.5));
  }
  const boughGeometry = new THREE.LatheGeometry(boughPoints, 7);
  const boughPositions = boughGeometry.attributes.position;
  for (let i = 0; i < boughPositions.count; i++) {
    const scale = 0.9 + random() * 0.2;
    boughPositions.setXYZ(i, boughPositions.getX(i) * scale, boughPositions.getY(i), boughPositions.getZ(i) * scale);
  }
  boughGeometry.computeVertexNormals();
  const foliage = new THREE.InstancedMesh(boughGeometry, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1 }), count);
  const dummy = new THREE.Object3D();
  const treeColor = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const angle = random() * Math.PI * 2, offset = 12 + random() ** 1.5 * 160;
    const radius = shoreRadius(angle) + offset;
    const x = Math.cos(angle) * radius, z = Math.sin(angle) * radius;
    const y = 0.65 + offset * 0.11 + Math.max(0, offset - 10) * 0.06 * (Math.sin(x * 0.04) + Math.cos(z * 0.037));
    const h = 7 + random() * 12, w = 2.2 + random() * 2.4;
    dummy.position.set(x, y + h * 0.32, z);
    dummy.scale.set(1, h * 0.65, 1);
    dummy.updateMatrix(); trunks.setMatrixAt(i, dummy.matrix);
    treeColor.setHSL(0.29 + random() * 0.08, 0.19 + random() * 0.14, 0.16 + random() * 0.12);
    dummy.position.set(x, y + h * 0.6, z);
    dummy.scale.set(w, h, w);
    dummy.updateMatrix(); foliage.setMatrixAt(i, dummy.matrix);
    foliage.setColorAt(i, treeColor);
  }
  group.add(trunks, foliage);
  const rocks = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: '#92958a', roughness: 1 }), 90);
  for (let i = 0; i < 90; i++) {
    const angle = random() * Math.PI * 2, r = shoreRadius(angle) + random() * 4;
    dummy.position.set(Math.cos(angle) * r, 0.4, Math.sin(angle) * r);
    dummy.rotation.set(random(), random() * 6, random());
    dummy.scale.set(1 + random() * 3, 0.5 + random() * 1.4, 1 + random() * 2);
    dummy.updateMatrix(); rocks.setMatrixAt(i, dummy.matrix);
  }
  group.add(rocks);
  // Irregular ridge meshes form continuous distant mountains, with atmospheric fog.
  for (let ridge = 0; ridge < 3; ridge++) {
    const verts = [], faces = [];
    const n = 96, radius = 430 + ridge * 150;
    for (let i = 0; i <= n; i++) {
      const a = i / n * Math.PI * 2;
      const peak = 80 + ridge * 25 + 55 * Math.sin(a * 5 + ridge) ** 2 + 40 * Math.cos(a * 9 + ridge) ** 2;
      verts.push(Math.cos(a) * radius, -8, Math.sin(a) * radius);
      verts.push(Math.cos(a) * (radius + 65), peak, Math.sin(a) * (radius + 65));
      if (i < n) { const k = i * 2; faces.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.setIndex(faces); geo.computeVertexNormals();
    group.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: ['#718277', '#8a9b93', '#a4b4ad'][ridge], roughness: 1, side: THREE.DoubleSide })));
  }
  return group;
}
