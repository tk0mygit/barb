export function createControls(canvas, joystick, knob) {
  const state = { steer: 0, throttle: 0, lookX: 0, lookY: 0 };
  const keys = new Set();
  let pointer = null;
  let origin = { x: 0, y: 0 };
  let previous = origin;
  let mode = 'sailing';
  function reset() {
    if (pointer !== null && canvas.hasPointerCapture(pointer)) canvas.releasePointerCapture(pointer);
    pointer = null;
    keys.clear();
    state.steer = state.throttle = state.lookX = state.lookY = 0;
    joystick.hidden = true;
  }
  canvas.addEventListener('pointerdown', event => {
    if (pointer !== null || (event.pointerType === 'mouse' && event.button !== 0)) return;
    pointer = event.pointerId;
    origin = previous = { x: event.clientX, y: event.clientY };
    canvas.setPointerCapture(pointer);
    canvas.focus({ preventScroll: true });
    if (mode === 'sailing') {
      joystick.style.left = `${origin.x}px`;
      joystick.style.top = `${origin.y}px`;
      knob.style.transform = 'translate(0, 0)';
      joystick.hidden = false;
    }
  });
  canvas.addEventListener('pointermove', event => {
    if (event.pointerId !== pointer) return;
    if (mode === 'fishing') {
      state.lookX += (event.clientX - previous.x) * 0.004;
      state.lookY += (event.clientY - previous.y) * 0.004;
    } else {
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
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    canvas.addEventListener(name, event => { if (event.pointerId === pointer) reset(); });
  }
  const supported = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD'];
  canvas.addEventListener('keydown', event => { if (supported.includes(event.code)) { event.preventDefault(); keys.add(event.code); } });
  window.addEventListener('keyup', event => keys.delete(event.code));
  window.addEventListener('blur', reset);
  canvas.addEventListener('blur', reset);
  document.addEventListener('visibilitychange', reset);
  return {
    setMode(next) { reset(); mode = next; },
    read(dt) {
      if (pointer === null) {
        state.steer = Number(keys.has('ArrowRight') || keys.has('KeyD')) - Number(keys.has('ArrowLeft') || keys.has('KeyA'));
        state.throttle = Number(keys.has('ArrowUp') || keys.has('KeyW'));
        if (mode === 'fishing') {
          state.lookX += state.steer * dt;
          state.lookY += (Number(keys.has('ArrowDown') || keys.has('KeyS')) - state.throttle) * dt;
        }
      }
      const result = { ...state };
      state.lookX = state.lookY = 0;
      return result;
    },
  };
}
