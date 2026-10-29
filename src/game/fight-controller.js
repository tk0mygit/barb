import { GESTURES } from './fishing-config.js';
import { fishResistance, isLargeFish, createFightProfile } from './fish-fight.js';
import { getQteDifficulty, qteSeconds, getFightScale, applyQteEffect, FightQteSchedule, QTE_TIMING } from './fight-qte.js';

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
// One FIGHT owns its physical clock and transient input/result queue. Render
// callbacks only admit time; they never choose a different integration grid.
export function createFightController({ species, lengthCm, startDistance, rod, reel, settings, random, id,
  qte = null, onEvent = () => {}, onEnd = () => {} }) {
  if (!(startDistance > settings.landingDistance)) throw new RangeError('FIGHT must start beyond landing');
  const enabled = qte?.enabled === true;
  if (enabled && typeof qte.selectOperation !== 'function') throw new TypeError('Enabled QTE requires an explicit operation provider');
  const difficulty = getQteDifficulty(species, lengthCm), profile = createFightProfile(species, lengthCm, difficulty);
  const scale = getFightScale(startDistance, settings.landingDistance, settings.fightScalingSpan);
  const span = startDistance - settings.landingDistance, limit = startDistance + settings.fightDistanceAllowance;
  const assist = isLargeFish(species, lengthCm) ? reel.largeFishAssistMultiplier ?? 1 : 1;
  const schedule = new FightQteSchedule(difficulty, startDistance, settings.landingDistance, enabled);
  const physical = { distance: startDistance, tension: settings.tensionStart };
  let normal = 0, wall = 0, render = 0, compensation = 0, ticks = 0, slack = 0, generation = 0;
  let mode = 'normal', paused = false, ended = null, held = false, holdAt = Infinity, direct = false;
  let warningEnd = Infinity, deadline = Infinity, armEnd = Infinity, operation = null, serial = 0;
  let contactId = null, contactStart = -Infinity, lifecycle = 0, normalOwnerStart = -Infinity;
  let successes = 0, failures = 0, drawCount = 0, push = 0, penalties = 0, pulls = 0, armTime = 0, qteTime = 0;
  const queue = [];
  const owner = () => paused ? 'suspended' : ended ? 'none' : ['warning', 'active', 'awaiting-result'].includes(mode) ? 'qte' : 'normal';
  const token = () => schedule.active ? Object.freeze({ fightId: id, index: schedule.active.index, generation }) : null;
  const valid = value => value && value.fightId === id && value.index === schedule.active?.index && value.generation === generation;
  function snapshot() {
    return Object.freeze({ id, startDistance, landingDistance: settings.landingDistance, scale, difficulty, profile,
      equipment: Object.freeze({ rod, reel }), distance: physical.distance, tension: physical.tension, slackSeconds: slack,
      normalSeconds: normal, elapsedSeconds: wall, renderSeconds: render, generation, lifecycleRevision: lifecycle, owner: owner(),
      reeling: owner() === 'normal' && mode !== 'arm' && (direct || held && wall >= holdAt),
      mode, paused, outcome: ended, rngCalls: drawCount, pushbackMeters: push, penaltyMeters: penalties,
      successPullMeters: pulls, armSeconds: armTime, qteSeconds: qteTime,
      qte: Object.freeze({ enabled, operation, token: token(), warningEndSeconds: warningEnd, deadlineSeconds: deadline,
        remainingSeconds: mode === 'warning' ? Math.max(0, warningEnd - wall) : mode === 'active' ? Math.max(0, deadline - wall) : 0,
        successes, failures, reservations: Object.freeze(schedule.entries.map(e => Object.freeze({ ...e }))) }) });
  }
  const emit = type => onEvent(Object.freeze({ type, fight: snapshot() }));
  function invalidate() { generation++; held = direct = false; holdAt = Infinity; contactId = null; contactStart = -Infinity; }
  function finish(outcome) {
    ended = outcome;
    if (outcome !== 'landed') schedule.abort();
    invalidate(); emit('fight-ended'); onEnd(outcome, snapshot());
  }
  function enqueue(event) {
    queue.push({ ...event, serial: serial++ });
    queue.sort((a, b) => a.at - b.at || a.serial - b.serial);
  }
  function resolve(event) {
    if (!valid(event.token) || paused || !['active', 'awaiting-result'].includes(mode)) return false;
    const before = physical.distance;
    if (event.success) successes++; else failures++;
    applyQteEffect(physical, event.success, failures, startDistance, scale, settings.landingDistance, settings.fightDistanceAllowance);
    if (event.success) pulls += before - physical.distance; else penalties += physical.distance - before;
    schedule.observe(physical.distance); schedule.resolve(normal);
    mode = event.success ? 'normal' : 'arm'; armEnd = event.success ? Infinity : wall + QTE_TIMING.armSeconds;
    normalOwnerStart = wall;
    warningEnd = deadline = Infinity; invalidate(); emit('qte-resolved'); return true;
  }
  function consume() {
    while (queue.length && queue[0].at <= wall) {
      const event = queue.shift();
      if (event.type === 'result') { resolve(event); continue; }
      if (event.raw ? event.lifecycle !== lifecycle || event.at < normalOwnerStart : event.generation !== generation) continue;
      if (owner() !== 'normal') continue;
      if (event.type === 'down') { held = true; direct = false; holdAt = event.at + GESTURES.holdSeconds; contactId = event.contactId ?? null; contactStart = event.at; }
      else if (event.type === 'reel') { direct = event.active; held = false; holdAt = Infinity; }
      else if (event.contactId === undefined || event.contactId === contactId && event.at >= contactStart) { held = direct = false; holdAt = Infinity; contactId = null; }
    }
  }
  function boundaries() {
    if (mode === 'warning' && wall >= warningEnd) { mode = 'active'; emit('qte-active'); }
    if (mode === 'active' && wall >= deadline) { mode = 'awaiting-result'; emit('qte-awaiting-result'); }
    if (mode === 'arm' && wall >= armEnd) { mode = 'normal'; armEnd = Infinity; emit('arm-ended'); }
  }
  function startPendingQte() {
    if (mode !== 'normal') return;
    const entry = schedule.start(normal);
    if (!entry) return;
    operation = qte.selectOperation(Object.freeze({ index: entry.index, difficulty }));
    const seconds = qteSeconds(difficulty, operation);
    mode = 'warning'; warningEnd = wall + QTE_TIMING.warningSeconds; deadline = warningEnd + seconds;
    invalidate(); emit('qte-warning');
  }
  function pump(end) {
    while (wall < end && !ended && !paused) {
      boundaries(); consume();
      // A positive normal-time gap can be smaller than one ulp of the
      // larger FIGHT clock. Commit that existing boundary, without inventing
      // a zero-duration physics step or relaxing the .8-second contract.
      if (mode === 'normal' && schedule.pending && normal < schedule.nextNormalAt
        && wall + (schedule.nextNormalAt - normal) === wall) normal = schedule.nextNormalAt;
      startPendingQte();
      let next = Math.min(end, queue[0]?.at ?? Infinity);
      if (mode === 'warning') next = Math.min(next, warningEnd);
      if (mode === 'active') next = Math.min(next, deadline);
      if (mode === 'arm') next = Math.min(next, armEnd);
      if (owner() === 'normal' && held && holdAt > wall) next = Math.min(next, holdAt);
      let gapBoundary = Infinity;
      if (mode === 'normal' && schedule.pending && normal < schedule.nextNormalAt) {
        gapBoundary = wall + (schedule.nextNormalAt - normal); next = Math.min(next, gapBoundary);
      }
      const dt = next - wall;
      if (!(dt > 0)) throw new Error('Nonpositive FIGHT interval');
      if (mode !== 'normal') {
        if (mode === 'arm') armTime += dt; else qteTime += dt;
        wall = next; continue;
      }
      const reeling = direct || held && wall >= holdAt;
      wall = next; normal = next === gapBoundary ? schedule.nextNormalAt : normal + dt;
      const resistance = fishResistance(species, lengthCm, normal);
      physical.tension = clamp(physical.tension + dt * (reeling
        ? settings.tensionRise * resistance * rod.tensionMultiplier : -settings.tensionRelief * reel.tensionReliefMultiplier), 0, 1);
      if (physical.tension >= 1) { finish('line-break'); break; }
      slack = physical.tension < settings.slackThreshold ? slack + dt : 0;
      if (slack > settings.slackGrace) {
        drawCount++;
        if (random() < -Math.expm1(-settings.slackEscapeRate * dt)) { finish('slack-escape'); break; }
      }
      if (reeling) physical.distance = Math.max(settings.landingDistance, physical.distance
        - span / (settings.fightReelSeconds * clamp(resistance, settings.reelResistanceMin, settings.reelResistanceMax)) * reel.reelSpeedMultiplier * assist * dt);
      else {
        const before = physical.distance;
        physical.distance = Math.min(limit, physical.distance + settings.fightPushbackSpeed * scale * clamp(resistance, 0.8, 1.5) * dt);
        push += physical.distance - before;
      }
      schedule.observe(physical.distance);
      startPendingQte();
      if (physical.distance <= settings.landingDistance && schedule.complete) finish('landed');
    }
    boundaries(); consume();
  }
  return {
    get snapshot() { return snapshot(); },
    step(dt) {
      if (paused || ended || !Number.isFinite(dt) || dt <= 0) return 0;
      // Compensated admission plus one-ulp comparison avoids render-sum drift.
      // This never changes input timestamps, hold/deadline tests or D thresholds.
      const add = dt - compensation, sum = render + add; compensation = (sum - render) - add; render = sum;
      const tick = settings.fightStepSeconds;
      const budget = render / tick, count = Math.floor(budget + Number.EPSILON * Math.max(1, Math.abs(budget)));
      while (ticks < count && !ended && !paused) { ticks++; pump(ticks * tick); }
      return ended ? Math.max(0, render - wall) : 0;
    },
    contact(type, at = render, epoch = generation) {
      if (ended || owner() !== 'normal' || !['down', 'up', 'cancel'].includes(type) || !Number.isFinite(at) || epoch !== generation) return false;
      enqueue({ type, at, generation: epoch }); return true;
    },
    queueContact(type, at, identity) {
      if (ended || paused || !['down', 'up', 'cancel'].includes(type) || !Number.isFinite(at)) return false;
      // Ingress can precede processing of a result in the same render frame.
      // Admission belongs to the owner at source time, not the lagging frame.
      // Coalesce only representational ulps at existing clock boundaries.
      // Prefer semantic edges to an adjacent tick endpoint: their IEEE754
      // representations can differ by one ulp (e.g. a 2s tap resolution).
      for (const boundary of [deadline, armEnd, normalOwnerStart, holdAt, wall]) {
        if (Number.isFinite(boundary) && Math.abs(at - boundary) <= Number.EPSILON * Math.max(1, Math.abs(at), Math.abs(boundary)) * 4) { at = boundary; break; }
      }
      enqueue({ type, at, contactId: identity, raw: true, lifecycle }); return true;
    },
    reel(active) { if (!ended && owner() === 'normal') enqueue({ type: 'reel', active: Boolean(active), at: render, generation }); },
    release() {
      if (owner() === 'qte') { lifecycle++; invalidate(); emit('input-invalidated'); }
      else if (owner() === 'normal') enqueue({ type: 'cancel', at: render, generation });
    },
    submitResult(value, success, at = wall) {
      if (ended || paused || !valid(value) || typeof success !== 'boolean' || !Number.isFinite(at) || at < warningEnd) return false;
      enqueue({ type: 'result', token: { ...value }, success, at });
      if (at <= wall) { boundaries(); consume(); }
      return true;
    },
    pause() { if (ended || paused) return false; paused = true; lifecycle++; invalidate(); emit('fight-paused'); return true; },
    resume() { if (ended || !paused) return false; paused = false; lifecycle++; invalidate(); emit('fight-resumed'); return true; },
    abort() { if (ended) return false; finish('aborted'); return true; },
  };
}
