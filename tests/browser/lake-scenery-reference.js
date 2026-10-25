import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';

const exec = promisify(execFile);
export const capturePullRequestBase = Boolean(process.env.CI && process.env.GITHUB_EVENT_NAME === 'pull_request' && process.env.GITHUB_EVENT_PATH);

// GitHub's PR base SHA is archived, never checked out into the user's checkout.
// The baseline shares the locked dependencies and gets its own dist/server.
export async function prepareSceneryReference(testInfo, explicitSha) {
  const event = explicitSha ? null : JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const sha = explicitSha ?? event.pull_request?.base?.sha;
  if (!/^[0-9a-f]{40}$/.test(sha ?? '')) throw new Error('Missing valid PR base SHA for scenery comparison');
  const directory = await mkdtemp(join(tmpdir(), 'barb-scenery-reference-'));
  const source = join(directory, 'source'), archive = join(directory, 'reference.tar');
  let server, logs = '';
  const logPath = testInfo.outputPath('scenery-reference-build.log');
  const dispose = async (info = testInfo) => {
    if (server && server.exitCode === null && server.signalCode === null) { const exited = once(server, 'exit'); server.kill('SIGTERM'); await exited; }
    await writeFile(logPath, logs);
    await info.attach('scenery-reference-build', { path: logPath, contentType: 'text/plain' });
    await rm(directory, { recursive: true, force: true });
  };
  try {
    await mkdir(source);
    await exec('git', ['archive', '--format=tar', '--output', archive, sha]);
    await exec('tar', ['-xf', archive, '-C', source]);
    await symlink(resolve('node_modules'), join(source, 'node_modules'), 'dir');
    const build = await exec('npm', ['run', 'build'], { cwd: source });
    logs += `PR base ${sha}\n${build.stdout}\n${build.stderr}\n`;
    server = spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js'), 'preview', '--host', '127.0.0.1', '--port', '4174', '--strictPort'], { cwd: source, stdio: ['ignore', 'pipe', 'pipe'] });
    server.stdout.on('data', data => { logs += data.toString(); });
    server.stderr.on('data', data => { logs += data.toString(); });
    const baseURL = 'http://127.0.0.1:4174/barb/';
    const deadline = Date.now() + 15000;
    while (true) {
      if (server.exitCode !== null) throw new Error(`Reference preview exited: ${server.exitCode}`);
      try { if ((await fetch(baseURL)).ok) break; } catch { /* Server startup only; no browser action is retried. */ }
      if (Date.now() >= deadline) throw new Error('Reference preview did not become ready');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return { sha, baseURL, dispose };
  } catch (error) {
    logs += `\n${error.stdout ?? ''}\n${error.stderr ?? ''}\n${error.stack}\n`;
    await dispose();
    throw error;
  }
}
