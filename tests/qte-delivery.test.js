import test from 'node:test';
import assert from 'node:assert/strict';
import { createQteClock } from '../src/input/qte-clock.js';
import { createQteDelivery } from '../src/input/qte-delivery.js';
import { createFishingInput } from '../src/input/fishing.js';
import { createControls } from '../src/input/controls.js';
import { QTE_DELIVERY_CONFIG } from '../src/game/qte-delivery-config.js';
import { FISH_SPECIES } from '../src/game/fish-species.js';
import { getQteDifficulty } from '../src/game/fight-qte.js';
import { hookedFight } from './helpers/fight-replay.js';

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-10, `${a} != ${b}`);
const pointer = (type, timeStamp, extra = {}) => ({ type, timeStamp, clientX: 0, clientY: 0,
  pointerId: 1, pointerType: 'mouse', button: 0, isPrimary: true, ...extra });
// Synthetic endpoint consumer exercises transport/checkpoints, not any of the
// four product operations. Operation distance/time/angle scoring is PR-B work.
function transportConsumer(required = 1, observations = []) {
  return input => {
    observations.push(input);
    const completed = input.edges.filter(e => e.type === 'up' && !e.contact.cancelled).length;
    const count = Math.min(3, (input.previous?.completedOperations ?? 0) + completed);
    return { success: count >= required, completedOperations: count, state: { count } };
  };
}
function setup({ operation = 'flick', capacity, required = 1, condition = {} } = {}) {
  let raw = 0;
  const { f, calls } = hookedFight({ speciesId: 'alligator-gar', size: 'max', rod: 10, reel: 10, startDistance: 4.51, ...condition },
    { qte: { enabled: true, delivery: 'finite', selectOperation: () => operation } });
  f.reel(true);
  while (f.state.fight.mode === 'normal') f.step(1 / 60);
  const domainStart = f.state.fight.elapsedSeconds, observations = [];
  const clock = createQteClock({ now: () => raw });
  const delivery = createQteDelivery({ fishing: f, clock, evaluate: transportConsumer(required, observations), capacity });
  const handle = delivery.open(0);
  assert.ok(handle);
  const at = value => { raw = value; };
  const display = () => {
    const p = delivery.prepareDisplay(1);
    assert.equal(delivery.presentDisplay(p, 2), true);
  };
  const send = (type, source, receipt = source, extra) => {
    raw = receipt; return delivery.ingest(pointer(type, source, extra), receipt);
  };
  const activate = () => { raw = 600; display(); };
  return { f, calls, clock, delivery, domainStart, handle, observations, at, display, send, activate };
}

test('S1 grace/capacity are central provisional defaults; public QTE remains OFF', () => {
  assert.equal(QTE_DELIVERY_CONFIG.receiptGraceMs, 100);
  assert.equal(QTE_DELIVERY_CONFIG.semanticEdgeCapacity, 128);
  const { f } = hookedFight(); assert.equal(f.state.fight.qte.enabled, false);
});

test('G13 independent E rejects invalid/origin/future time and retains source suspension membership', () => {
  let raw = 1000;
  const clock = createQteClock({ now: () => raw, historyCapacity: 4 });
  raw = 2000;
  const receipt = clock.read();
  assert.equal(clock.source(1500, receipt).active, 500); // normal dt cap would rebase to 1750
  for (const invalid of [-1, 999, NaN, Infinity, 2000.001, 1_700_000_000_000]) assert.equal(clock.source(invalid, receipt), null);
  assert.equal(clock.read(1999), null);
  clock.setSuspended('hidden', true, 2100);
  clock.setSuspended('blur', true, 2200);
  assert.equal(clock.read(5000).active, 1100);
  clock.setSuspended('hidden', false, 5000);
  assert.equal(clock.read(6000).suspended, true);
  clock.setSuspended('blur', false, 6000);
  assert.equal(clock.source(3000, clock.read(6010)).suspended, true);
  assert.equal(clock.source(6000, clock.read(6010)), null, 'coarse lifecycle boundary is ambiguous');
  assert.equal(clock.source(6001, clock.read(6010)).active, 1101);
  for (let i = 0; i < 20; i++) {
    clock.setSuspended('menu', true, 7000 + i * 2);
    clock.setSuspended('menu', false, 7001 + i * 2);
  }
  assert.equal(clock.historySize, 4);
  assert.equal(clock.source(1000, clock.read(7100)), null, 'expired provenance is rejected');
  const epoch = createQteClock({ now: () => 0, timestampMode: 'epoch', timeOrigin: 1_700_000_000_000 });
  assert.equal(epoch.source(1_700_000_000_010, epoch.read(20)).active, 10);
  assert.throws(() => createQteClock({ timestampMode: 'automatic' }), /origin/);
});

test('G04 display preparation needs a later presentation opportunity after the full warning', () => {
  const s = setup();
  const initial = s.f.state.fight;
  const p = s.delivery.prepareDisplay(10);
  s.at(599); assert.equal(s.delivery.presentDisplay(p, 11), false);
  assert.equal(s.send('pointerdown', 599).accepted, false);
  s.at(600); assert.equal(s.delivery.presentDisplay(p, 10), false);
  assert.equal(s.delivery.presentDisplay(p, 11), true);
  assert.equal(s.send('pointerup', 650).accepted, false, 'warning contact is not carried');
  assert.equal(s.send('pointerdown', 660).accepted, true);
  assert.equal(s.send('pointerup', 700).accepted, true);
  assert.equal(s.f.state.fight.qte.successes, 0);
  s.at(1199); assert.equal(s.delivery.poll(), false);
  for (const key of ['distance', 'tension', 'normalSeconds', 'rngCalls']) assert.equal(s.f.state.fight[key], initial[key]);
  s.at(1200); assert.equal(s.delivery.poll(), true);
  assert.equal(s.f.state.fight.qte.successes, 1);
  near(s.f.state.fight.elapsedSeconds, s.domainStart + 1.2);
});

test('unprepared display parks the domain without shortening the eventual operation window', () => {
  const s = setup(); s.at(5000); s.delivery.poll(); s.f.step(100);
  assert.equal(s.f.state.fight.mode, 'awaiting-display');
  near(s.f.state.fight.elapsedSeconds, s.domainStart + .6);
  s.display();
  assert.equal(s.delivery.snapshot.active, 5000);
  assert.equal(s.delivery.snapshot.deadline, 5500);
  assert.equal(s.send('pointerdown', 4999, 5000).accepted, false);
  s.send('pointerdown', 5001); s.send('pointerup', 5500, 5599);
  s.at(5600); assert.equal(s.delivery.poll(), true);
  near(s.f.state.fight.elapsedSeconds, s.domainStart + 5.6);
});

for (const [source, receipt, success] of [[1099, 1199, true], [1100, 1199, true], [1101, 1199, false],
  [1100, 1200, false], [1099, 1201, false], [599, 700, false], [600, 600, true]]) {
  test(`G01 inclusive source A/D and strict receipt C: up s=${source}, r=${receipt}`, () => {
    const s = setup(); s.activate();
    s.send('pointerdown', 600);
    s.send('pointerup', source, receipt);
    s.at(Math.max(1200, receipt)); assert.equal(s.delivery.poll(), true);
    assert.equal(s.f.state.fight.qte.successes, success ? 1 : 0);
    assert.equal(s.f.state.fight.qte.failures, success ? 0 : 1);
    s.at(1300); assert.equal(s.delivery.poll(), false);
    assert.equal(s.f.state.fight.qte.successes + s.f.state.fight.qte.failures, 1);
  });
}

for (const timerFirst of [false, true]) test(`G02 C1 r=C, timer first=${timerFirst}, repeated quantized now=C`, () => {
  const s = setup(); s.activate(); s.send('pointerdown', 700);
  s.at(1200);
  if (timerFirst) s.delivery.poll();
  assert.equal(s.send('pointerup', 1100, 1200).accepted, false);
  for (let i = 0; i < 5; i++) s.delivery.poll();
  assert.equal(s.f.state.fight.qte.failures, 1);
  assert.equal(s.f.state.fight.qte.successes, 0);
});

test('G03 same timestamp distinct down/up/down/up survive; identical Event object is deduplicated', () => {
  const s = setup({ required: 3, operation: 'tap' }); s.activate();
  const down = pointer('pointerdown', 600); s.at(600);
  assert.equal(s.delivery.ingest(down).accepted, true);
  assert.equal(s.delivery.ingest(down).accepted, false);
  s.send('pointerup', 600); s.send('pointerdown', 600); s.send('pointerup', 600);
  s.send('pointerdown', 600); s.send('pointerup', 600);
  assert.equal(s.delivery.snapshot.edges, 6);
  s.at(2700); s.delivery.poll();
  assert.equal(s.f.state.fight.qte.successes, 1);
  assert.deepEqual(s.observations.at(-1).edges.map(e => e.type), ['down', 'up', 'down', 'up', 'down', 'up']);
});

test('G05/G07 single pointer, secondary button, cancellation, reuse and stale releases', () => {
  const s = setup(); s.activate();
  assert.equal(s.send('pointerdown', 610, 610, { button: 2 }).accepted, false);
  assert.equal(s.send('pointerdown', 620, 620, { pointerId: 2, isPrimary: false }).accepted, false);
  s.send('pointerdown', 630);
  assert.equal(s.send('pointerdown', 640, 640, { pointerId: 2 }).accepted, false);
  s.send('pointercancel', 650);
  s.send('pointerdown', 700);
  assert.equal(s.send('pointerup', 649, 710).accepted, false, 'old source cannot release new contact');
  assert.equal(s.send('lostpointercapture', 650, 720).accepted, false);
  s.send('pointerup', 800);
  s.at(1200); s.delivery.poll(); assert.equal(s.f.state.fight.qte.successes, 1);
  assert.equal(s.observations.at(-1).edges.filter(e => e.type === 'up' && !e.contact.cancelled).length, 1);
});

test('same-quantum reuse after cancel is ambiguous and never becomes a success', () => {
  const s = setup(); s.activate();
  s.send('pointerdown', 700); s.send('pointercancel', 700); s.send('pointerdown', 700); s.send('pointerup', 700);
  s.at(1200); s.delivery.poll(); assert.equal(s.f.state.fight.qte.failures, 1);
  assert.equal(s.delivery.snapshot.counts['ambiguous-contact'], 1);
});

test('G16 late source-ordered cancel invalidates an already complete contact before cut', () => {
  const s = setup(); s.activate();
  s.send('pointerdown', 650); s.send('pointerup', 800);
  s.send('pointercancel', 700, 1000);
  s.at(1200); s.delivery.poll();
  assert.equal(s.f.state.fight.qte.failures, 1);
  assert.equal(s.f.state.fight.qte.successes, 0);
  assert.equal(s.observations.at(-1).edges.at(-1).contact.cancelled, true);
});

test('complete contacts are stably source-sorted even when their receipt order differs', () => {
  const s = setup({ required: 3 }); s.activate();
  s.send('pointerdown', 800); s.send('pointerup', 850);
  s.send('pointerdown', 610, 900); s.send('pointerup', 620, 910);
  s.send('pointerdown', 700, 920); s.send('pointerup', 750, 930);
  s.at(1200); s.delivery.poll();
  assert.deepEqual(s.observations.at(-1).edges.map(e => e.source), [610, 620, 700, 750, 800, 850]);
  assert.equal(s.f.state.fight.qte.successes, 1);
});

for (const hz of [60, 120, 240, 1000]) test(`G08 move/coalesced ${hz}Hz retains return-drag maximum and endpoints with two edges`, () => {
  const s = setup(); s.activate(); s.send('pointerdown', 600);
  const children = Array.from({ length: hz / 2 }, (_, i) => ({ timeStamp: 601 + i / hz * 900, clientX: i % 2 ? 100 : 0, clientY: 0 }));
  s.send('pointermove', 1099, 1099, { getCoalescedEvents: () => children });
  s.send('pointerup', 1100);
  assert.equal(s.delivery.snapshot.edges, 2);
  s.at(1200); s.delivery.poll();
  const contact = s.observations.at(-1).edges.at(-1).contact;
  assert.equal(contact.startX, 0); assert.equal(contact.endX, 0);
  assert.equal(contact.maxDisplacement, 100); assert.equal(contact.upSource, 1100);
});

for (const count of [127, 128, 129]) test(`G09 semantic N-1/N/N+1=${count}; controls bypass full queue`, () => {
  const s = setup(); s.activate();
  for (let i = 0; i < count; i++) s.send(i % 2 ? 'pointerup' : 'pointerdown', 601 + i);
  assert.ok(s.delivery.snapshot.highWater <= 128);
  assert.equal(s.delivery.snapshot.interrupted, count > 128);
  assert.equal(s.delivery.snapshot.counts['semantic-overflow'] ?? 0, count > 128 ? 1 : 0);
  if (count <= 128) {
    s.send('pointercancel', 900); s.at(1200); assert.equal(s.delivery.poll(), true);
  } else {
    assert.equal(s.f.state.fight.paused, true);
    assert.equal(s.f.state.fight.qte.successes + s.f.state.fight.qte.failures, 0);
  }
});

test('G09 checkpoint preserves completed operations and remaining time; no full-time retry', () => {
  const s = setup({ capacity: 5, required: 3 }); s.activate();
  for (let i = 0; i < 6; i++) s.send(i % 2 ? 'pointerup' : 'pointerdown', 610 + i * 10);
  const before = s.f.state.fight, remaining = s.delivery.snapshot.remainingMs;
  assert.equal(s.delivery.snapshot.completedOperations, 2);
  assert.equal(s.delivery.snapshot.provisionalSuccess, false);
  assert.equal(remaining, 440);
  s.at(2000); s.delivery.resumeTechnical();
  assert.equal(s.delivery.snapshot.remainingMs, remaining);
  s.display(); s.send('pointerdown', 2010); s.send('pointerup', 2020);
  assert.deepEqual(s.f.state.fight.qte.reservations, before.qte.reservations);
  s.at(2540); assert.equal(s.delivery.poll(), true);
  assert.equal(s.f.state.fight.qte.successes, 1);
  assert.equal(s.delivery.snapshot.completedOperations, 3);
});

test('overflow with no recoverable time fails only this QTE once after finite cut', () => {
  const s = setup({ capacity: 1 }); s.activate(); s.send('pointerdown', 700);
  s.send('pointerup', 1100, 1150);
  assert.equal(s.delivery.snapshot.interrupted, true);
  assert.equal(s.delivery.snapshot.remainingMs, 0);
  s.at(5000); assert.equal(s.delivery.poll(), false); s.delivery.resumeTechnical();
  s.at(5050); assert.equal(s.delivery.poll(), true);
  assert.equal(s.f.state.phase, 'fight'); assert.equal(s.f.state.fight.qte.failures, 1);
  assert.equal(s.f.state.fight.mode, 'arm'); assert.equal(s.delivery.poll(), false);
});

test('diagnostics and clock history stay bounded under invalid event floods', () => {
  const s = setup(); s.activate();
  for (let i = 0; i < 1000; i++) s.send('pointerdown', Infinity, 700);
  assert.equal(s.delivery.snapshot.diagnostics.length, 32);
  assert.equal(s.delivery.snapshot.counts['ambiguous-time'], 1000);
  assert.equal(s.delivery.snapshot.edges, 0);
});

for (const order of [['hidden', 'blur'], ['blur', 'hidden'], ['page', 'menu']]) test(`G10/G11 suspend reason union ${order.join(' -> ')} and fresh display/contact on resume`, () => {
  const s = setup(); s.activate(); s.send('pointerdown', 700);
  s.at(800); s.delivery.setSuspended(order[0], true);
  s.at(900); s.delivery.setSuspended(order[1], true);
  const paused = s.f.state.fight;
  s.at(3000); s.delivery.setSuspended(order[0], false);
  assert.equal(s.f.state.fight.paused, true);
  assert.equal(s.delivery.poll(), false);
  s.at(4000); s.delivery.setSuspended(order[1], false);
  assert.equal(s.f.state.fight.paused, true, 'presentation preparation is still required');
  assert.equal(s.delivery.snapshot.remainingMs, 300);
  s.display(); assert.equal(s.f.state.fight.paused, false);
  assert.deepEqual(s.f.state.fight.qte.reservations, paused.qte.reservations);
  assert.equal(s.send('pointerup', 799, 4001).accepted, false);
  s.send('pointerdown', 4010); s.send('pointerup', 4100);
  s.at(4400); assert.equal(s.delivery.poll(), true); assert.equal(s.f.state.fight.qte.successes, 1);
});

test('G15 page/BFCache suspension at zero remaining retains cut and seals once on return', () => {
  const s = setup(); s.activate(); s.send('pointerdown', 700); s.send('pointerup', 1100, 1110);
  const old = s.f.state.fight.qte.token;
  s.at(1120); s.delivery.setSuspended('page', true); s.at(9000); s.delivery.poll();
  assert.equal(s.f.state.fight.qte.successes, 0);
  s.delivery.setSuspended('page', false);
  assert.equal(s.f.commitQteDelivery(old, true), false);
  s.at(9080); assert.equal(s.delivery.poll(), true);
  assert.equal(s.f.state.fight.qte.successes, 1);
  assert.equal(s.delivery.poll(undefined, s.handle), false);
});

test('G12 rotation invalidates geometry and freezes remaining; resize jitter never extends the window', () => {
  const s = setup(); s.activate(); s.send('pointerdown', 700);
  const oldDisplay = s.delivery.prepareDisplay(1);
  s.at(800); s.delivery.invalidateGeometry(true);
  assert.equal(s.delivery.presentDisplay(oldDisplay, 2), false);
  s.at(4000); assert.equal(s.delivery.snapshot.remainingMs, 300);
  s.display(); assert.equal(s.f.state.fight.paused, false);
  assert.equal(s.send('pointerup', 4100).accepted, false);
  for (let i = 0; i < 20; i++) {
    s.at(4101 + i); s.delivery.invalidateGeometry(false); s.display();
  }
  assert.equal(s.delivery.snapshot.deadline, 1100);
  assert.equal(s.delivery.snapshot.remainingMs, 180);
  s.at(4400); s.delivery.poll(); assert.equal(s.f.state.fight.qte.failures, 1);
});

test('rotation during warning can confirm geometry without opening A early or deadlocking E', () => {
  const s = setup();
  s.at(300); s.delivery.invalidateGeometry(true);
  s.at(3000); s.display();
  assert.equal(s.f.state.fight.paused, false);
  assert.equal(s.delivery.snapshot.active, null);
  s.at(3299); assert.equal(s.send('pointerdown', 3299).accepted, false);
  s.at(3300); s.display();
  assert.equal(s.delivery.snapshot.active, 600);
  assert.equal(s.delivery.snapshot.deadline, 1100);
  s.at(3900); assert.equal(s.delivery.poll(), true);
});

test('unprovable move timestamp cannot be silently ignored to produce a valid returned contact', () => {
  const s = setup(); s.activate(); s.send('pointerdown', 650);
  s.send('pointermove', NaN, 700, { clientX: 100 });
  s.send('pointerup', 750);
  s.at(1200); s.delivery.poll(); assert.equal(s.f.state.fight.qte.failures, 1);
});

test('G19 adapter instance and QTE index bind stale timers; duplicate open does not reset the ledger', () => {
  const a = setup(), b = setup();
  assert.equal(a.delivery.open(0), a.handle);
  a.activate(); b.activate();
  assert.equal(a.f.advanceQteDelivery(b.f.state.fight.qte.token, 2, .6), false);
  assert.equal(a.f.commitQteDelivery(b.f.state.fight.qte.token, true), false);
  a.at(1200); assert.equal(a.delivery.poll(undefined, b.handle), false);
  assert.equal(a.delivery.poll(), true); assert.equal(a.delivery.poll(), false);
});

test('G06 stale identity-free cancel/up do not release the fresh normal hold', () => {
  const { f } = hookedFight(); const input = createFishingInput(f);
  input.down(0, 0, 1000); input.cancel(1100); input.down(0, 0, 1200);
  input.step(.5, 1500); f.step(.5); assert.equal(f.state.reeling, true);
  input.cancel(1150); input.up(1150);
  input.step(.01, 1510); f.step(.01); assert.equal(f.state.reeling, true);
  input.up(1520); input.step(.04, 1550); f.step(.04); assert.equal(f.state.reeling, false);
});

test('G14/G17 same-render normal fresh down at cut survives the single domain application', () => {
  const s = setup(); s.activate(); s.send('pointerdown', 700); s.send('pointerup', 800);
  const input = createFishingInput(s.f, undefined, { qteDelivery: s.delivery });
  s.at(1200);
  input.down(0, 0, 1200, { event: pointer('pointerdown', 1200), receipt: 1200 });
  input.step(.25, 1200); s.f.step(.25);
  assert.equal(s.f.state.fight.qte.successes, 1);
  assert.equal(s.f.state.reeling, true);
  s.at(1210); input.up(800, { event: pointer('pointerup', 800), receipt: 1210 });
  s.f.step(.01); assert.equal(s.f.state.reeling, true, 'late QTE up is isolated');
});

for (const success of [true, false]) test(`G13/G14 30/60/144fps, irregular render and long capped QTE frame: success=${success}`, () => {
  const runs = [30, 60, 144, 0].map((hz, index) => {
    const s = setup(); s.activate();
    const before = s.f.state.fight;
    if (success) { s.send('pointerdown', 700); s.send('pointerup', 1100, 1199); }
    // A long QTE render gap accepts the usual capped .25s. E still reaches
    // its real cut; the domain cannot bank this render budget as normal time.
    s.f.step(.25); s.f.step(.25);
    for (const key of ['distance', 'tension', 'normalSeconds', 'rngCalls', 'elapsedSeconds']) assert.equal(s.f.state.fight[key], before[key]);
    const cutAt = s.domainStart + 1.2;
    s.f.queueFightContact('down', cutAt, 'first-normal');
    s.at(1200 + index * 1000); assert.equal(s.delivery.poll(), true);
    near(s.f.state.fight.elapsedSeconds, cutAt);
    assert.equal(s.f.state.fight.qte.successes, +success);
    let elapsed = 0, frame = 0;
    while (elapsed < .6) {
      const dt = Math.min(.6 - elapsed, hz ? 1 / hz : [.001, .032, .075, .25, .004][frame++ % 5]);
      s.f.step(dt); elapsed += dt;
    }
    const result = s.f.state.fight;
    return Object.fromEntries(['distance', 'tension', 'normalSeconds', 'elapsedSeconds', 'rngCalls', 'armSeconds', 'qteSeconds'].map(key => [key, result[key]]));
  });
  for (const result of runs.slice(1)) for (const key of Object.keys(result)) near(result[key], runs[0][key]);
});

test('G19 future enqueue is not application, duplicate futures and foreign factory/fight/index tokens are rejected', () => {
  const make = () => {
    const { f } = hookedFight({ speciesId: 'alligator-gar', size: 'max', rod: 10, reel: 10, startDistance: 4.51 },
      { qte: { enabled: true, selectOperation: () => 'flick' } });
    f.reel(true); while (f.state.fight.mode === 'normal') f.step(1 / 60); return f;
  };
  const f = make(), foreign = make(), token = f.state.fight.qte.token, deadline = f.state.fight.qte.deadlineSeconds;
  assert.equal(f.submitQteResult(foreign.state.fight.qte.token, true, deadline), false);
  assert.equal(f.submitQteResult({ ...token, index: token.index + 1 }, true, deadline), false);
  assert.equal(f.submitQteResult({ ...token, fightId: token.fightId + 1 }, true, deadline), false);
  assert.equal(f.submitQteResult(token, true, deadline), true);
  assert.equal(f.submitQteResult(token, false, deadline), false);
  assert.equal(f.state.fight.qte.successes, 0);
  while (!f.state.fight.qte.successes) f.step(1 / 60);
  assert.equal(f.state.fight.qte.failures, 0);
});

test('G18/G19 same fight different indices, old epochs and near-shore remaining reservations stay distinct', () => {
  const s = setup(), handles = [], oldTokens = [];
  for (let index = 0; index < 3; index++) {
    if (index) {
      s.f.reel(true);
      for (let i = 0; s.f.state.fight.mode === 'normal' && i < 300; i++) s.f.step(1 / 60);
      s.at(index * 2000);
      handles.push(s.delivery.open(index * 2000));
    } else handles.push(s.handle);
    assert.equal(s.f.state.fight.qte.token.index, index);
    const token = s.f.state.fight.qte.token; oldTokens.push(token);
    for (const old of oldTokens.slice(0, -1)) assert.equal(s.f.commitQteDelivery(old, true), false);
    s.at(index * 2000 + 600); s.display();
    s.send('pointerdown', index * 2000 + 700); s.send('pointerup', index * 2000 + 800);
    s.at(index * 2000 + 1200);
    if (index) assert.equal(s.delivery.poll(undefined, handles[index - 1]), false);
    assert.equal(s.delivery.poll(), true);
    assert.equal(s.f.state.fight.qte.successes, index + 1);
    assert.equal(s.f.state.phase, 'fight');
  }
  assert.equal(new Set(handles).size, 3);
  s.f.reel(true); s.f.step(1 / 60); assert.equal(s.f.state.phase, 'landing');
});

test('control and token invalidation do not rebuild the stable QTE ledger or replenish time', () => {
  const s = setup(); s.activate(); s.send('pointerdown', 700);
  const old = s.f.state.fight.qte.token;
  s.f.cancelInput();
  assert.equal(s.send('pointerup', 800).accepted, false);
  s.at(850); s.display(); s.send('pointerdown', 900); s.send('pointerup', 1000);
  s.at(1200); assert.equal(s.f.commitQteDelivery(old, true), false);
  assert.equal(s.delivery.poll(), true); assert.equal(s.f.state.fight.qte.successes, 1);
  assert.equal(s.delivery.snapshot.deadline, 1100);
});

test('control ingress precedes focus/capture work, and self-release lostcapture cannot cancel an up', () => {
  const s = setup();
  const oldWindow = globalThis.window, oldDocument = globalThis.document;
  const performanceDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'performance');
  const canvas = new EventTarget(), captures = new Set(), ingress = [];
  let raw = 0;
  try {
    globalThis.window = new EventTarget(); globalThis.document = new EventTarget();
    Object.defineProperty(globalThis, 'performance', { configurable: true, value: { now: () => raw } });
    const input = createFishingInput(s.f, undefined, { qteDelivery: s.delivery });
    const receive = input.receivePointer;
    input.receivePointer = (event, receipt) => { ingress.push(receipt); receive(event, receipt); };
    canvas.hasPointerCapture = id => captures.has(id);
    canvas.setPointerCapture = id => { captures.add(id); raw += 50; };
    canvas.releasePointerCapture = id => {
      captures.delete(id);
      const event = new Event('lostpointercapture');
      Object.defineProperties(event, { pointerId: { value: id }, timeStamp: { value: raw } });
      canvas.dispatchEvent(event);
    };
    canvas.focus = () => { raw += 50; };
    const controls = createControls(canvas, {}, { style: {} }, { input, canLook: () => false });
    controls.setMode('fishing'); s.activate();
    function send(type, stamp, receipt) {
      raw = receipt; s.at(receipt);
      const event = new Event(type);
      for (const [key, value] of Object.entries(pointer(type, stamp))) if (key !== 'type') Object.defineProperty(event, key, { value });
      canvas.dispatchEvent(event);
    }
    send('pointerdown', 610, 620); send('pointerup', 800, 1199);
    assert.deepEqual(ingress, [620, 1199], 'capture/focus and self lostcapture do not move or duplicate ingress');
    s.at(1200); assert.equal(s.delivery.poll(), true);
    assert.equal(s.f.state.fight.qte.successes, 1);
    assert.equal(s.observations.at(-1).edges[0].receipt, 620);
    assert.equal(s.observations.at(-1).edges[1].receipt, 1199);
  } finally {
    if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow;
    if (oldDocument === undefined) delete globalThis.document; else globalThis.document = oldDocument;
    Object.defineProperty(globalThis, 'performance', performanceDescriptor);
  }
});

test('G09 drop-old/drop-new counterexamples lose a valid three-contact sequence', () => {
  const edges = Array.from({ length: 6 }, (_, i) => ({ type: i % 2 ? 'up' : 'down', contact: Math.floor(i / 2) }));
  const complete = list => list.filter(edge => edge.type === 'up' && list.some(down => down.type === 'down' && down.contact === edge.contact)).length;
  assert.equal(complete(edges), 3);
  assert.equal(complete(edges.slice(0, 5)), 2); assert.equal(complete(edges.slice(1)), 2);
});

for (const seconds of [.5, 1, 1.5]) test(`each existing non-tap duration ${seconds}s keeps inclusive D and fixed C`, () => {
  const species = FISH_SPECIES.find(fish => getQteDifficulty(fish, fish.minLengthCm).seconds === seconds);
  const s = setup({ condition: { speciesId: species.id, size: 'min' } }); s.activate();
  const deadline = 600 + seconds * 1000;
  s.send('pointerdown', 600); s.send('pointerup', deadline, deadline + 99);
  s.at(deadline + 100); assert.equal(s.delivery.poll(), true);
  assert.equal(s.f.state.fight.qte.successes, 1); assert.equal(s.delivery.snapshot.deadline, deadline);
});

test('repeat technical interruptions spend the same remaining budget and end without an infinite result wait', () => {
  const s = setup({ capacity: 1 }); s.activate();
  let raw = 600;
  for (let i = 0; i < 5; i++) {
    s.send('pointerdown', raw + 10); s.send('pointerup', raw + 100);
    assert.equal(s.delivery.snapshot.remainingMs, 400 - i * 100);
    assert.equal(s.delivery.snapshot.deadline, 1100);
    raw += 1100; s.at(raw); s.delivery.resumeTechnical();
    if (i < 4) s.display();
  }
  assert.equal(s.f.state.fight.qte.failures, 0);
  s.at(raw + 100); assert.equal(s.delivery.poll(), true);
  assert.equal(s.f.state.fight.qte.failures, 1); assert.equal(s.delivery.poll(), false);
});
