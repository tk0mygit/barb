import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createPlan, SMOKE_SPECS } from './ci-risk.js';

// Compare collected test identities, not just existing files or process exit code.
export function reportTests(report) {
  assert(Array.isArray(report.suites), 'Missing Playwright suites');
  assert(!report.errors?.length, 'Playwright reported collection/global errors');
  const tests = [];
  function visit(suite) {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        assert(spec.id && spec.file, 'Missing collected test identity');
        tests.push({ key: `${spec.id}:${test.projectName ?? ''}`, file: spec.file.replaceAll('\\', '/'), test });
      }
    }
    for (const child of suite.suites ?? []) visit(child);
  }
  report.suites.forEach(visit);
  assert(tests.length > 0, 'Playwright collected zero tests');
  assert.equal(new Set(tests.map(test => test.key)).size, tests.length, 'Duplicate test identities');
  return tests;
}

export function validateCollection(plan, report) {
  const tests = reportTests(report);
  const collectedFiles = new Set(tests.map(({ file }) => file));
  const relativeSpecs = plan.specs.map(file => path.posix.relative('tests/browser', file));
  assert.deepEqual([...collectedFiles].sort(), [...relativeSpecs].sort(), 'Selected and collected specs differ');
  if (plan.level === 'L1') {
    for (const smoke of SMOKE_SPECS) assert(plan.specs.includes(smoke), `Missing smoke: ${smoke}`);
    assert(plan.specs.some(spec => !SMOKE_SPECS.includes(spec)), 'L1 has no related specs');
  }
  return tests;
}

export function validateExecution(collected, report, exitCode) {
  assert.equal(exitCode, 0, 'Playwright did not exit successfully');
  const executed = reportTests(report);
  assert.deepEqual(executed.map(test => test.key).sort(), collected.map(test => test.key).sort(),
    'Collected and executed tests differ');
  for (const { key, test } of executed) {
    assert.equal(test.expectedStatus, 'passed', `Non-passing test expectation: ${key}`);
    assert.equal(test.status, 'expected', `Failed, skipped or flaky test: ${key}`);
    assert.equal(test.results?.length, 1, `Test must execute exactly once: ${key}`);
    assert.equal(test.results[0].status, 'passed', `Unexecuted or unsuccessful test: ${key}`);
  }
  return executed.length;
}

export function validatePlan(plan, fresh, actualSha) {
  assert.equal(plan.schemaVersion, 1, 'Unknown plan schema');
  assert.equal(plan.validationSha, actualSha, 'Checkout differs from classified SHA');
  for (const key of ['eventName', 'headSha', 'baseSha', 'validationSha', 'validationRef', 'level',
    'runE2E', 'deploy', 'changes', 'specs', 'smokeSpecs']) {
    assert.deepEqual(plan[key], fresh[key], `Stale or inconsistent plan: ${key}`);
  }
  if (!plan.runE2E) {
    assert.equal(plan.level, 'L0', 'Only L0 may omit E2E');
    assert.equal(plan.specs.length, 0, 'Skipped plan contains selected specs');
  } else {
    assert(['L1', 'L2'].includes(plan.level), 'Invalid E2E level');
    assert(plan.specs.length > 0, 'No selected E2E specs');
  }
}

export function runE2E({ cwd = process.cwd(), env = process.env } = {}) {
  const output = path.join(cwd, '.ci');
  mkdirSync(output, { recursive: true });
  const resultPath = path.join(output, 'result.json');
  const result = { status: 'running', executed: false, passedTests: 0 };
  const save = () => writeFileSync(resultPath, JSON.stringify(result, null, 2));
  save();
  try {
    const plan = JSON.parse(readFileSync(path.join(output, 'plan.json'), 'utf8'));
    const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
    const git = spawnSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' });
    assert.ifError(git.error);
    assert.equal(git.status, 0, 'Cannot identify validation checkout');
    const fresh = createPlan({ cwd, event, eventName: env.GITHUB_EVENT_NAME,
      ref: env.GITHUB_REF, validationSha: env.GITHUB_SHA, fetch: false });
    validatePlan(plan, fresh, git.stdout.trim());
    if (!plan.runE2E) {
      result.status = 'not-run';
      result.reason = plan.reasons.join('; ');
      save();
      return result;
    }
    const cli = path.join(cwd, 'node_modules/@playwright/test/cli.js');
    const filters = plan.level === 'L1'
      ? plan.specs.map(spec => `(^|/)${spec.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) : [];
    const args = ['test', ...filters, '--forbid-only', '--workers=1'];
    const collection = spawnSync(process.execPath, [cli, ...args, '--list', '--reporter=json'], {
      cwd, env: { ...env, PLAYWRIGHT_JSON_OUTPUT_FILE: '' }, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
    });
    writeFileSync(path.join(output, 'collection.json'), collection.stdout ?? '');
    assert.ifError(collection.error);
    assert.equal(collection.status, 0, `Playwright collection failed: ${collection.stderr ?? collection.error ?? ''}`);
    const collected = validateCollection(plan, JSON.parse(collection.stdout));
    result.collectedTests = collected.length;
    save();
    const reportPath = path.join(output, 'e2e-report.json');
    rmSync(reportPath, { force: true });
    result.executed = true;
    save();
    const execution = spawnSync(process.execPath, [cli, ...args, '--reporter=line,json'], {
      cwd, env: { ...env, PLAYWRIGHT_JSON_OUTPUT_FILE: reportPath }, stdio: 'inherit',
    });
    result.exitCode = execution.status;
    result.signal = execution.signal;
    assert.ifError(execution.error);
    assert.equal(execution.signal, null, 'Playwright execution was interrupted');
    result.passedTests = validateExecution(collected, JSON.parse(readFileSync(reportPath, 'utf8')), execution.status);
    result.status = 'passed';
    save();
    return result;
  } catch (error) {
    result.status = 'failed';
    result.error = error.message;
    save();
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { runE2E(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
