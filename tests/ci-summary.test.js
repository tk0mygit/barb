import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { planSummary, resultSummary, writeSummary } from '../scripts/ci-summary.js';

const SHA = 'a'.repeat(40);
const smokeSpecs = ['tests/browser/smoke-pc.spec.js', 'tests/browser/smoke-touch.spec.js'];
const requiredSteps = ['checkout', 'node', 'classify', 'plan', 'install', 'unit', 'build', 'e2e'];

function fixture(overrides = {}) {
  const plan = {
    eventName: 'pull_request', prNumber: 42, headSha: 'b'.repeat(40), baseSha: 'c'.repeat(40),
    validationRef: 'refs/pull/42/merge', validationSha: SHA, level: 'L1',
    reasons: ['局所音声変更'], changes: [{ status: 'M', paths: ['src/audio/ambient-player.js'] }],
    specs: [...smokeSpecs, 'tests/browser/audio.spec.js'], smokeSpecs,
    runE2E: true, deploy: false,
  };
  const steps = Object.fromEntries([...requiredSteps, 'chromium', 'diagnostics'].map(name => [name, { outcome: 'success' }]));
  steps.pages = { outcome: 'skipped' };
  return { plan, steps, result: { status: 'passed', executed: true, passedTests: 7 }, jobStatus: 'success', ...overrides };
}

function omittedE2E(eventName = 'pull_request') {
  const input = fixture();
  input.plan = { ...input.plan, eventName, level: 'L0', runE2E: false,
    deploy: eventName === 'push', specs: [], smokeSpecs: [] };
  input.result = { status: 'not-run', executed: false, passedTests: 0 };
  input.steps.chromium.outcome = 'skipped';
  if (input.plan.deploy) input.steps.pages.outcome = 'success';
  return input;
}

test('plan identifies PR HEAD, base, validation SHA and the complete selected scope', () => {
  const { plan } = fixture();
  const summary = planSummary(plan);
  for (const value of [plan.prNumber, plan.headSha, plan.baseSha, plan.validationRef,
    plan.validationSha, plan.level, plan.reasons[0], ...plan.specs, ...plan.changes[0].paths]) {
    assert(summary.includes(String(value)), `Missing plan evidence: ${value}`);
  }
  assert.match(summary, /実行予定/);
  assert.match(summary, /PC \/ touch smoke targets:/);
  assert.match(summary, /未選択のspecは未実行/);
  assert.doesNotMatch(summary, /実行成功|検証: 成功/);
});

test('L0 plan and result explicitly distinguish omitted E2E from passed E2E', () => {
  const input = omittedE2E();
  const planned = planSummary(input.plan);
  const result = resultSummary(input);
  for (const summary of [planned, result]) {
    assert.match(summary, /E2E未実行（L0設計）/);
    assert.doesNotMatch(summary, /E2E: (?:実行成功|成功)/);
  }
  assert.match(result, /検証: 成功/);
  assert.match(result, /未選択spec: 未実行/);
});

test('L1 and L2 results report actual execution count and leave unselected specs unexecuted', () => {
  for (const level of ['L1', 'L2']) {
    const input = fixture();
    input.plan.level = level;
    const summary = resultSummary(input);
    assert.match(summary, /E2E: 実行成功（7 tests、収集・実行を照合済み）/);
    assert.match(summary, /未選択spec: 未実行/);
    assert(summary.includes(SHA));
  }
});

test('every required step must complete, even the L0 audit step that records non-execution', () => {
  for (const name of requiredSteps) {
    for (const outcome of ['failure', 'cancelled', 'skipped']) {
      const input = omittedE2E();
      input.steps[name].outcome = outcome;
      assert.throws(() => resultSummary(input), new RegExp(`Required step incomplete: ${name}`));
    }
    const input = fixture();
    delete input.steps[name];
    assert.throws(() => resultSummary(input), new RegExp(`Required step incomplete: ${name}`));
  }
});

test('selected E2E cannot pass if Chromium was failed, skipped, cancelled or missing', () => {
  for (const outcome of ['failure', 'cancelled', 'skipped', undefined]) {
    const input = fixture();
    input.steps.chromium.outcome = outcome;
    assert.throws(() => resultSummary(input), /Chromium setup incomplete/);
  }
});

test('selected E2E cannot pass with a failed, interrupted, running or absent execution', () => {
  for (const status of ['failed', 'interrupted', 'running', 'not-run', 'skipped', undefined]) {
    const input = fixture();
    input.result.status = status;
    assert.throws(() => resultSummary(input), /Selected E2E did not complete/);
  }
  for (const result of [
    { status: 'passed', executed: false, passedTests: 7 },
    { status: 'passed', executed: true, passedTests: 0 },
    { status: 'passed', executed: true },
  ]) assert.throws(() => resultSummary(fixture({ result })), /No executed passing E2E tests/);
});

test('L0 requires an explicit non-execution record and rejects unexpected E2E', () => {
  const missing = omittedE2E();
  missing.result.status = undefined;
  assert.throws(() => resultSummary(missing), /Missing explicit E2E non-execution result/);
  const unexpected = omittedE2E();
  unexpected.result.executed = true;
  assert.throws(() => resultSummary(unexpected), /Unexpected E2E execution/);
});

test('diagnostics upload must complete for both E2E and L0 runs', () => {
  for (const makeInput of [fixture, omittedE2E]) {
    for (const outcome of ['failure', 'cancelled', 'skipped', undefined]) {
      const input = makeInput();
      input.steps.diagnostics.outcome = outcome;
      assert.throws(() => resultSummary(input), /Diagnostic upload incomplete/);
    }
  }
});

test('job failure or cancellation cannot become successful after passing steps', () => {
  for (const jobStatus of ['failure', 'cancelled', 'skipped', undefined]) {
    assert.throws(() => resultSummary(fixture({ jobStatus })), /Job failed or was cancelled/);
  }
});

test('main push permits skipped Chromium and E2E omission but requires its Pages artifact', () => {
  const input = omittedE2E('push');
  assert.match(resultSummary(input), /E2E未実行（main push設計）/);
  assert.match(planSummary(input.plan), /成功後にデプロイ予定/);
  for (const outcome of ['failure', 'cancelled', 'skipped', undefined]) {
    input.steps.pages.outcome = outcome;
    assert.throws(() => resultSummary(input), /Pages artifact upload incomplete/);
  }
});

test('summary escapes markup and line breaks in paths, refs and classification reasons', () => {
  const { plan } = fixture();
  const hostile = '<img src=x>&`\n\r| spaced path.md';
  plan.changes = [{ status: 'R100', paths: [hostile, 'new name.md'] }];
  plan.validationRef = hostile;
  plan.reasons = [hostile];
  const summary = planSummary(plan);
  assert.doesNotMatch(summary, /<img/);
  assert.match(summary, /&lt;img src=x&gt;&amp;&#96;&#10;&#13;\| spaced path\.md/);
  assert.match(summary, /<code>R100<\/code>.* → <code>new name\.md<\/code>/);
});

test('result writer records cancellation or failure before rejecting the required check', t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'barb-summary-'));
  const previousDirectory = process.cwd();
  const originalLog = console.log;
  t.after(() => {
    process.chdir(previousDirectory);
    console.log = originalLog;
    rmSync(directory, { recursive: true, force: true });
  });
  mkdirSync(path.join(directory, '.ci'));
  const input = fixture();
  writeFileSync(path.join(directory, '.ci/plan.json'), JSON.stringify(input.plan));
  writeFileSync(path.join(directory, '.ci/result.json'), JSON.stringify(input.result));
  process.chdir(directory);
  console.log = () => {};
  for (const jobStatus of ['cancelled', 'failure']) {
    const summaryPath = path.join(directory, `${jobStatus}.md`);
    assert.throws(() => writeSummary('result', { CI_STEPS: JSON.stringify(input.steps),
      CI_JOB_STATUS: jobStatus, GITHUB_STEP_SUMMARY: summaryPath }), /Job failed or was cancelled/);
    const summary = readFileSync(summaryPath, 'utf8');
    assert.match(summary, jobStatus === 'cancelled' ? /検証: 中断/ : /検証: 失敗・未完了/);
    assert.match(summary, /E2E成功は確認できません/);
    assert.doesNotMatch(summary, /検証: 成功|E2E: 実行成功/);
  }
});

const workflow = readFileSync(new URL('../.github/workflows/pages.yml', import.meta.url), 'utf8');
const activeWorkflow = workflow.replace(/^\s*#.*$/gm, '');

test('workflow keeps one stable required job with read-only repository permissions', () => {
  assert.match(activeWorkflow, /^permissions:\n  contents: read\n/m);
  assert.match(activeWorkflow, /^  build:\n    name: ci-required\n/m);
  assert.doesNotMatch(activeWorkflow, /continue-on-error:|permissions: write-all/);
  assert.doesNotMatch(activeWorkflow, /^\s+paths(?:-ignore)?:/m);
});

test('dispatch cannot weaken full verification and cron remains disabled', () => {
  assert.match(activeWorkflow, /^  workflow_dispatch:\s*$/m);
  assert.doesNotMatch(activeWorkflow, /^\s*(?:schedule|cron|inputs):/m);
});

test('event-specific concurrency separates PR, push, manual and future scheduled validation', () => {
  assert.match(activeWorkflow, /group: \$\{\{ github\.workflow \}\}-\$\{\{ github\.event_name \}\}-\$\{\{ github\.ref \}\}/);
});

test('Pages upload and deployment require main push and successful build', () => {
  const pushMain = "if: github.event_name == 'push' && github.ref == 'refs/heads/main'";
  assert.equal(activeWorkflow.split(pushMain).length - 1, 2);
  const deploy = activeWorkflow.slice(activeWorkflow.indexOf('\n  deploy:'));
  assert(deploy.includes(pushMain));
  assert.match(deploy, /needs: build/);
  assert.doesNotMatch(deploy, /always\(\)|continue-on-error/);
});

test('diagnostics and final outcome verification run after failure, with fourteen-day retention', () => {
  const artifacts = activeWorkflow.slice(activeWorkflow.indexOf('      - name: Upload browser failure diagnostics'),
    activeWorkflow.indexOf('      - uses: actions/upload-pages-artifact'));
  assert.match(artifacts, /if: always\(\)/);
  assert.match(artifacts, /retention-days: 14/);
  assert.match(artifacts, /test-results\//);
  assert.match(artifacts, /\.ci\//);
  const verification = activeWorkflow.slice(activeWorkflow.indexOf('      - name: Verify required outcomes'),
    activeWorkflow.indexOf('\n  deploy:'));
  assert.match(verification, /if: always\(\)/);
  assert.match(verification, /node scripts\/ci-summary\.js result/);
  assert.match(verification, /CI_JOB_STATUS: \$\{\{ job\.status \}\}/);
});
