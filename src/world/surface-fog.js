import * as THREE from 'three';

export const SURFACE_FOG_CONFIG = Object.freeze({ heights: Object.freeze([0.28, 0.72, 1.16]), size: 400, segments: 32, periodSeconds: 3600 });

// Three low, gently deformed sheets share one geometry/material. Depth testing
// clips against boats/shore; soft world-space density has no billboard edges.
export function createSurfaceFog() {
  const group = new THREE.Group(); group.name = 'surface-fog'; group.visible = false;
  const geometry = new THREE.PlaneGeometry(SURFACE_FOG_CONFIG.size, SURFACE_FOG_CONFIG.size, SURFACE_FOG_CONFIG.segments, SURFACE_FOG_CONFIG.segments);
  const material = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide, forceSinglePass: true, toneMapped: false,
    uniforms: { fogTime: { value: 0 }, fogAmount: { value: 0 }, fogTint: { value: new THREE.Color() }, boatPosition: { value: new THREE.Vector2() } },
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
      uniform vec3 fogTint;
      uniform vec2 boatPosition;
      varying vec3 world;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
      }
      void main() {
        float phase = fogTime * 0.00174532925;
        vec2 drift = vec2(sin(phase), cos(phase)) * vec2(34.0, 22.0);
        vec2 p = world.xz + drift;
        float broad = noise(p * 0.055 + world.y * 0.37);
        float wisps = noise(p * vec2(0.11, 0.28) + broad * 1.8);
        float cloud = smoothstep(0.35, 0.72, broad * 0.55 + wisps * 0.45);
        float nearBoat = smoothstep(4.5, 9.0, length(world.xz - boatPosition));
        float edge = 1.0 - smoothstep(164.0, 194.0, length(world.xz));
        // Keep surface scattering faint: the calibrated distance fog supplies
        // the visibility loss, while these localized wisps reveal its height.
        float alpha = cloud * nearBoat * edge * fogAmount * 0.06;
        gl_FragColor = vec4(fogTint, alpha);
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
      material.uniforms.fogTime.value = clock.elapsedSeconds % SURFACE_FOG_CONFIG.periodSeconds;
      material.uniforms.fogAmount.value = amount;
      material.uniforms.fogTint.value.copy(color);
      material.uniforms.boatPosition.value.set(boat.x, boat.z);
    },
    dispose() { geometry.dispose(); material.dispose(); group.removeFromParent(); },
  };
}
