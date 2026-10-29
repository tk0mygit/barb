import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, symlinkSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2), arg = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const repo = resolve(arg('--repo', process.cwd())), root = resolve(arg('--out', '/tmp/barb-5c1r-study/results'));
mkdirSync(root, { recursive: true });
const source = readFileSync(join(repo, 'tests/helpers/fight-replay.js'), 'utf8');
const aPath = join(repo, 'tests/fixtures/fight-failure-rescues.json'), bPath = join(repo, 'tests/fixtures/fight-fps-hold.json');
const a = JSON.parse(readFileSync(aPath)), b = JSON.parse(readFileSync(bPath));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(a.conditions.length, 106); assert.equal(b.groups.length, 86);
const physicalKeys = ['elapsedSeconds', 'normalSeconds', 'distance', 'tension', 'slackSeconds', 'rngCalls', 'pushbackMeters', 'penaltyMeters', 'successPullMeters', 'armSeconds', 'qteSeconds'];
const results = [], counterexamples = [];
for (const speed of [.2, .6, .8, 1]) {
  const dir = join(root, `native-${speed}`); mkdirSync(join(dir, 'tests/helpers'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), '{"type":"module"}\n');
  if (!existsSync(join(dir, 'src'))) symlinkSync(join(repo, 'src'), join(dir, 'src'), 'dir');
  assert.equal(source.split('createFishing({ random, collection, ...options })').length, 2);
  const modified = source.replace('createFishing({ random, collection, ...options })', `createFishing({ config: { fightPushbackSpeed: ${speed} }, random, collection, ...options })`);
  writeFileSync(join(dir, 'tests/helpers/fight-replay.js'), modified);
  const { replayFight } = await import(pathToFileURL(join(dir, 'tests/helpers/fight-replay.js')).href);
  let failureLineBreak = 0, successLanded = 0, rescue = 0, bMismatch = 0, aTimeout = 0, maxError = 0;
  const aRows = [], bRows = [];
  for (const condition of a.conditions) for (const operation of ['flick', 'tap']) {
    const none = replayFight(condition), failure = replayFight(condition, { mode: 'failure', operation }), success = replayFight(condition, { mode: 'success', operation });
    failureLineBreak += failure.outcome === 'line-break' ? 1 : 0; successLanded += success.outcome === 'landed' ? 1 : 0;
    aTimeout += [none, failure, success].filter(r => r.outcome === 'right-censored').length;
    if (none.outcome === 'line-break' && failure.outcome === 'landed') rescue++;
    if (failure.outcome !== 'line-break' || success.outcome !== 'landed') counterexamples.push({ speed, condition, operation,
      outcomes: [none.outcome, failure.outcome, success.outcome], events: failure.events,
      transitions: failure.transitions.map(e => ({ type: e.type, fight: e.fight })) });
    aRows.push({ condition, operation, none: none.outcome, failure: failure.outcome, success: success.outcome });
  }
  for (const group of b.groups) {
    assert.ok(new Set(group.results.map(r => r.outcome)).size > 1);
    const [, mode, fixture] = group.key.split('|'), operation = fixture === 'tap' ? 'tap' : 'flick';
    const condition = { speciesId: group.species, size: group.size, rod: group.rod, reel: group.reel, startDistance: group.distance };
    const ref = replayFight({ ...condition, fps: 60 }, { mode, operation });
    const outputs = [30, 60, 144].map(fps => replayFight({ ...condition, fps }, { mode, operation, providedEvents: ref.events }));
    for (const result of outputs) {
      let mismatch = result.outcome !== ref.outcome;
      for (const key of physicalKeys) {
        const error = Math.abs(result.fight[key] - ref.fight[key]); maxError = Math.max(maxError, error);
        mismatch ||= error >= 1e-9;
      }
      mismatch ||= JSON.stringify(result.fight.qte.reservations) !== JSON.stringify(ref.fight.qte.reservations);
      if (mismatch) { bMismatch++; counterexamples.push({ speed, kind: 'B86-mismatch', group, ref: ref.fight, actual: result.fight }); }
    }
    bRows.push({ condition, mode, operation, outcomes: outputs.map(r => r.outcome) });
  }
  results.push({ speed, aRows: aRows.length, aFights: aRows.length * 3, failureLineBreak, successLanded, freeRescues: rescue, aTimeout,
    bGroups: bRows.length, bFights: bRows.length * 4, bMismatch, maxError, sourceHelperSha256: sha256(source), isolatedHelperSha256: sha256(modified) });
  writeFileSync(join(root, `fixed-rows-${speed}.json`), JSON.stringify({ aRows, bRows }, null, 2) + '\n');
  console.log(JSON.stringify(results.at(-1)));
}
writeFileSync(join(root, 'fixed-regressions.json'), JSON.stringify({
  aFixture: { path: aPath, sha256: sha256(readFileSync(aPath)), gitBlob: '449f776fc507911437996dd54b592ebb4092adaf', base: a.base, source: a.source },
  bFixture: { path: bPath, sha256: sha256(readFileSync(bPath)), gitBlob: 'ecf70b5a6810bf7e49be3d9c7a76b324ed5cfdae', source: b.source },
  originalRawFilesAvailable: false, note: 'Repository fixtures reused without edits. Original 5C-0 raw inputs not attached; raw-file byte identity is unverified.',
  results }, null, 2) + '\n');
writeFileSync(join(root, 'fixed-counterexamples.json'), JSON.stringify(counterexamples, null, 2) + '\n');
