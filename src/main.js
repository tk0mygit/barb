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
import { estimateWaterDepth } from './world/depth.js';
import { createGameClock } from './game/game-clock.js';
import { createCollectionMenu } from './ui/collection-menu.js';
import { createSalesHUD } from './ui/sales-hud.js';
import { createAchievements } from './game/achievements.js';
import { createAchievementNotice } from './ui/achievement-notice.js';
import { createSaveStorage, SAVE_STORAGE_KEYS } from './game/save-storage.js';
import { createAutosave } from './game/autosave.js';
import { createSaveStatus } from './ui/save-status.js';

const canvas = document.querySelector('#scene');
function showError(message) {
  document.querySelector('#status').hidden = true;
  const error = document.querySelector('#error');
  error.textContent = message;
  error.hidden = false;
  document.querySelector('#fish-button').disabled = true;
  document.querySelector('#menu-button').disabled = true;
}
let autosave;
try {
  // Choose one complete domain before anything subscribes or renders. Storage
  // remains read-only until the scene, controls and every HUD are ready.
  const storage = createSaveStorage();
  const loaded = storage.load();
  const state = loaded.state ?? (() => {
    const boat = createBoatState();
    const clock = createGameClock();
    const fishing = createFishing({
      isWater: (x, z) => Math.hypot(x, z) < shoreRadius(Math.atan2(z, x)) - 2,
      getBoatPosition: () => boat,
      getEnvironment: position => ({ depthM: estimateWaterDepth(position), ...clock.state }),
    });
    const collection = fishing.collection;
    const achievements = createAchievements({ collection });
    return { boat, clock, fishing, collection, achievements };
  })();
  const { boat, clock: gameClock, fishing, collection, achievements } = state;
  autosave = createAutosave({ state, storage });
  const saveStatus = createSaveStatus();
  autosave.subscribe(saveStatus.update);
  saveStatus.update(autosave.status);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 2400);
  const model = createBoatModel();
  model.position.set(boat.x, 0, boat.z);
  model.rotation.y = -boat.heading;
  scene.add(model);
  const lake = createLake(scene);
  const spotsView = createFishingSpotsView(scene);
  const salesHUD = createSalesHUD(collection);
  const achievementNotice = createAchievementNotice();
  achievements.subscribe(awards => achievementNotice.notify(awards));
  const spotsHUD = createFishingSpotsHUD();
  const fishingInput = createFishingInput(fishing);
  const controls = createControls(canvas, document.querySelector('#joystick'), document.querySelector('#joystick-knob'), {
    input: fishingInput, canLook: () => fishing.state.phase === PHASE.READY,
  });
  controls.setEnabled(false);
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
    onClose: () => { if (fishing.closeResult()) canvas.focus({ preventScroll: true }); },
    onSell: () => {
      const receipt = fishing.sellResult();
      if (receipt) { salesHUD.notify(receipt); canvas.focus({ preventScroll: true }); }
      return receipt;
    },
  });
  const collectionMenu = createCollectionMenu({
    collection,
    achievements,
    onSale: receipt => salesHUD.notify(receipt),
    onUpgrade: () => salesHUD.update(),
    canPurchase: () => boat.mode === 'sailing' || (boat.mode === 'fishing' && fishing.state.phase === PHASE.READY),
    canOpen: () => fishing.state.phase !== PHASE.RESULT && !document.querySelector('#catch-dialog').open,
    onOpenChange: open => {
      salesHUD.update();
      achievementNotice.update();
      controls.setEnabled(!open);
      previous = performance.now();
      if (!open) canvas.focus({ preventScroll: true });
    },
  });
  // Populate the first rendered frame from the chosen state, including the
  // saved transform. Never show a model at the new-game origin first.
  spotsView.update(getFishingSpotStatus(boat).active?.id);
  spotsHUD.update(getFishingSpotStatus(boat));
  hud.update(boat);
  fishingHUD.update(fishing, false, gameClock.state);
  collectionMenu.update();
  // resize() renders synchronously, before the animation loop. Apply the saved
  // clock here too so a night restore never flashes the daytime environment.
  lake.update(0, boat, gameClock.state);
  window.addEventListener('keydown', event => {
    if (collectionMenu.isOpen || event.defaultPrevented) return;
    if (event.code !== 'Escape' || boat.mode !== 'fishing' || fishing.state.phase === PHASE.RESULT) return;
    if (fishing.state.phase === PHASE.AIM) controls.reset();
    else changeMode('sailing');
  });
  function resize() {
    const width = window.innerWidth, height = window.innerHeight;
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    // Orientation can change while the menu pauses animation updates.
    renderer.render(scene, camera);
  }
  window.addEventListener('resize', resize);
  resize();
  let previous = performance.now(), elapsed = 0;
  let focused = true;
  window.addEventListener('blur', () => { focused = false; });
  window.addEventListener('focus', () => { focused = true; previous = performance.now(); });
  document.addEventListener('visibilitychange', () => {
    previous = performance.now();
    if (document.hidden) autosave.flush();
  });
  window.addEventListener('pagehide', () => autosave.flush());
  window.addEventListener('pageshow', () => autosave.checkForExternalChanges());
  window.addEventListener('storage', event => {
    if (event.key === null || SAVE_STORAGE_KEYS.includes(event.key)) autosave.checkForExternalChanges();
  });
  renderer.setAnimationLoop(now => {
    const frameSeconds = Math.max(0, (now - previous) / 1000);
    const dt = Math.min(frameSeconds, 0.25);
    previous = now;
    if (document.hidden || !focused || collectionMenu.isOpen) return;
    // Clock tracks all active time, even on slow frames. Movement retains its
    // existing safety cap; hidden/unfocused time is not caught up on resume.
    gameClock.step(frameSeconds);
    const clockState = gameClock.state;
    elapsed += dt;
    const input = controls.read(dt);
    const phaseBefore = fishing.state.phase;
    if (boat.mode === 'fishing') fishing.step(dt);
    if (fishing.state.phase === PHASE.BITE && phaseBefore !== PHASE.BITE) audio.bite();
    // Substeps preserve real-time braking on slow devices without large collision steps.
    const steps = Math.max(1, Math.ceil(dt / 0.05));
    for (let i = 0; i < steps; i++) stepBoat(boat, input, dt / steps);
    autosave.markProgress();
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
    lake.update(elapsed, boat, clockState);
    hud.update(boat);
    fishingHUD.update(fishing, boat.mode === 'fishing', clockState);
    collectionMenu.update();
    renderer.render(scene, camera);
    hud.ready();
  });
  canvas.addEventListener('webglcontextlost', event => {
    event.preventDefault();
    controls.setEnabled(false);
    renderer.setAnimationLoop(null);
    autosave.dispose();
    showError('描画が中断されました。ページを再読み込みしてください。');
  });
  // resize() has already rendered successfully and all initialization above
  // completed. Only now allow input and attach autosave's timers/subscriptions.
  autosave.start();
  controls.setEnabled(true);
} catch (error) {
  autosave?.dispose();
  console.error(error);
  showError('3D表示を開始できませんでした。WebGL 2対応のブラウザで、ハードウェアアクセラレーションを有効にしてください。');
}
