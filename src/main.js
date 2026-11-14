import * as THREE from 'three';
import './ui/style.css';
import { calculateRenderResolution } from './rendering/resolution.js';
import { createLake } from './world/lake.js';
import { stepBoat, enterFishing, leaveFishing, isStopped } from './game/boat.js';
import { createTimeSkip } from './game/time-skip.js';
import { createPlayPreferences } from './game/play-preferences.js';
import { createBoatModel } from './rendering/boat-model.js';
import { createCameraRig } from './rendering/camera.js';
import { createCastVisibility } from './rendering/cast-visibility.js';
import { createCelestialObservation } from './rendering/celestial-observation.js';
import { nearRingExpansion } from './rendering/fishing-visuals.js';
import { createControls } from './input/controls.js';
import { createTimeSkipInputLock } from './input/time-skip-lock.js';
import { createHUD } from './ui/hud.js';
import { PHASE } from './game/fishing.js';
import { createFishingInput } from './input/fishing.js';
import { createFishingView } from './rendering/fishing.js';
import { createRodReelView } from './rendering/rod-reel-view.js';
import { createFishingHUD } from './ui/fishing-hud.js';
import { createCastNotices } from './ui/cast-notices.js';
import { createFishingAudio } from './ui/fishing-audio.js';
import { createAudioSession } from './audio/audio-session.js';
import { createAmbientAudio } from './audio/ambient-audio.js';
import { getFishingSpotStatus } from './game/fishing-spots.js';
import { createFishingSpotsView } from './rendering/fishing-spots.js';
import { createFishingSpotsHUD } from './ui/fishing-spots-hud.js';
import { createCollectionMenu } from './ui/collection-menu.js';
import { createSalesHUD } from './ui/sales-hud.js';
import { createAchievementNotice } from './ui/achievement-notice.js';
import { createDiscoveryCoordinator } from './ui/discovery-coordinator.js';
import { createSpeciesDiscoveryNotice } from './ui/species-discovery-notice.js';
import { createRareDiscoveryCue } from './audio/rare-discovery-cue.js';
import { createSaveStorage, SAVE_STORAGE_KEYS } from './game/save-storage.js';
import { createAutosave } from './game/autosave.js';
import { createSaveStatus } from './ui/save-status.js';

import { createGameplay } from './game/gameplay.js';
import { createQteClock } from './input/qte-clock.js';
import { createQteDelivery } from './input/qte-delivery.js';
import { createQteEvaluator } from './game/qte-operations.js';
import { createQteHUD } from './ui/qte-hud.js';

// One initializer for public ON and code-injected ON/OFF regression tests.
// Policy is code-only: no export, URL/storage setting or public global.
function startGame({ qteEnabled = false, random = Math.random, onFightEvent = () => {} } = {}) {
const canvas = document.querySelector('#scene');
function showError(message) {
  document.querySelector('#status').hidden = true;
  const error = document.querySelector('#error');
  error.textContent = message;
  error.hidden = false;
  document.querySelector('#fish-button').disabled = true;
  document.querySelector('#menu-button').disabled = true;
  document.querySelector('#day-night-skip').hidden = true;
}
let autosave, environmentAudio, audioSession, qteDelivery, qteHUD, rodReelView, fishingView, discoveryCoordinator;
let disposeSkyCheck, celestialObservation;
try {
  // Choose one complete domain before anything subscribes or renders. Storage
  // remains read-only until the scene, controls and every HUD are ready.
  const gameplayFactory = options => createGameplay({ ...options, qteEnabled, random,
    onFightEvent(event) {
      if (event.type === 'qte-warning') qteDelivery.open(performance.now());
      if (event.type === 'fight-ended') qteDelivery?.retire();
      onFightEvent(event);
    },
  });
  const storage = createSaveStorage({ gameplayFactory });
  const loaded = storage.load();
  if (loaded.status.code === 'restore-failed') throw new Error('Gameplay restoration failed');
  const state = loaded.state ?? gameplayFactory();
  const { boat, clock: gameClock, fishing, collection, achievements } = state;
  const timeSkip = createTimeSkip(gameClock);
  const playPreferences = createPlayPreferences();
  disposeSkyCheck = () => playPreferences.dispose();
  autosave = createAutosave({ state, storage });
  const saveStatus = createSaveStatus();
  autosave.subscribe(saveStatus.update);
  saveStatus.update(autosave.status);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
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
  const spotsHUD = createFishingSpotsHUD();
  if (qteEnabled) {
    const provider = { getDescriptor: index => state.qteProvider.getDescriptor(index) };
    qteDelivery = createQteDelivery({ fishing, clock: createQteClock(), evaluate: createQteEvaluator(provider) });
  }
  const fishingInput = createFishingInput(fishing, undefined, { qteDelivery });
  const controls = createControls(canvas, document.querySelector('#joystick'), document.querySelector('#joystick-knob'), {
    input: fishingInput, canLook: () => fishing.state.phase === PHASE.READY,
    onPreparationCancel: () => cancelPreparation(),
  });
  controls.setEnabled(false);
  fishingView = createFishingView(scene, camera);
  rodReelView = createRodReelView(scene, camera, collection);
  const rodTipWorld = new THREE.Vector3();
  const castNotices = createCastNotices();
  audioSession = createAudioSession();
  const ambientAudio = environmentAudio = createAmbientAudio({ session: audioSession, clock: gameClock });
  const audio = createFishingAudio({ session: audioSession });
  discoveryCoordinator = createDiscoveryCoordinator({ collection, fishing, achievements, achievementNotice,
    discoveryNotice: createSpeciesDiscoveryNotice({ cue: createRareDiscoveryCue({ session: audioSession }) }) });
  const unlockAudio = event => {
    if (!event.isTrusted || document.hidden) return;
    const touch = event.pointerType === 'touch' || event.type.startsWith('touch');
    const contact = event.pointerId ?? event.changedTouches?.[0]?.identifier;
    // Touch down precedes activation. Remember only a new contact since the
    // latest blur/hidden/pagehide, never the tail of an interrupted gesture.
    if (touch && ['pointerdown', 'touchstart'].includes(event.type)) {
      touchContact = contact; return;
    }
    const freshTouch = touch && ['pointerup', 'touchend'].includes(event.type) && touchContact === contact;
    if (touch) touchContact = undefined;
    if (event.type === 'keydown' && (event.repeat || event.key === 'Escape')) return;
    if (event.type === 'pointerdown' && event.pointerType !== 'mouse') return;
    if (event.type === 'pointerup' && event.pointerType === 'mouse') return;
    if (navigator.userActivation?.isActive === false) return;
    // Startup may lack focus entirely. After an explicit blur, only a fresh
    // touch may repair a missing mobile focus notification; PC waits for focus.
    const startupInput = focusRecovery === 'startup' && ['pointerdown', 'keydown'].includes(event.type);
    if (!focused && (startupInput || freshTouch)) {
      celestialObservation?.reset();
      focused = true; focusRecovery = null;
      discoveryCoordinator.recoverFocus();
      fishingInput.setSuspended('blur', false, performance.now());
      previous = performance.now(); ambientAudio.setPaused('blur', false);
    }
    // These controls own their click request; do not change/hide the retry
    // control between pointerdown and the click that actually activates it.
    if (event.target.closest?.('#ambient-toggle, #ambient-retry')) return;
    ambientAudio.unlock();
  };
  document.addEventListener('pointerdown', unlockAudio, { passive: true });
  document.addEventListener('pointerup', unlockAudio, { passive: true });
  if (!window.PointerEvent) {
    document.addEventListener('touchstart', unlockAudio, { passive: true });
    document.addEventListener('touchend', unlockAudio, { passive: true });
  }
  const cancelTouch = () => { touchContact = undefined; };
  document.addEventListener('pointercancel', cancelTouch);
  document.addEventListener('touchcancel', cancelTouch);
  document.addEventListener('click', unlockAudio);
  document.addEventListener('keydown', unlockAudio);
  const rig = createCameraRig(camera, boat);
  const app = document.querySelector('#app');
  let preparation = null;
  let focused = document.hasFocus(), pageActive = true, renderHealthy = true;
  let focusRecovery = focused ? null : 'startup', touchContact;
  const fixedCastVisibility = createCastVisibility(camera, () => {
    const style = getComputedStyle(document.documentElement);
    const inset = edge => parseFloat(style.getPropertyValue(`--safe-${edge}`)) || 0;
    return { width: window.innerWidth, height: window.innerHeight,
      insets: Object.fromEntries(['top', 'right', 'bottom', 'left'].map(edge => [edge, inset(edge)])),
      occlusions: [...document.querySelectorAll('.masthead, .action-panel, .telemetry, .edition, #fishing-panel, .compass')]
        .filter(element => element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden')
        .map(element => { const { left, top, right, bottom } = element.getBoundingClientRect(); return { left, top, right, bottom }; }),
    };
  });
  const castVisibility = {
    constrain: fixedCastVisibility.constrain,
    isVisible(options) {
      if (!fixedCastVisibility.isVisible(options)) return false;
      const { origin, heading, distance } = options;
      const radius = 0.7 * (1 + 1.6 * nearRingExpansion(distance, fishing.settings.landingDistance));
      return castNotices.update(fixedCastVisibility.footprint({
        x: origin.x + Math.sin(heading) * distance,
        z: origin.z - Math.cos(heading) * distance, radius,
      }), true);
    },
  };
  const hasWaterTarget = () => [PHASE.AIM, PHASE.CAST, PHASE.LURE, PHASE.BITE].includes(fishing.state.phase);
  function updateFishingDisplay(clockState) {
    hud.update(boat);
    fishingHUD.update(fishing, boat.mode === 'fishing', clockState);
    if (fishing.state.phase === PHASE.AIM) {
      fishing.refreshAim();
      fishingHUD.update(fishing, boat.mode === 'fishing', clockState);
    }
    rodReelView.update(boat.mode === 'fishing', fishing.state, elapsed);
    fishingView.update(fishing, boat.mode === 'fishing', elapsed, rodReelView.copyTipWorld(rodTipWorld));
    const activeTarget = boat.mode === 'fishing' && hasWaterTarget();
    const targetVisible = castNotices.update(activeTarget ? fishingView.getScreenBounds(camera, {
      width: window.innerWidth, height: window.innerHeight,
    }) : null, activeTarget);
    if (!targetVisible && fishing.cancelForViewChange('外界の変更を検知したためルアーを回収した。')) {
      controls.reset();
      fishingHUD.update(fishing, true, clockState);
      rodReelView.update(true, fishing.state, elapsed);
      fishingView.update(fishing, true, elapsed, rodReelView.copyTipWorld(rodTipWorld));
      castNotices.update(null, false);
    }
  }
  function cancelPreparation() {
    if (!preparation) return;
    preparation = null;
    app.dataset.castPreparing = 'false';
    controls.cancelPreparation();
    controls.setEnabled(!collectionMenu.isOpen && !timeSkip.active && renderHealthy);
  }
  function changeMode(mode) {
    if (timeSkip.active || !renderHealthy) return;
    cancelPreparation();
    if (mode === 'fishing') { if (!enterFishing(boat)) return; }
    else {
      if (!fishing.canLeave()) return;
      fishing.reset();
      leaveFishing(boat);
    }
    controls.setMode(boat.mode);
    canvas.focus({ preventScroll: true });
  }
  function safeToSkip() {
    return playPreferences.state.dayNightSkip && !document.hidden && focused && pageActive && renderHealthy
      && !collectionMenu.isOpen && !document.querySelector('#collection-dialog').open
      && !document.querySelector('#catch-dialog').open && boat.mode === 'sailing' && isStopped(boat)
      && !preparation && fishing.state.phase === PHASE.READY;
  }
  const hud = createHUD({ onFish: () => changeMode('fishing'), onReturn: () => changeMode('sailing'),
    readTimeSkip: () => ({ enabled: playPreferences.state.dayNightSkip, active: timeSkip.active,
      available: !timeSkip.active && safeToSkip(), timeOfDay: gameClock.state.timeOfDay }),
    onTimeSkip: () => {
      if (!timeSkip.start(safeToSkip())) return;
      celestialObservation.reset();
      boat.speed = 0;
      previous = performance.now();
      syncTimeSkip();
    },
  });
  const fishingHUD = createFishingHUD({
    onResult: discoveryCoordinator.showResult,
    onResultClose: discoveryCoordinator.closeResult,
    onSelectLure: id => { fishing.selectLure(id); },
    onPrepare: () => {
      if (!renderHealthy || timeSkip.active || preparation || boat.mode !== 'fishing' || fishing.state.phase !== PHASE.READY) return;
      controls.beginPreparation();
      const fromPosition = camera.position.clone(), fromQuaternion = camera.quaternion.clone();
      const heading = rig.prepareCast();
      preparation = { heading, fromPosition, fromQuaternion, position: camera.position.clone(), quaternion: camera.quaternion.clone(), time: 0 };
      camera.position.copy(fromPosition); camera.quaternion.copy(fromQuaternion);
      app.dataset.castPreparing = 'true';
      document.querySelector('#cast-button').disabled = true;
      canvas.focus({ preventScroll: true });
    },
    onCancel: () => { cancelPreparation(); controls.reset(); canvas.focus({ preventScroll: true }); },
    onClose: () => { if (fishing.closeResult()) canvas.focus({ preventScroll: true }); },
    onSell: () => {
      const receipt = fishing.sellResult();
      if (receipt) { salesHUD.notify(receipt); canvas.focus({ preventScroll: true }); }
      return receipt;
    },
  });
  const collectionMenu = createCollectionMenu({
    ambientAudio,
    playPreferences,
    collection,
    achievements,
    onSale: receipt => salesHUD.notify(receipt),
    onUpgrade: () => salesHUD.update(),
    canPurchase: () => boat.mode === 'sailing' || (boat.mode === 'fishing' && fishing.state.phase === PHASE.READY),
    canOpen: () => !timeSkip.active && renderHealthy && fishing.state.phase !== PHASE.RESULT && !document.querySelector('#catch-dialog').open,
    onOpenChange: open => {
      celestialObservation?.reset();
      if (open) cancelTimeSkip();
      fishingInput.setSuspended('menu', open, performance.now());
      if (open) cancelPreparation();
      if (open) castNotices.update(null, false);
      ambientAudio.setPaused('menu', open);
      salesHUD.update();
      achievementNotice.update();
      controls.setEnabled(!open && !timeSkip.active && renderHealthy);
      if (open && fishing.state.phase === PHASE.READY) rodReelView.resetMotion();
      previous = performance.now();
      if (!open) canvas.focus({ preventScroll: true });
    },
  });
  const skipInputLock = createTimeSkipInputLock({ isActive: () => timeSkip.active });
  let skipLocked = false;
  function syncTimeSkip() {
    const locked = timeSkip.active;
    if (locked !== skipLocked) {
      celestialObservation?.reset();
      skipLocked = locked;
      if (locked) skipInputLock.discardHeldKeys();
      controls.setEnabled(!locked && !collectionMenu.isOpen && renderHealthy);
      canvas.inert = locked;
      document.querySelector('.wordmark').inert = locked;
      document.querySelector('.action-panel').inert = locked;
      app.dataset.timeSkipping = String(locked);
      app.setAttribute('aria-busy', String(locked));
      if (!locked && focused && pageActive && !document.hidden && !collectionMenu.isOpen && renderHealthy) canvas.focus({ preventScroll: true });
    }
    if (renderHealthy) { hud.update(boat); collectionMenu.update(); }
  }
  function cancelTimeSkip() {
    if (!timeSkip.active && !skipLocked) return;
    timeSkip.cancel(); syncTimeSkip(); previous = performance.now();
  }
  const unsubscribePlay = playPreferences.subscribe(() => {
    if (!playPreferences.state.dayNightSkip) cancelTimeSkip();
    syncTimeSkip();
  });
  const interruptObservationAndSkip = () => { celestialObservation?.reset(); cancelTimeSkip(); };
  window.addEventListener('error', interruptObservationAndSkip);
  window.addEventListener('unhandledrejection', interruptObservationAndSkip);
  disposeSkyCheck = () => {
    cancelTimeSkip(); unsubscribePlay(); skipInputLock.dispose(); playPreferences.dispose();
    window.removeEventListener('error', interruptObservationAndSkip); window.removeEventListener('unhandledrejection', interruptObservationAndSkip);
  };
  if (qteDelivery) qteHUD = createQteHUD({ fishing, delivery: qteDelivery,
    provider: { getDescriptor: index => state.qteProvider.getDescriptor(index) },
    manageGeometry: false, autoPresent: false });
  const observationObstacles = [...document.querySelectorAll('.wordmark, .location, .wallet, #menu-button, .action-panel, .telemetry, .edition, .compass, #fishing-panel, #joystick, #achievement-notice, #species-discovery-notice, #sale-notice')];
  celestialObservation = createCelestialObservation({ renderer, scene, camera, targets: lake.celestial,
    recorded: ['aurora', 'meteor'].filter(kind => achievements.snapshot.unlocked.some(row => row.id === `normal-${kind}-observed`)),
    onObservation: kind => achievements.recordObservation(kind),
    getViewport: () => ({ width: window.innerWidth, height: window.innerHeight,
      occlusions: observationObstacles.filter(element => element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden')
        .map(element => element.getBoundingClientRect()) }),
  });
  // Dialogs can open and close between rAFs. Neither interval can contribute
  // to continuity, even if the next normal frame sees an already closed menu.
  for (const dialog of document.querySelectorAll('dialog')) {
    dialog.addEventListener('beforetoggle', () => celestialObservation.reset());
    dialog.addEventListener('toggle', () => celestialObservation.reset());
  }
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
    if (timeSkip.active || collectionMenu.isOpen || event.defaultPrevented) return;
    if (event.code !== 'Escape' || boat.mode !== 'fishing' || fishing.state.phase === PHASE.RESULT) return;
    if (preparation) cancelPreparation();
    else if (fishing.state.phase === PHASE.AIM) controls.reset();
    else changeMode('sailing');
  });
  let drawingSize, qteFrame = 0, qteRenderedFrame = -1;
  let previous = performance.now(), elapsed = 0;
  function resize() {
    celestialObservation.reset();
    fishingInput.geometryChanged(false, performance.now());
    if (boat.mode === 'fishing' && fishing.state.phase === PHASE.FIGHT) controls.reset();
    const next = calculateRenderResolution({ width: window.innerWidth, height: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio, coarsePointer: window.matchMedia('(pointer: coarse)').matches });
    const { width, height, pixelRatio } = next;
    if (!drawingSize || width !== drawingSize.width || height !== drawingSize.height || pixelRatio !== drawingSize.pixelRatio) {
      // Set dimensions and ratio together, avoiding an intermediate allocation
      // at the old orientation's size. CSS owns the canvas's displayed size.
      renderer.setDrawingBufferSize(width, height, pixelRatio);
      drawingSize = next;
    }
    camera.aspect = width / height;
    camera.fov = 55;
    camera.updateProjectionMatrix();
    if (boat.mode === 'fishing' && [PHASE.CAST, PHASE.LURE, PHASE.BITE].includes(fishing.state.phase)
      && !castVisibility.isVisible({ origin: fishing.state.origin, heading: fishing.state.heading,
        distance: fishing.state.distance, landingDistance: fishing.settings.landingDistance })) {
      controls.reset();
      fishing.cancelForViewChange();
    }
    updateFishingDisplay(gameClock.state);
    // Resize renders real geometry too; it never advances QTE presentation.
    qteHUD?.update(qteFrame, performance.now());
    // Orientation can change while the menu pauses animation updates.
    renderer.render(scene, camera);
    qteRenderedFrame = qteFrame;
  }
  window.addEventListener('resize', resize);
  const orientationChanged = () => { celestialObservation.reset(); fishingInput.geometryChanged(true, performance.now()); };
  window.addEventListener('orientationchange', orientationChanged);
  window.screen.orientation?.addEventListener('change', orientationChanged);
  resize();
  ambientAudio.setPaused('blur', !focused);
  ambientAudio.setPaused('hidden', document.hidden);
  fishingInput.setSuspended('blur', !focused, performance.now());
  fishingInput.setSuspended('hidden', document.hidden, performance.now());
  window.addEventListener('blur', () => {
    celestialObservation.reset();
    fishingInput.setSuspended('blur', true, performance.now());
    cancelPreparation();
    focused = false; focusRecovery = 'blurred'; cancelTouch(); ambientAudio.setPaused('blur', true);
    if (fishing.state.phase === PHASE.READY) rodReelView.resetMotion();
    cancelTimeSkip(); syncTimeSkip();
  });
  window.addEventListener('focus', () => {
    celestialObservation.reset();
    fishingInput.setSuspended('blur', false, performance.now());
    focused = true; focusRecovery = null; cancelTouch();
    previous = performance.now(); ambientAudio.setPaused('blur', false);
    syncTimeSkip();
  });
  document.addEventListener('visibilitychange', () => {
    celestialObservation.reset();
    fishingInput.setSuspended('hidden', document.hidden, performance.now());
    ambientAudio.setPaused('hidden', document.hidden);
    previous = performance.now();
    if (document.hidden) cancelTimeSkip();
    syncTimeSkip();
    if (document.hidden) { cancelTouch(); autosave.flush(); }
    if (document.hidden) cancelPreparation();
    if (document.hidden && fishing.state.phase === PHASE.READY) rodReelView.resetMotion();
  });
  window.addEventListener('pagehide', () => {
    celestialObservation.reset();
    pageActive = false; cancelTimeSkip(); syncTimeSkip();
    fishingInput.setSuspended('page', true, performance.now());
    cancelTouch(); ambientAudio.setPaused('page', true); autosave.flush();
    if (fishing.state.phase === PHASE.READY) rodReelView.resetMotion();
  });
  window.addEventListener('pageshow', () => {
    celestialObservation.reset();
    pageActive = true; syncTimeSkip();
    fishingInput.setSuspended('page', false, performance.now());
    previous = performance.now();
    ambientAudio.setPaused('page', false); autosave.checkForExternalChanges();
  });
  window.addEventListener('storage', event => {
    if (event.key === null || SAVE_STORAGE_KEYS.includes(event.key)) autosave.checkForExternalChanges();
  });
  renderer.setAnimationLoop(now => {
    try {
      if (!Number.isFinite(now)) { celestialObservation.reset(); cancelTimeSkip(); previous = performance.now(); return; }
      const frameSeconds = Math.max(0, (now - previous) / 1000);
      const dt = Math.min(frameSeconds, 0.25);
      previous = now;
      if (timeSkip.active && !safeToSkip()) cancelTimeSkip();
      // SkyCheck's pagehide latch must not pause the existing OFF path.
      if (document.hidden || !focused || (!pageActive && playPreferences.state.dayNightSkip)
        || collectionMenu.isOpen || document.querySelector('#collection-dialog').open) { celestialObservation.reset(); return; }
      // Clock tracks all active time, even on slow frames. Movement retains its
      // existing safety cap; hidden/unfocused time is not caught up on resume.
      const skippingFrame = timeSkip.step(frameSeconds);
      const clockState = gameClock.state;
      ambientAudio.update();
      if (!skippingFrame) {
        elapsed += dt;
        // DOM events have already entered controls. The prior frame really
        // rendered its prepared HUD; only a later rAF may present that geometry.
        if (qteHUD) {
          qteFrame++;
          if (qteRenderedFrame === qteFrame - 1) qteHUD.present(qteFrame, performance.now());
        }
        const input = controls.read(dt, qteDelivery ? performance.now() : now);
        const phaseBefore = fishing.state.phase;
        // Input has polled/sealed and based its normal timestamps on this same
        // accepted duration. The unresolved interval is never banked as physics.
        const physicsDt = qteDelivery && phaseBefore === PHASE.FIGHT ? fishingInput.frameSeconds : dt;
        if (boat.mode === 'fishing') fishing.step(physicsDt);
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
        rig.update(dt, input, Boolean(preparation) || (boat.mode === 'fishing' && fishing.state.phase !== PHASE.READY), tracking);
        if (preparation) {
          preparation.time += dt;
          const t = Math.min(1, preparation.time / 0.1), smooth = t * t * (3 - 2 * t);
          camera.position.lerpVectors(preparation.fromPosition, preparation.position, smooth);
          camera.quaternion.slerpQuaternions(preparation.fromQuaternion, preparation.quaternion, smooth);
          camera.updateMatrixWorld();
          if (t === 1) {
            const heading = preparation.heading;
            preparation = null; app.dataset.castPreparing = 'false';
            // Lay out AIM before measuring its occlusions; a stale READY panel or
            // rejection note must not become the constraint for the new gesture.
            fishing.prepare(boat, heading, null);
            hud.update(boat);
            fishingHUD.update(fishing, true, clockState);
            fishing.setCastVisibility(castVisibility);
            controls.finishPreparation();
          }
        }
      }
      autosave.markProgress();
      lake.update(elapsed, boat, clockState);
      updateFishingDisplay(clockState);
      collectionMenu.update();
      if (!skippingFrame) qteHUD?.update(qteFrame, performance.now());
      celestialObservation.renderFrame(now, clockState, () => !skippingFrame && !timeSkip.active
        && focused && !document.hidden && pageActive && renderHealthy && !collectionMenu.isOpen
        && !document.querySelector('dialog[open]') && ![PHASE.FIGHT, PHASE.LANDING, PHASE.RESULT].includes(fishing.state.phase));
      qteRenderedFrame = qteFrame;
      hud.ready();
      if (skipLocked !== timeSkip.active) syncTimeSkip();
    } catch (error) {
      stopRendering('描画が中断されました。ページを再読み込みしてください。');
      console.error(error);
    }
  });
  function stopRendering(message) {
    renderHealthy = false;
    celestialObservation.dispose();
    disposeSkyCheck();
    controls.setEnabled(false);
    renderer.setAnimationLoop(null);
    discoveryCoordinator.dispose();
    ambientAudio.dispose(); audioSession.dispose();
    qteHUD?.dispose(); qteDelivery?.retire();
    rodReelView.dispose();
    fishingView.dispose();
    autosave.dispose();
    showError(message);
  }
  canvas.addEventListener('webglcontextlost', event => {
    event.preventDefault();
    stopRendering('描画が中断されました。ページを再読み込みしてください。');
  });
  // resize() has already rendered successfully and all initialization above
  // completed. Only now allow input and attach autosave's timers/subscriptions.
  autosave.start();
  controls.setEnabled(true);
  return { state, storage, autosave, qteDelivery, qteHUD, renderer };
} catch (error) {
  celestialObservation?.dispose();
  disposeSkyCheck?.();
  discoveryCoordinator?.dispose();
  environmentAudio?.dispose(); audioSession?.dispose();
  autosave?.dispose(); qteHUD?.dispose(); qteDelivery?.retire();
  rodReelView?.dispose();
  fishingView?.dispose();
  console.error(error);
  showError('3D表示を開始できませんでした。WebGL 2対応のブラウザで、ハードウェアアクセラレーションを有効にしてください。');
}

}

startGame({ qteEnabled: true });
