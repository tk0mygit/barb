import * as THREE from 'three';

// Replace this factory with a GLTF asset without changing the simulation.
// Local forward is -Z, waterline is Y=0.
export function createBoatModel() {
  const boat = new THREE.Group();
  const hullMaterial = new THREE.MeshStandardMaterial({ color: '#e1dfce', roughness: 0.7 });
  const wood = new THREE.MeshStandardMaterial({ color: '#9e6943', roughness: 0.85 });
  const dark = new THREE.MeshStandardMaterial({ color: '#253c39', roughness: 0.5 });
  const outline = [[-1.15, 2.2], [1.15, 2.2], [1.35, -0.8], [0.75, -2.2], [0, -3.1], [-0.75, -2.2], [-1.35, -0.8]];
  const shape = new THREE.Shape(outline.map(([x, z]) => new THREE.Vector2(x, -z)));
  const hull = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.65, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.15, bevelSegments: 2, steps: 1 }), hullMaterial);
  hull.rotation.x = -Math.PI / 2;
  hull.position.y = 0.06;
  boat.add(hull);
  function box(w, h, d, x, y, z, material) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    boat.add(mesh);
    return mesh;
  }
  box(1.9, 0.09, 3.4, 0, 0.9, 0, wood);
  for (const x of [-1.12, 1.12]) box(0.13, 0.3, 3.4, x, 1.04, 0.3, dark);
  for (const z of [-0.9, 1.2]) box(2.15, 0.16, 0.5, 0, 1.16, z, wood);
  box(0.55, 0.8, 0.55, 0, 0.8, 2.55, dark);
  box(0.15, 0.8, 0.2, 0, 0.1, 2.65, dark);
  return boat;
}
