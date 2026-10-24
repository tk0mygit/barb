import * as THREE from 'three';
import { sampleNightFog } from './night-fog.js';

export const SURFACE_FOG_CONFIG = Object.freeze({ heights: Object.freeze([0.28, 0.85, 1.42]), size: 400, segments: 32, periodSeconds: 3600 });

// Three low, gently deformed sheets share one geometry/material. Depth testing
// clips against boats/shore; soft world-space density has no billboard edges.
export function createSurfaceFog() {
  const group = new THREE.Group(); group.name = 'surface-fog'; group.visible = false;
  const geometry = new THREE.PlaneGeometry(SURFACE_FOG_CONFIG.size, SURFACE_FOG_CONFIG.size, SURFACE_FOG_CONFIG.segments, SURFACE_FOG_CONFIG.segments);
  const nightFog = {};
  const material = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide, forceSinglePass: true, toneMapped: false,
    uniforms: { fogTime: { value: 0 }, fogDrift: { value: new THREE.Vector2() }, fogAmount: { value: 0 }, fogOpacityScale: { value: 1 }, fogTint: { value: new THREE.Color() }, boatPosition: { value: new THREE.Vector2() } },
    vertexShader: `
      uniform float fogTime;
      varying vec3 world;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        float phase = fogTime * 0.00174532925;
        w.y += sin(w.x * 0.045 + phase) * cos(w.z * 0.037 - phase * 2.0) * 0.11;
        world = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: `
      uniform float fogTime;
      uniform float fogAmount;
      uniform float fogOpacityScale;
      uniform vec2 fogDrift;
      uniform vec3 fogTint;
      uniform vec2 boatPosition;
      varying vec3 world;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
      }
      void main() {
        float nearBoat = smoothstep(5.5, 11.0, length(world.xz - boatPosition));
        float edge = 1.0 - smoothstep(164.0, 194.0, length(world.xz));
        // Fade out before distant sheets compress into subpixel horizon bands.
        float localRange = 1.0 - smoothstep(18.0, 52.0, length(world.xz - cameraPosition.xz));
        float support = nearBoat * edge * localRange;
        if (support <= 0.0) discard;
        vec2 p = world.xz + fogDrift;
        float broad = noise(p * vec2(0.045, 0.055) + world.y * vec2(2.3, 1.1));
        float wisps = noise(p * vec2(0.10, 0.28) + broad * 1.8 + world.y * vec2(-1.7, 2.9));
        float cloud = smoothstep(0.43, 0.70, broad) * smoothstep(0.40, 0.68, wisps);
        // Open gaps between broad patches and narrow strands preserve locality.
        // Bound the surface veil in dense fog; distance fog owns attenuation.
        float alpha = cloud * support * fogAmount * fogOpacityScale * 0.45;
        vec3 mistTint = fogTint * 1.45 + vec3(0.008, 0.010, 0.012);
        gl_FragColor = vec4(mistTint, alpha);
        #include <colorspace_fragment>
      }`,
  });
  for (const height of SURFACE_FOG_CONFIG.heights) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2; mesh.position.y = height; mesh.renderOrder = 2;
    group.add(mesh);
  }
  return {
    group,
    update(clock, boat, amount, color) {
      group.visible = amount > 0;
      const time = clock.elapsedSeconds % SURFACE_FOG_CONFIG.periodSeconds;
      material.uniforms.fogTime.value = time;
      // Identical wind for all fragments/layers; compute once per clock sample.
      const phase = time * (2 * Math.PI / SURFACE_FOG_CONFIG.periodSeconds);
      material.uniforms.fogDrift.value.set(Math.sin(phase) * 34, Math.cos(phase) * 22);
      material.uniforms.fogAmount.value = amount;
      // Cap the target, not the live envelope: keep all 12s of the shared fade.
      sampleNightFog(clock, nightFog);
      material.uniforms.fogOpacityScale.value = nightFog.targetFogAmount > 0 ? Math.min(1, 0.7 / nightFog.targetFogAmount) : 1;
      material.uniforms.fogTint.value.copy(color);
      material.uniforms.boatPosition.value.set(boat.x, boat.z);
    },
    dispose() { geometry.dispose(); material.dispose(); group.removeFromParent(); },
  };
}
