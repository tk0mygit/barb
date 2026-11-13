// Capture-phase guard also rejects synthetic events aimed at disabled/hidden
// controls. Keys pressed before or during a skip need a fresh down afterwards.
export function createTimeSkipInputLock({ target = document, isActive }) {
  const held = new Set(), blocked = new Set();
  const events = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'click', 'dblclick',
    'keydown', 'keyup', 'touchstart', 'touchmove', 'touchend', 'touchcancel', 'wheel', 'contextmenu'];
  function guard(event) {
    const key = event.type === 'keydown' || event.type === 'keyup';
    if (event.type === 'keydown') {
      held.add(event.code);
      if (!event.repeat && !isActive()) blocked.delete(event.code);
    }
    const reject = isActive() || key && blocked.has(event.code);
    if (isActive() && event.type === 'keydown') blocked.add(event.code);
    if (event.type === 'keyup') { held.delete(event.code); blocked.delete(event.code); }
    if (!reject) return;
    event.preventDefault(); event.stopImmediatePropagation();
  }
  for (const name of events) target.addEventListener(name, guard, { capture: true, passive: false });
  return {
    discardHeldKeys() { for (const code of held) blocked.add(code); },
    dispose() { for (const name of events) target.removeEventListener(name, guard, { capture: true }); held.clear(); blocked.clear(); },
  };
}
