import * as THREE from 'three';
import './ui/style.css';
import { createLake } from './world/lake.js';
import { createBoatState, stepBoat, enterFishing, leaveFishing } from './game/boat.js';
import { createBoatModel } from './rendering/boat-model.js';
import { createCameraRig } from './rendering/camera.js';
import { createControls } from './input/controls.js';
import { createHUD } from './ui/hud.js';
import { createFishing, PHASE } from './game/fishing.js';
import { createFishingInput } from './input/fishing.js';
import { createFishingView } from './rendering/fishing.js';
import { createFishingHUD } from './ui/fishing-hud.js';
import { createFishingAudio } from './ui/fishing-audio.js';
import { shoreRadius } from './world/config.js';
import { getFishingSpotStatus } from './game/fishing-spots.js';
import { createFishingSpotsView } from './rendering/fishing-spots.js';
import { createFishingSpotsHUD } from './ui/fishing-spots-hud.js';

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
  const fishing = createFishing({ isWater: (x, z) => Math.hypot(x, z) < shoreRadius(Math.atan2(z, x)) - 2, getBoatPosition: () => boat });
  const spotsView = createFishingSpotsView(scene);
  const spotsHUD = createFishingSpotsHUD();
  const fishingInput = createFishingInput(fishing);
  const controls = createControls(canvas, document.querySelector('#joystick'), document.querySelector('#joystick-knob'), {
    input: fishingInput, canLook: () => fishing.state.phase === PHASE.READY,
  });
  const fishingView = createFishingView(scene);
  const audio = createFishingAudio();
  document.addEventListener('pointerdown', () => audio.unlock(), { passive: true });
  const rig = createCameraRig(camera, boat);
  function changeMode(mode) {
    if (mode === 'fishing') { if (!enterFishing(boat)) return; }
    else {
      if (!fishing.canLeave()) return;
      fishing.reset();
      leaveFishing(boat);
    }
    controls.setMode(boat.mode);
    canvas.focus({ preventScroll: true });
  }
  const hud = createHUD({ onFish: () => changeMode('fishing'), onReturn: () => changeMode('sailing') });
  const fishingHUD = createFishingHUD({
    onSelectLure: id => { fishing.selectLure(id); },
    onPrepare: () => {
      controls.reset();
      const direction = camera.getWorldDirection(new THREE.Vector3());
      fishing.prepare(boat, Math.atan2(direction.x, -direction.z));
      canvas.focus({ preventScroll: true });
    },
    onCancel: () => { controls.reset(); canvas.focus({ preventScroll: true }); },
    onClose: () => { fishing.closeResult(); canvas.focus({ preventScroll: true }); },
  });
  window.addEventListener('keydown', event => {
    if (event.code !== 'Escape' || boat.mode !== 'fishing' || fishing.state.phase === PHASE.RESULT) return;
    if (fishing.state.phase === PHASE.AIM) controls.reset();
    else changeMode('sailing');
  });
  function resize() {
    const width = window.innerWidth, height = window.innerHeight;
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();
  let previous = performance.now(), elapsed = 0;
  let focused = true;
  window.addEventListener('blur', () => { focused = false; });
  window.addEventListener('focus', () => { focused = true; previous = performance.now(); });
  document.addEventListener('visibilitychange', () => { previous = performance.now(); });
  renderer.setAnimationLoop(now => {
    const dt = Math.min((now - previous) / 1000, 0.25);
    previous = now;
    if (document.hidden || !focused) return;
    elapsed += dt;
    const input = controls.read(dt);
    const phaseBefore = fishing.state.phase;
    if (boat.mode === 'fishing') fishing.step(dt);
    if (fishing.state.phase === PHASE.BITE && phaseBefore !== PHASE.BITE) audio.bite();
    // Substeps preserve real-time braking on slow devices without large collision steps.
    const steps = Math.max(1, Math.ceil(dt / 0.05));
    for (let i = 0; i < steps; i++) stepBoat(boat, input, dt / steps);
    const spotStatus = getFishingSpotStatus(boat);
    spotsView.update(spotStatus.active?.id);
    spotsHUD.update(spotStatus);
    model.position.set(boat.x, Math.sin(elapsed * 1.5) * 0.045, boat.z);
    model.rotation.set(Math.sin(elapsed * 1.3) * 0.008, -boat.heading, Math.cos(elapsed * 1.4) * 0.014);
    // Three.js local -Z forward rotates with a negative yaw for our heading convention.
    const tracking = [PHASE.FIGHT, PHASE.LANDING].includes(fishing.state.phase) ? {
      x: fishing.state.origin.x + Math.sin(fishing.state.heading) * fishing.state.distance,
      z: fishing.state.origin.z - Math.cos(fishing.state.heading) * fishing.state.distance,
    } : null;
    rig.update(dt, input, boat.mode === 'fishing' && fishing.state.phase !== PHASE.READY, tracking);
    fishingView.update(fishing, boat.mode === 'fishing', elapsed);
    lake.update(elapsed, boat);
    hud.update(boat);
    fishingHUD.update(fishing, boat.mode === 'fishing');
    renderer.render(scene, camera);
    hud.ready();
  });
  canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); renderer.setAnimationLoop(null); showError('描画が中断されました。ページを再読み込みしてください。'); });
} catch (error) {
  console.error(error);
  showError('3D表示を開始できませんでした。WebGL 2対応のブラウザで、ハードウェアアクセラレーションを有効にしてください。');
}
