import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { createSurfaceTimeline, createFishingEffects, surfaceHeight, SURFACE_POOL_SIZE } from '../src/rendering/fishing-effects.js';
import { createFishingView } from '../src/rendering/fishing.js';
import { createFishing, getLurePosition } from '../src/game/fishing.js';
import { FISHING_CONFIG } from '../src/game/fishing-config.js';
import { fishingDisplayDraws } from '../scripts/lib/mobile-rod-reel-replay.js';

const initial = () => ({ phase: 'ready', revision: 0, time: 0, reeling: false,
  origin: { x: 10, z: 20 }, target: { x: 10, z: 12 }, heading: 0, distance: 8,
  lureId: 'minnow', action: 0, validCast: true });
function rig(seed) {
  const timeline = createSurfaceTimeline({ seed }), state = initial();
  let elapsed = 0;
  const update = (phase = state.phase, dt = 0, active = true, reeling = state.reeling) => {
    if (phase !== state.phase) { state.phase = phase; state.revision++; state.time = 0; }
    elapsed += dt; state.time += dt; state.reeling = reeling;
    const before = structuredClone(state), point = getLurePosition(state);
    timeline.update(state, active, elapsed, point.x, point.z);
    assert.deepEqual(state, before);
  };
  return { timeline, state, update, get elapsed() { return elapsed; } };
}

test('surface one-shots require observed CAST→LURE / LURE→BITE, revision and an active display', () => {
  const r = rig(21); r.update(); r.update('cast', .1); r.update('lure', .1);
  assert.deepEqual(r.timeline.counts, { landing: 1, bite: 0, reel: 0 });
  for (let i = 0; i < 8; i++) r.update('lure');
  assert.equal(r.timeline.counts.landing, 1);
  assert.equal(r.timeline.events.find(e => e.kind).x, r.state.target.x);
  assert.equal(r.timeline.events.find(e => e.kind).z, r.state.target.z);
  r.update('bite', .1); for (let i = 0; i < 8; i++) r.update('bite');
  assert.deepEqual(r.timeline.counts, { landing: 1, bite: 1, reel: 0 });
  for (const first of ['ready', 'lure', 'bite', 'fight']) {
    const p = rig(); p.update(first); assert.equal(p.timeline.counts.landing + p.timeline.counts.bite, 0);
  }
  const skipped = rig(); skipped.update('cast'); skipped.state.revision += 4; skipped.update('lure', .1);
  assert.equal(skipped.timeline.counts.landing, 0, 'no replay across unobserved transitions');
  const asleep = rig(); asleep.update('cast', 0, false); asleep.update('lure', .1);
  assert.equal(asleep.timeline.counts.landing, 0);
});

test('reel scheduling is deterministic in seconds at 30/60/144 FPS, 3–5/s with irregular intervals', () => {
  const play = (fps, seed) => {
    const r = rig(seed), births = new Map(); r.update('fight', 0, true, true);
    for (let i = 0; i < fps * 20; i++) {
      r.update('fight', 1 / fps);
      for (const event of r.timeline.events) if (event.kind) births.set(event.serial, { born: event.born, size: event.size });
    }
    assert(r.timeline.counts.reel / 20 >= 3 && r.timeline.counts.reel / 20 <= 5);
    const values = [...births.values()];
    const intervals = values.slice(1).map((e, i) => e.born - values[i].born);
    assert(intervals.every(dt => dt >= .15 - 1e-9 && dt <= .35 + 1e-9));
    assert(new Set(intervals.map(n => n.toFixed(5))).size > 20);
    return values;
  };
  const expected = play(30, 55);
  assert.deepEqual(play(60, 55), expected); assert.deepEqual(play(144, 55), expected);
  assert.deepEqual(play(30, 55), expected); assert.notDeepEqual(play(30, 56), expected);
});

test('release, QTE ownership/stop, menus/background and long gaps never bank reel bursts', () => {
  const r = rig(14); r.update('fight', 0, true, true);
  for (let i = 0; i < 20; i++) r.update('fight', .1);
  assert(r.timeline.counts.reel >= 6);
  for (const owner of ['qte', 'suspended', 'normal']) {
    r.state.inputOwner = owner;
    const count = r.timeline.counts.reel;
    for (let i = 0; i < 15; i++) r.update('fight', .1, true, false);
    assert.equal(r.timeline.counts.reel, count); assert.equal(r.timeline.nextAt, Infinity);
    r.update('fight', 0, true, true); assert.equal(r.timeline.counts.reel, count);
    assert(r.timeline.nextAt >= r.elapsed + .15);
  }
  for (const active of [false, false, true]) {
    const count = r.timeline.counts.reel; r.update('fight', 20, active, true);
    assert.equal(r.timeline.counts.reel, count); assert(r.timeline.events.every(e => !e.kind));
  }
  const originalRandom = Math.random;
  try {
    Math.random = () => { throw new Error('domain RNG consumed'); };
    for (let i = 0; i < 20; i++) r.update('fight', .1, true, true);
  } finally { Math.random = originalRandom; }
});

test('all terminal/inactive phases clear immediately; lifetime/pool/overwrite stay bounded', () => {
  for (const phase of ['ready', 'aim', 'cast', 'landing', 'failed', 'result', 'boat']) {
    const r = rig(); r.update('cast'); r.update('lure', .1); r.update('bite', .1);
    assert(r.timeline.events.some(e => e.kind)); r.update(phase, 0);
    assert(r.timeline.events.every(e => !e.kind), phase);
  }
  const r = rig(); r.update('cast'); r.update('lure', .1); r.update('bite', .1);
  for (let i = 0; i < 10; i++) r.update('bite', .1);
  assert(r.timeline.events.every(e => !e.kind));
  assert.equal(r.timeline.events.length, SURFACE_POOL_SIZE);
  r.update('fight', 0, true, true);
  r.timeline.events.forEach((e, i) => Object.assign(e, { kind: i === 0 ? 'bite' : 'reel', serial: i + 1, born: r.elapsed, life: .86 }));
  r.update('fight', .3);
  assert.equal(r.timeline.events.length, 6); assert.equal(r.timeline.events[0].kind, 'bite');
  assert(r.timeline.events.every(e => e.life <= 1));
  for (let i = 0; i < 80; i++) r.update('fight', .25);
  assert(r.timeline.events.filter(e => e.kind).length <= 6);
});

test('one fixed fog-aware batch provides visible vertical droplets, bounded triangles and no frame resource creation', () => {
  const effects = createFishingEffects({ seed: 5 }), state = initial(), batches = effects.group.children;
  const ids = batches.map(m => [m.geometry, m.material, m.geometry.attributes.position, m.geometry.attributes.color]);
  assert.equal(batches.length, 1); assert.equal(new Set(batches.map(m => m.material)).size, 1);
  const material = batches[0].material;
  assert.equal(material.fog, true); assert.equal(material.depthTest, true); assert.equal(material.depthWrite, false);
  assert.equal(material.forceSinglePass, true); assert.equal(material.map, null);
  assert.equal(material.onBeforeCompile, THREE.Material.prototype.onBeforeCompile);
  const camera = new THREE.PerspectiveCamera(55, 390 / 844, .1, 2400);
  camera.position.set(10, 2.15, 21.25); camera.lookAt(10, 2.15, 0);
  const scene = new THREE.Scene(); scene.add(effects.group);
  const update = (phase, elapsed) => {
    if (phase !== state.phase) { state.phase = phase; state.revision++; }
    const point = getLurePosition(state), before = structuredClone(state);
    effects.update(state, true, elapsed, point.x, point.z); scene.updateMatrixWorld(true);
    assert.deepEqual(state, before);
  };
  try {
    update('cast', 0); update('lure', .1); update('lure', .3);
    const heights = () => {
      const p = batches[0].geometry.attributes.position;
      let height = 0;
      for (let i = p.count / 2; i < p.count; i++) height = Math.max(height, p.getY(i));
      return height;
    };
    const landingHeight = heights(); assert(landingHeight > .5 && landingHeight < 1.2);
    update('bite', .4); update('bite', .6);
    assert(heights() > landingHeight, 'BITE must stand higher than landing');
    const draws = fishingDisplayDraws(Object.fromEntries(batches.map(m => [m.name, m])), camera);
    assert.equal(Object.values(draws).reduce((n, d) => n + d.calls, 0), 1);
    assert.equal(Object.values(draws).reduce((n, d) => n + d.triangles, 0), 1152);
    update('fight', .7); state.reeling = true;
    for (let i = 0; i < 120; i++) { state.distance = 8 + i * .1; update('fight', .7 + i / 60); }
    batches.forEach((m, i) => assert.deepEqual([m.geometry, m.material, m.geometry.attributes.position, m.geometry.attributes.color], ids[i]));
    update('landing', 2.7); assert.equal(effects.group.visible, false);
    assert(Object.values(fishingDisplayDraws(Object.fromEntries(batches.map(m => [m.name, m])), camera)).every(d => d.calls === 0));
  } finally { effects.dispose(); }
  let disposal = 0;
  for (const [geometry] of ids) geometry.addEventListener('dispose', () => disposal++);
  material.addEventListener('dispose', () => disposal++);
  effects.dispose(); assert.equal(disposal, 0, 'second dispose is a no-op');
  assert.equal(scene.children.length, 0);
});

test('surface height follows the existing lake wave; 8m/32m/near contact and original view contract are immutable', () => {
  const water = readFileSync(new URL('../src/world/water.js', import.meta.url), 'utf8');
  assert(water.includes('sin(p.x * 0.12 + time * 0.8) * cos(p.y * 0.15 + time * 0.5) * 0.09'));
  for (const distance of [4.5, 8, 32]) {
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(), view = createFishingView(scene, camera);
    const state = initial(); state.distance = distance; state.target.z = 20 - distance;
    const fishing = { state, settings: FISHING_CONFIG }, tip = new THREE.Vector3(1, 2, 3);
    const group = scene.children[0], [ring, lure, shadow, line] = group.children;
    for (const phase of ['ready', 'aim', 'cast', 'lure', 'bite', 'fight', 'landing', 'failed', 'result']) {
      state.phase = phase; state.revision++;
      const before = structuredClone(state); view.update(fishing, true, state.revision * .1, tip);
      assert.deepEqual(state, before);
      assert.equal(ring.visible, ['aim', 'cast', 'lure', 'bite'].includes(phase));
      assert.equal(lure.visible, ['cast', 'lure'].includes(phase)); assert.equal(shadow.visible, phase === 'fight');
      if (['bite', 'fight'].includes(phase)) assert.deepEqual(Array.from(line.geometry.attributes.position.array), [1, 2, 3, 10, .12, 20 - distance].map(Math.fround));
    }
    view.dispose(); view.dispose();
  }
  for (let t = 0; t < 10; t += .1) assert(Math.abs(surfaceHeight(10, 12, t)) <= .09);
});

test('real domain QTE/pause reports no reeling; view disposal is wired once into both existing shutdown paths', () => {
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.equal(main.split('    fishingView.dispose();').length, 2);
  assert.equal(main.split('  fishingView?.dispose();').length, 2);
  assert.equal(main.split("addEventListener('webglcontextlost'").length, 2);
  const fishing = createFishing({ random: () => .5 });
  fishing.prepare({ x: 10, z: 20, heading: 0 }); fishing.cast();
  for (let i = 0; i < 120 && fishing.state.phase !== 'bite'; i++) fishing.step(.25);
  assert.equal(fishing.hook(), true); fishing.reel(true); fishing.step(.1);
  fishing.pauseFight(); fishing.step(.1);
  assert.equal(fishing.state.inputOwner, 'suspended'); assert.equal(fishing.state.reeling, false);
});
