import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const LANES = Object.freeze(['regular', 'mobile']);
export const MOBILE_SPEC = 'tests/browser/mobile-performance.spec.js';
export const hash = value => createHash('sha256').update(value).digest('hex');
export const planHash = plan => hash(JSON.stringify(plan));

export function validationContext(plan, env = process.env) {
  for (const name of ['headSha', 'validationSha', ...(plan.eventName === 'pull_request' ? ['baseSha'] : [])]) {
    assert.match(plan[name] ?? '', /^[a-f0-9]{40}$/, `Missing valid ${name}`);
  }
  assert.match(env.GITHUB_RUN_ID ?? '', /^\d+$/, 'Missing run ID');
  assert.match(env.GITHUB_RUN_ATTEMPT ?? '', /^[1-9]\d*$/, 'Missing run attempt');
  return Object.fromEntries(['eventName', 'validationRef', 'baseSha', 'headSha', 'validationSha']
    .map(key => [key, plan[key]]).concat([['runId', env.GITHUB_RUN_ID], ['runAttempt', env.GITHUB_RUN_ATTEMPT]]));
}

export function artifactName(context, job) {
  assert(['build', ...LANES].includes(job), 'Unknown artifact job');
  return `ci-${context.runId}-${context.runAttempt}-${context.validationSha}-${job}`;
}

// Hash every uploaded payload file, including images/Trace and the exact dist.
// Separate artifact directories avoid download merges overwriting evidence.
export function fileManifest(cwd, job) {
  const files = {};
  function visit(relative) {
    const directory = path.join(cwd, relative);
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = `${relative}/${entry.name}`;
      assert(!entry.isSymbolicLink(), `Artifact contains a symlink: ${file}`);
      if (entry.isDirectory()) visit(file);
      else {
        assert(entry.isFile(), `Unexpected artifact entry: ${file}`);
        if (file !== '.ci/job-record.json') files[file] = hash(readFileSync(path.join(cwd, file)));
      }
    }
  }
  for (const root of ['.ci', job === 'build' ? 'dist' : 'test-results']) visit(root);
  return files;
}

export function recordJob(job, { cwd = process.cwd(), env = process.env } = {}) {
  assert(['build', ...LANES].includes(job), 'Unknown record job');
  const plan = JSON.parse(readFileSync(path.join(cwd, '.ci/plan.json'), 'utf8'));
  const record = { schemaVersion: 1, job, context: validationContext(plan, env),
    jobStatus: env.CI_JOB_STATUS, steps: JSON.parse(env.CI_STEPS),
    recordedAt: new Date().toISOString(), files: fileManifest(cwd, job) };
  writeFileSync(path.join(cwd, '.ci/job-record.json'), JSON.stringify(record, null, 2));
  return record;
}

export function readRecord(cwd, job, context) {
  const record = JSON.parse(readFileSync(path.join(cwd, '.ci/job-record.json'), 'utf8'));
  assert.equal(record.schemaVersion, 1, 'Unknown record schema');
  assert.equal(record.job, job, 'Artifact job differs');
  assert.deepEqual(record.context, context, 'Artifact SHA/ref/run provenance differs');
  assert.deepEqual(record.files, fileManifest(cwd, job), 'Artifact files missing, added or corrupted');
  return record;
}
