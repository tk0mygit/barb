export function createControls(canvas, joystick, knob, fishing = null) {
  const state = { steer: 0, throttle: 0, lookX: 0, lookY: 0 };
  const keys = new Set();
  let pointer = null;
  let origin = { x: 0, y: 0 };
  let previous = origin;
  let mode = 'sailing';
  let fishingGesture = false;
  let preparing = false;
  let startedAt;
  let enabled = true;
  let uncertainRelease = false;
  const canLook = () => !fishing || fishing.canLook();
  function release() {
    const previousPointer = pointer;
    pointer = null;
    uncertainRelease = false;
    fishingGesture = false;
    if (previousPointer !== null && canvas.hasPointerCapture(previousPointer)) canvas.releasePointerCapture(previousPointer);
    keys.clear();
    state.steer = state.throttle = state.lookX = state.lookY = 0;
    joystick.hidden = true;
  }
  function reset(event, receipt = performance.now()) {
    const interruptedPreparation = preparing;
    preparing = false;
    release();
    fishing?.input.cancel(event?.timeStamp, { event, receipt });
    if (interruptedPreparation) fishing?.onPreparationCancel?.();
  }
  canvas.addEventListener('pointerdown', event => {
    const receipt = performance.now();
    if (!enabled) return;
    fishing?.input.receivePointer?.(event, receipt);
    if (uncertainRelease) release();
    if (pointer !== null || (event.pointerType === 'mouse' && event.button !== 0)) return;
    pointer = event.pointerId;
    origin = previous = { x: event.clientX, y: event.clientY };
    startedAt = event.timeStamp;
    canvas.setPointerCapture(pointer);
    canvas.focus({ preventScroll: true });
    if (!preparing && mode === 'fishing' && !canLook()) {
      fishingGesture = true;
      fishing.input.down(event.clientX, event.clientY, event.timeStamp, { event, receipt });
    }
    if (mode === 'sailing') {
      joystick.style.left = `${origin.x}px`;
      joystick.style.top = `${origin.y}px`;
      knob.style.transform = 'translate(0, 0)';
      joystick.hidden = false;
    }
  });
  // Pointer handlers own canvas gestures and focus. Cancel the parallel legacy
  // touch default so Chromium does not carry a drag's gesture suppression into
  // the next UI tap. Buttons and scrollable menus keep their native defaults.
  canvas.addEventListener('touchstart', event => { if (enabled) event.preventDefault(); }, { passive: false });
  canvas.addEventListener('pointermove', event => {
    const receipt = performance.now();
    fishing?.input.receivePointer?.(event, receipt);
    if (event.pointerId !== pointer) return;
    if (preparing) {
      // Keep the live contact, but never look, aim or cast before the camera
      // has reached its prepared pose. A release here is discarded below.
      previous = { x: event.clientX, y: event.clientY };
      return;
    }
    if (fishingGesture) {
      fishing.input.move(event.clientX, event.clientY, { event, receipt });
    } else if (mode === 'fishing' && canLook()) {
      state.lookX += (event.clientX - previous.x) * 0.004;
      state.lookY += (event.clientY - previous.y) * 0.004;
    } else if (mode === 'sailing') {
      const dx = event.clientX - origin.x;
      const dy = event.clientY - origin.y;
      const length = Math.hypot(dx, dy);
      state.steer = Math.max(-1, Math.min(1, dx / 65));
      state.throttle = Math.min(1, Math.max(0, length - 8) / 70);
      const scale = Math.min(1, 40 / (length || 1));
      knob.style.transform = `translate(${dx * scale}px, ${dy * scale}px)`;
    }
    previous = { x: event.clientX, y: event.clientY };
  });
  canvas.addEventListener('pointerup', event => {
    const receipt = performance.now();
    fishing?.input.receivePointer?.(event, receipt);
    if (event.pointerId !== pointer) return;
    if (event.timeStamp < startedAt) return;
    if (fishingGesture && fishing.input.up(event.timeStamp, { event, receipt }) === false) {
      // A quarantined old up must leave the new normal hold intact. A later
      // unambiguous up or a fresh down can still replace this local contact.
      uncertainRelease = true; return;
    }
    release();
  });
  for (const name of ['pointercancel', 'lostpointercapture']) {
    canvas.addEventListener(name, event => {
      const receipt = performance.now();
      // release() clears owner before releasing capture. Its own resulting
      // lostcapture must not cancel a completed QTE contact.
      if (event.pointerId !== pointer) return;
      fishing?.input.receivePointer?.(event, receipt);
      if (event.pointerId === pointer && event.timeStamp >= startedAt) reset(event, receipt);
    });
  }
  const supported = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD'];
  canvas.addEventListener('keydown', event => { if (enabled && supported.includes(event.code)) { event.preventDefault(); keys.add(event.code); } });
  window.addEventListener('keyup', event => keys.delete(event.code));
  window.addEventListener('blur', reset);
  canvas.addEventListener('blur', reset);
  document.addEventListener('visibilitychange', reset);
  return {
    reset,
    beginPreparation() { reset(); preparing = true; },
    finishPreparation() {
      if (!preparing) return;
      preparing = false;
      // Only a contact still held through preparation becomes a new AIM
      // gesture. A completed/cancelled contact is never replayed later.
      if (pointer !== null && mode === 'fishing') {
        fishingGesture = true;
        fishing.input.down(origin.x, origin.y, startedAt);
        fishing.input.move(previous.x, previous.y);
      }
    },
    cancelPreparation() { reset(); },
    setEnabled(next) { reset(); enabled = next; },
    setMode(next) { reset(); mode = next; },
    read(dt, frameEndTimestamp) {
      if (!enabled || preparing) return { steer: 0, throttle: 0, lookX: 0, lookY: 0 };
      if (mode === 'fishing') fishing?.input.step(dt, frameEndTimestamp);
      if (pointer === null) {
        state.steer = Number(keys.has('ArrowRight') || keys.has('KeyD')) - Number(keys.has('ArrowLeft') || keys.has('KeyA'));
        state.throttle = Number(keys.has('ArrowUp') || keys.has('KeyW'));
        if (mode === 'fishing' && canLook()) {
          state.lookX += state.steer * dt;
          state.lookY += (Number(keys.has('ArrowDown') || keys.has('KeyS')) - state.throttle) * dt;
        }
      }
      if (mode === 'fishing' && !canLook()) state.lookX = state.lookY = 0;
      const result = { ...state };
      state.lookX = state.lookY = 0;
      return result;
    },
  };
}
