import * as THREE from 'three';
import { PHASE, getLurePosition } from '../game/fishing.js';
import { nearRingExpansion } from './fishing-visuals.js';
import { createLureModel } from './lure-models.js';

export function createFishingView(scene, camera) {
  const group = new THREE.Group();
  group.visible = false;
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.6, 0.7, 40), new THREE.MeshBasicMaterial({ color: '#ffe5a1', side: THREE.DoubleSide, transparent: true, depthTest: false, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2;
  const lureModel = createLureModel();
  const lure = lureModel.mesh;
  // These world-position guides remain readable over the nearby boat. Draw
  // after water/boat, before the existing surface-fog layer (renderOrder 2).
  // Their normal material fog remains enabled, and DOM HUD stays above them.
  ring.renderOrder = lure.renderOrder = 1;
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.5, 16), new THREE.MeshBasicMaterial({ color: '#173d37', transparent: true, opacity: 0.65, side: THREE.DoubleSide }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.scale.set(0.6, 1.5, 1);
  const positions = new Float32Array(6);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: '#f0e8c9', transparent: true, opacity: 0.65 }));
  line.name = 'fishing-line';
  line.frustumCulled = false;
  group.add(ring, lure, shadow, line);
  scene.add(group);
  const point = new THREE.Vector3();
  const lineOrigin = new THREE.Vector3();
  return {
    getScreenBounds(camera, { width, height }) {
      if (!group.visible) return null;
      camera.updateMatrixWorld();
      group.updateWorldMatrix(true, true);
      const bounds = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
      for (const mesh of [ring, lure]) {
        if (!mesh.visible) continue;
        const vertices = mesh.geometry.attributes.position;
        for (let i = 0; i < vertices.count; i++) {
          point.fromBufferAttribute(vertices, i).applyMatrix4(mesh.matrixWorld).project(camera);
          const x = (point.x + 1) * width / 2, y = (1 - point.y) * height / 2;
          bounds.left = Math.min(bounds.left, x); bounds.right = Math.max(bounds.right, x);
          bounds.top = Math.min(bounds.top, y); bounds.bottom = Math.max(bounds.bottom, y);
        }
      }
      return Number.isFinite(bounds.left) ? bounds : null;
    },
    update(fishing, active, elapsed) {
      const s = fishing.state;
      lureModel.select(s.lureId);
      group.visible = active && ![PHASE.READY, PHASE.RESULT, PHASE.FAILED].includes(s.phase);
      if (!group.visible) return;
      let { x, z } = getLurePosition(s);
      let y = 0.15 + Math.sin(elapsed * 7) * 0.035;
      if (s.phase === PHASE.CAST) {
        const t = Math.min(1, s.time / fishing.settings.flightSeconds);
        x = THREE.MathUtils.lerp(s.origin.x, s.target.x, t);
        z = THREE.MathUtils.lerp(s.origin.z, s.target.z, t);
        // Keep the existing long-cast arc, but flatten its visual height for
        // short casts. Flight time and the actual water target are unchanged.
        y = 2 * (1 - t) + Math.sin(t * Math.PI) * Math.min(4, s.distance * 0.18);
      }
      lure.position.set(x, y + (s.action > 0 ? Math.abs(Math.sin(elapsed * 18)) * 0.35 : 0), z);
      // Show a readable three-quarter profile, following the cast/retrieval ray.
      lure.rotation.y = -s.heading + Math.PI / 3;
      lure.visible = s.phase !== PHASE.AIM && s.phase !== PHASE.LANDING;
      // The water marker remains at the predicted landing point throughout
      // flight; it must not travel through the near-boat area with the lure.
      ring.position.set(s.phase === PHASE.CAST ? s.target.x : x, 0.12, s.phase === PHASE.CAST ? s.target.z : z);
      const splash = s.phase === PHASE.LANDING || (s.phase === PHASE.LURE && s.time < 0.8);
      const expansion = nearRingExpansion(s.distance, fishing.settings.landingDistance);
      ring.scale.setScalar(splash ? 1 + s.time * 2 * (s.phase === PHASE.LANDING ? 1 : expansion) : s.phase === PHASE.BITE ? 1 + (0.5 + Math.sin(elapsed * 22) * 0.4) * expansion : 1);
      ring.material.opacity = splash ? Math.max(0, 1 - s.time / 1.2) : 0.8;
      ring.material.color.set(s.phase === PHASE.BITE ? '#ffb86c' : s.validCast ? '#ffe5a1' : '#ff6655');
      shadow.visible = s.phase === PHASE.FIGHT;
      shadow.position.set(x, 0.11, z);
      line.visible = s.phase !== PHASE.AIM;
      // A virtual rod tip in the camera's 3D view volume, one metre ahead.
      // Scale with its frustum so yaw, tracking and aspect changes preserve a
      // natural slightly-right-of-centre projection (58%, 57%) on every screen.
      camera.updateMatrixWorld();
      const halfHeight = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / camera.zoom;
      lineOrigin.set(0.16 * halfHeight * camera.aspect, -0.14 * halfHeight, -1).applyMatrix4(camera.matrixWorld);
      lineOrigin.toArray(positions, 0);
      lure.position.toArray(positions, 3);
      geometry.attributes.position.needsUpdate = true;
    },
  };
}
