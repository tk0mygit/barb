import test from 'node:test';
import assert from 'node:assert/strict';
import { operationSetup } from './helpers/qte-operations.js';
import { createFishingInput } from '../src/input/fishing.js';

const pointer = (type, timeStamp) => ({ type, timeStamp, clientX: 0, clientY: 0,
  pointerId: 1, pointerType: 'mouse', button: 0, isPrimary: true });
function setup() {
  const s = operationSetup({ operation: 'flick', condition: {
    speciesId: 'bluegill', size: 'max', startDistance: 8, rod: 1, reel: 1,
  } });
  s.activate(); s.send('pointerdown', 610); s.send('pointerup', 620, { clientX: 50 });
  const input = createFishingInput(s.f, undefined, { qteDelivery: s.delivery });
  function send(type, raw) {
    s.at(raw); const event = pointer(type, raw); input.receivePointer(event, raw);
    if (type === 'pointerdown') input.down(0, 0, raw, { event, receipt: raw });
    else if (type === 'pointerup') input.up(raw, { event, receipt: raw });
    else input.cancel(raw, { event, receipt: raw });
  }
  function frame(dt, raw) {
    s.at(raw); const accepted = input.step(dt, raw);
    assert.ok(Number.isFinite(accepted) && accepted >= 0 && accepted <= dt);
    assert.equal(input.frameSeconds, accepted);
    s.f.step(input.frameSeconds);
    return accepted;
  }
  return { s, input, send, frame, cut: s.delivery.snapshot.cut };
}

for (const [label, postCut, downAfterCut, releaseAfterFrame] of [
  ['short post-cut portion of a capped frame', 100, 80, 100],
  ['two-second late rAF with a fresh normal down', 2000, 1900, 110],
]) test(`${label}: release never becomes a later ghost hold`, () => {
  const { s, send, frame, cut } = setup();
  send('pointerdown', cut + downAfterCut);
  const end = cut + postCut;
  frame(.25, end);
  assert.equal(s.f.state.fight.qte.successes, 1);
  const up = end + releaseAfterFrame;
  send('pointerup', up); frame(releaseAfterFrame / 1000, up);
  for (let n = 1; n <= 45; n++) {
    frame(.05, up + n * 50);
    assert.equal(s.f.state.fight.reeling, false, `released contact reappeared at ${up + n * 50}`);
  }
});

for (const beforeFirstFrame of [true, false]) test(`post-C pointercancel ${beforeFirstFrame ? 'before' : 'after'} sealing closes the fresh normal contact`, () => {
  const { s, send, frame, cut } = setup();
  send('pointerdown', cut + 1900);
  if (beforeFirstFrame) send('pointercancel', cut + 1950);
  frame(.25, cut + 2000);
  if (!beforeFirstFrame) { frame(.11, cut + 2110); send('pointercancel', cut + 2110); }
  const end = cut + (beforeFirstFrame ? 2000 : 2110);
  for (let n = 1; n <= 40; n++) { frame(.05, end + n * 50); assert.equal(s.f.state.fight.reeling, false); }
});

test('canvas blur after C discards a queued normal down without losing the completed QTE', () => {
  const { s, send, frame, cut } = setup();
  send('pointerdown', cut + 1900); send('blur', cut + 1950);
  frame(.25, cut + 2000);
  assert.equal(s.f.state.fight.qte.successes, 1);
  for (let n = 1; n <= 40; n++) { frame(.05, cut + 2000 + n * 50); assert.equal(s.f.state.fight.reeling, false); }
});

test('a secondary or hybrid pointer cannot replace the pending post-C normal owner', () => {
  for (const isPrimary of [false, true]) {
    const { s, input, send, frame, cut } = setup();
    send('pointerdown', cut + 1900);
    s.at(cut + 1920);
    // Controls observes this ingress but does not give an occupied canvas to
    // a second pointer, even on a hybrid device with two primary pointer types.
    input.receivePointer({ ...pointer('pointerdown', cut + 1920), pointerId: 2, pointerType: 'touch', isPrimary }, cut + 1920);
    send('pointercancel', cut + 1950); frame(.25, cut + 2000);
    for (let n = 1; n <= 40; n++) { frame(.05, cut + 2000 + n * 50); assert.equal(s.f.state.fight.reeling, false); }
  }
});

test('late-cut normal down retains its last-frame hold and one release, without banking QTE time', () => {
  const { s, input, send, frame, cut } = setup();
  send('pointerdown', cut + 1900);
  const end = cut + 2000;
  frame(.25, end); assert.equal(s.f.state.fight.reeling, false);
  frame(.15, end + 150); assert.equal(s.f.state.fight.reeling, true);
  send('pointerup', end + 180); frame(.03, end + 180);
  assert.equal(input.frameSeconds, .03);
  // The domain snapshot can lag ingress by one existing fixed tick. Cross
  // that tick, then require the release to remain effective on every update.
  frame(1 / 60, end + 180 + 1000 / 60);
  assert.equal(s.f.state.fight.reeling, false);
  for (let n = 1; n <= 10; n++) { frame(.05, end + 180 + 1000 / 60 + n * 50); assert.equal(s.f.state.fight.reeling, false); }
});
