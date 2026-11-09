import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { BUILD_STEPS, E2E_STEPS, planSummary, resultSummary, validateAggregate, validateArtifactDiscovery, validateArtifactDownloads, validateDownloadSteps, uploadedArtifactId, writeSummary } from '../scripts/ci-summary.js';
import { executionPlan, MOBILE_SPEC, splitSpecs } from '../scripts/ci-e2e.js';
import { classifyChanges, L1_GROUPS, listBrowserSpecs, SMOKE_SPECS } from '../scripts/ci-risk.js';
import { artifactName, fileManifest, LANES, readRecord, recordJob, validationContext } from '../scripts/lib/ci-artifacts.js';
import { mobileGateFixture } from './helpers/mobile-gate-fixture.js';
import { fishingPhaseGateFixture } from './helpers/fishing-phase-fixture.js';
import { readMobileImplementation, replayMobileCamera } from '../scripts/lib/mobile-comparison-source.js';

const SHA = 'a'.repeat(40);
const inventory = listBrowserSpecs();
const env = { GITHUB_RUN_ID: '42', GITHUB_RUN_ATTEMPT: '1' };
const clone = value => structuredClone(value);
const steps = names => Object.fromEntries(names.map(name => [name, { outcome: 'success' }]));

function report(specs) {
  return { suites: [{ specs: specs.map(file => ({ id: file, file: file.replace('tests/browser/', ''),
    tests: [{ projectName: '', expectedStatus: 'passed', status: 'expected', results: [{ status: 'passed', retry: 0 }] }] })) }] };
}

function fixture({ level = 'L2', eventName = 'workflow_dispatch', specs = inventory, mobile } = {}) {
  const plan = { schemaVersion: 1, eventName, prNumber: 42, headSha: mobile?.metadata.headSha ?? SHA,
    baseSha: mobile?.metadata.baseSha ?? (eventName === 'pull_request' ? 'b'.repeat(40) : null), validationSha: mobile?.metadata.validationSha ?? SHA,
    validationRef: eventName === 'pull_request' ? 'refs/pull/42/merge' : 'refs/heads/main',
    level, runE2E: level !== 'L0', deploy: eventName === 'push',
    reasons: ['fixture selection'], changes: [{ status: 'M', paths: ['scripts/ci-e2e.js'] }],
    specs: level === 'L0' ? [] : [...specs], smokeSpecs: level === 'L0' ? [] : [...SMOKE_SPECS] };
  const context = validationContext(plan, env);
  const execution = executionPlan(plan, inventory, context);
  const expected = plan.runE2E ? report(plan.specs) : undefined;
  const build = { plan: clone(plan), execution: clone(execution), expected,
    recordHash: 'build-record-hash', record: { schemaVersion: 3, job: 'build', context: clone(context), jobStatus: 'success',
      steps: { ...steps(BUILD_STEPS), pages: { outcome: plan.deploy ? 'success' : 'skipped' } },
      files: { 'dist/index.html': 'build-hash' } },
    result: { context: clone(context), executed: false, status: plan.runE2E ? 'prepared' : 'not-run',
      passedTests: 0, ...(plan.runE2E ? { collectedTests: plan.specs.length } : {}) } };
  const needs = { build: { result: 'success', outputs: { artifact_id: '100',
    ...(plan.deploy ? { pages_artifact_id: 'pages-id' } : {}) } } };
  const lanes = {};
  for (const lane of LANES) {
    const selected = execution.lanes[lane];
    needs[`e2e_${lane}`] = { result: selected.length ? 'success' : 'skipped',
      outputs: selected.length ? { artifact_id: String(101 + LANES.indexOf(lane)) } : {} };
    if (!selected.length) continue;
    lanes[lane] = { plan: clone(plan), execution: clone(execution), expected: clone(expected),
      collection: report(selected), report: report(selected),
      record: { schemaVersion: 3, job: lane, context: clone(context), jobStatus: 'success', steps: steps(E2E_STEPS), files: {} },
      result: { lane, context: clone(context), specs: clone(selected), executed: true, status: 'passed',
        passedTests: selected.length, collectedTests: selected.length, exitCode: 0, signal: null,
        buildRecordHash: build.recordHash, executionMs: 1250, collectionMs: 100 } };
    if (lane === 'mobile' && mobile) {
      lanes[lane].mobile = { metadata: mobile.metadata, before: mobile.before, after: mobile.after, comparison: mobile.comparison };
      lanes[lane].record.files = clone(mobile.files);
    }
  }
  return { plan, context, execution, inventory, build, needs, lanes };
}

test('the complete inventory is partitioned exactly, and unprofiled specs cannot disappear', () => {
  assert(inventory.length >= 25, 'Baseline specs must remain in the full inventory');
  const input = fixture();
  assert.equal(LANES.filter(lane => lane !== 'mobile').reduce((sum, lane) => sum + input.execution.lanes[lane].length, 0), inventory.length - 1);
  assert.deepEqual(input.execution.lanes.mobile, [MOBILE_SPEC]);
  assert.deepEqual(Object.values(input.execution.lanes).flat().sort(), inventory);
  const expanded = [...inventory, 'tests/browser/new.spec.js'].sort();
  const lanes = splitSpecs({ ...input.plan, specs: expanded }, expanded);
  assert.equal(LANES.filter(lane => lane !== 'mobile').flatMap(lane => lanes[lane]).filter(spec => spec === 'tests/browser/new.spec.js').length, 1);
  assert.deepEqual(lanes.mobile, [MOBILE_SPEC]);
});

test('original risk plan and full inventory cannot be weakened by the split plan', async () => {
  for (const mutate of [
    input => input.execution.inventory.pop(), input => input.execution.lanes.regular_a.pop(),
    input => input.execution.lanes.mobile.push(input.execution.lanes.regular_a[0]),
    input => input.execution.planHash = 'different-plan', input => input.build.plan.level = 'L1',
  ]) {
    const input = fixture(); mutate(input);
    await assert.rejects(() => validateAggregate(input), /plan differs|Inconsistent execution plan/);
  }
});

test('both collection and execution ID unions match the original selection exactly once', async () => {
  const input = fixture(), result = await validateAggregate(input);
  assert.equal(result.passedTests, inventory.length);
  for (const lane of LANES) assert.equal(result.laneResults[lane].passedTests, input.execution.lanes[lane].length);
  assert.equal(LANES.filter(lane => lane !== 'mobile').reduce((sum, lane) => sum + result.laneResults[lane].passedTests, 0), inventory.length - 1);
  assert.equal(result.laneResults.mobile.passedTests, 1);
  assert(resultSummary({ plan: input.plan, result }).includes(`${inventory.length} tests、収集・実行ID`));
});

test('the final aggregate awaits real-SHA replay for the valid rotated FIGHT difference', async () => {
  const mobile = await mobileGateFixture(), input = fixture({ eventName: 'pull_request', mobile });
  assert.notDeepEqual(mobile.before.find(e => e.id === 'rotated-fight').metrics.camera,
    mobile.after.find(e => e.id === 'rotated-fight').metrics.camera);
  const pending = validateAggregate(input); assert.equal(typeof pending.then, 'function');
  const result = await pending;
  assert.equal(result.mobilePairs, 34); assert.equal(result.passedTests, inventory.length);
});

test('5F-1A passes through the existing aggregate and raw captures/report are reverified there', async () => {
  const mobile = await fishingPhaseGateFixture(), input = fixture({ eventName: 'pull_request', mobile });
  const result = await validateAggregate(input);
  assert.equal(result.mobilePairs, 34); assert.equal(result.passedTests, inventory.length);
  const report = clone(input);
  report.lanes.mobile.mobile.comparison.rows.find(row => row.id === 'pc-fight').after.resources.calls++;
  await assert.rejects(validateAggregate(report), /report differs from captures/);
  const capture = clone(input);
  capture.lanes.mobile.mobile.after.find(entry => entry.id === 'pc-bite').metrics.fishingDisplay.passes.actual.draws.lure.calls = 1;
  await assert.rejects(validateAggregate(capture), /submissions differ from source culling/);
});

test('source-backed final gate rejects forged states, reports, provenance and incomplete lanes', async () => {
  const original = fixture({ eventName: 'pull_request', mobile: await mobileGateFixture() });
  const source = await readMobileImplementation(original.plan.validationSha);
  const cases = [
    ['camera', p => { const e = p.mobile.after.find(e => e.id === 'rotated-fight'); e.metrics.camera.quaternion[0] += .01;
      e.metrics.cameraExpected = clone(e.metrics.camera); }, /camera quaternion\[0\] differs from source/],
    ['tracking', p => { const e = p.mobile.after.find(e => e.id === 'rotated-fight'); e.metrics.cameraFrames.at(-1).tracking.z += .25;
      e.metrics.camera = replayMobileCamera(source, e.metrics.cameraFrames); e.metrics.cameraExpected = clone(e.metrics.camera); }, /tracking z: differs from source FIGHT replay/],
    ['tension', p => { p.mobile.after.find(e => e.id === 'rotated-fight').layout.tension += .01; }, /HUD tension: differs from source FIGHT replay/],
    ['source', p => { p.mobile.metadata.implementations.pr.cameraBlob = 'b'.repeat(40); }, /implementation provenance differs/],
    ['comparison', p => { p.mobile.comparison.rows[0].id = 'forged-row'; }, /report differs/],
    ['capture ID', p => { p.mobile.after[0].id = 'substituted-capture'; }, /Missing\/duplicate mobile capture/],
    ['missing PNG', p => { delete p.record.files['test-results/mobile-comparison/pr-rotated-fight.png']; }, /Missing mobile artifact/],
    ['missing JSON', p => { delete p.record.files['test-results/mobile-comparison/main-rotated-fight.json']; }, /Missing mobile artifact/],
  ];
  for (const [label, mutate, expected] of cases) {
    const input = clone(original); mutate(input.lanes.mobile);
    await assert.rejects(validateAggregate(input), expected, label);
  }
  const regular = clone(original); regular.needs.e2e_regular_a.result = 'failure';
  await assert.rejects(validateAggregate(regular), /Required job incomplete: e2e_regular_a/);
  const mobile = clone(original); mobile.lanes.mobile.result.executed = false;
  await assert.rejects(validateAggregate(mobile), /No executed E2E tests/);
});

test('either successful lane cannot replace failed, cancelled, skipped or missing required jobs', async () => {
  for (const job of ['build', ...LANES.map(lane => `e2e_${lane}`)]) {
    for (const outcome of ['failure', 'cancelled', 'skipped', undefined]) {
      const input = fixture(); input.needs[job].result = outcome;
      await assert.rejects(() => validateAggregate(input), /Required job incomplete/);
    }
    const input = fixture(); delete input.needs[job];
    await assert.rejects(() => validateAggregate(input), /Missing or unexpected required job/);
  }
});

test('missing, failed, interrupted or unexecuted lane records fail even if needs says success', async () => {
  for (const lane of LANES) {
    const missing = fixture(); delete missing.lanes[lane];
    await assert.rejects(() => validateAggregate(missing), /Missing .* validation artifact/);
    for (const status of ['failed', 'interrupted', 'running', 'not-run', 'skipped', undefined]) {
      const input = fixture(); input.lanes[lane].result.status = status;
      await assert.rejects(() => validateAggregate(input), /Selected E2E did not complete/);
    }
    for (const mutate of [
      payload => payload.result.executed = false, payload => payload.result.signal = 'SIGTERM',
      payload => payload.result.exitCode = 1, payload => payload.result.passedTests = 999,
      payload => payload.record.jobStatus = 'cancelled',
    ]) {
      const input = fixture(); mutate(input.lanes[lane]); await assert.rejects(() => validateAggregate(input));
    }
  }
});

test('missing or substituted IDs cannot pass by keeping the same passing test count', async () => {
  for (const type of ['collection', 'report']) {
    for (const mutate of [
      specs => specs.pop(), specs => specs[0].id = 'unexpected-ID',
      specs => specs.push({ ...clone(specs[0]), id: 'extra-ID' }), specs => specs[1].id = specs[0].id,
    ]) {
      const input = fixture(); mutate(input.lanes.regular_a[type].suites[0].specs);
      await assert.rejects(() => validateAggregate(input), /IDs|identities|specs differ|tests differ/);
    }
  }
  const input = fixture();
  input.lanes.mobile.collection.suites[0].specs[0].id = input.lanes.regular_a.collection.suites[0].specs[0].id;
  await assert.rejects(() => validateAggregate(input), /Lane collection differs/);
});

test('skip, expected failure, retry and zero execution fail at the final gate', async () => {
  for (const mutate of [
    entry => entry.expectedStatus = 'skipped', entry => entry.expectedStatus = 'failed',
    entry => entry.status = 'flaky', entry => entry.results = [],
    entry => entry.results.push({ status: 'passed' }), entry => entry.results[0].retry = 1,
    entry => entry.results[0].status = 'skipped',
  ]) {
    const input = fixture(); mutate(input.lanes.mobile.report.suites[0].specs[0].tests[0]);
    await assert.rejects(() => validateAggregate(input));
  }
});

test('all required install/unit/build/setup steps and diagnostic uploads must succeed', async () => {
  for (const [job, names] of [['build', BUILD_STEPS], ...LANES.map(lane => [lane, E2E_STEPS])]) {
    for (const name of names) for (const outcome of ['failure', 'cancelled', 'skipped', undefined]) {
      const input = fixture();
      (job === 'build' ? input.build : input.lanes[job]).record.steps[name].outcome = outcome;
      await assert.rejects(() => validateAggregate(input), /Required step incomplete/);
    }
    const input = fixture(); delete input.needs[job === 'build' ? job : `e2e_${job}`].outputs.artifact_id;
    await assert.rejects(() => validateAggregate(input), /Missing uploaded artifact ID/);
  }
  const duplicate = fixture(); duplicate.needs.e2e_mobile.outputs.artifact_id = duplicate.needs.e2e_regular_a.outputs.artifact_id;
  await assert.rejects(() => validateAggregate(duplicate), /Duplicate artifact IDs/);
});

test('uploaded IDs must be canonical positive integer strings before they can select a path', async () => {
  for (const job of ['build', ...LANES]) {
    const key = job === 'build' ? job : `e2e_${job}`;
    for (const id of ['0', '-1', '01', '123suffix', '1,2', '../100', '1/../../100', '1e2', '9007199254740992', 100, true]) {
      const input = fixture(); input.needs[key].outputs.artifact_id = id;
      assert.throws(() => uploadedArtifactId(input.needs, job), /Invalid uploaded artifact ID/);
      await assert.rejects(validateAggregate(input), /Invalid uploaded artifact ID/);
    }
  }
});

test('singleton service downloads bind each output ID to its actual name and reject substitution or swapping', t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'barb-artifact-ids-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const input = fixture();
  const jobs = ['build', ...LANES];
  // This service map is independent of needs: selectors cannot rename an
  // artifact or substitute the name-selected payload for an unknown ID.
  const service = new Map(jobs.map((job, index) => [String(100 + index), artifactName(input.context, job)]));
  const download = needs => {
    for (const job of jobs) {
      const id = uploadedArtifactId(needs, job), actualName = service.get(id);
      assert(actualName, 'Artifact service: ID not found');
      mkdirSync(path.join(directory, id, actualName), { recursive: true });
    }
  };
  download(input.needs);
  const check = needs => validateArtifactDownloads({ directory, needs, context: input.context, active: LANES });
  assert.doesNotThrow(() => check(input.needs));
  for (const job of jobs) {
    const key = job === 'build' ? job : `e2e_${job}`;
    const changed = clone(input.needs); changed[key].outputs.artifact_id = '999999';
    assert.throws(() => check(changed), /Missing, unexpected or colliding validation artifacts/);
    assert.throws(() => download(changed), /Artifact service: ID not found/);
  }
  const swapped = clone(input.needs);
  [swapped.e2e_regular_a.outputs.artifact_id, swapped.e2e_regular_c.outputs.artifact_id] =
    [swapped.e2e_regular_c.outputs.artifact_id, swapped.e2e_regular_a.outputs.artifact_id];
  // The requested ID set is unchanged; the service's actual names expose the swap.
  assert.throws(() => check(swapped), /Downloaded artifact name differs for output ID/);
  const reused = clone(input.needs); reused.e2e_regular_c.outputs.artifact_id = reused.e2e_regular_a.outputs.artifact_id;
  assert.throws(() => check(reused), /Duplicate artifact IDs/);
  const id = uploadedArtifactId(input.needs, 'regular_c');
  const actual = path.join(directory, id, artifactName(input.context, 'regular_c'));
  // A correct service name under another actual ID cannot stand in for the
  // ID declared by this job, even when the name set is otherwise unchanged.
  renameSync(path.join(directory, id), path.join(directory, '888888'));
  assert.throws(() => check(input.needs), /Missing, unexpected or colliding validation artifacts/);
  renameSync(path.join(directory, '888888'), path.join(directory, id));
  for (const changedContext of [{ runId: '43' }, { runAttempt: '2' }, { validationSha: 'b'.repeat(40) }]) {
    const wrongName = path.join(directory, id, artifactName({ ...input.context, ...changedContext }, 'regular_c'));
    renameSync(actual, wrongName);
    assert.throws(() => check(input.needs), /Downloaded artifact name differs for output ID/);
    renameSync(wrongName, actual);
  }
  mkdirSync(path.join(directory, id, 'unexpected-name'));
  assert.throws(() => check(input.needs), /Downloaded artifact name differs for output ID/);
  rmSync(path.join(directory, id, 'unexpected-name'), { recursive: true });
  mkdirSync(path.join(directory, '777777'));
  assert.throws(() => check(input.needs), /Missing, unexpected or colliding validation artifacts/);
  rmSync(path.join(directory, '777777'), { recursive: true });
  const held = path.join(directory, 'held');
  renameSync(actual, held); symlinkSync(held, actual, 'dir');
  assert.throws(() => check(input.needs), /Missing, unexpected or colliding validation artifacts/);
  // Remove the extra top-level path so the child symlink itself is inspected.
  const outside = path.join(tmpdir(), path.basename(directory) + '-held');
  renameSync(held, outside); rmSync(actual); symlinkSync(outside, actual, 'dir');
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  assert.throws(() => check(input.needs), /Invalid downloaded artifact directory/);
});

test('all active gate downloads must succeed and every inactive download must be skipped', () => {
  for (const active of [LANES, [], ['regular_b', 'regular_c'], ['mobile']]) {
    const complete = Object.fromEntries(['build', ...LANES].map(job => [`download_${job}`,
      { outcome: job === 'build' || active.includes(job) ? 'success' : 'skipped' }]));
    complete.download_discovery = { outcome: 'success' };
    assert.doesNotThrow(() => validateDownloadSteps(complete, active));
    for (const outcome of ['failure', 'cancelled', 'skipped', undefined]) {
      const changed = clone(complete); changed.download_discovery.outcome = outcome;
      assert.throws(() => validateDownloadSteps(changed, active), /Required gate download: discovery/);
    }
    for (const job of ['build', ...LANES]) {
      const required = job === 'build' || active.includes(job);
      for (const outcome of required ? ['failure', 'cancelled', 'skipped', undefined] : ['success', 'failure', undefined]) {
        const changed = clone(complete); changed[`download_${job}`].outcome = outcome;
        assert.throws(() => validateDownloadSteps(changed, active), required ? /Required gate download/ : /Unplanned gate download/);
      }
    }
  }
});

test('pattern discovery retains exact remote names and must match the ID-fetched sealed bytes', t => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'barb-artifact-discovery-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const directory = path.join(cwd, '.ci-artifacts'), discoveryDirectory = path.join(cwd, '.ci-discovered');
  mkdirSync(discoveryDirectory);
  const input = fixture(), jobs = ['build', ...LANES];
  for (const job of jobs) {
    const byId = path.join(directory, uploadedArtifactId(input.needs, job), artifactName(input.context, job));
    mkdirSync(path.join(byId, '.ci'), { recursive: true });
    writeFileSync(path.join(byId, '.ci/plan.json'), JSON.stringify(input.plan));
    const payload = job === 'build' ? 'dist' : 'test-results';
    mkdirSync(path.join(byId, payload)); writeFileSync(path.join(byId, payload, 'probe.txt'), `${job} bytes`);
    recordJob(job, { cwd: byId, env: { ...env, CI_STEPS: '{}', CI_JOB_STATUS: 'success' } });
    cpSync(byId, path.join(discoveryDirectory, artifactName(input.context, job)), { recursive: true });
  }
  const check = () => validateArtifactDiscovery({ directory, discoveryDirectory, needs: input.needs,
    context: input.context, active: LANES });
  assert.doesNotThrow(check);
  mkdirSync(path.join(discoveryDirectory, 'ci-unexpected'));
  assert.throws(check, /Missing, unexpected or colliding discovered validation artifacts/);
  rmSync(path.join(discoveryDirectory, 'ci-unexpected'), { recursive: true });
  const root = path.join(discoveryDirectory, artifactName(input.context, 'regular_c'));
  const held = path.join(cwd, 'held');
  renameSync(root, held);
  assert.throws(check, /Missing, unexpected or colliding discovered validation artifacts/);
  symlinkSync(held, root, 'dir');
  assert.throws(check, /Invalid discovered artifact directory/);
  rmSync(root); renameSync(held, root);
  writeFileSync(path.join(root, 'test-results/probe.txt'), 'different bytes');
  assert.throws(check, /Artifact files missing, added or corrupted/);
  // Even a valid but different sealed payload cannot replace the ID download.
  recordJob('regular_c', { cwd: root, env: { ...env, CI_STEPS: '{}', CI_JOB_STATUS: 'success' } });
  assert.throws(check, /Discovered artifact differs from output-ID download: regular_c/);
});

test('base/head/validation SHA, ref, run and attempt mismatches are rejected for every lane', async () => {
  for (const job of ['build', ...LANES]) for (const kind of ['record', 'result']) {
    for (const key of ['baseSha', 'headSha', 'validationSha', 'validationRef', 'eventName', 'prNumber', 'runId', 'runAttempt']) {
      const input = fixture();
      (job === 'build' ? input.build : input.lanes[job])[kind].context[key] = 'mismatch';
      await assert.rejects(() => validateAggregate(input), /provenance differs/);
    }
  }
  const input = fixture(); input.lanes.mobile.result.buildRecordHash = 'another-build';
  await assert.rejects(() => validateAggregate(input), /different build artifact/);
});

test('L1 preserves both smoke specs and related selection, with no unnecessary mobile job', async () => {
  const input = fixture({ eventName: 'pull_request', level: 'L1', specs: [...SMOKE_SPECS, 'tests/browser/audio.spec.js'].sort() });
  assert.deepEqual(input.execution.lanes.mobile, []);
  assert.equal(input.needs.e2e_mobile.result, 'skipped');
  assert.equal((await validateAggregate(input)).passedTests, 3);
  const unexpected = clone(input); unexpected.needs.e2e_mobile.result = 'success';
  await assert.rejects(() => validateAggregate(unexpected), /Unplanned E2E job/);
  const future = [...input.plan.specs, MOBILE_SPEC].sort();
  const lanes = splitSpecs({ ...input.plan, specs: future }, inventory);
  assert.deepEqual(lanes.mobile, [MOBILE_SPEC]); assert.deepEqual(LANES.filter(lane => lane !== 'mobile').flatMap(lane => lanes[lane]).sort(), input.plan.specs);
  const futurePlan = classifyChanges([{ status: 'M', paths: ['src/audio/ambient-player.js'] }], {
    availableSpecs: inventory, groups: { ...L1_GROUPS, 'ambient-output': { specs: ['tests/browser/audio.spec.js', MOBILE_SPEC] } },
  });
  assert.equal(futurePlan.level, 'L1');
  assert.deepEqual(splitSpecs(futurePlan, inventory), lanes);
  for (const missing of SMOKE_SPECS) assert.throws(() => splitSpecs({ ...input.plan,
    specs: future.filter(file => file !== missing) }, inventory), /Missing smoke/);
});

test('L1 skips empty Regular A and keeps original smoke coverage across B/C', async () => {
  const aOnly = fixture({ eventName: 'pull_request', level: 'L1', specs: [...SMOKE_SPECS, 'tests/browser/audio.spec.js'].sort() });
  assert.deepEqual(aOnly.execution.lanes.regular_a, []);
  assert.equal(aOnly.needs.e2e_regular_a.result, 'skipped');
  assert.equal((await validateAggregate(aOnly)).passedTests, aOnly.plan.specs.length);
  // Related specs stay with their complete-file assignment; smokes remain in B/C.
  const split = fixture({ eventName: 'pull_request', level: 'L1', specs: [...SMOKE_SPECS, 'tests/browser/audio-gain.spec.js'].sort() });
  assert.equal((await validateAggregate(split)).passedTests, split.plan.specs.length);
  for (const lane of ['regular_a', 'mobile']) {
    const unexpectedJob = clone(aOnly); unexpectedJob.needs[`e2e_${lane}`].result = 'success';
    await assert.rejects(validateAggregate(unexpectedJob), /Unplanned E2E job/);
    const unexpectedArtifact = clone(aOnly); unexpectedArtifact.needs[`e2e_${lane}`].outputs.artifact_id = 'unplanned';
    await assert.rejects(validateAggregate(unexpectedArtifact), /Unplanned E2E artifact/);
  }
});

test('a future L1 Mobile selection still awaits all 34 source-backed comparisons', async () => {
  const input = fixture({ eventName: 'pull_request', level: 'L1', mobile: await mobileGateFixture(),
    specs: [...SMOKE_SPECS, 'tests/browser/audio.spec.js', MOBILE_SPEC].sort() });
  const result = await validateAggregate(input);
  assert.equal(result.passedTests, input.plan.specs.length);
  assert.equal(result.mobilePairs, 34);
  assert.equal(input.needs.e2e_regular_a.result, 'skipped');
  assert.equal(input.needs.e2e_mobile.result, 'success');
});

test('old regular keys/records, surplus needs/lanes and tampered four-lane execution plans fail closed', async () => {
  for (const mutate of [
    input => input.needs.e2e_regular = input.needs.e2e_regular_a,
    input => { input.needs.e2e_regular = input.needs.e2e_regular_a; delete input.needs.e2e_regular_a; },
    input => delete input.needs.e2e_regular_c,
    input => input.execution.schemaVersion = 1,
    input => input.execution.schemaVersion = 2,
    input => input.execution.profile.hash = 'forged',
    input => input.execution.inputHash = 'forged',
    input => input.execution.selectedSpecs.pop(),
    input => input.execution.lanes.regular_b.push(input.execution.lanes.regular_a[0]),
    input => input.execution.lanes.regular_a.push(MOBILE_SPEC),
    input => input.execution.lanes.regular = input.execution.lanes.regular_a,
    input => input.execution.lanes.regular_b.push('tests/browser/unselected.spec.js'),
    input => input.execution.lanes.regular_c = [],
    input => input.lanes.regular = input.lanes.regular_a,
    input => input.lanes.regular_a.record.job = 'regular',
    input => input.lanes.regular_b.record.schemaVersion = 1,
    input => input.lanes.regular_c.record.schemaVersion = 2,
    input => input.lanes.regular_a.collection = clone(input.lanes.regular_b.collection),
    input => input.lanes.regular_b.report = clone(input.lanes.regular_a.report),
  ]) {
    const input = fixture(); mutate(input);
    await assert.rejects(validateAggregate(input));
  }
  for (const job of ['build', ...LANES]) for (const schemaVersion of [1, 2]) {
    const input = fixture();
    (job === 'build' ? input.build : input.lanes[job]).record.schemaVersion = schemaVersion;
    await assert.rejects(validateAggregate(input), /Unknown record schema/);
  }
});

test('L0 and main push require explicit non-execution and reject unintended E2E', async () => {
  for (const eventName of ['pull_request', 'push']) {
    const input = fixture({ level: 'L0', eventName }), result = await validateAggregate(input);
    const summary = resultSummary({ plan: input.plan, result });
    assert.match(summary, eventName === 'push' ? /E2E未実行（main push設計）/ : /E2E未実行（L0設計）/);
    assert.doesNotMatch(summary, /E2E: 実行成功|34組完了/);
    const missing = clone(input); missing.build.result.status = 'passed';
    await assert.rejects(() => validateAggregate(missing), /Missing explicit E2E non-execution/);
    const unexpected = clone(input); unexpected.build.result.executed = true;
    await assert.rejects(() => validateAggregate(unexpected), /unexpectedly executed E2E/);
    for (const lane of LANES) {
      const running = clone(input); running.needs[`e2e_${lane}`].result = 'success';
      await assert.rejects(validateAggregate(running), /Unplanned E2E job/);
      const artifact = clone(input); artifact.needs[`e2e_${lane}`].outputs.artifact_id = '9999';
      await assert.rejects(validateAggregate(artifact), /Unplanned E2E artifact/);
    }
  }
});

test('main push Pages requires the build artifact and dispatch has no Pages artifact', async () => {
  for (const outcome of ['failure', 'cancelled', 'skipped', undefined]) {
    const input = fixture({ level: 'L0', eventName: 'push' }); input.build.record.steps.pages.outcome = outcome;
    await assert.rejects(() => validateAggregate(input), /Required step incomplete: build\/pages/);
  }
  const missing = fixture({ level: 'L0', eventName: 'push' }); delete missing.needs.build.outputs.pages_artifact_id;
  await assert.rejects(() => validateAggregate(missing), /Missing Pages artifact ID/);
  const dispatch = fixture(); dispatch.build.record.steps.pages.outcome = 'success';
  await assert.rejects(() => validateAggregate(dispatch), /Unexpected Pages artifact upload/);
  const noDist = fixture(); noDist.build.record.files = {};
  await assert.rejects(() => validateAggregate(noDist), /Missing built dist/);
});

test('artifact manifests reject missing, modified, added files and SHA/job/run mixing', t => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'barb-artifact-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  mkdirSync(path.join(cwd, '.ci')); mkdirSync(path.join(cwd, 'dist'));
  const input = fixture();
  writeFileSync(path.join(cwd, '.ci/plan.json'), JSON.stringify(input.plan));
  writeFileSync(path.join(cwd, 'dist/index.html'), 'validated build');
  recordJob('build', { cwd, env: { ...env, CI_STEPS: '{}', CI_JOB_STATUS: 'success' } });
  assert.doesNotThrow(() => readRecord(cwd, 'build', input.context));
  assert.equal(Object.keys(fileManifest(cwd, 'build')).length, 2);
  for (const content of ['different build', null]) {
    if (content === null) rmSync(path.join(cwd, 'dist/index.html'));
    else writeFileSync(path.join(cwd, 'dist/index.html'), content);
    assert.throws(() => readRecord(cwd, 'build', input.context), /missing, added or corrupted/);
  }
  writeFileSync(path.join(cwd, 'dist/index.html'), 'validated build');
  writeFileSync(path.join(cwd, '.ci/injected.json'), '{}');
  assert.throws(() => readRecord(cwd, 'build', input.context), /missing, added or corrupted/);
  rmSync(path.join(cwd, '.ci/injected.json'));
  assert.throws(() => readRecord(cwd, 'mobile', input.context), /Artifact job differs/);
  assert.throws(() => readRecord(cwd, 'build', { ...input.context, validationSha: 'b'.repeat(40) }), /provenance differs/);
  assert.notEqual(artifactName(input.context, 'regular_a'), artifactName(input.context, 'mobile'));
  assert.notEqual(artifactName(input.context, 'mobile'), artifactName({ ...input.context, runAttempt: '2' }, 'mobile'));
});

test('plan includes original reasons, full selected spec list and distinct source SHAs', () => {
  const { plan } = fixture({ eventName: 'pull_request' }), summary = planSummary(plan);
  for (const value of [plan.prNumber, plan.headSha, plan.baseSha, plan.validationRef, plan.validationSha,
    plan.level, ...plan.reasons, ...plan.specs, ...plan.changes[0].paths]) assert(summary.includes(String(value)));
  assert.doesNotMatch(summary, /実行成功|検証: 成功/);
  plan.reasons = ['<img src=x>&`\n\r']; assert.match(planSummary(plan), /&lt;img src=x&gt;&amp;&#96;&#10;&#13;/);
});

test('final writer reports failed/cancelled setup without claiming E2E success', async t => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'barb-summary-'));
  const previous = process.cwd(), log = console.log;
  t.after(() => { process.chdir(previous); console.log = log; rmSync(cwd, { recursive: true, force: true }); });
  process.chdir(cwd); console.log = () => {};
  for (const status of ['failure', 'cancelled']) {
    const summary = path.join(cwd, `${status}.md`);
    await assert.rejects(() => writeSummary('result', { CI_STEPS: '{}', CI_JOB_STATUS: status, GITHUB_STEP_SUMMARY: summary }), /Required gate step/);
    assert.match(readFileSync(summary, 'utf8'), /E2E成功は確認できません/);
    assert.doesNotMatch(readFileSync(summary, 'utf8'), /検証: 成功|E2E: 実行成功/);
  }
});

test('summary CLI awaits result rejection, exits nonzero and preserves plan/record modes', t => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'barb-summary-cli-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  mkdirSync(path.join(cwd, '.ci'));
  writeFileSync(path.join(cwd, '.ci/plan.json'), JSON.stringify(fixture().plan));
  const script = fileURLToPath(new URL('../scripts/ci-summary.js', import.meta.url));
  const summary = path.join(cwd, 'summary.md');
  const environment = { ...process.env, GITHUB_RUN_ID: '42', GITHUB_RUN_ATTEMPT: '1', GITHUB_SHA: SHA,
    CI_STEPS: JSON.stringify(steps(['checkout', 'node', 'install', 'download_build', 'download_discovery'])), CI_JOB_STATUS: 'success',
    CI_NEEDS: JSON.stringify(fixture().needs),
    CI_RECORD_JOB: 'build', GITHUB_STEP_SUMMARY: summary };
  for (const mode of ['plan', 'record']) {
    const child = spawnSync(process.execPath, [script, mode], { cwd, env: environment, encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr);
    assert.doesNotMatch(child.stdout, /検証: 成功|E2E: 実行成功/);
  }
  assert.equal(JSON.parse(readFileSync(path.join(cwd, '.ci/job-record.json'), 'utf8')).job, 'build');
  const child = spawnSync(process.execPath, [script, 'result'], { cwd, env: environment, encoding: 'utf8' });
  assert.equal(child.status, 1, child.stderr); assert.match(child.stderr, /Missing downloaded artifact ID directory/);
  assert.match(child.stdout, /失敗・未完了/); assert.match(readFileSync(summary, 'utf8'), /E2E成功は確認できません/);
  assert.doesNotMatch(child.stdout, /検証: 成功|E2E: 実行成功/);
  assert.doesNotMatch(child.stderr, /UnhandledPromiseRejection|unhandledRejection/);
});

const workflow = readFileSync(new URL('../.github/workflows/pages.yml', import.meta.url), 'utf8').replace(/^\s*#.*$/gm, '');
test('workflow final ci-required always runs with all five direct dependencies and read-only permissions', () => {
  assert.match(workflow, /^permissions:\n  contents: read\n/m);
  assert.equal((workflow.match(/name: ci-required/g) ?? []).length, 1);
  const gate = workflow.slice(workflow.indexOf('\n  required:'), workflow.indexOf('\n  deploy:'));
  assert.match(gate, /if: always\(\)/);
  assert.match(gate, /needs: \[build, e2e_regular_a, e2e_regular_b, e2e_regular_c, e2e_mobile\]/);
  assert.match(gate, /CI_NEEDS: \$\{\{ toJSON\(needs\) \}\}/);
  assert.match(gate, /merge-multiple: false/);
  for (const job of ['build', ...LANES]) {
    const key = job === 'build' ? job : `e2e_${job}`;
    const section = gate.slice(gate.indexOf(`id: download_${job}\n`)).split(/\n      - name:/)[0];
    assert(section.includes(`if: always() && needs.${key}.result == 'success' && needs.${key}.outputs.artifact_id != ''`));
    assert(section.includes(`artifact-ids: \u0024{{ needs.${key}.outputs.artifact_id }}`));
    assert(section.includes(`path: .ci-artifacts/\u0024{{ needs.${key}.outputs.artifact_id }}`));
    assert.match(section, /merge-multiple: false/);
    assert.doesNotMatch(section, /^\s+(?:name|pattern|github-token|run-id):/m);
  }
  const discovery = gate.slice(gate.indexOf('id: download_discovery\n')).split(/\n      - name:/)[0];
  assert.match(discovery, /if: always\(\)/);
  assert(discovery.includes('pattern: ci-${{ github.run_id }}-${{ github.run_attempt }}-${{ github.sha }}-*'));
  assert.match(discovery, /path: \.ci-discovered\n/);
  assert.match(discovery, /merge-multiple: false/);
  assert.match(gate, /node scripts\/ci-summary\.js result/);
  assert.doesNotMatch(workflow, /continue-on-error:|permissions: write-all|^\s+paths(?:-ignore)?:/m);
});

test('all four E2E lanes depend only on build and preserve failure diagnostics for fourteen days', () => {
  assert.equal((workflow.match(/^  e2e_[a-z_]+:/gm) ?? []).length, LANES.length);
  assert.doesNotMatch(workflow, /^  e2e_regular:|run_regular:/m);
  for (const [job, lane] of LANES.map(lane => [`e2e_${lane}`, lane])) {
    const section = workflow.slice(workflow.indexOf(`\n  ${job}:`) + 1).split(/\n  [a-z0-9_]+:/)[0];
    assert.match(section, /^    needs: build$/m);
    assert.match(section, /^    runs-on: ubuntu-latest$/m);
    assert.match(section, /fetch-depth: 0/); assert.match(section, /node-version: 24/);
    assert(section.includes(`if: needs.build.outputs.run_${lane} == 'true'`));
    assert(section.includes(`run: node scripts/ci-e2e.js run ${lane}`));
    assert(section.includes(`CI_RECORD_JOB: ${lane}\n`));
    assert(section.includes(`github.sha }}-${lane}\n`));
    assert(workflow.includes(`run_${lane}: \u0024{{ steps.prepare.outputs.run_${lane} }}`));
    assert.match(section, /if: always\(\)/); assert.match(section, /retention-days: 14/);
    assert.match(section, /include-hidden-files: true/); assert.match(section, /if-no-files-found: error/);
    assert.match(section, /test-results\//);
    const download = section.slice(section.indexOf('- uses: actions/download-artifact@v4')).split(/\n      - name:/)[0];
    assert(download.includes('artifact-ids: ${{ needs.build.outputs.artifact_id }}'));
    assert.match(download, /path: \.ci-input\n/);
    assert.match(download, /merge-multiple: false/);
    assert.doesNotMatch(download, /^\s+(?:name|pattern|github-token|run-id):/m);
  }
});

test('browser timeout, expectation timeout, worker and retry policy stay unchanged', () => {
  const config = readFileSync(new URL('../playwright.config.js', import.meta.url), 'utf8');
  assert.match(config, /timeout: 120000/);
  assert.match(config, /expect: \{ timeout: 15000 \}/);
  assert.match(config, /workers: 1/);
  assert.doesNotMatch(config, /retries:/);
});

test('Pages upload/deploy require main push, the final gate, and the same SHA-specific artifact', () => {
  assert.match(workflow, /if: github.event_name == 'push' && github.ref == 'refs\/heads\/main'/);
  const deploy = workflow.slice(workflow.indexOf('\n  deploy:'));
  assert.match(deploy, /needs: \[build, required\]/);
  assert.match(deploy, /needs.required.result == 'success'/);
  const name = 'github-pages-${{ github.run_id }}-${{ github.run_attempt }}-${{ github.sha }}';
  assert(workflow.includes(`name: ${name}`)); assert(deploy.includes(`artifact_name: ${name}`));
});

test('manual full E2E, disabled cron and event-specific concurrency remain intact', () => {
  assert.match(workflow, /^  workflow_dispatch:\s*$/m);
  assert.doesNotMatch(workflow, /^\s*(?:schedule|cron|inputs):/m);
  assert.match(workflow, /group: \$\{\{ github.workflow \}\}-\$\{\{ github.event_name \}\}-\$\{\{ github.ref \}\}/);
});
