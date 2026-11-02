import * as THREE from 'three';
import { test, expect } from './diagnostics-fixture.js';
import { createRodReelView } from '../../src/rendering/rod-reel-view.js';
import { FISHING_CONFIG } from '../../src/game/fishing-config.js';
import { GEAR_PROFILES, openGear, assertGear, gearRead, gearTick, gearPhase, gearEvidence } from './rod-reel-fixture.js';

const ORIGIN = [10, 20]; // Validated initial save used by openGear.
// Reconstructing a cast fraction uses double-precision subtraction/dot/division.
// This bound is separate from (and much smaller than) the Float32 line error,
// whose exact rounded coordinates are checked without a tolerance in assertGear.
const SOURCE_WORLD_EPSILON = 2e-12;

function assertAnimatedClear(snapshot) {
  // Measure the current native HUD after its phase layout. The centred
  // reticle and lower controls are outside the top HUD exclusion band.
  const topControls = snapshot.controls.filter(rect => rect.id !== 'reticle'
    && rect.bottom < snapshot.viewport.height / 2);
  expect(topControls.length).toBeGreaterThan(0);
  const bottom = Math.max(...topControls.map(rect => rect.bottom));
  for (const [kind, part] of [['rod', snapshot.rod], ['reel', snapshot.reel]]) {
    expect(part.bounds.top, `${snapshot.phase} ${kind} must clear the complete top HUD by 2 CSS pixels`)
      .toBeGreaterThanOrEqual(bottom + 2);
  }
  return { topHudBottomCss: bottom, rodTopCss: snapshot.rod.bounds.top, reelTopCss: snapshot.reel.bounds.top,
    minimumClearanceCss: Math.min(snapshot.rod.bounds.top, snapshot.reel.bounds.top) - bottom };
}

function castSeconds(snapshot) {
  const target = snapshot.ring.center.world, lure = snapshot.lure.center.world;
  const dx = target[0] - ORIGIN[0], dz = target[2] - ORIGIN[1];
  return 0.8 * ((lure[0] - ORIGIN[0]) * dx + (lure[2] - ORIGIN[1]) * dz) / (dx * dx + dz * dz);
}

function sourceReplay(level) {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
  const view = createRodReelView(scene, camera, {
    equipment: { rodLevel: level, reelLevel: level }, subscribe: () => () => {},
  });
  let phase, revision = 0;
  return {
    check(snapshot, phaseSeconds) {
      if (phase !== snapshot.phase) { phase = snapshot.phase; revision++; }
      const c = snapshot.camera;
      camera.position.fromArray(c.position); camera.quaternion.fromArray(c.quaternion);
      Object.assign(camera, { fov: c.fov, aspect: c.aspect, near: c.near, far: c.far, zoom: c.zoom });
      camera.updateProjectionMatrix();
      view.update(true, { phase, revision, time: phaseSeconds }, snapshot.frame.elapsed);
      const expected = view.copyTipWorld(new THREE.Vector3());
      for (let i = 0; i < 3; i++) expect(Math.abs(expected.getComponent(i) - snapshot.tip.world[i])).toBeLessThanOrEqual(SOURCE_WORLD_EPSILON);
      return { phase, phaseSeconds, visualElapsed: snapshot.frame.elapsed, expectedTipWorld: expected.toArray(),
        actualTipWorld: snapshot.tip.world, lineStartWorld: snapshot.line.start.world,
        worldDelta: snapshot.line.worldDelta, projectionDelta: snapshot.line.projectionDelta };
    },
    dispose: () => view.dispose(),
  };
}

const cases = [
  { id: 'pc', level: 10, distance: 8, direction: 0 },
  { id: 'portrait', level: 1, distance: 32, direction: 1 },
  { id: 'landscape', level: 5, distance: 40, direction: -1 },
];

for (const scenario of cases) test(`cast motion: ${scenario.id} Lv${scenario.level} ${scenario.distance}m same-frame physical tip`, async ({ createContext }, info) => {
  const profile = GEAR_PROFILES.find(p => p.id === scenario.id);
  const { page, click, input, errors } = await openGear(createContext, profile, { level: scenario.level });
  await click('#fish-button');
  for (let i = 0; i < 12; i++) await gearTick(page);
  const initial = await gearEvidence(page, info, 'motion-ready', { screenshot: true });
  assertGear(initial, scenario.level); expect(initial.line.visible).toBe(false);

  if (scenario.id === 'portrait') {
    // Cancel a native captured drag and verify the ordinary READY reset before
    // a new cast. No test state mutation or synthetic pointer event is used.
    await click('#cast-button'); await gearTick(page);
    const point = { x: 90, y: profile.height * 0.48 };
    await input.down(point); await input.move({ x: point.x + 50, y: point.y }); await gearTick(page);
    await input.cancel(); await input.up(); await gearTick(page);
    expect(await gearPhase(page)).toBe('ready');
    assertGear(await gearEvidence(page, info, 'motion-native-cancel'), scenario.level);
  }
  if (scenario.id === 'landscape') {
    // Menu opening uses the ordinary input reset to cancel AIM. Its first
    // resumed frame must already be neutral, without replaying the old hold.
    await click('#cast-button'); await gearTick(page); await gearTick(page);
    await click('#menu-button');
    const paused = await gearRead(page);
    await page.clock.fastForward(5000);
    expect((await gearRead(page)).renders).toBe(paused.renders);
    await click('#collection-close'); await page.clock.runFor(16);
    expect(await gearPhase(page)).toBe('ready');
    const resumed = await gearEvidence(page, info, 'motion-cancelled-aim-menu-resume');
    assertGear(resumed, scenario.level); expect(resumed.line.visible).toBe(false);
  }

  const replay = sourceReplay(scenario.level), numerical = [];
  try {
    await click('#cast-button');
    await expect(page.locator('#app')).toHaveAttribute('data-cast-preparing', 'true');
    // Existing preparation remains 0.1s and has no extra motion input wait.
    await gearTick(page);
    expect(await gearPhase(page)).toBe('aim');
    const entered = await gearRead(page);
    numerical.push({ ...replay.check(entered, 0), hudClearance: assertAnimatedClear(entered),
      clockSource: 'AIM first frame after preparation (domain time zero)' });
    expect(entered.line.visible).toBe(false);
    const point = { x: scenario.direction < 0 ? profile.width - 90 : scenario.direction > 0 ? 90 : profile.width / 2,
      y: profile.height * 0.48 };
    await input.down(point);
    await input.move({ x: point.x + 1, y: point.y });
    await input.move({ x: point.x + scenario.direction * (scenario.distance > 8 ? 181 : 0),
      y: point.y - (!scenario.direction && scenario.distance > 8 ? 181 : 0) });
    await gearTick(page);
    await expect(page.locator('#line-distance')).toHaveText(`着水予測 ${scenario.distance.toFixed(1)} m`);
    const aim = await gearEvidence(page, info, 'motion-aim-held', { screenshot: true });
    assertGear(aim, scenario.level);
    numerical.push({ ...replay.check(aim, aim.frame.elapsed - entered.frame.elapsed), hudClearance: assertAnimatedClear(aim),
      clockSource: 'accepted visual elapsed since AIM time zero' });
    expect(aim.tip.normalized[1]).toBeLessThan(initial.tip.normalized[1] - 0.1);
    const target = aim.ring.center.world;
    expect(Math.hypot(target[0] - ORIGIN[0], target[2] - ORIGIN[1])).toBeCloseTo(scenario.distance, 10);
    const releasedAt = aim.frame.elapsed;
    await input.up();

    let previous = 0, firstCast;
    for (const seconds of [0.032, 0.128, 0.3, 0.6, 0.78]) {
      await page.clock.runFor(Math.round((seconds - previous) * 1000)); previous = seconds;
      expect(await gearPhase(page)).toBe('cast');
      const snapshot = await gearEvidence(page, info, `motion-cast-${Math.round(seconds * 1000)}ms`,
        { screenshot: seconds === 0.032 || seconds === 0.6 });
      assertGear(snapshot, scenario.level, { line: true });
      const time = castSeconds(snapshot);
      expect(time).toBeGreaterThan(0); expect(time).toBeLessThan(0.8);
      expect(Math.abs(time - (snapshot.frame.elapsed - releasedAt))).toBeLessThanOrEqual(SOURCE_WORLD_EPSILON);
      numerical.push({ ...replay.check(snapshot, time), hudClearance: assertAnimatedClear(snapshot),
        clockSource: 'unchanged lure x/z fraction along committed cast ray × 0.8s' });
      expect(snapshot.ring.center.world).toEqual(target);
      for (const [axis, origin] of [[0, ORIGIN[0]], [2, ORIGIN[1]]]) {
        expect(Math.abs(snapshot.lure.center.world[axis] - (origin + (target[axis] - origin) * time / 0.8)))
          .toBeLessThanOrEqual(SOURCE_WORLD_EPSILON);
      }
      expect(snapshot.camera).toEqual(aim.camera);
      for (const kind of ['rod', 'reel']) {
        expect(snapshot[kind].geometryId).toBe(initial[kind].geometryId);
        expect(snapshot[kind].materialId).toBe(initial[kind].materialId);
        expect(snapshot[kind].positionVersion).toBe(initial[kind].positionVersion);
      }
      if (!firstCast) firstCast = snapshot;
      else {
        expect(snapshot.resources).toEqual(firstCast.resources);
        expect(snapshot.line.geometryId).toBe(firstCast.line.geometryId);
        expect(snapshot.line.materialId).toBe(firstCast.line.materialId);
      }
      if (scenario.id === 'landscape' && seconds === 0.128) {
        await click('#menu-button');
        const paused = await gearRead(page);
        await page.clock.fastForward(5000);
        const held = await gearRead(page);
        expect(held.renders).toBe(paused.renders);
        expect(held.tip).toEqual(paused.tip); expect(held.line.start).toEqual(paused.line.start);
        await click('#collection-close');
      }
    }
    await page.clock.runFor(48);
    expect(await gearPhase(page)).toBe('lure');
    const lure = await gearEvidence(page, info, 'motion-lure', { screenshot: true });
    assertGear(lure, scenario.level, { line: true });
    numerical.push({ ...replay.check(lure, (lure.ring.scale[0] - 1) / 2), clockSource: 'unchanged first-LURE splash ring scale: (scale−1)/2' });
    expect(lure.ring.center.world).toEqual(target); expect(lure.camera).toEqual(aim.camera);
    expect(FISHING_CONFIG.flightSeconds).toBe(0.8);

    if (scenario.id === 'portrait') {
      await page.setViewportSize({ width: 844, height: 390 });
      await expect.poll(async () => {
        await page.clock.runFor(16);
        return (await gearRead(page)).camera.aspect;
      }, { intervals: [0] }).toBe(844 / 390);
      expect(await gearPhase(page)).toBe('lure');
      const rotated = await gearEvidence(page, info, 'motion-lure-rotated');
      assertGear(rotated, scenario.level, { line: true });
      expect(rotated.ring.center.world).toEqual(target);
      expect(rotated.camera.position).toEqual(aim.camera.position);
      expect(rotated.camera.quaternion).toEqual(aim.camera.quaternion);
    }
    expect(errors).toEqual([]);
    await info.attach('motion-numerical-evidence', { body: JSON.stringify({ scenario, numerical,
      precision: { sourceReplayWorldBound: SOURCE_WORLD_EPSILON, line: 'exact Float32 rounding of actual root.localToWorld tip' } }, null, 2),
    contentType: 'application/json' });
  } finally { replay.dispose(); }
});
