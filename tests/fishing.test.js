import test from 'node:test';
import assert from 'node:assert/strict';
import { createFishing, PHASE } from '../src/game/fishing.js';
import { createFishingInput } from '../src/input/fishing.js';
import { randomGenerator, shoreRadius } from '../src/world/config.js';

function cast(fishing, dx = 0, dy = 100) {
  fishing.prepare({ x: 0, z: 30 }, 0); fishing.aim(dx, dy); fishing.cast();
  fishing.step(fishing.settings.flightSeconds + 0.01);
  assert.equal(fishing.state.phase, PHASE.LURE);
}
function bite(fishing) {
  for (let i = 0; i < 20000 && fishing.state.phase === PHASE.LURE; i++) fishing.step(0.01);
  assert.equal(fishing.state.phase, PHASE.BITE);
}
function hooked(options = {}) {
  const fishing = createFishing({ random: () => 0.5, ...options });
  cast(fishing); bite(fishing); assert.equal(fishing.hook(), true); return fishing;
}

test('cast direction/distance, shoreline clipping and cancelled preparation', () => {
  const f = createFishing({ isWater: (x, z) => Math.hypot(x, z) < shoreRadius(Math.atan2(z, x)) - 2 });
  f.prepare({ x: 0, z: 30 }, 0); f.aim(80, -120);
  assert.ok(f.state.target.x > 0 && f.state.target.z < 30);
  assert.ok(f.state.distance > 20);
  f.cancelInput(); assert.equal(f.state.phase, PHASE.READY);
  f.prepare({ x: 0, z: 30 }, Math.PI / 2); f.aim(0, 180);
  assert.ok(f.state.target.x > 31 && Math.abs(f.state.target.z - 30) < 0.01);
  const shore = createFishing({ isWater: (x, z) => z >= -1 });
  shore.prepare({ x: 0, z: 0 }, 0); shore.aim(0, 180);
  assert.equal(shore.state.validCast, false); shore.cast();
  assert.equal(shore.state.phase, PHASE.READY);
});

test('bite sampling averages 10–20s and is independent of simulation frame size', () => {
  const random = randomGenerator(420);
  let total = 0;
  for (let i = 0; i < 1000; i++) {
    const f = createFishing({ random }); cast(f);
    let seconds = 0;
    while (f.state.phase === PHASE.LURE) { f.step(0.1); seconds += 0.1; }
    total += seconds;
  }
  assert.ok(total / 1000 > 10 && total / 1000 < 20, `mean=${total / 1000}`);
  const times = [1 / 30, 1 / 60, 1 / 144].map(dt => {
    const f = createFishing({ random: () => 0.5 }); cast(f); let t = 0;
    while (f.state.phase === PHASE.LURE) { f.step(dt); t += dt; }
    return t;
  });
  assert.ok(Math.max(...times) - Math.min(...times) < 0.05);
});

test('reel, wait and short flick have separate effects; retrieval allows another cast', () => {
  const f = createFishing({ config: { biteDelay: 100 } }); cast(f);
  const input = createFishingInput(f), initial = f.state.distance;
  input.down(0, 0); input.move(40, 0); input.step(0.1); input.up();
  assert.ok(f.state.action > 0); assert.equal(f.state.reeling, false);
  f.step(0.5); assert.equal(f.state.distance, initial);
  input.down(0, 0); input.step(0.3); f.step(1); assert.ok(f.state.distance < initial);
  input.cancel(); assert.equal(f.state.reeling, false);
  f.reel(true); f.step(50); assert.equal(f.state.phase, PHASE.READY);
  assert.equal(f.prepare({ x: 0, z: 30 }, 0), true);
});

test('fresh tap hooks within the window; a carried hold/release or drag never hooks', () => {
  const f = createFishing({ random: () => 0.5 }); cast(f);
  const input = createFishingInput(f);
  input.down(0, 0); input.step(0.3); bite(f);
  input.up(); assert.equal(f.state.phase, PHASE.BITE);
  input.down(0, 0); input.move(100, 0); input.up(); assert.equal(f.state.phase, PHASE.BITE);
  input.down(0, 0); input.step(0.05); input.up(); assert.equal(f.state.phase, PHASE.FIGHT);
  assert.equal(f.state.reeling, false);
});

test('missed hook, excess tension and prolonged slack fail, then allow retry', () => {
  const missed = createFishing({ random: () => 0.5 }); cast(missed); bite(missed);
  missed.step(1.01); assert.equal(missed.state.phase, PHASE.FAILED); assert.equal(missed.hook(), false);
  const broken = hooked(); broken.reel(true);
  while (broken.state.phase === PHASE.FIGHT) broken.step(0.05);
  assert.equal(broken.state.phase, PHASE.FAILED); assert.match(broken.state.message, /ライン/);
  const slack = hooked({ random: () => 0 }); slack.step(3);
  assert.equal(slack.state.phase, PHASE.FAILED); assert.match(slack.state.message, /緩み/);
  for (const f of [missed, broken, slack]) {
    assert.equal(f.state.catches.length, 0); f.step(2);
    assert.equal(f.state.phase, PHASE.READY); cast(f);
  }
});

test('controlled fights take 5–15s across fish sizes, land once, and retain structured catches', () => {
  for (const size of [0.01, 0.5, 0.99]) {
    const f = hooked({ random: () => size, now: () => 1700000000000 });
    let elapsed = 0, holding = false;
    while (f.state.phase === PHASE.FIGHT && elapsed < 30) {
      if (f.state.tension < 0.4) holding = true;
      if (f.state.tension > 0.78) holding = false;
      f.reel(holding); f.step(1 / 60); elapsed += 1 / 60;
    }
    assert.equal(f.state.phase, PHASE.LANDING);
    assert.ok(elapsed >= 5 && elapsed <= 15, `fight=${elapsed}`);
    f.step(2); assert.equal(f.state.phase, PHASE.RESULT);
    f.step(10); assert.equal(f.state.catches.length, 1);
    const record = f.state.catch;
    assert.equal(record.speciesId, 'black-bass'); assert.equal(record.schemaVersion, 1);
    assert.ok(record.lengthCm >= 25 && record.lengthCm <= 55 && record.weightKg > 0);
    f.closeResult(); assert.equal(f.state.phase, PHASE.READY);
    assert.equal(f.state.catches[0], record); assert.equal(f.state.catch, null);
    cast(f);
  }
});

test('cancellation releases holds in lure/fight and returns aim to ready; active fishing cannot leave', () => {
  const f = createFishing(), input = createFishingInput(f);
  f.prepare({ x: 0, z: 0 }, 0); input.down(1, 1); input.cancel();
  assert.equal(f.state.phase, PHASE.READY);
  cast(f); assert.equal(f.canLeave(), false); f.reset(); assert.equal(f.state.phase, PHASE.LURE);
  input.down(0, 0); input.step(0.3); assert.equal(f.state.reeling, true);
  input.cancel(); assert.equal(f.state.reeling, false);
  const fight = hooked(), fightInput = createFishingInput(fight);
  fightInput.down(0, 0); fightInput.step(0.3); fightInput.cancel();
  assert.equal(fight.state.reeling, false); assert.equal(fight.canLeave(), false);
});
test('gesture event timestamps preserve quick flicks when rendering is delayed', () => {
  const f = createFishing(); cast(f);
  const input = createFishingInput(f);
  input.down(0, 0, 1000); input.move(40, 0);
  input.step(0.3); input.up(1080);
  assert.ok(f.state.action > 0); assert.equal(f.state.reeling, false);
  f.step(2);
  input.down(0, 0, 2000); input.move(40, 0); input.up(2500);
  assert.equal(f.state.action, 0);
});
