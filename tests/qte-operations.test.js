import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreQteContact, evaluateQteOperation, QTE_DIRECTIONS } from '../src/game/qte-operations.js';
import { operationSetup, displayGeometry } from './helpers/qte-operations.js';
import { getQteDifficulty } from '../src/game/fight-qte.js';
import { FISH_SPECIES } from '../src/game/fish-species.js';

const window = { active: 600, deadline: 1100, cut: 1200 };
const geometry = Object.freeze({ ...displayGeometry, revision: 0 });
const contact = extra => ({ pointerType: 'mouse', button: 0, isPrimary: true, displayRevision: 0, geometry,
  downSource: 600, upSource: 700, downReceipt: 600, upReceipt: 700,
  startX: 0, startY: 0, endX: 35, endY: 0, maxDisplacement: 35, cancelled: false, ...extra });
const score = (operation, extra = {}, direction = 'right', timing = window) => scoreQteContact({ descriptor: { operation, direction }, contact: contact(extra), window: timing });
const endpoint = (direction, distance, degrees = 0) => {
  const v = QTE_DIRECTIONS[direction], angle = degrees * Math.PI / 180;
  return { endX: distance * (v.x * Math.cos(angle) - v.y * Math.sin(angle)), endY: distance * (v.y * Math.cos(angle) + v.x * Math.sin(angle)) };
};

for (const operation of ['flick', 'swipe']) for (const direction of Object.keys(QTE_DIRECTIONS)) {
  test(`${operation}/${direction}: inclusive distance, both angle boundaries, zero and reverse direction`, () => {
    const distance = operation === 'flick' ? 35 : 75, degrees = operation === 'flick' ? 35 : 30;
    for (const [delta, pass] of [[-0.000001, false], [0, true], [0.000001, true]])
      assert.equal(score(operation, endpoint(direction, distance + delta), direction), pass, `distance ${delta}`);
    for (const sign of [-1, 1]) for (const [delta, pass] of [[-0.000001, true], [0, true], [0.000001, false]])
      assert.equal(score(operation, endpoint(direction, 100, sign * (degrees + delta)), direction), pass, `angle ${sign * (degrees + delta)}`);
    assert.equal(score(operation, { endX: 0, endY: 0 }, direction), false);
    assert.equal(score(operation, endpoint(direction, 100, 180), direction), false);
  });
}
test('flick <=300ms, tap <=350ms and all operation endpoints obey inclusive A/D, strict receipt C', () => {
  for (const [operation, bound] of [['flick', 300], ['tap', 350]]) for (const [delta, pass] of [[-0.001, true], [0, true], [0.001, false]])
    assert.equal(score(operation, { endX: operation === 'tap' ? 0 : 35, maxDisplacement: operation === 'tap' ? 0 : 35,
      upSource: 600 + bound + delta, upReceipt: 600 + bound + delta }), pass);
  for (const operation of ['flick', 'swipe', 'tap', 'target']) {
    const c = { endX: operation === 'flick' ? 35 : operation === 'swipe' ? 75 : 0, maxDisplacement: operation === 'tap' ? 0 : 75,
      downSource: 1000, downReceipt: 1000, upSource: 1100, upReceipt: 1199.999 };
    assert.equal(score(operation, c), true, operation);
    assert.equal(score(operation, { ...c, upReceipt: 1200 }), false, operation);
    assert.equal(score(operation, { ...c, upSource: 1100.001 }), false, operation);
    assert.equal(score(operation, { ...c, downSource: 599.999 }), false, operation);
    assert.equal(score(operation, { ...c, upSource: 999.999 }), false, operation);
    assert.equal(score(operation, { ...c, upReceipt: 1099 }), false, operation);
  }
});
test('tap max path displacement includes 14px and rejects a returned drag; flick/swipe use endpoints', () => {
  for (const [movement, pass] of [[13.999999, true], [14, true], [14.000001, false]])
    assert.equal(score('tap', { endX: 0, maxDisplacement: movement }), pass);
  assert.equal(score('tap', { endX: 0, maxDisplacement: 100 }), false);
  for (const operation of ['flick', 'swipe']) assert.equal(score(operation, { endX: 1, maxDisplacement: 150 }), false);
});
test('target: mouse32/touch40, both down/up, cardinal circumference and four corners', () => {
  for (const [pointerType, radius] of [['mouse', 32], ['touch', 40]]) for (const axis of ['x', 'y']) for (const sign of [-1, 1]) {
    for (const [delta, pass] of [[-0.000001, true], [0, true], [0.000001, false]]) for (const end of ['start', 'end'])
      assert.equal(score('target', { pointerType, endX: 0, [`${end}${axis.toUpperCase()}`]: sign * (radius + delta) }), pass);
    assert.equal(score('target', { pointerType, startX: radius + 1, endX: 0 }), false);
    for (const x of [-1, 1]) for (const y of [-1, 1]) assert.equal(score('target', { pointerType, endX: radius * x, endY: radius * y }), false);
  }
});
test('invalid pointer, secondary mouse, nonprimary, missing geometry/revision, cancelled and abnormal times reject safely', () => {
  for (const extra of [{ pointerType: '' }, { pointerType: 'pen' }, { pointerType: undefined }, { button: 2 }, { isPrimary: false },
    { geometry: null }, { displayRevision: 1 }, { cancelled: true }, { upSource: NaN }, { downReceipt: Infinity }, { endX: NaN },
    { startX: -201 }, { maxDisplacement: -1 }]) assert.equal(score('flick', extra), false, JSON.stringify(extra));
});
test('pure evidence consumer is idempotent, checks identity and pairs, and bounds checkpoints at three taps', () => {
  const handle = { adapter: {}, instance: {}, fightId: 1, index: 0 }, descriptor = { fightId: 1, index: 0, operation: 'tap' };
  const c = { ...contact({ endX: 0, maxDisplacement: 0 }), ...handle, serial: 1, generation: 0, lifecycle: 0, pointerId: 1 };
  const edges = [{ type: 'down', source: 600, receipt: 600, serial: 0, contact: c }, { type: 'up', source: 700, receipt: 700, serial: 1, contact: c }];
  const input = { descriptor, handle, window, edges, final: false };
  const once = evaluateQteOperation(input);
  assert.deepEqual(evaluateQteOperation(input), once);
  assert.equal(once.completedOperations, 1); assert.equal(once.success, false);
  assert.equal(evaluateQteOperation({ ...input, previous: once }).completedOperations, 1);
  assert.equal(evaluateQteOperation({ ...input, edges: [...edges, edges[1]] }).completedOperations, 1);
  assert.equal(evaluateQteOperation({ ...input, edges: [edges[1]] }).completedOperations, 0);
  assert.equal(evaluateQteOperation({ ...input, edges: edges.map(e => ({ ...e, contact: { ...c, index: 1 } })) }).success, false);
  const done = { completedOperations: 3, success: true, throughSerial: 5 };
  assert.equal(evaluateQteOperation({ ...input, previous: done, final: true }).completedOperations, 3);
  assert.equal(evaluateQteOperation({ ...input, previous: done, final: true }).success, true);
  assert.throws(() => evaluateQteOperation({ ...input, descriptor: { ...descriptor, fightId: 2 } }), /identity/);
});

test('real delivery: three taps survive invalid retries, live previews, two overflow checkpoints and single seal', () => {
  const s = operationSetup({ operation: 'tap', capacity: 4 }); s.activate();
  const tap = at => { s.send('pointerdown', at); s.send('pointerup', at + 20); };
  tap(610);
  s.send('pointerdown', 650); s.send('pointermove', 660, { clientX: 15 }); s.send('pointerup', 670);
  assert.equal(s.delivery.preview().completedOperations, 1);
  assert.equal(s.delivery.preview().completedOperations, 1);
  s.send('pointerdown', 700); assert.equal(s.delivery.snapshot.interrupted, true);
  assert.equal(s.delivery.snapshot.completedOperations, 1);
  s.at(900); s.delivery.resumeTechnical(); s.display();
  tap(910); // active E=710
  s.send('pointerdown', 950); s.send('pointercancel', 960);
  s.send('pointerdown', 970); s.send('pointerup', 980); // overflow on up, checkpoint closes partial contact
  assert.equal(s.delivery.snapshot.interrupted, true); assert.equal(s.delivery.snapshot.completedOperations, 2);
  const remaining = s.delivery.snapshot.remainingMs;
  s.at(2000); s.delivery.resumeTechnical(); s.display();
  assert.equal(s.delivery.snapshot.remainingMs, remaining);
  tap(2010);
  assert.equal(s.delivery.preview().completedOperations, 3); assert.equal(s.f.state.fight.qte.successes, 0);
  s.at(2000 + remaining + 100); assert.equal(s.delivery.poll(), true);
  assert.equal(s.f.state.fight.qte.successes, 1); assert.equal(s.delivery.poll(), false);
});
test('coalesced returned tap drag is rejected, cancelled completed contact loses provisional success, fresh retry succeeds', () => {
  const s = operationSetup({ operation: 'tap' }); s.activate();
  s.send('pointerdown', 610);
  s.send('pointermove', 630, { getCoalescedEvents: () => [{ timeStamp: 620, clientX: 15, clientY: 0 }], clientX: 0 });
  s.send('pointerup', 640);
  assert.equal(s.delivery.preview().completedOperations, 0);
  for (const at of [650, 750, 850]) { s.send('pointerdown', at); s.send('pointerup', at + 20); }
  assert.equal(s.delivery.preview().success, true);
  s.send('pointercancel', 660, {}, 900);
  assert.equal(s.delivery.preview().completedOperations, 2);
  s.send('pointerdown', 910); s.send('pointerup', 920);
  assert.equal(s.seal(), true); assert.equal(s.f.state.fight.qte.successes, 1);
});
test('pointerType and immutable prepared geometry reach scoring; unknown/type-changing contacts cannot use touch radius', () => {
  const s = operationSetup({ operation: 'target' }); s.activate();
  const supplied = { region: { left: -100, top: -100, right: 100, bottom: 100 }, target: { x: 0, y: 0 } };
  s.at(601); const prep = s.display(supplied); supplied.target.x = 100;
  assert.ok(Object.isFrozen(prep.geometry.target));
  for (const type of ['', 'pen', undefined]) assert.equal(s.send('pointerdown', 610, { pointerType: type }).accepted, false);
  s.send('pointerdown', 620, { clientX: 39, pointerType: 'mouse' }); s.send('pointerup', 630, { clientX: 39, pointerType: 'mouse' });
  assert.equal(s.delivery.preview().success, false);
  s.send('pointerdown', 640, { clientX: 39, pointerType: 'mouse' }); s.send('pointerup', 650, { clientX: 39, pointerType: 'touch' });
  assert.equal(s.delivery.preview().success, false);
  s.send('pointerdown', 660, { clientX: 40, pointerType: 'touch' }); s.send('pointerup', 670, { clientX: 40, pointerType: 'touch' });
  assert.equal(s.seal(), true); assert.equal(s.f.state.fight.qte.successes, 1);
});
test('warning, fresh down, display epoch, resize, rotation and zero-budget technical interruption', () => {
  const s = operationSetup({ operation: 'target' });
  assert.equal(s.send('pointerdown', 599).accepted, false);
  s.activate(); s.send('pointerup', 601); assert.equal(s.delivery.preview().success, false);
  s.send('pointerdown', 610); s.at(620); s.delivery.invalidateGeometry(false); s.display({ ...displayGeometry, target: { x: 100, y: 0 } });
  s.send('pointerup', 630, { clientX: 100 }); assert.equal(s.delivery.preview().success, false);
  s.send('pointerdown', 640, { clientX: 100 }); s.at(650); s.delivery.invalidateGeometry(true);
  s.at(4000); s.display(); assert.equal(s.delivery.snapshot.remainingMs, 450);
  s.send('pointerup', 4010); assert.equal(s.delivery.preview().success, false);
  const zero = operationSetup({ operation: 'swipe', capacity: 1 }); zero.activate();
  zero.send('pointerdown', 600); zero.send('pointerup', 1100, { clientX: 75 });
  assert.equal(zero.delivery.snapshot.interrupted, true); assert.equal(zero.delivery.snapshot.remainingMs, 0);
  zero.at(9000); zero.delivery.resumeTechnical(); zero.at(9100);
  assert.equal(zero.delivery.poll(), true); assert.equal(zero.f.state.fight.qte.failures, 1); assert.equal(zero.delivery.poll(), false);
});
test('all existing 0.5/1/1.5s windows and the fixed 2s tap window accept source D and reject C', () => {
  for (const seconds of [.5, 1, 1.5, 2]) for (const late of [false, true]) {
    const species = FISH_SPECIES.find(f => getQteDifficulty(f, f.minLengthCm).seconds === (seconds === 2 ? .5 : seconds));
    const s = operationSetup({ operation: seconds === 2 ? 'tap' : 'swipe', condition: { speciesId: species.id, size: 'min' } }); s.activate();
    const d = 600 + seconds * 1000;
    if (seconds === 2) for (const at of [610, 650]) { s.send('pointerdown', at); s.send('pointerup', at + 10); }
    s.send('pointerdown', d - 100);
    s.send('pointerup', d, { clientX: seconds === 2 ? 0 : 75 }, d + (late ? 100 : 99));
    s.at(d + 100); s.delivery.poll(); assert.equal(s.f.state.fight.qte.successes, +!late);
  }
});
test('sufficient success survives overflow at zero remaining; missing facts still fail once', () => {
  const s = operationSetup({ operation: 'swipe', capacity: 2 }); s.activate();
  s.send('pointerdown', 610); s.send('pointerup', 650, { clientX: 75 });
  assert.equal(s.delivery.preview().success, true);
  s.send('pointerdown', 1100); assert.equal(s.delivery.snapshot.interrupted, true);
  assert.equal(s.delivery.snapshot.completedOperations, 1);
  s.at(4000); s.delivery.resumeTechnical(); s.at(4100);
  assert.equal(s.delivery.poll(), true); assert.equal(s.f.state.fight.qte.successes, 1); assert.equal(s.delivery.poll(), false);
});
