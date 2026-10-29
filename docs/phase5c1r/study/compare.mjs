import assert from 'node:assert/strict';
import { cpSync, mkdirSync, readFileSync, writeFileSync, openSync, writeSync, closeSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';
import os from 'node:os';

const args = process.argv.slice(2), arg = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const repo = resolve(arg('--repo', process.cwd()));
const out = resolve(arg('--out', '/tmp/barb-5c1r-study/results'));
const speed = Number(arg('--speed', '.2')), pilot = args.includes('--pilot');
mkdirSync(out, { recursive: true });
const load = path => import(pathToFileURL(join(repo, path)).href);
const { createFightController: original } = await load('src/game/fight-controller.js');
const { FISHING_CONFIG } = await load('src/game/fishing-config.js');
const { FISH_SPECIES } = await load('src/game/fish-species.js');
const { getEquipmentLevel } = await load('src/game/equipment.js');
const { getFightScale } = await load('src/game/fight-qte.js');
const hash = value => createHash('sha256').update(value).digest('hex');
const sha = arg('--base-sha', '9524cd519c74eae88dc52a384c7a8dc9a096a0df');
assert.match(sha, /^[a-f0-9]{40}$/);
const settings = Object.freeze({ ...FISHING_CONFIG, fightPushbackSpeed: speed });

// Only telemetry is added to an isolated copy. Production files are never edited.
// Observe each physical endpoint AND each QTE effect, including sub-tick hold edges.
const telemetryDir = join(out, `telemetry-${speed}`);
cpSync(join(repo, 'src/game'), telemetryDir, { recursive: true });
writeFileSync(join(telemetryDir, 'package.json'), '{"type":"module"}\n');
const source = readFileSync(join(repo, 'src/game/fight-controller.js'), 'utf8');
assert.equal(source.split('schedule.observe(physical.distance);').length - 1, 2);
let instrumented = source.replace('  const physical =', '  let studyMaximum = startDistance, studyMinimum = startDistance;\n  const physical =')
  .replace('return Object.freeze({ id, startDistance,', 'return Object.freeze({ studyMaximum, studyMinimum, id, startDistance,')
  .replaceAll('schedule.observe(physical.distance);', 'studyMaximum = Math.max(studyMaximum, physical.distance); studyMinimum = Math.min(studyMinimum, physical.distance);\n      schedule.observe(physical.distance);');
assert.notEqual(source, instrumented);
writeFileSync(join(telemetryDir, 'fight-controller.js'), instrumented);
const { createFightController: factory } = await import(pathToFileURL(join(telemetryDir, 'fight-controller.js')).href);

const seed = 0x9e3779b9;
const modes = ['none', 'success', 'failure', 'alternating'];
const strategies = ['hold', 'adaptive', 'idle', 'short-taps'];
const distances = [4.5001, 4.51, 5.5, 8, 16, 32, 40, 60];
const eq = (x, y) => assert.ok(Math.abs(x - y) < 1e-9, `${x} != ${y}`);
const lengths = (s, size) => size === 'min' ? s.minLengthCm : size === 'max' ? s.maxLengthCm : (s.minLengthCm + s.maxLengthCm) / 2;
function physicalState(s) {
  return Object.fromEntries(['outcome', 'elapsedSeconds', 'normalSeconds', 'distance', 'tension', 'slackSeconds', 'rngCalls',
    'pushbackMeters', 'penaltyMeters', 'successPullMeters', 'armSeconds', 'qteSeconds', 'mode', 'generation', 'lifecycleRevision', 'owner', 'reeling', 'paused', 'scale']
    .map(k => [k, s[k]]).concat([['qte', { successes: s.qte.successes, failures: s.qte.failures, reservations: s.qte.reservations }]]));
}
let maximumNumericError = 0;
function equivalent(a, b) {
  for (const key of Object.keys(a)) {
    if (typeof a[key] === 'number' && typeof b[key] === 'number') {
      maximumNumericError = Math.max(maximumNumericError, Math.abs(a[key] - b[key])); eq(a[key], b[key]);
    } else if (a[key] && typeof a[key] === 'object' && !Array.isArray(a[key])) equivalent(a[key], b[key]);
    else assert.deepEqual(a[key], b[key]);
  }
}
function run(condition, { fps = 60, providedEvents = null, create = factory, trace = false } = {}) {
  const { species, size, rod, reel, distance, mode, strategy, operation = 'flick' } = condition;
  let c, ended = false, held = false, rng = seed, draws = 0, qteIndex = 0, eventId = 0;
  const events = [], transitions = [], samples = [], warnings = [], resolutions = [], violations = [];
  const send = (type, at) => {
    const e = { type, at, identity: ++eventId }; events.push(e);
    assert.equal(c.queueContact(type, at, type === 'down' ? e.identity : undefined), true);
  };
  c = create({ species, lengthCm: lengths(species, size), startDistance: distance,
    rod: getEquipmentLevel('rod', rod), reel: getEquipmentLevel('reel', reel), settings, id: 1,
    random: () => { draws++; rng = (Math.imul(1664525, rng) + 1013904223) >>> 0; return rng / 4294967296; },
    qte: mode === 'none' ? null : { enabled: true, selectOperation: () => operation },
    onEnd: () => { ended = true; },
    onEvent(event) {
      const s = event.fight;
      transitions.push({ type: event.type, ...physicalState(s), index: s.qte.token?.index ?? null });
      if (event.type === 'qte-warning') {
        if (warnings.includes(s.qte.token.index)) violations.push('duplicate-warning');
        if (resolutions.length && s.normalSeconds < resolutions.at(-1) + .8) violations.push('qte-gap');
        warnings.push(s.qte.token.index); held = false;
        const success = mode === 'success' || mode === 'alternating' && qteIndex % 2 === 0; qteIndex++;
        assert.equal(c.submitResult(s.qte.token, success, s.qte.deadlineSeconds), true);
      }
      if (event.type === 'qte-resolved') {
        resolutions.push(s.normalSeconds); held = false;
        if (!providedEvents && strategy === 'hold') send('down', s.elapsedSeconds);
      }
    },
  });
  if (!providedEvents && strategy === 'hold') send('down', 0);
  let admitted = 0, nextPoll = 0, frame = 0, ingress = 0;
  while (!ended && admitted < 180) {
    if (!providedEvents && frame % (fps / 10) === 0) {
      const s = c.snapshot;
      if (strategy === 'adaptive' && s.owner === 'normal') {
        if (held && s.tension > .65) { send('up', admitted); held = false; }
        else if (!held && s.tension < .35) { send('down', admitted); held = true; }
      }
      if (strategy === 'short-taps' && s.owner === 'normal') {
        if (frame % (fps / 2) === 0) send('down', admitted);
        else if (frame % (fps / 2) === fps / 10) send('up', admitted);
      }
      if (trace) samples.push(physicalState(s));
      nextPoll++;
    }
    const end = Math.min(++frame / fps, 180);
    if (providedEvents) while (ingress < providedEvents.length && providedEvents[ingress].at <= end) {
      const e = providedEvents[ingress++]; c.queueContact(e.type, e.at, e.type === 'down' ? e.identity : undefined);
    }
    c.step(end - admitted); admitted = end;
  }
  const s = c.snapshot;
  assert.equal(draws, s.rngCalls);
  if (s.studyMaximum > distance + 4 || s.studyMinimum < 4.5) violations.push('distance-cap-or-floor');
  if (s.outcome === 'landed' && s.qte.reservations.some(e => e.status !== 'done')) violations.push('landed-with-reservations');
  if (s.outcome && s.qte.reservations.some(e => !['done', 'cancelled'].includes(e.status))) violations.push('terminal-reservations');
  return { state: physicalState(s), outcome: s.outcome ?? 'right-censored', maximum: s.studyMaximum, minimum: s.studyMinimum,
    events: providedEvents ?? events, transitions, warnings, violations, samples };
}

// Instrumentation parity: no new physics, RNG, QTE, or input decisions.
let parity = 0;
for (const species of [FISH_SPECIES[0], FISH_SPECIES.at(-1)]) for (const distance of [4.5001, 8, 60]) for (const mode of modes) {
  const condition = { species, size: 'max', rod: 1, reel: 1, distance, mode, strategy: 'adaptive' };
  const a = run(condition), b = run(condition, { create: original });
  assert.deepEqual(a.state, b.state); assert.deepEqual(a.transitions, b.transitions); assert.deepEqual(a.events, b.events); parity++;
}

const rows = openSync(join(out, `rows-${speed}${pilot ? '-pilot' : ''}.jsonl`), 'w');
const buckets = new Map(), failures = [], traces = [];
let comparisons = 0, fpsMismatch = 0, violations = 0, count = 0;
const started = Date.now();
function add(key, row) {
  if (!buckets.has(key)) buckets.set(key, { key, n: 0, landed: 0, 'line-break': 0, 'slack-escape': 0, 'right-censored': 0,
    captures: [], times: [], push: [], maxRetreat: 0, capHits: 0, penalties: [], draws: [], remaining: 0, duplicateWarnings: 0 });
  const b = buckets.get(key); b.n++; b[row.outcome]++; b.times.push(row.seconds);
  if (row.outcome === 'landed') b.captures.push(row.seconds);
  b.push.push(row.pushback); b.penalties.push(row.penalty); b.draws.push(row.draws);
  b.maxRetreat = Math.max(b.maxRetreat, row.maximumRetreat); b.capHits += row.capHit ? 1 : 0;
  b.remaining += row.remaining; b.duplicateWarnings += row.duplicateWarnings;
}
for (const species of FISH_SPECIES) {
  for (const size of ['min', 'mid', 'max']) for (const rod of [1, 5, 10]) for (const reel of [1, 5, 10])
  for (const distance of (pilot ? [4.5001, 5.5, 32] : distances)) for (const strategy of (pilot ? ['adaptive'] : strategies)) for (const mode of modes) {
    const condition = { species, size, rod, reel, distance, strategy, mode }, ref = run(condition);
    const legal = distance <= 32 + getEquipmentLevel('rod', rod).castDistanceBonusM;
    const row = { speed, species: species.id, size, rod, reel, distance, strategy, mode, legal,
      outcome: ref.outcome, seconds: ref.state.elapsedSeconds, pushback: ref.state.pushbackMeters,
      maximumRetreat: ref.maximum - distance, capHit: ref.maximum === distance + 4,
      minimumDistance: ref.minimum, penalty: ref.state.penaltyMeters, draws: ref.state.rngCalls,
      remaining: ref.state.qte.reservations.filter(e => !['done', 'cancelled'].includes(e.status)).length,
      duplicateWarnings: ref.warnings.length - new Set(ref.warnings).size, successes: ref.state.qte.successes, failures: ref.state.qte.failures };
    for (const fps of [30, 144]) {
      const result = run(condition, { fps, providedEvents: ref.events }); comparisons++;
      try {
        equivalent(result.state, ref.state); assert.equal(result.transitions.length, ref.transitions.length);
        for (let i = 0; i < ref.transitions.length; i++) equivalent(result.transitions[i], ref.transitions[i]);
      }
      catch (error) {
        fpsMismatch++;
        if (failures.length < 20) failures.push({ kind: 'fps-mismatch', row, fps, reference: ref.state, actual: result.state, error: error.message });
      }
    }
    violations += ref.violations.length;
    if (ref.violations.length && failures.length < 20) failures.push({ kind: 'invariant', row, violations: ref.violations });
    if (ref.outcome === 'right-censored' && strategy === 'adaptive' && traces.length < 8) traces.push({ kind: 'adaptive-timeout', row,
      ...run(condition, { trace: true }) });
    writeSync(rows, JSON.stringify(row) + '\n'); count++;
    for (const key of ['all', legal ? 'legal' : 'stress', `${legal ? 'legal' : 'stress'}|${strategy}|${mode}`,
      `${legal ? 'legal' : 'stress'}|distance=${distance}|${strategy}|${mode}`,
      `${legal ? 'legal' : 'stress'}|rod=${rod}|reel=${reel}|${strategy}|${mode}`]) add(key, row);
  }
  console.log(JSON.stringify({ speed, species: species.id, count, seconds: (Date.now() - started) / 1000, fpsMismatch, violations }));
}
closeSync(rows);
const quantile = (values, q) => values.length ? values.slice().sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * q) - 1)] : null;
const stats = values => ({ n: values.length, p50: quantile(values, .5), p90: quantile(values, .9), p99: quantile(values, .99), max: values.length ? Math.max(...values) : null });
const summary = [...buckets.values()].map(b => ({ key: b.key, n: b.n, landed: b.landed, lineBreak: b['line-break'], slackEscape: b['slack-escape'], censored: b['right-censored'],
  captureSeconds: stats(b.captures), observedSeconds: stats(b.times), pushbackMeters: stats(b.push), maxRetreat: b.maxRetreat, capHits: b.capHits,
  penalties: stats(b.penalties), rngCalls: stats(b.draws), remaining: b.remaining, duplicateWarnings: b.duplicateWarnings }));
const manifest = { speed, baseSha: sha, node: process.version, platform: `${process.platform}/${process.arch}`, cpu: os.cpus()[0].model,
  seed, seedPolicy: 'same LCG seed for each FIGHT; encounter RNG excluded', horizonSeconds: 180,
  sourceControllerSha256: hash(source), telemetryControllerSha256: hash(instrumented), settings, parityCases: parity,
  canonicalConditions: count, fights: count * 3, fps: [30, 60, 144], comparisons, fpsMismatch, violations,
  elapsedSeconds: (Date.now() - started) / 1000, numericTolerance: 1e-9, maximumNumericError, pilot, summary, failures };
writeFileSync(join(out, `summary-${speed}${pilot ? '-pilot' : ''}.json`), JSON.stringify(manifest, null, 2) + '\n');
writeFileSync(join(out, `traces-${speed}${pilot ? '-pilot' : ''}.json`), JSON.stringify(traces, null, 2) + '\n');
console.log(JSON.stringify({ complete: true, speed, count, comparisons, fpsMismatch, violations, traces: traces.length }));
