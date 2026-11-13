import test from 'node:test';
import assert from 'node:assert/strict';
import { createTimeSkipInputLock } from '../src/input/time-skip-lock.js';

test('all input entrances are blocked and held keys need a fresh press after the skip', () => {
  const target = new EventTarget(); let active = false;
  const lock = createTimeSkipInputLock({ target, isActive: () => active });
  const received = [];
  for (const type of ['pointerdown', 'pointermove', 'pointerup', 'click', 'keydown', 'keyup', 'touchstart', 'wheel']) {
    target.addEventListener(type, e => received.push(`${e.type}:${e.code ?? ''}`));
  }
  function send(type, code, repeat = false) {
    const event = new Event(type, { cancelable: true }); event.code = code; event.repeat = repeat;
    target.dispatchEvent(event); return event.defaultPrevented;
  }
  assert.equal(send('keydown', 'KeyW'), false);
  active = true; lock.discardHeldKeys();
  for (const type of ['pointerdown', 'pointermove', 'pointerup', 'click', 'touchstart', 'wheel']) assert.equal(send(type), true);
  assert.equal(send('keydown', 'Enter'), true);
  active = false;
  assert.equal(send('keydown', 'KeyW', true), true);
  assert.equal(send('keydown', 'Enter', true), true);
  assert.equal(send('keyup', 'KeyW'), true);
  assert.equal(send('keydown', 'KeyW'), false);
  assert.equal(send('keydown', 'Enter'), false); // fresh press also recovers a missed keyup
  assert.equal(send('pointerdown'), false);
  assert.deepEqual(received, ['keydown:KeyW', 'keydown:KeyW', 'keydown:Enter', 'pointerdown:']);
  lock.dispose(); active = true;
  assert.equal(send('click'), false);
});
