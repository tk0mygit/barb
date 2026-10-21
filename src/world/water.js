import * as THREE from 'three';

export function createWater() {
  const material = new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 }, boatPosition: { value: new THREE.Vector2() }, boatSpeed: { value: 0 } },
    vertexShader: `
      uniform float time;
      varying vec3 world;
      void main() {
        vec3 p = position;
        p.z += sin(p.x * 0.12 + time * 0.8) * cos(p.y * 0.15 + time * 0.5) * 0.09;
        vec4 w = modelMatrix * vec4(p, 1.0);
        world = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: `
      uniform float time;
      uniform vec2 boatPosition;
      uniform float boatSpeed;
      varying vec3 world;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
          mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
      }
      void main() {
        vec2 p = world.xz;
        float a = noise(p * 0.8 + vec2(time * 0.3, time * 0.15)) * 2.0 - 1.0;
        float b = noise(p * 1.2 + vec2(-time * 0.2, time * 0.2)) * 2.0 - 1.0;
        vec3 n = normalize(vec3(a * 0.09, 1.0, b * 0.09));
        vec3 eye = normalize(cameraPosition - world);
        float fresnel = pow(1.0 - max(dot(eye, n), 0.0), 3.0);
        vec3 color = mix(vec3(0.055, 0.24, 0.25), vec3(0.61, 0.75, 0.71), fresnel * 0.85);
        color += (a * b) * 0.028;
        vec3 sun = normalize(vec3(-0.5, 0.65, -0.4));
        float spec = pow(max(dot(reflect(-sun, n), eye), 0.0), 90.0);
        color += vec3(1.0, 0.9, 0.66) * spec * 0.7;
        float d = length(p - boatPosition);
        float wake = sin(d * 8.0 - time * 5.0) * exp(-d * 0.5) * min(boatSpeed / 4.0, 1.0);
        color += wake * 0.10;
        float haze = 1.0 - exp(-length(cameraPosition - world) * 0.0015);
        gl_FragColor = vec4(mix(color, vec3(0.70, 0.79, 0.75), haze), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(400, 400, 110, 110), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0;
  return { mesh, update(time, boat) { material.uniforms.time.value = time; material.uniforms.boatPosition.value.set(boat.x, boat.z); material.uniforms.boatSpeed.value = boat.speed; } };
}
