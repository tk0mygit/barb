import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';

const exec = promisify(execFile), baseSha = '05dd8fcb45726cbbfe439d43c89f295f5affac93';
const headSha = (await exec('git', ['rev-parse', 'HEAD'])).stdout.trim();
const output = resolve(process.argv[2] ?? 'test-results/sky4-budget.json');
const git = async (...args) => (await exec('git', args)).stdout.trim();
assert.equal(await git('status', '--porcelain=v1', '--untracked-files=all', '--', 'src', 'package.json', 'package-lock.json', 'vite.config.js', 'index.html'), '', 'STOP: uncommitted build source');
const lockBlob = await git('rev-parse', `${headSha}:package-lock.json`);
assert.equal(await git('rev-parse', `${baseSha}:package-lock.json`), lockBlob, 'STOP: dependency locks differ');
assert.equal(await git('diff', '--name-only', baseSha, headSha, '--', 'public', 'src/assets'), '', 'STOP: delivery assets changed');
const directory = await mkdtemp(join(tmpdir(), 'barb-sky4-budget-')), logs = [];
const sha256 = data => createHash('sha256').update(data).digest('hex');
async function measure(sha, label) {
  const source = join(directory, label), archive = join(directory, `${label}.tar`);
  await mkdir(source); await exec('git', ['archive', '--format=tar', '--output', archive, sha]);
  await exec('tar', ['-xf', archive, '-C', source]);
  await symlink(resolve('node_modules'), join(source, 'node_modules'), 'dir');
  const build = await exec('npm', ['run', 'build'], { cwd: source }); logs.push({ sha, stdout: build.stdout, stderr: build.stderr });
  const files = [];
  async function visit(path, prefix = '') {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const name = prefix + entry.name, filename = join(path, entry.name);
      if (entry.isDirectory()) await visit(filename, name + '/');
      else {
        const data = await readFile(filename);
        files.push({ name, bytes: data.length, gzipBytes: gzipSync(data, { level: 9, mtime: 0 }).length, sha256: sha256(data) });
      }
    }
  }
  await visit(join(source, 'dist'));
  const code = files.filter(row => /\.(js|css|html)$/.test(row.name)), assets = files.filter(row => !code.includes(row));
  return { sha, files: files.sort((a,b) => a.name.localeCompare(b.name)),
    codeBytes: code.reduce((n,r) => n+r.bytes, 0), codeGzipBytes: code.reduce((n,r) => n+r.gzipBytes, 0),
    assets: assets.map(({ name, bytes, sha256 }) => ({ name, bytes, sha256 })).sort((a,b) => a.name.localeCompare(b.name)) };
}
try {
  const before = await measure(baseSha, 'before'), after = await measure(headSha, 'after');
  assert.deepEqual(after.assets, before.assets, 'STOP: additional/changed delivery assets');
  const increase = after.codeGzipBytes - before.codeGzipBytes;
  assert(increase <= 80 * 1024, 'STOP: Sky Update exceeds 80KiB gzip budget');
  const report = { status: 'pass', node: process.version, lockBlob, gzip: { level: 9, mtime: 0, perFile: true,
    scope: 'all built JS/CSS/HTML; includes Sky-1/2/3/4' }, before, after, increaseBytes: increase,
    budgetBytes: 80 * 1024, addedDeliveryAssets: 0, addedTextures: 0,
    conditions: 'separate git archives, identical node_modules from the same locked npm ci, same Vite and gzip invocation; no worktree' };
  await mkdir(resolve(output, '..'), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2)); await writeFile(output.replace(/\.json$/, '-build-logs.json'), JSON.stringify(logs, null, 2));
  console.log(JSON.stringify({ status: report.status, baseSha, headSha, before: before.codeGzipBytes, after: after.codeGzipBytes, increase, budget: report.budgetBytes, output }));
} finally { await rm(directory, { recursive: true, force: true }); }
