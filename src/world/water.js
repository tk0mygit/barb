import * as THREE from 'three';
import { INITIAL_DAY_CLOCK, sampleDayNight } from './day-night.js';

export function createWater(fog = new THREE.FogExp2('#b9ccc3', 0.0018)) {
  const initial = sampleDayNight(INITIAL_DAY_CLOCK);
  const material = new THREE.ShaderMaterial({
    fog: true,
    uniforms: {
      time: { value: 0 }, boatPosition: { value: new THREE.Vector2() }, boatSpeed: { value: 0 },
      deepColor: { value: new THREE.Color() }, reflectionColor: { value: new THREE.Color() },
      sunDirection: { value: new THREE.Vector3() }, moonDirection: { value: new THREE.Vector3() },
      sunColor: { value: new THREE.Color() }, moonColor: { value: new THREE.Color('#b8cdee') },
      sunHighlight: { value: 0 }, moonHighlight: { value: 0 }, waterDetail: { value: 1 },
      fogColor: { value: fog.color.clone() }, fogDensity: { value: fog.density },
    },
    vertexShader: `
      uniform float time;
      varying vec3 world;
      #include <fog_pars_vertex>
      void main() {
        vec3 p = position;
        p.z += sin(p.x * 0.12 + time * 0.8) * cos(p.y * 0.15 + time * 0.5) * 0.09;
        vec4 w = modelMatrix * vec4(p, 1.0);
        world = w.xyz;
        vec4 mvPosition = viewMatrix * w;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
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
      #include <fog_pars_fragment>
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
        float distanceToEye = length(cameraPosition.xz - p);
        // Broad wind ripples retain a quiet surface. Attenuate small normals
        // before they compress into shimmering pixels near the far bank.
        float detail = 1.0 - smoothstep(24.0, 180.0, distanceToEye);
        float broad = noise(p * 0.035 + vec2(time * 0.018, -time * 0.012));
        // Reuse the fine field to bend wave fronts, avoiding a fourth noise
        // evaluation over the lake's large screen area.
        float grain = noise(p * 0.28 + vec2(time * 0.08, time * 0.04)) * 2.0 - 1.0;
        float drift = broad * 2.0 + grain * 0.8;
        float a = sin(dot(p, vec2(0.68, 0.31)) + time * 0.75 + drift) * 0.55
          + grain * 0.45;
        float b = sin(dot(p, vec2(-0.24, 0.92)) - time * 0.63 + drift) * 0.4
          + (noise(p * 0.37 + vec2(-time * 0.05, time * 0.06)) * 2.0 - 1.0) * 0.6;
        vec3 n = normalize(vec3(a * 0.055, 1.0, b * 0.055) * vec3(0.35 + detail * 0.65, 1.0, 0.35 + detail * 0.65));
        vec3 eye = normalize(cameraPosition - world);
        float fresnel = pow(1.0 - max(dot(eye, n), 0.0), 3.0);
        vec3 bodyColor = deepColor * vec3(0.72, 0.82, 0.78);
        vec3 color = mix(bodyColor, reflectionColor * 0.9, fresnel * 0.82);
        color *= 0.97 + broad * 0.06;
        color += (a * b) * 0.009 * detail * waterDetail;
        float sunSpec = pow(max(dot(reflect(-sunDirection, n), eye), 0.0), 90.0);
        float moonSpec = pow(max(dot(reflect(-moonDirection, n), eye), 0.0), 90.0);
        color += sunColor * sunSpec * sunHighlight + moonColor * moonSpec * moonHighlight;
        float d = length(p - boatPosition);
        float wake = sin(d * 8.0 - time * 5.0) * exp(-d * 0.5) * min(boatSpeed / 4.0, 1.0);
        color += wake * 0.10 * waterDetail;
        gl_FragColor = vec4(max(color, vec3(0.0)), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
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
    // Keep these correct before the first render too. Three.js then uploads
    // fogColor in its output color space, just as for the terrain materials.
    u.fogColor.value.copy(fog.color);
    u.fogDensity.value = fog.density;
  } };
}
