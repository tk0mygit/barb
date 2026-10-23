import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { createTerrain } from './terrain.js';
import { createWater } from './water.js';
import { createEnvironmentParameters, INITIAL_DAY_CLOCK, sampleDayNight } from './day-night.js';
import { sampleNightFog } from './night-fog.js';

const hazeDensity = 0.0018, nightFogDensity = 0.0052;

export function createLake(scene) {
  scene.background = new THREE.Color('#b9d1cd');
  scene.fog = new THREE.FogExp2('#b9ccc3', hazeDensity);
  const nightFogColor = new THREE.Color('#53646f');
  const ambient = new THREE.HemisphereLight('#dfede9', '#5e6f4b', 2.4);
  scene.add(ambient);
  const sunlight = new THREE.DirectionalLight('#fff0cd', 3.2);
  sunlight.position.set(-100, 140, -100);
  sunlight.castShadow = true;
  sunlight.shadow.mapSize.set(1024, 1024);
  Object.assign(sunlight.shadow.camera, { left: -25, right: 25, top: 25, bottom: -25, near: 1, far: 320 });
  sunlight.shadow.bias = -0.001;
  scene.add(sunlight, sunlight.target);
  // Only the existing sun casts a shadow. Moonlight adds no shadow map/pass.
  const moonlight = new THREE.DirectionalLight('#b8cdee', 0.55);
  scene.add(moonlight, moonlight.target);
  const sky = new Sky();
  sky.scale.setScalar(2000);
  sky.material.uniforms.turbidity.value = 5;
  sky.material.uniforms.rayleigh.value = 1.4;
  sky.material.uniforms.mieCoefficient.value = 0.004;
  sky.material.uniforms.mieDirectionalG.value = 0.8;
  sky.material.uniforms.sunPosition.value.set(-100, 140, -100);
  // Retain Sky's daylight scattering and sun disc; blend in a simple blue
  // night gradient before its existing tone mapping and color conversion.
  Object.assign(sky.material.uniforms, {
    skyDaylight: { value: 1 }, nightTop: { value: new THREE.Color('#080f25') },
    nightHorizon: { value: new THREE.Color('#283e50') },
    nightFogStrength: { value: 0 }, nightFogColor: { value: new THREE.Color() },
  });
  sky.material.fragmentShader = `uniform float skyDaylight;
    uniform vec3 nightTop;
    uniform vec3 nightHorizon;
    uniform float nightFogStrength;
    uniform vec3 nightFogColor;
    ${sky.material.fragmentShader}`.replace('gl_FragColor = vec4( texColor, 1.0 );', `
      vec3 nightColor = mix(nightHorizon, nightTop, smoothstep(0.0, 0.65, direction.y));
      gl_FragColor = vec4(mix(nightColor, texColor, skyDaylight), 1.0);`)
    .replace('#include <colorspace_fragment>', `#include <colorspace_fragment>
      // Meet the scene fog at the horizon in the same output color space.
      gl_FragColor.rgb = mix(gl_FragColor.rgb, linearToOutputTexel(vec4(nightFogColor, 1.0)).rgb,
        nightFogStrength * (1.0 - smoothstep(0.0, 0.25, direction.y)));`);
  const moon = new THREE.Mesh(new THREE.SphereGeometry(6, 16, 12),
    new THREE.MeshBasicMaterial({ color: '#d9e3ee', transparent: true, fog: false, depthWrite: false }));
  moon.name = 'moon';
  scene.add(moon);
  scene.add(sky, createTerrain());
  const water = createWater(scene.fog);
  scene.add(water.mesh);
  const environment = createEnvironmentParameters();
  const nightFog = {};
  const sunDirection = new THREE.Vector3(), moonDirection = new THREE.Vector3();
  return {
    update(time, boat, clock = INITIAL_DAY_CLOCK) {
      sampleDayNight(clock, environment);
      sampleNightFog(clock, nightFog);
      ambient.color.fromArray(environment.ambientSky);
      ambient.groundColor.fromArray(environment.ambientGround);
      ambient.intensity = environment.ambientIntensity;
      sunlight.color.fromArray(environment.sunColor);
      sunlight.intensity = environment.sunIntensity;
      moonlight.intensity = environment.moonIntensity;
      sunDirection.fromArray(environment.sunDirection);
      moonDirection.fromArray(environment.moonDirection);
      sunlight.position.copy(sunDirection).multiplyScalar(200);
      sunlight.position.x += boat.x; sunlight.position.z += boat.z;
      sunlight.target.position.set(boat.x, 0, boat.z);
      moonlight.position.copy(moonDirection).multiplyScalar(200);
      moonlight.position.x += boat.x; moonlight.position.z += boat.z;
      moonlight.target.position.copy(sunlight.target.position);
      sky.position.set(boat.x, 0, boat.z);
      sky.material.uniforms.sunPosition.value.copy(sunDirection).multiplyScalar(450000);
      sky.material.uniforms.skyDaylight.value = environment.skyDaylight;
      sky.material.uniforms.nightTop.value.fromArray(environment.skyTop);
      sky.material.uniforms.nightHorizon.value.fromArray(environment.horizon);
      scene.fog.color.fromArray(environment.horizon).lerp(nightFogColor, nightFog.intensity * 0.45);
      scene.fog.density = hazeDensity + (nightFogDensity - hazeDensity) * nightFog.intensity;
      sky.material.uniforms.nightFogStrength.value = nightFog.intensity;
      sky.material.uniforms.nightFogColor.value.copy(scene.fog.color);
      scene.background.copy(scene.fog.color);
      moon.position.copy(moonDirection).multiplyScalar(900);
      moon.position.x += boat.x; moon.position.z += boat.z;
      moon.material.opacity = environment.moonOpacity;
      moon.visible = environment.moonOpacity > 0;
      water.update(time, boat, environment);
    },
  };
}
