import assert from 'node:assert/strict';
import { appendFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const quote = value => `<code>${String(value ?? 'unknown').replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;').replaceAll('`', '&#96;').replaceAll('\n', '&#10;').replaceAll('\r', '&#13;')}</code>`;

export function planSummary(plan) {
  const lines = ['### CI validation plan', '',
    `- Event / PR: ${quote(plan.eventName)} / ${quote(plan.prNumber ?? '—')}`,
    `- PR HEAD SHA: ${quote(plan.headSha)}`,
    `- Base SHA: ${quote(plan.baseSha)}`,
    `- Validation ref / SHA: ${quote(plan.validationRef)} / ${quote(plan.validationSha)}`,
    `- Selection: **${quote(plan.level)}**`,
    `- Reason: ${plan.reasons.map(quote).join('; ')}`,
    '- npm ci / unit tests / build: 実行予定',
    `- E2E: ${plan.runE2E ? '実行予定（下記の選択対象）' : plan.eventName === 'pull_request' ? 'E2E未実行（L0設計）' : 'E2E未実行（main push設計）'}`,
    `- Pages: ${plan.deploy ? '成功後にデプロイ予定' : 'デプロイ対象外'}`,
    '', 'Changed files:', '',
    ...(plan.changes.length ? plan.changes.map(change => `- ${quote(change.status)} ${change.paths.map(quote).join(' → ')}`)
      : ['- 差分なし、または取得不能（選択理由を参照）']),
    '', 'Selected E2E specs:', '',
    ...(plan.specs.length ? plan.specs.map(quote).map(spec => `- ${spec}`) : ['- なし（未実行）']),
    '', `PC / touch smoke targets: ${plan.smokeSpecs.length ? plan.smokeSpecs.map(quote).join(', ') : '未実行'}`,
    '', '未選択のspecは未実行です。計画は実行結果と区別し、最終結果は下記と各stepで確認してください。', ''];
  return lines.join('\n');
}

export function resultSummary({ plan, result, steps, jobStatus }) {
  const prerequisites = ['checkout', 'node', 'classify', 'plan', 'install', 'unit', 'build', 'e2e'];
  for (const name of prerequisites) assert.equal(steps[name]?.outcome, 'success', `Required step incomplete: ${name}`);
  if (plan.runE2E) {
    assert.equal(steps.chromium?.outcome, 'success', 'Chromium setup incomplete');
    assert.equal(result.status, 'passed', 'Selected E2E did not complete');
    assert(result.executed && result.passedTests > 0, 'No executed passing E2E tests');
  } else {
    assert.equal(result.status, 'not-run', 'Missing explicit E2E non-execution result');
    assert.equal(result.executed, false, 'Unexpected E2E execution');
  }
  assert.equal(steps.diagnostics?.outcome, 'success', 'Diagnostic upload incomplete');
  if (plan.deploy) assert.equal(steps.pages?.outcome, 'success', 'Pages artifact upload incomplete');
  assert.equal(jobStatus, 'success', 'Job failed or was cancelled');
  const e2e = plan.runE2E ? `実行成功（${result.passedTests} tests、収集・実行を照合済み）`
    : plan.eventName === 'pull_request' ? 'E2E未実行（L0設計）' : 'E2E未実行（main push設計）';
  return `### CI validation result\n\n- 検証: 成功\n- E2E: ${e2e}\n- 未選択spec: 未実行\n- Validation SHA: ${quote(plan.validationSha)}\n`;
}

export function writeSummary(mode, env = process.env) {
  const read = name => JSON.parse(readFileSync(path.join('.ci', name), 'utf8'));
  let summary;
  let failure;
  try {
    const plan = read('plan.json');
    summary = mode === 'plan' ? planSummary(plan) : resultSummary({ plan, result: read('result.json'),
      steps: JSON.parse(env.CI_STEPS), jobStatus: env.CI_JOB_STATUS });
  } catch (error) {
    failure = error;
    summary = `### CI validation ${mode === 'plan' ? 'plan' : 'result'}\n\n- 検証: ${env.CI_JOB_STATUS === 'cancelled' ? '中断' : '失敗・未完了'}\n- E2E成功は確認できません。\n- Details: ${quote(error.message)}\n`;
  }
  console.log(summary);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  if (failure) throw failure;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { writeSummary(process.argv[2]); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
