import assert from 'node:assert/strict';
import { appendFileSync, existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { identities, revalidatePlan, reportTests, validateCollection, validateExecutionPlan,
  validateExecution, validateLaneCollection } from './ci-e2e.js';
import { listBrowserSpecs } from './ci-risk.js';
import { artifactName, hash, LANES, readRecord, recordJob } from './lib/ci-artifacts.js';
import { compareMobileCapturesWithSources, MOBILE_CAPTURE_IDS } from './compare-mobile-performance.mjs';

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

export const BUILD_STEPS = ['checkout', 'node', 'classify', 'plan', 'install', 'unit', 'build', 'prepare'];
export const E2E_STEPS = ['checkout', 'node', 'install', 'download', 'chromium', 'e2e'];

function validateNeeds(needs) {
  assert.deepEqual(Object.keys(needs).sort(), ['build', ...LANES.map(lane => `e2e_${lane}`)].sort(), 'Missing or unexpected required job');
}

// Each singleton download uses this output ID as its parent directory and
// keeps the artifact service's actual name as the child directory.
export function uploadedArtifactId(needs, job) {
  const key = job === 'build' ? job : `e2e_${job}`;
  const id = needs[key]?.outputs?.artifact_id;
  assert(id, `Missing uploaded artifact ID: ${key}`);
  assert(typeof id === 'string' && /^[1-9]\d*$/.test(id) && Number.isSafeInteger(Number(id)),
    `Invalid uploaded artifact ID: ${key}`);
  return id;
}

export function artifactDownloadRoot(directory, needs, context, job) {
  const parent = path.join(directory, uploadedArtifactId(needs, job));
  assert(existsSync(parent) && lstatSync(parent).isDirectory(), `Missing downloaded artifact ID directory: ${job}`);
  const name = artifactName(context, job);
  assert.deepEqual(readdirSync(parent).sort(), [name], `Downloaded artifact name differs for output ID: ${job}`);
  const root = path.join(parent, name);
  assert(lstatSync(root).isDirectory(), `Invalid downloaded artifact directory: ${job}`);
  return root;
}

export function validateDownloadSteps(steps, active) {
  assert.equal(steps.download_discovery?.outcome, 'success', 'Required gate download: discovery');
  for (const job of ['build', ...LANES]) {
    const expected = job === 'build' || active.includes(job) ? 'success' : 'skipped';
    assert.equal(steps[`download_${job}`]?.outcome, expected,
      `${expected === 'success' ? 'Required' : 'Unplanned'} gate download: ${job}`);
  }
}

export function validateArtifactDownloads({ directory, needs, context, active }) {
  validateNeeds(needs);
  const jobs = ['build', ...active];
  const ids = jobs.map(job => uploadedArtifactId(needs, job));
  assert.equal(new Set(ids).size, ids.length, 'Duplicate artifact IDs');
  assert(lstatSync(directory).isDirectory(), 'Invalid validation artifact directory');
  assert.deepEqual(readdirSync(directory).sort(), ids.sort(), 'Missing, unexpected or colliding validation artifacts');
  for (const job of jobs) artifactDownloadRoot(directory, needs, context, job);
}

// Retain the original pattern-based inventory as an independent observation.
// ID-only requests would otherwise hide unexpected ci-* artifacts in the run.
export function validateArtifactDiscovery({ directory, discoveryDirectory, needs, context, active }) {
  const jobs = ['build', ...active];
  assert(lstatSync(discoveryDirectory).isDirectory(), 'Invalid discovered validation artifact directory');
  assert.deepEqual(readdirSync(discoveryDirectory).sort(), jobs.map(job => artifactName(context, job)).sort(),
    'Missing, unexpected or colliding discovered validation artifacts');
  for (const job of jobs) {
    const root = path.join(discoveryDirectory, artifactName(context, job));
    assert(lstatSync(root).isDirectory(), `Invalid discovered artifact directory: ${job}`);
    readRecord(root, job, context);
    const byId = artifactDownloadRoot(directory, needs, context, job);
    assert.equal(hash(readFileSync(path.join(root, '.ci/job-record.json'))),
      hash(readFileSync(path.join(byId, '.ci/job-record.json'))),
      `Discovered artifact differs from output-ID download: ${job}`);
  }
}

function validateJob(payload, job, context, requiredSteps) {
  assert(payload, `Missing ${job} validation artifact`);
  assert.equal(payload.record.schemaVersion, 3, 'Unknown record schema');
  assert.equal(payload.record.job, job, 'Artifact job differs');
  assert.deepEqual(payload.record.context, context, 'Artifact SHA/ref/run provenance differs');
  assert.equal(payload.record.jobStatus, 'success', `Job failed or was cancelled: ${job}`);
  for (const name of requiredSteps) {
    assert.equal(payload.record.steps[name]?.outcome, 'success', `Required step incomplete: ${job}/${name}`);
  }
  assert.deepEqual(payload.result.context, context, 'Result SHA/ref/run provenance differs');
}

export async function validateMobileEvidence(payload, plan) {
  const { metadata, before, after, comparison } = payload.mobile;
  for (const key of ['baseSha', 'headSha', 'validationSha']) {
    assert.equal(metadata[key], plan[key], `Mobile comparison ${key} differs`);
  }
  assert.equal(metadata.mode, 'regression', 'Unexpected mobile comparison mode');
  assert.equal(metadata.implementations.main.sha, plan.baseSha, 'Mobile base implementation SHA differs');
  assert.equal(metadata.implementations.pr.sha, plan.validationSha, 'Mobile validation implementation SHA differs');
  const prefix = 'test-results/mobile-comparison/';
  const required = ['comparison-metadata.json', 'main.json', 'pr.json', 'comparison.html', 'comparison.json',
    ...['main', 'pr'].flatMap(target => MOBILE_CAPTURE_IDS.flatMap(id => [`${target}-${id}.png`, `${target}-${id}.json`]))];
  for (const file of required) assert(payload.record.files[prefix + file], `Missing mobile artifact: ${file}`);
  assert.deepEqual(Object.keys(payload.record.files).filter(file => file.startsWith(prefix) && file.endsWith('.png')).sort(),
    required.filter(file => file.endsWith('.png')).map(file => prefix + file).sort(), 'Unexpected mobile image set (requires exactly 68 images)');
  assert(!payload.record.files[prefix + 'comparison-incomplete.json'], 'Incomplete mobile comparison');
  const rows = await compareMobileCapturesWithSources(before, after, metadata);
  assert.deepEqual(comparison, { metadata, rows }, 'Mobile comparison report differs from captures');
  return rows.length;
}

// This validates the raw collection/execution reports again at the final gate.
// Counts in result.json are evidence to check, never the coverage oracle.
export async function validateAggregate({ plan, execution, inventory, context, needs, build, lanes }) {
  validateNeeds(needs);
  assert(Object.keys(lanes).every(lane => LANES.includes(lane)), 'Unknown E2E artifact lane');
  validateExecutionPlan(plan, execution, inventory, context);
  assert.equal(needs.build.result, 'success', 'Required job incomplete: build');
  const active = LANES.filter(lane => execution.lanes[lane]?.length > 0);
  const artifactIds = ['build', ...active.map(lane => `e2e_${lane}`)].map(job => {
    assert.equal(needs[job]?.result, 'success', `Required job incomplete: ${job}`);
    return uploadedArtifactId(needs, job === 'build' ? job : job.slice(4));
  });
  assert.equal(new Set(artifactIds).size, artifactIds.length, 'Duplicate artifact IDs');
  validateJob(build, 'build', context, [...BUILD_STEPS, ...(plan.deploy ? ['pages'] : [])]);
  assert.deepEqual(build.plan, plan, 'Build risk plan differs');
  assert.deepEqual(build.execution, execution, 'Build execution plan differs');
  assert(Object.keys(build.record.files).some(file => file.startsWith('dist/')), 'Missing built dist artifact');
  assert.equal(build.result.executed, false, 'Build job unexpectedly executed E2E');
  if (plan.deploy) {
    assert.equal(plan.eventName, 'push', 'Pages requires main push');
    assert.equal(plan.validationRef, 'refs/heads/main', 'Pages requires main ref');
    assert(needs.build.outputs.pages_artifact_id, 'Missing Pages artifact ID');
  } else {
    assert.equal(build.record.steps.pages?.outcome, 'skipped', 'Unexpected Pages artifact upload');
    assert(!needs.build.outputs.pages_artifact_id, 'Unexpected Pages artifact ID');
  }
  for (const lane of LANES.filter(lane => !active.includes(lane))) {
    assert.equal(needs[`e2e_${lane}`]?.result, 'skipped', `Unplanned E2E job: ${lane}`);
    assert(!needs[`e2e_${lane}`].outputs?.artifact_id && !lanes[lane], `Unplanned E2E artifact: ${lane}`);
  }
  if (!plan.runE2E) {
    assert.equal(build.result.status, 'not-run', 'Missing explicit E2E non-execution result');
    assert.equal(build.result.passedTests, 0, 'Unexecuted tests counted as passing');
    assert.equal(build.expected, undefined, 'Unexpected E2E collection on omitted run');
    return { passedTests: 0, laneResults: {}, mobilePairs: 0 };
  }
  assert.equal(build.result.status, 'prepared', 'Original E2E collection did not complete');
  const expected = validateCollection(plan, build.expected);
  assert.equal(build.result.collectedTests, expected.length, 'Original collection count differs');
  const collectedUnion = [], executedUnion = [], laneResults = {};
  let mobilePairs = 0;
  for (const lane of active) {
    const payload = lanes[lane];
    validateJob(payload, lane, context, E2E_STEPS);
    for (const [name, value] of [['plan', plan], ['execution', execution], ['expected', build.expected]]) {
      assert.deepEqual(payload[name], value, `Lane ${name} differs: ${lane}`);
    }
    const collected = validateLaneCollection(plan, execution, build.expected, payload.collection, lane);
    const result = payload.result;
    assert.equal(result.lane, lane, 'Result lane differs');
    assert.deepEqual(result.specs, execution.lanes[lane], 'Result specs differ');
    assert.equal(result.status, 'passed', `Selected E2E did not complete: ${lane}`);
    assert.equal(result.executed, true, 'No executed E2E tests');
    assert.equal(result.signal, null, 'E2E process was interrupted');
    const passed = validateExecution(collected, payload.report, result.exitCode);
    assert.equal(result.collectedTests, collected.length, 'Lane collection count differs');
    assert.equal(result.passedTests, passed, 'Lane execution count differs');
    assert.equal(result.buildRecordHash, build.recordHash, 'Lane used a different build artifact');
    for (const key of ['executionMs', 'collectionMs']) {
      assert(Number.isFinite(result[key]) && result[key] >= 0, `Missing lane timing: ${lane}/${key}`);
    }
    collectedUnion.push(...collected);
    executedUnion.push(...reportTests(payload.report));
    laneResults[lane] = { passedTests: passed, executionMs: result.executionMs, collectionMs: result.collectionMs };
    if (lane === 'mobile' && plan.eventName === 'pull_request') mobilePairs = await validateMobileEvidence(payload, plan);
  }
  for (const [name, tests] of [['collection', collectedUnion], ['execution', executedUnion]]) {
    assert.equal(new Set(tests.map(test => test.key)).size, tests.length, `Duplicate ${name} IDs across lanes`);
    assert.deepEqual(identities(tests), identities(expected), `${name} union differs from original expected IDs`);
  }
  return { passedTests: expected.length, laneResults, mobilePairs };
}

export async function verifyArtifacts({ cwd = process.cwd(), env = process.env,
  directory = path.join(cwd, '.ci-artifacts'), discoveryDirectory = path.join(cwd, '.ci-discovered') } = {}) {
  const needs = JSON.parse(env.CI_NEEDS);
  validateNeeds(needs);
  assert.equal(needs.build.result, 'success', 'Required job incomplete: build');
  // The final checkout/event, not a downloaded result, anchors all provenance.
  const buildRoot = artifactDownloadRoot(directory, needs, { runId: env.GITHUB_RUN_ID,
    runAttempt: env.GITHUB_RUN_ATTEMPT, validationSha: env.GITHUB_SHA }, 'build');
  const localPlan = JSON.parse(readFileSync(path.join(buildRoot, '.ci/plan.json'), 'utf8'));
  const context = revalidatePlan(localPlan, { cwd, env });
  const readPayload = job => {
    const root = artifactDownloadRoot(directory, needs, context, job);
    const read = name => JSON.parse(readFileSync(path.join(root, '.ci', name), 'utf8'));
    const record = readRecord(root, job, context);
    return { record, recordHash: hash(readFileSync(path.join(root, '.ci/job-record.json'))),
      plan: read('plan.json'), execution: read('execution-plan.json'), result: read('result.json'),
      expected: existsSync(path.join(root, '.ci/expected-collection.json')) ? read('expected-collection.json') : undefined,
      ...(job === 'build' ? {} : { collection: read('collection.json'), report: read('e2e-report.json') }), root };
  };
  const build = readPayload('build');
  const lanes = {};
  validateExecutionPlan(localPlan, build.execution, listBrowserSpecs(cwd), context);
  const active = LANES.filter(lane => build.execution.lanes[lane]?.length > 0);
  validateArtifactDownloads({ directory, needs, context, active });
  validateArtifactDiscovery({ directory, discoveryDirectory, needs, context, active });
  if (env.CI_STEPS) validateDownloadSteps(JSON.parse(env.CI_STEPS), active);
  for (const lane of active) {
    const payload = lanes[lane] = readPayload(lane);
    if (lane === 'mobile' && localPlan.eventName === 'pull_request') {
      const readMobile = file => JSON.parse(readFileSync(path.join(payload.root, 'test-results/mobile-comparison', file), 'utf8'));
      payload.mobile = { metadata: readMobile('comparison-metadata.json'), before: readMobile('main.json'),
        after: readMobile('pr.json'), comparison: readMobile('comparison.json') };
      for (const [target, entries] of [['main', payload.mobile.before], ['pr', payload.mobile.after]]) {
        for (const entry of entries) {
          assert(MOBILE_CAPTURE_IDS.includes(entry.id), 'Unknown mobile capture ID');
          assert.equal(entry.target, target, 'Mobile capture target differs');
          assert.equal(path.basename(entry.image), `${target}-${entry.id}.png`, 'Mobile capture image differs');
          assert.deepEqual(readMobile(`${target}-${entry.id}.json`), entry, 'Mobile capture record differs');
        }
      }
    }
  }
  const result = await validateAggregate({ plan: localPlan, execution: build.execution, context,
    inventory: listBrowserSpecs(cwd), needs, build, lanes });
  return { plan: localPlan, result };
}

export function resultSummary({ plan, result, env = process.env }) {
  const e2e = plan.runE2E ? `実行成功（${result.passedTests} tests、収集・実行IDの和集合と重複なしを照合済み）`
    : plan.eventName === 'pull_request' ? 'E2E未実行（L0設計）' : 'E2E未実行（main push設計）';
  return [`### CI validation result`, '', '- 検証: 成功', `- E2E: ${e2e}`,
    '- 未選択spec: 未実行', `- Validation SHA: ${quote(plan.validationSha)}`,
    ...Object.entries(result.laneResults).map(([lane, value]) =>
      `- ${lane}: ${value.passedTests} tests; E2E ${(value.executionMs / 1000).toFixed(1)}s; 収集 ${(value.collectionMs / 1000).toFixed(1)}s`),
    `- モバイルmain/PR比較: ${result.mobilePairs ? `${result.mobilePairs}組完了（comparison.html / JSON / 68画像を照合済み）` : '対象外（34組比較の成功は表示しません）'}`,
    '- 全CI壁時計時間・各job時間・セットアップ重複コスト・総Runner時間: Actionsの実測時刻を参照（docs/TESTING_WORKFLOW.md）。',
    ...(env.GITHUB_REPOSITORY && env.GITHUB_RUN_ID ? [
      `- Run / attempt: [${env.GITHUB_RUN_ID} / ${env.GITHUB_RUN_ATTEMPT}](https://github.com/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}/attempts/${env.GITHUB_RUN_ATTEMPT})`,
      `- Artifacts: ${['build', ...Object.keys(result.laneResults)].map(job => quote(artifactName({ runId: env.GITHUB_RUN_ID,
        runAttempt: env.GITHUB_RUN_ATTEMPT, validationSha: plan.validationSha }, job))).join(', ')}`] : []), ''].join('\n');
}

export async function writeSummary(mode, env = process.env) {
  const read = name => JSON.parse(readFileSync(path.join('.ci', name), 'utf8'));
  let summary;
  let failure;
  try {
    if (mode === 'record') {
      const record = recordJob(env.CI_RECORD_JOB, { env });
      summary = `### ${quote(record.job)} validation record\n\n最終判定は ci-required を確認してください。\n`;
    } else if (mode === 'plan') summary = planSummary(read('plan.json'));
    else {
      assert.equal(mode, 'result', 'Unknown summary mode');
      const steps = JSON.parse(env.CI_STEPS);
      for (const name of ['checkout', 'node', 'install', 'download_build', 'download_discovery']) {
        assert.equal(steps[name]?.outcome, 'success', `Required gate step incomplete: ${name}`);
      }
      assert.equal(env.CI_JOB_STATUS, 'success', 'Final job failed or was cancelled');
      summary = resultSummary(await verifyArtifacts({ env }));
    }
  } catch (error) {
    failure = error;
    summary = `### CI validation ${mode === 'plan' ? 'plan' : 'result'}\n\n- 検証: ${env.CI_JOB_STATUS === 'cancelled' ? '中断' : '失敗・未完了'}\n- E2E成功は確認できません。\n- Details: ${quote(error.message)}\n`;
  }
  console.log(summary);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  if (failure) throw failure;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { await writeSummary(process.argv[2]); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
