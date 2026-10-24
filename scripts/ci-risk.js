import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SMOKE_SPECS = Object.freeze([
  'tests/browser/smoke-pc.spec.js',
  'tests/browser/smoke-touch.spec.js',
]);

// An allowlist, not a docs/** exemption: new operational/development documents
// must be reviewed before they can reduce verification.
export const L0_DOCUMENTS = Object.freeze([
  'README.md',
  ...['SAVE_DATA', 'FISH_SPECIES', 'FISH_SALES', 'FISHING_SPOTS', 'FISHING_BALANCE',
    'EQUIPMENT_UPGRADES', 'DEPTH_AND_TIME', 'DAY_NIGHT_LIGHTING', 'CATCH_COLLECTION',
    'AUDIO_SYSTEM', 'ACHIEVEMENTS'].map(name => `docs/${name}.md`),
]);

const browser = name => `tests/browser/${name}.spec.js`;
export const L1_GROUPS = Object.freeze({
  'ambient-output': {
    sources: ['src/audio/generated-sources.js', 'src/audio/ambient-player.js'],
    specs: [browser('audio'), browser('audio-gain')],
  },
  'sound-settings': {
    sources: ['src/ui/sound-settings.js'],
    specs: [browser('audio'), browser('collection-menu')],
  },
  'achievements-view': {
    sources: ['src/ui/achievements-view.js'],
    specs: [browser('achievements'), browser('achievement-notice'), browser('collection-menu')],
  },
  'equipment-view': {
    sources: ['src/ui/equipment-view.js'],
    specs: [browser('equipment-ui'), browser('equipment-game'), browser('collection-menu')],
  },
});

// Shared menu coverage does not make changes to the menu itself low risk.
const specGroups = new Map([
  [browser('audio'), 'ambient-output'], [browser('audio-gain'), 'ambient-output'],
  [browser('achievements'), 'achievements-view'], [browser('achievement-notice'), 'achievements-view'],
  [browser('equipment-ui'), 'equipment-view'], [browser('equipment-game'), 'equipment-view'],
]);
const sourceGroups = new Map(Object.entries(L1_GROUPS).flatMap(([group, { sources }]) => sources.map(path => [path, group])));
const shaPattern = /^[a-f0-9]{40}$/;
const unique = values => [...new Set(values)];
const validPath = path => typeof path === 'string' && path.length > 0 && !path.includes('\0')
  && !path.startsWith('/') && !path.split('/').some(part => part === '..' || part === '.' || part === '');

export function listBrowserSpecs(cwd = process.cwd()) {
  return readdirSync(resolve(cwd, 'tests/browser'), { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.spec.js'))
    .map(entry => `tests/browser/${entry.name}`).sort();
}

export function parseNameStatus(raw) {
  const value = typeof raw === 'string' ? raw : new TextDecoder('utf-8', { fatal: true }).decode(raw);
  if (!value || !value.endsWith('\0')) throw new Error('Empty or incomplete NUL-delimited diff');
  const fields = value.slice(0, -1).split('\0'), changes = [];
  for (let index = 0; index < fields.length;) {
    const status = fields[index++];
    if (!/^(?:[AMDT]|[RC](?:100|[1-9]?\d))$/.test(status)) throw new Error('Unknown diff status');
    const paths = fields.slice(index, index + (/^[RC]/.test(status) ? 2 : 1));
    index += paths.length;
    if (paths.length !== (/^[RC]/.test(status) ? 2 : 1) || !paths.every(validPath)) throw new Error('Incomplete or invalid changed paths');
    changes.push({ status, paths });
  }
  if (!changes.length) throw new Error('Empty PR diff');
  return changes;
}

function validChanges(changes) {
  return Array.isArray(changes) && changes.length > 0 && changes.every(change => change
    && /^(?:[AMDT]|[RC](?:100|[1-9]?\d))$/.test(change.status)
    && Array.isArray(change.paths) && change.paths.length === (/^[RC]/.test(change.status) ? 2 : 1)
    && change.paths.every(validPath));
}

export function classifyChanges(changes, { availableSpecs = [], groups = L1_GROUPS } = {}) {
  const inventoryValid = Array.isArray(availableSpecs) && availableSpecs.every(path =>
    typeof path === 'string' && /^tests\/browser\/[^/]+\.spec\.js$/.test(path));
  const specs = inventoryValid ? unique(availableSpecs).sort() : [];
  const full = reasons => ({ level: 'L2', reasons, changes: Array.isArray(changes) ? changes : [],
    specs, smokeSpecs: SMOKE_SPECS.filter(path => specs.includes(path)), runE2E: true, deploy: false });
  if (!inventoryValid) return full(['E2E inventoryが不正のため全件検証']);
  if (!validChanges(changes)) return full(['変更ファイル取得が不明・失敗・空・不正のため全件検証']);
  const selectedGroups = new Set(), changedSpecGroups = new Set(), reasons = [];
  for (const { status, paths } of changes) {
    for (const path of paths) {
      if (status === 'T') return full([`ファイル種別変更: ${path}`]);
      if (L0_DOCUMENTS.includes(path)) continue;
      const isSpec = path.endsWith('.spec.js');
      if (isSpec && (status !== 'M')) return full([`specの追加・削除・リネーム: ${path}`]);
      const group = isSpec ? specGroups.get(path) : sourceGroups.get(path);
      if (!group) return full([`高リスク・共有基盤・未知の変更: ${path}`]);
      selectedGroups.add(group);
      if (isSpec) changedSpecGroups.add(group);
    }
  }
  if (changedSpecGroups.size > 1) return full(['複数領域のspec変更のため全件検証']);
  if (!selectedGroups.size) return { level: 'L0', reasons: ['既知の説明用文書のみの変更'], changes,
    specs: [], smokeSpecs: [], runE2E: false, deploy: false };
  const related = unique([...selectedGroups].flatMap(group => groups[group]?.specs ?? []));
  if (!related.length || [...selectedGroups].some(group => !groups[group]?.specs?.length)) {
    return full(['関連specの対応表が空・不整合のため全件検証']);
  }
  const selected = unique([...SMOKE_SPECS, ...related]).sort();
  const missing = selected.filter(path => !specs.includes(path));
  if (missing.length) return full([`関連specまたは共通スモークが欠落: ${missing.join(', ')}`]);
  // A changed spec must never disappear from its own plan.
  const changedSpecs = changes.flatMap(({ paths }) => paths).filter(path => path.endsWith('.spec.js'));
  if (changedSpecs.some(path => !selected.includes(path))) return full(['変更specが選択対象から漏れているため全件検証']);
  reasons.push(...[...selectedGroups].sort().map(group => `局所変更: ${group}`));
  return { level: 'L1', reasons, changes, specs: selected, smokeSpecs: [...SMOKE_SPECS], runE2E: true, deploy: false };
}

export function eventPlan(eventName, { ref, changes, availableSpecs = [], groups } = {}) {
  if (eventName === 'pull_request') return classifyChanges(changes, { availableSpecs, groups });
  if (eventName === 'push' && ref === 'refs/heads/main') return {
    level: 'L0', reasons: ['main push: マージ後の軽量ビルド・デプロイ（P3-A維持）'], changes: [],
    specs: [], smokeSpecs: [], runE2E: false, deploy: true,
  };
  return { level: 'L2', reasons: [`${eventName || 'unknown'}イベント: 変更範囲によらず全件検証`], changes: [],
    specs: unique(availableSpecs).sort(), smokeSpecs: SMOKE_SPECS.filter(path => availableSpecs.includes(path)),
    runE2E: true, deploy: false };
}

function git(cwd, args, { binary = false } = {}) {
  const result = spawnSync('git', args, { cwd, encoding: binary ? undefined : 'utf8',
    maxBuffer: 64 * 1024 * 1024, timeout: 60000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
  if (result.error || result.status !== 0) throw new Error(`git ${args[0]} failed: ${result.error?.message ?? String(result.stderr).trim()}`);
  return binary ? result.stdout : result.stdout.trim();
}

export function readChangedFiles({ cwd = process.cwd(), baseSha, headSha, validationSha, fetch = true } = {}) {
  try {
    if (![baseSha, headSha, validationSha].every(sha => typeof sha === 'string' && shaPattern.test(sha))) throw new Error('Missing or invalid base/head/validation SHA');
    const actualValidationSha = git(cwd, ['rev-parse', 'HEAD']);
    if (actualValidationSha !== validationSha) throw new Error('Checkout SHA differs from validation SHA');
    if (git(cwd, ['rev-parse', '--is-shallow-repository']) === 'true') {
      if (!fetch) throw new Error('Incomplete shallow history');
      git(cwd, ['fetch', '--no-tags', '--unshallow', 'origin']);
    }
    if (git(cwd, ['rev-parse', '--is-shallow-repository']) !== 'false') throw new Error('History completeness is unknown');
    for (const sha of [baseSha, headSha]) {
      try { git(cwd, ['cat-file', '-e', `${sha}^{commit}`]); }
      catch (error) {
        if (!fetch) throw error;
        git(cwd, ['fetch', '--no-tags', 'origin', sha]);
        git(cwd, ['cat-file', '-e', `${sha}^{commit}`]);
      }
    }
    const parents = git(cwd, ['show', '-s', '--format=%P', actualValidationSha]).split(' ');
    if (parents.length !== 2 || parents[0] !== baseSha || parents[1] !== headSha) {
      throw new Error('PR checkout is not the merge of the recorded base and HEAD');
    }
    const mergeBases = git(cwd, ['merge-base', '--all', baseSha, headSha]).split('\n');
    if (mergeBases.length !== 1 || !shaPattern.test(mergeBases[0])) throw new Error('Missing or ambiguous PR merge base');
    const mergeBaseSha = mergeBases[0];
    const changes = parseNameStatus(git(cwd, ['diff', '--no-ext-diff', '--no-textconv', '--name-status', '-z', '--find-renames', mergeBaseSha, headSha, '--'], { binary: true }));
    return { ok: true, changes, mergeBaseSha, actualValidationSha };
  } catch (error) {
    // Never return the prefix of an incomplete diff as a low-risk plan.
    return { ok: false, changes: [], error: error.message };
  }
}

export function createPlan({ eventName = process.env.GITHUB_EVENT_NAME, event = {},
  ref = process.env.GITHUB_REF, validationSha = process.env.GITHUB_SHA, cwd = process.cwd(), fetch = true } = {}) {
  let availableSpecs = [], inventoryError;
  try { availableSpecs = listBrowserSpecs(cwd); } catch (error) { inventoryError = error.message; }
  const pr = event.pull_request;
  const headSha = pr?.head?.sha ?? validationSha;
  const baseSha = pr?.base?.sha ?? null;
  const diff = eventName === 'pull_request'
    ? readChangedFiles({ cwd, baseSha, headSha, validationSha, fetch })
    : { ok: true, changes: [], mergeBaseSha: null };
  let plan;
  try { plan = eventPlan(eventName, { ref, changes: diff.ok ? diff.changes : null, availableSpecs }); }
  catch (error) {
    plan = eventPlan('classification-error', { ref, availableSpecs });
    plan.reasons.push(`分類エラー: ${error.message}`);
  }
  if (inventoryError || !availableSpecs.length) {
    plan.level = 'L2'; plan.runE2E = true; plan.deploy = false;
    plan.reasons = [`E2E inventory unavailable: ${inventoryError ?? 'no specs'}`];
    plan.specs = availableSpecs; plan.smokeSpecs = [];
  }
  if (!diff.ok) plan.reasons.push(`差分取得エラー: ${diff.error}`);
  return { schemaVersion: 1, eventName, prNumber: event.number ?? pr?.number ?? null,
    headSha, baseSha, validationRef: ref, validationSha, ...plan, diff };
}

function main() {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--output')) throw new Error('Usage: node scripts/ci-risk.js [--output path]');
  let event = {}, eventError;
  try { event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')); }
  catch (error) { eventError = error.message; }
  const plan = createPlan({ event });
  // The event payload is required to identify PR commits. All non-push unknown
  // events already require the full suite; do not weaken dispatch or schedule.
  if (eventError && plan.eventName === 'pull_request') plan.reasons.push(`イベント取得エラー: ${eventError}`);
  const output = resolve(args[1] ?? '.ci/plan.json');
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(plan, null, 2)}\n`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT,
    `level=${plan.level}\nrun_e2e=${plan.runE2E}\ndeploy=${plan.deploy}\n`);
  console.log(JSON.stringify(plan, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
