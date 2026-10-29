import assert from 'node:assert/strict';
import { cpSync, mkdirSync, readFileSync, writeFileSync, openSync, writeSync, closeSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

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
// Bind the new study to actual committed sources; never relabel old captures.
const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
const sha = git('rev-parse', 'HEAD');
git('diff', '--exit-code', 'HEAD', '--', 'src');
const sourceTree = git('rev-parse', 'HEAD:src');
const sourceHashes = Object.fromEntries(git('ls-files', 'src').split('\n').map(p => [p, hash(readFileSync(join(repo, p)))]));
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
  let c, ended = false, held = false, buttonDown = false, rng = seed, draws = 0, qteIndex = 0, eventId = 0;
  const events = [], transitions = [], samples = [], warnings = [], resolutions = [], violations = [];
  const send = (type, at) => {
    if (type === 'up' && !buttonDown) return;
    if (type === 'down') assert.equal(buttonDown, false, 'duplicate down in generated single-button stream');
    buttonDown = type === 'down';
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
        warnings.push(s.qte.token.index);
        if (!providedEvents && buttonDown) send('up', s.elapsedSeconds);
        held = false;
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


const inputPath = join(out, 'same-input-baseline-events.jsonl');
const inputMetadataPath = inputPath + '.metadata.json';
let shared, sourceViolations = [];

if (speed === .2) {
 shared=[];
 for (const species of FISH_SPECIES) for (const size of ['min','mid','max']) for (const rod of [1,5,10]) for (const reel of [1,5,10]) for (const distance of distances) for (const strategy of strategies) {
  const condition={species,size,rod,reel,distance,strategy,mode:'failure'};
  const ref=run(condition);
  if (ref.violations.length) sourceViolations.push({ condition: { ...condition, species: species.id }, violations: ref.violations });
  shared.push({condition:{...condition,species:species.id},events:ref.events});
 }
 writeFileSync(inputPath,shared.map(x=>JSON.stringify(x)).join('\n')+'\n');
 writeFileSync(inputMetadataPath, JSON.stringify({ sourceHead: sha, sourceTree, sourceHashes, speed, seed, conditions: shared.length, inputSha256: hash(readFileSync(inputPath)), sourceViolations }, null, 2) + '\n');
} else shared=readFileSync(inputPath,'utf8').trim().split('\n').map(x=>JSON.parse(x));
// A different model's legacy file must not silently stand in for this fixture.
const inputMetadata = JSON.parse(readFileSync(inputMetadataPath, 'utf8'));
const inputSha256 = hash(readFileSync(inputPath));
assert.match(inputMetadata.sourceHead, /^[a-f0-9]{40}$/);
assert.equal(inputMetadata.sourceTree, sourceTree);
assert.deepEqual(inputMetadata.sourceHashes, sourceHashes);
assert.equal(inputMetadata.speed, .2); assert.equal(inputMetadata.seed, seed);
assert.equal(inputMetadata.inputSha256, inputSha256);
assert.equal(inputMetadata.conditions, 10368); assert.equal(shared.length, 10368);
sourceViolations = inputMetadata.sourceViolations;
assert.ok(Array.isArray(sourceViolations));
const seen = new Set();
for (const { condition: c, events } of shared) {
 assert.ok(FISH_SPECIES.some(s => s.id === c.species));
 assert.ok(['min','mid','max'].includes(c.size));
 assert.ok([1,5,10].includes(c.rod) && [1,5,10].includes(c.reel));
 assert.ok(distances.includes(c.distance) && strategies.includes(c.strategy));
 assert.equal(c.mode, 'failure');
 const key = [c.species,c.size,c.rod,c.reel,c.distance,c.strategy].join('|');
 assert.equal(seen.has(key), false); seen.add(key);
 assert.ok(Array.isArray(events));
 let down = false, at = -Infinity, identity = 0;
 for (const e of events) {
  assert.ok(Number.isFinite(e.at) && e.at >= 0 && e.at >= at && e.at <= 180);
  assert.ok(Number.isSafeInteger(e.identity) && e.identity > identity);
  assert.ok(e.type === 'down' || e.type === 'up');
  assert.equal(e.type === 'down', !down, 'physical button stream must alternate down/up');
  down = e.type === 'down'; at = e.at; identity = e.identity;
 }
}
let rescues=0,newTimeouts=0,rows=[],invariantViolations=[];
for (const entry of shared) {
 const condition={...entry.condition,species:FISH_SPECIES.find(s=>s.id===entry.condition.species)};
 const plain=run({...condition,mode:'none'},{providedEvents:entry.events});
 const failed=run(condition,{providedEvents:entry.events});
 const rescue=plain.outcome==='line-break' && failed.outcome==='landed';
 rescues+=rescue?1:0; newTimeouts += [plain,failed].filter(x=>x.outcome==='right-censored').length;
 if (plain.violations.length || failed.violations.length) invariantViolations.push({ condition: entry.condition, plain: plain.violations, failed: failed.violations });
 rows.push({condition:entry.condition,plain:plain.outcome,failed:failed.outcome,rescue,violations:{plain:plain.violations,failed:failed.violations}});
}
const probes=[];
for (const distance of distances) {
 const c=original({species:FISH_SPECIES[0],lengthCm:40,startDistance:distance,rod:getEquipmentLevel('rod',1),reel:getEquipmentLevel('reel',1),settings,random:()=>.5,id:1});
 c.step(1);
 probes.push({speed,distance,scale:c.snapshot.scale,after:c.snapshot.distance,delta:c.snapshot.distance-distance,displayBefore:distance.toFixed(1),displayAfter:c.snapshot.distance.toFixed(1),draws:c.snapshot.rngCalls});
}
writeFileSync(join(out,'same-input-'+speed+'.json'),JSON.stringify({sourceHead:sha,sourceTree,sourceHashes,inputMetadata,inputSha256,sourceViolations,invariantViolations,speed,conditions:shared.length,fights:shared.length*2,seed,canonicalSourceSpeed:.2,operations:'all failure, flick',eventPolicy:'single normal button; explicit release at qte-warning; result submitted through domain; no QTE gesture scoring',rescues,newTimeouts,rows,probes},null,2)+'\n');
console.log(JSON.stringify({speed,conditions:shared.length,fights:shared.length*2,rescues,newTimeouts,probes}));

// Keep diagnostic files on failure, and reject a misleading zero exit status.
assert.deepEqual(sourceViolations, []);
assert.deepEqual(invariantViolations, []);
assert.equal(newTimeouts, 0);
assert.equal(rescues, 0, 'This fixed physical-input grid gained a line-break rescue; inspect rows before acceptance');
