import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createPlan, listBrowserSpecs, SMOKE_SPECS } from './ci-risk.js';
import { hash, LANES, MOBILE_SPEC, planHash, readRecord, validationContext } from './lib/ci-artifacts.js';

export { LANES, MOBILE_SPEC };
export const identities = tests => tests.map(({ key, file }) => [key, file]).sort((a, b) => a[0].localeCompare(b[0]));

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
  assert.deepEqual(identities(executed), identities(collected),
    'Collected and executed tests differ');
  for (const { key, test } of executed) {
    assert.equal(test.expectedStatus, 'passed', `Non-passing test expectation: ${key}`);
    assert.equal(test.status, 'expected', `Failed, skipped or flaky test: ${key}`);
    assert.equal(test.results?.length, 1, `Test must execute exactly once: ${key}`);
    assert.equal(test.results[0].status, 'passed', `Unexecuted or unsuccessful test: ${key}`);
    assert.equal(test.results[0].retry, 0, `Retried test or missing retry record: ${key}`);
  }
  return executed.length;
}

export function validatePlan(plan, fresh, actualSha) {
  assert.equal(plan.schemaVersion, 1, 'Unknown plan schema');
  assert.equal(plan.validationSha, actualSha, 'Checkout differs from classified SHA');
  for (const key of ['eventName', 'headSha', 'baseSha', 'validationSha', 'validationRef', 'level',
    'runE2E', 'deploy', 'changes', 'specs', 'smokeSpecs', 'prNumber', 'reasons', 'diff']) {
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

export function splitSpecs(plan, inventory) {
  assert.equal(new Set(inventory).size, inventory.length, 'Duplicate inventory specs');
  assert(inventory.every(file => /^tests\/browser\/[^/]+\.spec\.js$/.test(file)), 'Invalid spec inventory');
  assert.equal(new Set(plan.specs).size, plan.specs.length, 'Duplicate selected specs');
  assert(plan.specs.every(file => inventory.includes(file)), 'Selected spec missing from inventory');
  if (plan.level === 'L2') assert.deepEqual(plan.specs, inventory, 'L2 must select the complete inventory');
  // A future L1 mapping that selects mobile is supported: the entire spec stays
  // on one runner, while the original smoke/related selection stays intact.
  if (plan.level === 'L1') {
    for (const smoke of SMOKE_SPECS) assert(plan.specs.includes(smoke), `Missing smoke: ${smoke}`);
    assert(plan.specs.some(spec => !SMOKE_SPECS.includes(spec)), 'L1 has no related specs');
  }
  if (!plan.runE2E) assert.deepEqual(plan.specs, [], 'Skipped plan contains selected specs');
  return Object.fromEntries(LANES.map(lane => [lane,
    plan.specs.filter(spec => (spec === MOBILE_SPEC) === (lane === 'mobile'))]));
}

export function revalidatePlan(plan, { cwd = process.cwd(), env = process.env } = {}) {
  const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
  const git = spawnSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' });
  assert.ifError(git.error);
  assert.equal(git.status, 0, 'Cannot identify validation checkout');
  const fresh = createPlan({ cwd, event, eventName: env.GITHUB_EVENT_NAME,
    ref: env.GITHUB_REF, validationSha: env.GITHUB_SHA, fetch: false });
  validatePlan(plan, fresh, git.stdout.trim());
  if (plan.eventName === 'pull_request') assert(fresh.diff.ok, 'Cannot verify PR base/head/validation SHA relationship');
  return validationContext(plan, env);
}

export function executionPlan(plan, inventory, context) {
  return { schemaVersion: 1, context, planHash: planHash(plan), inventory: [...inventory], lanes: splitSpecs(plan, inventory) };
}

function playwrightArgs(specs) {
  const filters = specs.map(spec => `(^|/)${spec.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
  return ['test', ...filters, '--forbid-only', '--workers=1'];
}

function collect(cwd, env, args, output) {
  const collection = spawnSync(process.execPath, [path.join(cwd, 'node_modules/@playwright/test/cli.js'),
    ...args, '--list', '--reporter=json'], {
    cwd, env: { ...env, PLAYWRIGHT_JSON_OUTPUT_FILE: '' }, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
  });
  writeFileSync(output, collection.stdout ?? '');
  assert.ifError(collection.error);
  assert.equal(collection.status, 0, `Playwright collection failed: ${collection.stderr ?? ''}`);
  return JSON.parse(collection.stdout);
}

// The build runner collects the original, unsplit selection independently.
// Lane collection can therefore never define its own expected coverage.
export function prepareE2E({ cwd = process.cwd(), env = process.env } = {}) {
  const output = path.join(cwd, '.ci');
  mkdirSync(output, { recursive: true });
  const plan = JSON.parse(readFileSync(path.join(output, 'plan.json'), 'utf8'));
  const context = revalidatePlan(plan, { cwd, env });
  const execution = executionPlan(plan, listBrowserSpecs(cwd), context);
  const result = { context, status: 'running', executed: false, passedTests: 0,
    startedAt: new Date().toISOString() };
  const save = () => writeFileSync(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
  save();
  try {
    if (plan.runE2E) {
      const start = performance.now();
      const args = playwrightArgs(plan.level === 'L1' ? plan.specs : []);
      const report = collect(cwd, env, args, path.join(output, 'expected-collection.json'));
      result.collectedTests = validateCollection(plan, report).length;
      result.collectionMs = performance.now() - start;
      result.status = 'prepared';
    } else {
      result.status = 'not-run';
      result.reason = plan.reasons.join('; ');
    }
    writeFileSync(path.join(output, 'execution-plan.json'), JSON.stringify(execution, null, 2));
    if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, LANES.map(lane =>
      `run_${lane}=${execution.lanes[lane].length > 0}\n`).join(''));
    result.finishedAt = new Date().toISOString();
    save();
    return result;
  } catch (error) {
    result.status = 'failed'; result.error = error.message; save(); throw error;
  }
}

export function validateLaneCollection(plan, execution, expectedReport, report, lane) {
  assert(LANES.includes(lane), 'Unknown E2E lane');
  const expected = validateCollection(plan, expectedReport).filter(({ file }) =>
    execution.lanes[lane].includes(`tests/browser/${file}`));
  const collected = validateCollection({ ...plan, level: 'L2', specs: execution.lanes[lane] }, report);
  assert.deepEqual(identities(collected), identities(expected), 'Lane collection differs from original expected IDs');
  return collected;
}

export function runE2E({ cwd = process.cwd(), env = process.env, lane = 'regular',
  input = path.join(cwd, '.ci-input') } = {}) {
  assert(LANES.includes(lane), 'Unknown E2E lane');
  const output = path.join(cwd, '.ci');
  mkdirSync(output, { recursive: true });
  const resultPath = path.join(output, 'result.json');
  const result = { lane, status: 'running', executed: false, passedTests: 0, startedAt: new Date().toISOString() };
  const save = () => writeFileSync(resultPath, JSON.stringify(result, null, 2));
  save();
  try {
    const readInput = name => JSON.parse(readFileSync(path.join(input, '.ci', name), 'utf8'));
    const plan = readInput('plan.json');
    const context = revalidatePlan(plan, { cwd, env });
    const record = readRecord(input, 'build', context);
    assert.equal(record.jobStatus, 'success', 'Build record is not successful');
    result.buildRecordHash = hash(readFileSync(path.join(input, '.ci/job-record.json')));
    const execution = readInput('execution-plan.json');
    assert.deepEqual(execution, executionPlan(plan, listBrowserSpecs(cwd), context), 'Inconsistent execution plan');
    assert(plan.runE2E && execution.lanes[lane].length > 0, 'Unplanned E2E lane');
    for (const name of ['plan.json', 'execution-plan.json', 'expected-collection.json']) {
      cpSync(path.join(input, '.ci', name), path.join(output, name));
    }
    cpSync(path.join(input, 'dist'), path.join(cwd, 'dist'), { recursive: true });
    result.context = context;
    result.specs = execution.lanes[lane];
    const args = playwrightArgs(result.specs);
    const collectionStart = performance.now();
    const report = collect(cwd, env, args, path.join(output, 'collection.json'));
    const collected = validateLaneCollection(plan, execution, readInput('expected-collection.json'), report, lane);
    result.collectionMs = performance.now() - collectionStart;
    result.collectedTests = collected.length;
    save();
    const reportPath = path.join(output, 'e2e-report.json');
    rmSync(reportPath, { force: true });
    result.executed = true;
    save();
    const executionStart = performance.now();
    const run = spawnSync(process.execPath, [path.join(cwd, 'node_modules/@playwright/test/cli.js'), ...args, '--reporter=line,json'], {
      cwd, env: { ...env, PLAYWRIGHT_JSON_OUTPUT_FILE: reportPath }, stdio: 'inherit',
    });
    result.executionMs = performance.now() - executionStart;
    result.exitCode = run.status;
    result.signal = run.signal;
    assert.ifError(run.error);
    assert.equal(run.signal, null, 'Playwright execution was interrupted');
    result.passedTests = validateExecution(collected, JSON.parse(readFileSync(reportPath, 'utf8')), run.status);
    result.status = 'passed';
    result.finishedAt = new Date().toISOString();
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
  try {
    if (process.argv[2] === 'prepare') prepareE2E();
    else if (process.argv[2] === 'run' && LANES.includes(process.argv[3])) runE2E({ lane: process.argv[3] });
    else throw new Error('Usage: node scripts/ci-e2e.js prepare | run regular | run mobile');
  }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
