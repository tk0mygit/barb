import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { DEFAULT_LURE_ID, LURES } from '../game/lures.js';

// Rotation-independent envelope, shared with the cast safety projection.
// Metres in model space; bob/action translation is applied by the view.
export const LURE_ENVELOPE = Object.freeze({ radius: 0.29, minY: -0.105, maxY: 0.112 });
// The upper fin / blade occupies a narrower radius than the main body. Two
// boxes retain the real silhouette without reserving empty upper corners that
// would unnecessarily displace notices on a small screen.
export const LURE_FOOTPRINT_ENVELOPES = Object.freeze([
  Object.freeze({ radius: 0.29, minY: -0.105, maxY: 0.09 }),
  Object.freeze({ radius: 0.20, minY: 0.09, maxY: 0.112 }),
]);

function buildGeometry(id) {
  const parts = [];
  function add(geometry, color, position = [0, 0, 0], scale = [1, 1, 1]) {
    geometry.scale(...scale).translate(...position);
    const flat = geometry.index ? geometry.toNonIndexed() : geometry;
    if (flat !== geometry) geometry.dispose();
    // Position and vertex colour are all the unlit, fog-aware material needs.
    flat.deleteAttribute('normal'); flat.deleteAttribute('uv');
    const rgb = new THREE.Color(color), colors = new Float32Array(flat.attributes.position.count * 3);
    for (let i = 0; i < colors.length; i += 3) rgb.toArray(colors, i);
    flat.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    parts.push(flat);
  }
  function body(profile, color, width = 1, segments = 8) {
    // A faceted, tapered body along local -Z (head). No imported assets.
    const geometry = new THREE.LatheGeometry(profile.map(([z, radius]) => new THREE.Vector2(radius, z)), segments);
    geometry.rotateX(Math.PI / 2).scale(width, 1, 1);
    add(geometry, color);
  }
  function tube(points, radius, color, segments = 10) {
    add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p))), segments, radius, 4, false), color);
  }
  function fin(points, color, thickness = 0.008) {
    const shape = new THREE.Shape(points.map(([z, y]) => new THREE.Vector2(z, y)));
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, steps: 1 });
    geometry.rotateY(-Math.PI / 2).translate(thickness / 2, 0, 0);
    add(geometry, color);
  }
  if (id === 'minnow') {
    body([[-0.26, 0], [-0.22, 0.055], [-0.10, 0.075], [0.10, 0.045], [0.22, 0]], '#e6cf89', 0.75, 6);
    fin([[0.19, 0], [0.30, 0.085], [0.27, 0], [0.30, -0.085]], '#cf7654');
    fin([[-0.07, 0.055], [0.07, 0.13], [0.11, 0.04]], '#557d76');
    // The eye on the visible flank makes the broad head unambiguous.
    add(new THREE.OctahedronGeometry(0.017), '#172d2c', [-0.039, 0.025, -0.20]);
    for (const x of [-0.055, 0.055]) {
      const pectoral = new THREE.PlaneGeometry(0.055, 0.07);
      pectoral.rotateX(-Math.PI / 2);
      add(pectoral, '#cfb36e', [x, -0.015, -0.03]);
    }
  } else if (id === 'crankbait') {
    body([[-0.18, 0], [-0.14, 0.09], [-0.02, 0.12], [0.12, 0.08], [0.17, 0]], '#d8a14e', 0.85);
    const lip = new THREE.BoxGeometry(0.13, 0.018, 0.18);
    lip.rotateX(-0.35);
    add(lip, '#c1e0d1', [0, -0.025, -0.235]);
    add(new THREE.OctahedronGeometry(0.021), '#24312e', [-0.068, 0.04, -0.12]);
  } else if (id === 'worm') {
    tube([[0.01, 0, -0.29], [-0.055, 0.015, -0.18], [-0.06, 0.025, -0.04],
      [0.07, 0.01, 0.10], [0.08, 0.03, 0.22], [-0.015, 0.05, 0.30]], 0.037, '#b483ae', 18);
    // The thin curled end reads as soft plastic even in silhouette.
    tube([[-0.015, 0.05, 0.30], [-0.10, 0.05, 0.29], [-0.115, 0.045, 0.23]], 0.018, '#b483ae', 6);
  } else if (id === 'spinnerbait') {
    tube([[0, -0.035, 0.01], [0, 0.08, -0.20], [0, 0.20, 0.02], [0, 0.19, 0.17]], 0.012, '#d6dfd2', 8);
    add(new THREE.OctahedronGeometry(1), '#e8d293', [0, 0.19, 0.13], [0.072, 0.036, 0.10]);
    add(new THREE.OctahedronGeometry(1), '#df9b4e', [0, -0.025, 0], [0.05, 0.048, 0.085]);
    for (let i = 0; i < 7; i++) {
      const a = i * Math.PI * 2 / 7;
      tube([[0, -0.025, 0.035], [Math.cos(a) * 0.07, -0.025 + Math.sin(a) * 0.04, 0.15],
        [Math.cos(a) * 0.11, -0.025 + Math.sin(a) * 0.06, 0.29]], 0.009, i % 2 ? '#d5c77c' : '#9bba8a', 4);
    }
  } else throw new Error(`Unknown lure model: ${id}`);
  const geometry = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  // Keep even the flight's first frame inside a narrow portrait frustum.
  geometry.scale(0.85, id === 'spinnerbait' ? 0.48 : 0.85, 0.85);
  geometry.type = 'LureGeometry';
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
}

export function createLureModel() {
  const geometries = new Map(LURES.map(({ id }) => [id, buildGeometry(id)]));
  const material = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, depthTest: false, depthWrite: false });
  const mesh = new THREE.Mesh(geometries.get(DEFAULT_LURE_ID), material);
  mesh.name = 'fishing-lure';
  mesh.userData.lureId = DEFAULT_LURE_ID;
  mesh.renderOrder = 1;
  return {
    mesh,
    select(id) {
      if (id === mesh.userData.lureId) return;
      const geometry = geometries.get(id);
      if (!geometry) throw new Error(`Unknown lure model: ${id}`);
      mesh.geometry = geometry;
      mesh.userData.lureId = id;
    },
  };
}
