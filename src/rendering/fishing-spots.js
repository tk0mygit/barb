import * as THREE from 'three';
import { FISHING_SPOTS } from '../world/fishing-spots.js';

export function createFishingSpotsView(scene) {
  const centreGeometry = new THREE.RingGeometry(2.8, 3.05, 40);
  const rangeGeometry = new THREE.RingGeometry(0.994, 1, 64);
  const group = new THREE.Group();
  group.name = 'fishing-spots';
  const markers = FISHING_SPOTS.map(spot => {
    const material = new THREE.MeshBasicMaterial({ color: '#eee1ad', transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide });
    const centre = new THREE.Mesh(centreGeometry, material);
    const range = new THREE.Mesh(rangeGeometry, material.clone());
    range.material.opacity = 0.2;
    range.scale.setScalar(spot.radius);
    for (const mesh of [centre, range]) {
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(spot.x, 0.13, spot.z); // above the existing ±0.09m waves
      mesh.name = `${spot.id}-${mesh === centre ? 'centre' : 'range'}`;
      group.add(mesh);
    }
    return { id: spot.id, centre, range };
  });
  scene.add(group);
  let previousId;
  return {
    update(activeId) {
      if (previousId === activeId) return;
      previousId = activeId;
      for (const marker of markers) {
        const active = marker.id === activeId;
        marker.centre.material.opacity = active ? 0.8 : 0.5;
        marker.range.material.opacity = active ? 0.4 : 0.2;
      }
    },
  };
}
