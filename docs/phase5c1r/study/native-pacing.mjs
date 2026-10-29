import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const repo = resolve(process.argv[2] ?? process.cwd());
const out = resolve(process.argv[3] ?? '/tmp/barb-5c1r-native-pacing');
mkdirSync(out, { recursive: true });
execFileSync('git', ['diff', '--exit-code', 'HEAD', '--', 'src'], { cwd: repo });
const load = path => import(pathToFileURL(join(repo, path)).href);
const { createFishing, PHASE } = await load('src/game/fishing.js');
const { createFishingInput } = await load('src/input/fishing.js');
const { FISH_SPECIES } = await load('src/game/fish-species.js');
const { LURES } = await load('src/game/lures.js');
const { getSpeciesProbabilities } = await load('src/game/fish-encounters.js');
const oldCsv = readFileSync(join(repo, 'docs/phase5c1r/pacing-20-vs-30.csv'), 'utf8');
const [header, ...oldLines] = oldCsv.trim().split(/\r?\n/).map(line => line.split(','));
const oldRows = oldLines.map(values => Object.fromEntries(header.map((key, index) => [key, values[index]])));
assert.equal(oldRows.length, 1152);
const rows = [], differences = [], summaries = [], trace = [];
const keyOf = row => ['speed', 'species', 'lure', 'lengthCm', 'fps', 'rod', 'reel', 'startDistance'].map(key => row[key]).join('|');
const previous = new Map(oldRows.map(row => [keyOf(row), row]));
assert.equal(previous.size, 1152);
const quantile = (values, q) => [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * q) - 1)] ?? null;

function encounter(speed, lureId, speciesId, size) {
  let start = 0, speciesRoll;
  for (const entry of getSpeciesProbabilities(lureId)) {
    if (entry.speciesId === speciesId) speciesRoll = start + entry.probability / 2;
    start += entry.probability;
  }
  assert.ok(Number.isFinite(speciesRoll));
  const rolls = [0, speciesRoll, size];
  const f = createFishing({ config: { fightPushbackSpeed: speed }, random: () => rolls.shift() ?? .5, now: () => 1700000000000 });
  assert.equal(f.selectLure(lureId), true);
  assert.equal(f.prepare({ x: 0, z: 0 }, 0), true);
  f.aim(0, 180); f.cast(); assert.equal(f.state.phase, PHASE.CAST);
  f.step(f.settings.flightSeconds + .01);
  while (f.state.phase === PHASE.LURE) f.step(.01);
  assert.equal(f.state.phase, PHASE.BITE);
  assert.equal(f.state.encounter.speciesId, speciesId);
  assert.equal(f.state.distance, 32);
  assert.equal(f.hook(), true);
  assert.equal(f.state.fight.qte.enabled, false);
  return f;
}

for (const speed of [.2, .6, .8, 1]) {
  for (const species of FISH_SPECIES) for (const lure of LURES) for (const size of [0, .5, 1 - Number.EPSILON]) for (const fps of [30, 144]) {
    const f = encounter(speed, lure.id, species.id, size), input = createFishingInput(f), dt = 1 / fps;
    const lengthCm = f.state.encounter.lengthCm;
    let elapsed = 0, observe = 0, held = false;
    const samples = [];
    while (f.state.phase === PHASE.FIGHT && elapsed < 180) {
      if (elapsed >= observe) {
        if (!held && f.state.tension < .35) { input.down(0, 0); held = true; }
        else if (held && f.state.tension > .65) { input.up(); held = false; }
        if (speed === .8 && species.id === 'alligator-gar' && size > .99 && lure.id === 'minnow' && fps === 30) samples.push({ elapsed, held, distance: f.state.distance, tension: f.state.tension, normal: f.state.fight.normalSeconds });
        observe += .1;
      }
      input.step(dt); f.step(dt); elapsed += dt;
    }
    const fight = f.state.fight, span = fight.startDistance - fight.landingDistance;
    const equivalentSeconds = elapsed * span / (span + fight.pushbackMeters);
    const row = { speed, species: species.id, lure: lure.id, lengthCm, fps, rod: 1, reel: 1, startDistance: 32,
      outcome: fight.outcome ?? 'right-censored', seconds: elapsed, physicalSeconds: fight.elapsedSeconds, equivalentSeconds, pushback: fight.pushbackMeters,
      exceeds20: elapsed > 20, exceedsEquivalentBound: equivalentSeconds > (species.id === 'alligator-gar' ? 20 : 16), originalHarnessWouldTimeout: elapsed > 25,
      passesOld20: fight.outcome === 'landed' && elapsed >= 5 && elapsed <= 20,
      passesNew30: fight.outcome === 'landed' && elapsed >= 5 && elapsed <= 30 };
    const old = previous.get(keyOf(row)); assert.ok(old);
    for (const [key, value] of Object.entries(row)) {
      const equal = typeof value === 'number' ? Number(old[key]) === value : typeof value === 'boolean' ? old[key].toLowerCase() === String(value) : old[key] === value;
      if (!equal) differences.push({ condition: keyOf(row), key, before: old[key], after: value });
    }
    if (samples.length) trace.push({ row, samples });
    rows.push(row);
  }
  const selected = rows.filter(row => row.speed === speed), captured = selected.filter(row => row.outcome === 'landed').map(row => row.seconds);
  summaries.push({ speed, n: selected.length, landed: captured.length, lineBreak: selected.filter(row => row.outcome === 'line-break').length,
    slackEscape: selected.filter(row => row.outcome === 'slack-escape').length, censored: selected.filter(row => row.outcome === 'right-censored').length,
    p50: quantile(captured, .5), p90: quantile(captured, .9), p99: quantile(captured, .99), max: Math.max(...captured),
    over20: selected.filter(row => row.exceeds20).length, over30: selected.filter(row => row.seconds > 30).length,
    over25: selected.filter(row => row.originalHarnessWouldTimeout).length, equivalentBoundFailures: selected.filter(row => row.exceedsEquivalentBound).length });
  console.log(JSON.stringify(summaries.at(-1)));
}
assert.equal(rows.length, 1152);
writeFileSync(join(out, 'native-pacing-rows.json'), JSON.stringify(rows, null, 2) + '\n');
writeFileSync(join(out, 'native-pacing-trace.json'), JSON.stringify(trace, null, 2) + '\n');
writeFileSync(join(out, 'native-pacing-differences.json'), JSON.stringify(differences, null, 2) + '\n');
writeFileSync(join(out, 'native-pacing-summary.json'), JSON.stringify({ head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
  sourceTree: execFileSync('git', ['rev-parse', 'HEAD:src'], { cwd: repo, encoding: 'utf8' }).trim(), oldCsvSha256: createHash('sha256').update(oldCsv).digest('hex'),
  method: 'Public createFishing CAST→LURE→BITE→HOOK then createFishingInput, same 100ms wall-time adaptive sampling as fishing-species.test; no state injection; 180s censor separately; fixed encounter random sequence [0,species midpoint,size] then .5.',
  quantile: 'nearest rank, captured only; fps conditions retained to match prior CSV (not human success rates)',
  rows: rows.length, differences: differences.length, summaries }, null, 2) + '\n');
console.log(JSON.stringify({ rows: rows.length, differences: differences.length }));

assert.equal(differences.length, 0, 'Native reproduction differs from the preserved old CSV');
assert.ok(summaries.every(s => s.landed === 288 && s.over30 === 0 && s.equivalentBoundFailures === 0));
