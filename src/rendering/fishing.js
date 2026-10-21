import * as THREE from 'three';
import { PHASE } from '../game/fishing.js';

export function createFishingView(scene) {
  const group = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.6, 0.7, 40), new THREE.MeshBasicMaterial({ color: '#ffe5a1', side: THREE.DoubleSide, transparent: true }));
  ring.rotation.x = -Math.PI / 2;
  const lure = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), new THREE.MeshBasicMaterial({ color: '#ffe1a0' }));
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.5, 16), new THREE.MeshBasicMaterial({ color: '#173d37', transparent: true, opacity: 0.65, side: THREE.DoubleSide }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.scale.set(0.6, 1.5, 1);
  const positions = new Float32Array(6);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: '#f0e8c9', transparent: true, opacity: 0.65 }));
  line.frustumCulled = false;
  group.add(ring, lure, shadow, line);
  scene.add(group);
  return {
    update(fishing, active, elapsed) {
      const s = fishing.state;
      group.visible = active && ![PHASE.READY, PHASE.RESULT, PHASE.FAILED].includes(s.phase);
      if (!group.visible) return;
      let x = s.origin.x + Math.sin(s.heading) * s.distance;
      let z = s.origin.z - Math.cos(s.heading) * s.distance;
      let y = 0.15 + Math.sin(elapsed * 7) * 0.035;
      if (s.phase === PHASE.CAST) {
        const t = Math.min(1, s.time / fishing.settings.flightSeconds);
        x = THREE.MathUtils.lerp(s.origin.x, s.target.x, t);
        z = THREE.MathUtils.lerp(s.origin.z, s.target.z, t);
        y = 2 * (1 - t) + Math.sin(t * Math.PI) * 4;
      }
      lure.position.set(x, y + (s.action > 0 ? Math.abs(Math.sin(elapsed * 18)) * 0.35 : 0), z);
      lure.visible = s.phase !== PHASE.AIM && s.phase !== PHASE.LANDING;
      ring.position.set(x, 0.12, z);
      const splash = s.phase === PHASE.LANDING || (s.phase === PHASE.LURE && s.time < 0.8);
      ring.scale.setScalar(splash ? 1 + s.time * 2 : s.phase === PHASE.BITE ? 1.5 + Math.sin(elapsed * 22) * 0.4 : 1);
      ring.material.opacity = splash ? Math.max(0, 1 - s.time / 1.2) : 0.8;
      ring.material.color.set(s.phase === PHASE.BITE ? '#ffb86c' : s.validCast ? '#ffe5a1' : '#ff6655');
      shadow.visible = s.phase === PHASE.FIGHT;
      shadow.position.set(x, 0.11, z);
      line.visible = s.phase !== PHASE.AIM;
      positions.set([s.origin.x + 0.4, 2, s.origin.z - 0.4, x, y, z]);
      geometry.attributes.position.needsUpdate = true;
    },
  };
}
