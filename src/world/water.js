import * as THREE from 'three';
import { INITIAL_DAY_CLOCK, sampleDayNight } from './day-night.js';

export function createWater(fog = new THREE.FogExp2('#b9ccc3', 0.0018)) {
  const initial = sampleDayNight(INITIAL_DAY_CLOCK);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 }, boatPosition: { value: new THREE.Vector2() }, boatSpeed: { value: 0 },
      deepColor: { value: new THREE.Color() }, reflectionColor: { value: new THREE.Color() },
      sunDirection: { value: new THREE.Vector3() }, moonDirection: { value: new THREE.Vector3() },
      sunColor: { value: new THREE.Color() }, moonColor: { value: new THREE.Color('#b8cdee') },
      sunHighlight: { value: 0 }, moonHighlight: { value: 0 }, waterDetail: { value: 1 },
      fogColor: { value: fog.color }, fogDensity: { value: fog.density },
    },
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
      uniform vec3 deepColor;
      uniform vec3 reflectionColor;
      uniform vec3 sunDirection;
      uniform vec3 moonDirection;
      uniform vec3 sunColor;
      uniform vec3 moonColor;
      uniform float sunHighlight;
      uniform float moonHighlight;
      uniform float waterDetail;
      uniform vec3 fogColor;
      uniform float fogDensity;
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
        vec3 color = mix(deepColor, reflectionColor, fresnel * 0.85);
        color += (a * b) * 0.028 * waterDetail;
        float sunSpec = pow(max(dot(reflect(-sunDirection, n), eye), 0.0), 90.0);
        float moonSpec = pow(max(dot(reflect(-moonDirection, n), eye), 0.0), 90.0);
        color += sunColor * sunSpec * sunHighlight + moonColor * moonSpec * moonHighlight;
        float d = length(p - boatPosition);
        float wake = sin(d * 8.0 - time * 5.0) * exp(-d * 0.5) * min(boatSpeed / 4.0, 1.0);
        color += wake * 0.10 * waterDetail;
        float distanceToEye = length(cameraPosition - world);
        float haze = 1.0 - exp(-distanceToEye * distanceToEye * fogDensity * fogDensity);
        gl_FragColor = vec4(mix(max(color, vec3(0.0)), fogColor, haze), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(400, 400, 110, 110), material);
  mesh.name = 'lake-water';
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0;
  return { mesh, update(time, boat, environment = initial) {
    const u = material.uniforms;
    u.time.value = time;
    u.boatPosition.value.set(boat.x, boat.z);
    u.boatSpeed.value = boat.speed;
    u.deepColor.value.fromArray(environment.waterDeep);
    u.reflectionColor.value.fromArray(environment.waterReflection);
    u.sunColor.value.fromArray(environment.sunColor);
    u.sunDirection.value.fromArray(environment.sunDirection);
    u.moonDirection.value.fromArray(environment.moonDirection);
    u.sunHighlight.value = environment.sunHighlight;
    u.moonHighlight.value = environment.moonHighlight;
    u.waterDetail.value = environment.waterDetail;
  } };
}
