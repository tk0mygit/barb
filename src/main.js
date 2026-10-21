import * as THREE from 'three';
import './ui/style.css';
import { createLake } from './world/lake.js';
import { createBoatState, stepBoat, enterFishing, leaveFishing } from './game/boat.js';
import { createBoatModel } from './rendering/boat-model.js';
import { createCameraRig } from './rendering/camera.js';
import { createControls } from './input/controls.js';
import { createHUD } from './ui/hud.js';

const canvas = document.querySelector('#scene');
function showError(message) {
  document.querySelector('#status').hidden = true;
  const error = document.querySelector('#error');
  error.textContent = message;
  error.hidden = false;
  document.querySelector('#fish-button').disabled = true;
}
try {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 2400);
  const boat = createBoatState();
  const model = createBoatModel();
  scene.add(model);
  const lake = createLake(scene);
  const controls = createControls(canvas, document.querySelector('#joystick'), document.querySelector('#joystick-knob'));
  const rig = createCameraRig(camera, boat);
  function changeMode(mode) {
    if (mode === 'fishing') { if (!enterFishing(boat)) return; }
    else leaveFishing(boat);
    controls.setMode(boat.mode);
    canvas.focus({ preventScroll: true });
  }
  const hud = createHUD({ onFish: () => changeMode('fishing'), onReturn: () => changeMode('sailing') });
  window.addEventListener('keydown', event => { if (event.code === 'Escape' && boat.mode === 'fishing') changeMode('sailing'); });
  function resize() {
    const width = window.innerWidth, height = window.innerHeight;
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();
  let previous = performance.now(), elapsed = 0;
  document.addEventListener('visibilitychange', () => { previous = performance.now(); });
  renderer.setAnimationLoop(now => {
    const dt = Math.min((now - previous) / 1000, 0.25);
    previous = now;
    if (document.hidden) return;
    elapsed += dt;
    const input = controls.read(dt);
    // Substeps preserve real-time braking on slow devices without large collision steps.
    const steps = Math.max(1, Math.ceil(dt / 0.05));
    for (let i = 0; i < steps; i++) stepBoat(boat, input, dt / steps);
    model.position.set(boat.x, Math.sin(elapsed * 1.5) * 0.045, boat.z);
    model.rotation.set(Math.sin(elapsed * 1.3) * 0.008, -boat.heading, Math.cos(elapsed * 1.4) * 0.014);
    // Three.js local -Z forward rotates with a negative yaw for our heading convention.
    rig.update(dt, input);
    lake.update(elapsed, boat);
    hud.update(boat);
    renderer.render(scene, camera);
    hud.ready();
  });
  canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); renderer.setAnimationLoop(null); showError('描画が中断されました。ページを再読み込みしてください。'); });
} catch (error) {
  console.error(error);
  showError('3D表示を開始できませんでした。WebGL 2対応のブラウザで、ハードウェアアクセラレーションを有効にしてください。');
}
