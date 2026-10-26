import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MOBILE_SPEC, prepareE2E, reportTests, runE2E, validateCollection, validateExecution, validatePlan } from '../scripts/ci-e2e.js';
import { artifactName, recordJob, validationContext } from '../scripts/lib/ci-artifacts.js';
import { BUILD_STEPS, E2E_STEPS, verifyArtifacts } from '../scripts/ci-summary.js';
import { createPlan, SMOKE_SPECS } from '../scripts/ci-risk.js';

const SHA = 'a'.repeat(40);
const relatedSpec = 'tests/browser/audio.spec.js';
const selectedSpecs = [...SMOKE_SPECS, relatedSpec].sort();
const clone = value => structuredClone(value);

function report(specs = selectedSpecs) {
  return {
    errors: [],
    suites: [{ title: 'browser suite', suites: specs.map((file, index) => ({
      title: file,
      specs: [{ id: `test-${index}`, file: file.replace('tests/browser/', ''),
        tests: [{ projectName: 'chromium', expectedStatus: 'passed', status: 'expected', results: [{ status: 'passed', retry: 0 }] }],
      }],
    })) }],
  };
}

function plan(overrides = {}) {
  return { schemaVersion: 1, eventName: 'pull_request', headSha: 'b'.repeat(40),
    baseSha: 'c'.repeat(40), validationSha: SHA, validationRef: 'refs/pull/1/merge',
    level: 'L1', runE2E: true, deploy: false,
    changes: [{ status: 'M', paths: ['src/audio/ambient-player.js'] }],
    specs: selectedSpecs, smokeSpecs: [...SMOKE_SPECS], ...overrides };
}

test('L1 collection includes desktop, touch and related specs', () => {
  assert.equal(validateCollection(plan(), report()).length, 3);
});

test('existing selected file with no collected tests is rejected', () => {
  const collection = report();
  collection.suites[0].suites[0].specs[0].tests = [];
  assert.throws(() => validateCollection(plan(), collection), /Selected and collected specs differ/);
});

test('L1 rejects either missing smoke and a smoke-only selection', () => {
  for (const missing of SMOKE_SPECS) {
    const specs = selectedSpecs.filter(spec => spec !== missing);
    assert.throws(() => validateCollection(plan({ specs }), report(specs)), /Missing smoke/);
  }
  assert.throws(() => validateCollection(plan({ specs: [...SMOKE_SPECS] }), report(SMOKE_SPECS)), /no related specs/);
});

test('L1 collection cannot silently drop or add a spec', () => {
  assert.throws(() => validateCollection(plan(), report(SMOKE_SPECS)), /Selected and collected specs differ/);
  assert.throws(() => validateCollection(plan(), report([...selectedSpecs, 'tests/browser/unselected.spec.js'])),
    /Selected and collected specs differ/);
});

test('L2 requires the entire planned inventory to collect tests', () => {
  const specs = [...selectedSpecs, 'tests/browser/fishing.spec.js', 'tests/browser/save-data.spec.js'];
  const fullPlan = plan({ level: 'L2', specs });
  assert.equal(validateCollection(fullPlan, report(specs)).length, specs.length);
  assert.throws(() => validateCollection(fullPlan, report(selectedSpecs)), /Selected and collected specs differ/);
});

test('zero tests, malformed reports, global errors and duplicate identities fail', () => {
  assert.throws(() => reportTests({}), /Missing Playwright suites/);
  assert.throws(() => reportTests(report([])), /zero tests/);
  const collection = report();
  collection.errors.push({ message: 'Cannot import fixture' });
  assert.throws(() => reportTests(collection), /global errors/);
  const duplicate = report();
  duplicate.suites[0].suites[1].specs[0].id = duplicate.suites[0].suites[0].specs[0].id;
  assert.throws(() => reportTests(duplicate), /Duplicate test identities/);
  const anonymous = report();
  delete anonymous.suites[0].suites[0].specs[0].id;
  assert.throws(() => reportTests(anonymous), /Missing collected test identity/);
});

test('successful execution matches every collected identity exactly once', () => {
  const collection = report();
  assert.equal(validateExecution(reportTests(collection), clone(collection), 0), 3);
});

test('failed or interrupted process cannot pass even with a passing report', () => {
  const collection = report();
  for (const exitCode of [1, 130, null, undefined]) {
    assert.throws(() => validateExecution(reportTests(collection), clone(collection), exitCode), /did not exit successfully/);
  }
});

test('execution missing a collected test or substituting another identity fails', () => {
  const collection = report();
  const incomplete = clone(collection);
  incomplete.suites[0].suites.pop();
  assert.throws(() => validateExecution(reportTests(collection), incomplete, 0), /Collected and executed tests differ/);
  const substituted = clone(collection);
  substituted.suites[0].suites[0].specs[0].id = 'different-test';
  assert.throws(() => validateExecution(reportTests(collection), substituted, 0), /Collected and executed tests differ/);
});

test('failed, skipped, timed out, interrupted and flaky tests cannot pass', () => {
  const collection = report();
  for (const status of ['failed', 'skipped', 'timedOut', 'interrupted']) {
    const execution = clone(collection);
    execution.suites[0].suites[0].specs[0].tests[0].results[0].status = status;
    assert.throws(() => validateExecution(reportTests(collection), execution, 0), /Unexecuted or unsuccessful test/);
  }
  for (const status of ['unexpected', 'skipped', 'flaky']) {
    const execution = clone(collection);
    execution.suites[0].suites[0].specs[0].tests[0].status = status;
    assert.throws(() => validateExecution(reportTests(collection), execution, 0), /Failed, skipped or flaky test/);
  }
});

test('unexecuted, retried and expected-failure tests cannot be counted as passed', () => {
  const collection = report();
  for (const results of [[], [{ status: 'failed' }, { status: 'passed' }]]) {
    const execution = clone(collection);
    execution.suites[0].suites[0].specs[0].tests[0].results = results;
    assert.throws(() => validateExecution(reportTests(collection), execution, 0), /exactly once/);
  }
  const expectedFailure = clone(collection);
  expectedFailure.suites[0].suites[0].specs[0].tests[0].expectedStatus = 'failed';
  assert.throws(() => validateExecution(reportTests(collection), expectedFailure, 0), /Non-passing test expectation/);
});

test('classification plan must match checkout, current event and recomputed selection', () => {
  const original = plan();
  assert.doesNotThrow(() => validatePlan(original, clone(original), SHA));
  assert.throws(() => validatePlan(original, clone(original), 'd'.repeat(40)), /Checkout differs/);
  for (const [key, value] of [
    ['eventName', 'workflow_dispatch'], ['headSha', 'e'.repeat(40)], ['baseSha', 'f'.repeat(40)],
    ['validationSha', 'd'.repeat(40)], ['validationRef', 'refs/pull/2/merge'],
    ['level', 'L0'], ['runE2E', false], ['deploy', true], ['changes', []],
    ['specs', [...SMOKE_SPECS]], ['smokeSpecs', []],
  ]) {
    const stale = { ...original, [key]: value };
    assert.throws(() => validatePlan(stale, clone(original), key === 'validationSha' ? value : SHA),
      new RegExp(`Stale or inconsistent plan: ${key}`));
  }
  assert.throws(() => validatePlan({ ...original, schemaVersion: 2 }, clone(original), SHA), /Unknown plan schema/);
});

test('L0 may omit E2E only with an empty consistent selection', () => {
  const documentation = plan({ level: 'L0', runE2E: false, specs: [], smokeSpecs: [] });
  assert.doesNotThrow(() => validatePlan(documentation, clone(documentation), SHA));
  const selectedButSkipped = { ...documentation, specs: [relatedSpec] };
  assert.throws(() => validatePlan(selectedButSkipped, clone(selectedButSkipped), SHA), /Skipped plan contains selected specs/);
  const weakened = plan({ level: 'L1', runE2E: false });
  assert.throws(() => validatePlan(weakened, clone(weakened), SHA), /Only L0 may omit E2E/);
  const empty = plan({ specs: [] });
  assert.throws(() => validatePlan(empty, clone(empty), SHA), /No selected E2E specs/);
});

// Exercise the actual Playwright CLI and its JSON reporter in a disposable
// repository. These probes request no browser, web server or application code.
function runnerFixture(t, eventName = 'workflow_dispatch', behavior = 'pass', includeMobile = false) {
  const cwd = mkdtempSync(path.join(tmpdir(), 'barb-ci-runner-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  mkdirSync(path.join(cwd, 'tests/browser'), { recursive: true });
  const originalInventory = eventName === 'pull_request'
    ? [...selectedSpecs, 'tests/browser/audio-gain.spec.js', 'tests/browser/game.spec.js'].sort()
    : selectedSpecs;
  const inventory = [...originalInventory, ...(includeMobile ? [MOBILE_SPEC] : [])].sort();
  for (const [index, file] of inventory.entries()) writeFileSync(path.join(cwd, file), `
    const { test, expect } = require('@playwright/test');
    test${behavior === 'skip' && index === 0 ? '.skip' : ''}('probe ${index}', () => {
      expect(1).toBe(${behavior === 'fail' && index === 0 ? '2' : '1'});
    });
  `);
  writeFileSync(path.join(cwd, 'playwright.config.js'), `
    module.exports = { testDir: './tests/browser', workers: 1 };
  `);
  mkdirSync(path.join(cwd, 'src/audio'), { recursive: true });
  writeFileSync(path.join(cwd, 'src/audio/ambient-player.js'), '// base\n');
  writeFileSync(path.join(cwd, 'README.md'), '# Fixture\n');
  function git(args) {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  }
  const identity = ['-c', 'user.name=CI fixture', '-c', 'user.email=ci@example.invalid', '-c', 'commit.gpgsign=false'];
  git(['init', '-q', '--initial-branch=main']);
  git(['add', '.']);
  git([...identity, 'commit', '-qm', 'fixture']);
  let event = {};
  if (eventName === 'pull_request') {
    const baseSha = git(['rev-parse', 'HEAD']);
    git(['switch', '-qc', 'fixture-pr']);
    writeFileSync(path.join(cwd, behavior === 'docs' ? 'README.md' : 'src/audio/ambient-player.js'), '// PR change\n');
    git(['add', '.']);
    git([...identity, 'commit', '-qm', 'PR change']);
    const headSha = git(['rev-parse', 'HEAD']);
    git(['switch', '-q', 'main']);
    git([...identity, 'merge', '--no-ff', '-qm', 'PR validation merge', 'fixture-pr']);
    event = { number: 1, pull_request: { head: { sha: headSha }, base: { sha: baseSha } } };
  }
  const validationSha = git(['rev-parse', 'HEAD']);
  const eventPath = path.join(cwd, 'event.json');
  writeFileSync(eventPath, JSON.stringify(event));
  const env = { ...process.env, GITHUB_EVENT_PATH: eventPath, GITHUB_EVENT_NAME: eventName,
    GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1',
    GITHUB_REF: eventName === 'pull_request' ? 'refs/pull/1/merge' : 'refs/heads/main', GITHUB_SHA: validationSha };
  mkdirSync(path.join(cwd, '.ci'));
  writeFileSync(path.join(cwd, '.ci/plan.json'), JSON.stringify(createPlan({
    cwd, event, eventName, ref: env.GITHUB_REF, validationSha, fetch: false,
  })));
  symlinkSync(path.resolve('node_modules'), path.join(cwd, 'node_modules'), 'dir');
  return { cwd, env, result: () => JSON.parse(readFileSync(path.join(cwd, '.ci/result.json'), 'utf8')) };
}

function runPrepared(fixture) {
  prepareE2E(fixture);
  mkdirSync(path.join(fixture.cwd, 'dist'));
  writeFileSync(path.join(fixture.cwd, 'dist/index.html'), 'probe build');
  seal(fixture, 'build', BUILD_STEPS);
  const input = path.join(fixture.cwd, '.ci-input');
  mkdirSync(input);
  for (const directory of ['.ci', 'dist']) cpSync(path.join(fixture.cwd, directory), path.join(input, directory), { recursive: true });
  rmSync(path.join(fixture.cwd, '.ci'), { recursive: true });
  return runE2E(fixture);
}

function seal(fixture, job, names) {
  return recordJob(job, { ...fixture, env: { ...fixture.env, CI_JOB_STATUS: 'success',
    CI_STEPS: JSON.stringify({ ...Object.fromEntries(names.map(name => [name, { outcome: 'success' }])),
      ...(job === 'build' ? { pages: { outcome: fixture.env.GITHUB_EVENT_NAME === 'push' ? 'success' : 'skipped' } } : {}) }) } });
}

function archive(fixture, directory, job) {
  const plan = JSON.parse(readFileSync(path.join(fixture.cwd, '.ci/plan.json'), 'utf8'));
  const destination = path.join(fixture.cwd, '.ci-artifacts', artifactName(validationContext(plan, fixture.env), job));
  mkdirSync(destination, { recursive: true });
  for (const root of ['.ci', job === 'build' ? 'dist' : 'test-results']) {
    cpSync(path.join(directory, root), path.join(destination, root), { recursive: true });
  }
  return destination;
}

test('runner records main push E2E omission without launching Playwright', t => {
  const fixture = runnerFixture(t, 'push');
  assert.equal(prepareE2E(fixture).status, 'not-run');
  assert.equal(fixture.result().executed, false);
  assert.equal(fixture.result().passedTests, 0);
});

test('runner completes only after collecting and executing the full dispatch inventory', t => {
  const fixture = runnerFixture(t);
  assert.equal(runPrepared(fixture).status, 'passed');
  assert.equal(fixture.result().passedTests, selectedSpecs.length);
  assert.equal(fixture.result().executed, true);
});

test('runner persists a failed result when actual Playwright test fails', t => {
  const fixture = runnerFixture(t, 'workflow_dispatch', 'fail');
  assert.throws(() => runPrepared(fixture), /did not exit successfully/);
  assert.equal(fixture.result().status, 'failed');
  assert.equal(fixture.result().exitCode, 1);
});

test('runner rejects actual skipped tests even when Playwright exits successfully', t => {
  const fixture = runnerFixture(t, 'workflow_dispatch', 'skip');
  assert.throws(() => runPrepared(fixture), /Non-passing test expectation|Failed, skipped or flaky test/);
  assert.equal(fixture.result().status, 'failed');
});

test('L1 PR runner recomputes the real merge diff and filters only related and smoke specs', t => {
  const fixture = runnerFixture(t, 'pull_request');
  const planned = JSON.parse(readFileSync(path.join(fixture.cwd, '.ci/plan.json'), 'utf8'));
  assert.equal(planned.level, 'L1');
  assert.equal(planned.diff.ok, true);
  assert.deepEqual(planned.changes, [{ status: 'M', paths: ['src/audio/ambient-player.js'] }]);
  assert.equal(runPrepared(fixture).passedTests, 4);
  const collected = reportTests(JSON.parse(readFileSync(path.join(fixture.cwd, '.ci/collection.json'), 'utf8')));
  assert.deepEqual(collected.map(({ file }) => file).sort(), [
    'audio-gain.spec.js', 'audio.spec.js', 'smoke-pc.spec.js', 'smoke-touch.spec.js',
  ]);
  assert.equal(collected.some(({ file }) => file === 'game.spec.js'), false);
});

test('L0 documentation PR runner verifies the merge and records intentional E2E omission', t => {
  const fixture = runnerFixture(t, 'pull_request', 'docs');
  const planned = JSON.parse(readFileSync(path.join(fixture.cwd, '.ci/plan.json'), 'utf8'));
  assert.equal(planned.level, 'L0');
  assert.equal(planned.diff.ok, true);
  assert.equal(prepareE2E(fixture).status, 'not-run');
  assert.equal(fixture.result().executed, false);
});

test('real reporter probes from both lanes pass the actual artifact gate; missing/corrupt evidence fails', t => {
  const fixture = runnerFixture(t, 'workflow_dispatch', 'pass', true);
  // No browser/application is used; this exercises runner/report/artifact wiring.
  assert.equal(runPrepared(fixture).passedTests, selectedSpecs.length);
  archive(fixture, path.join(fixture.cwd, '.ci-input'), 'build');
  seal(fixture, 'regular', E2E_STEPS); archive(fixture, fixture.cwd, 'regular');
  assert.equal(runE2E({ ...fixture, lane: 'mobile' }).passedTests, 1);
  seal(fixture, 'mobile', E2E_STEPS);
  const mobile = archive(fixture, fixture.cwd, 'mobile');
  const needs = Object.fromEntries(['build', 'e2e_regular', 'e2e_mobile'].map(job =>
    [job, { result: 'success', outputs: { artifact_id: `${job}-id` } }]));
  const input = { ...fixture, env: { ...fixture.env, CI_NEEDS: JSON.stringify(needs) } };
  assert.equal(verifyArtifacts(input).result.passedTests, 4);
  const reportFile = path.join(mobile, '.ci/e2e-report.json');
  const original = readFileSync(reportFile);
  writeFileSync(reportFile, '{}');
  assert.throws(() => verifyArtifacts(input), /missing, added or corrupted/);
  writeFileSync(reportFile, original);
  mkdirSync(path.join(fixture.cwd, '.ci-artifacts/unexpected-artifact'));
  assert.throws(() => verifyArtifacts(input), /Missing, unexpected or colliding/);
  rmSync(path.join(fixture.cwd, '.ci-artifacts/unexpected-artifact'), { recursive: true });
  rmSync(mobile, { recursive: true });
  assert.throws(() => verifyArtifacts(input), /Missing, unexpected or colliding/);
});

test('actual L0 and main push records pass only with explicit omission and required build evidence', t => {
  for (const eventName of ['pull_request', 'push']) {
    const fixture = runnerFixture(t, eventName, 'docs');
    assert.equal(prepareE2E(fixture).status, 'not-run');
    mkdirSync(path.join(fixture.cwd, 'dist')); writeFileSync(path.join(fixture.cwd, 'dist/index.html'), 'built main');
    seal(fixture, 'build', BUILD_STEPS); archive(fixture, fixture.cwd, 'build');
    const needs = { build: { result: 'success', outputs: { artifact_id: 'build-id',
      ...(eventName === 'push' ? { pages_artifact_id: 'pages-id' } : {}) } },
    e2e_regular: { result: 'skipped', outputs: {} }, e2e_mobile: { result: 'skipped', outputs: {} } };
    const result = verifyArtifacts({ ...fixture, env: { ...fixture.env, CI_NEEDS: JSON.stringify(needs) } });
    assert.equal(result.result.passedTests, 0); assert.equal(result.plan.deploy, eventName === 'push');
  }
});
