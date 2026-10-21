import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { createTerrain } from './terrain.js';
import { createWater } from './water.js';

export function createLake(scene) {
  scene.background = new THREE.Color('#b9d1cd');
  scene.fog = new THREE.FogExp2('#b9ccc3', 0.0018);
  scene.add(new THREE.HemisphereLight('#dfede9', '#5e6f4b', 2.4));
  const sunlight = new THREE.DirectionalLight('#fff0cd', 3.2);
  sunlight.position.set(-100, 140, -100);
  sunlight.castShadow = true;
  sunlight.shadow.mapSize.set(1024, 1024);
  Object.assign(sunlight.shadow.camera, { left: -25, right: 25, top: 25, bottom: -25, near: 1, far: 320 });
  sunlight.shadow.bias = -0.001;
  scene.add(sunlight, sunlight.target);
  const sky = new Sky();
  sky.scale.setScalar(2000);
  sky.material.uniforms.turbidity.value = 5;
  sky.material.uniforms.rayleigh.value = 1.4;
  sky.material.uniforms.mieCoefficient.value = 0.004;
  sky.material.uniforms.mieDirectionalG.value = 0.8;
  sky.material.uniforms.sunPosition.value.set(-100, 140, -100);
  scene.add(sky, createTerrain());
  const water = createWater();
  scene.add(water.mesh);
  return {
    update(time, boat) {
      water.update(time, boat);
      sunlight.position.set(boat.x - 100, 140, boat.z - 100);
      sunlight.target.position.set(boat.x, 0, boat.z);
    },
  };
}
