import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SMOKE_SPECS, L0_DOCUMENTS, L1_GROUPS, classifyChanges, eventPlan, parseNameStatus, readChangedFiles, createPlan } from '../scripts/ci-risk.js';
import { FISH_SPECIES } from '../src/game/fish-species.js';

const availableSpecs = [...new Set([...SMOKE_SPECS, ...Object.values(L1_GROUPS).flatMap(group => group.specs),
  'tests/browser/game.spec.js', 'tests/browser/save-data.spec.js'])].sort();
const change = (path, status = 'M') => ({ status, paths: [path] });
const classify = (changes, options = {}) => classifyChanges(changes, { availableSpecs, ...options });
const audio = 'src/audio/ambient-player.js';
const achievementView = 'src/ui/achievements-view.js';
const fishPng = 'src/assets/fish/black-bass.png';
const fishPngSources = L1_GROUPS['fish-png'].sources;
// Keep the required selection independent of the classifier's mapping.
const fishPngSpecs = ['collection-menu', 'fish-assets', 'fish-sales', 'fishing', 'smoke-pc', 'smoke-touch']
  .map(name => `tests/browser/${name}.spec.js`).sort();
const spotsHUD = 'src/ui/fishing-spots-hud.js';
const spotsHUDSpecs = ['cast-visibility', 'fishing-spots', 'mobile-layout', 'smoke-pc', 'smoke-touch']
  .map(name => `tests/browser/${name}.spec.js`).sort();

test('README and explicitly reviewed explanatory docs are L0 without E2E', () => {
  for (const changes of [[change('README.md')], [change('docs/AUDIO_SYSTEM.md')],
    [change('docs/FISHING_BALANCE.md'), change('README.md')]]) {
    const plan = classify(changes);
    assert.equal(plan.level, 'L0'); assert.equal(plan.runE2E, false);
    assert.deepEqual(plan.specs, []); assert.deepEqual(plan.smokeSpecs, []);
  }
});

test('README with local audio changes selects both related specs and PC/touch smoke', () => {
  for (const source of L1_GROUPS['ambient-output'].sources) {
    const plan = classify([change('README.md'), change(source)]);
    assert.equal(plan.level, 'L1'); assert.equal(plan.runE2E, true);
    assert.deepEqual(plan.specs, [...SMOKE_SPECS, ...L1_GROUPS['ambient-output'].specs].sort());
    assert.deepEqual(plan.smokeSpecs, SMOKE_SPECS);
  }
});

test('each limited UI source selects its integration specs and common smoke', () => {
  for (const name of ['sound-settings', 'achievements-view', 'equipment-view']) {
    const group = L1_GROUPS[name], plan = classify(group.sources.map(path => change(path)));
    assert.equal(plan.level, 'L1');
    assert.deepEqual(plan.specs, [...new Set([...SMOKE_SPECS, ...group.specs])].sort());
  }
});

test('multiple local source features select a deduplicated union', () => {
  const plan = classify([change(audio), change(achievementView), change('src/ui/equipment-view.js')]);
  assert.equal(plan.level, 'L1');
  assert.deepEqual(plan.specs, [...new Set([...SMOKE_SPECS, ...L1_GROUPS['ambient-output'].specs,
    ...L1_GROUPS['achievements-view'].specs, ...L1_GROUPS['equipment-view'].specs])].sort());
});

test('only the existing fishing spots HUD modification selects the five required specs', () => {
  assert.deepEqual(L1_GROUPS['fishing-spots-hud'].sources, [spotsHUD]);
  for (const documents of [[], ...L0_DOCUMENTS.map(path => [change(path)])]) {
    const plan = classify([change(spotsHUD), ...documents]);
    assert.equal(plan.level, 'L1'); assert.equal(plan.runE2E, true); assert.equal(plan.deploy, false);
    assert.deepEqual(plan.specs, spotsHUDSpecs); assert.deepEqual(plan.smokeSpecs, SMOKE_SPECS);
  }
});

test('fishing spots HUD additions, deletions, type changes, renames and copies require L2', () => {
  const changes = ['A', 'D', 'T'].map(status => change(spotsHUD, status));
  for (const status of ['R0', 'R75', 'R100', 'C0', 'C90', 'C100']) {
    for (const other of ['src/ui/fishing-spots-hud-new.js', audio, 'README.md']) {
      changes.push({ status, paths: [spotsHUD, other] }, { status, paths: [other, spotsHUD] });
    }
  }
  for (const item of changes) {
    const plan = classify([change('README.md'), item]);
    assert.equal(plan.level, 'L2', JSON.stringify(item)); assert.deepEqual(plan.specs, availableSpecs);
  }
});

test('fishing spots HUD cannot mix with any other L1 implementation or individual spec', () => {
  for (const [name, group] of Object.entries(L1_GROUPS)) {
    if (name === 'fishing-spots-hud') continue;
    for (const path of [...group.sources, ...group.specs]) {
      for (const changes of [[change(spotsHUD), change(path)], [change(path), change(spotsHUD)]]) {
        const plan = classify(changes);
        assert.equal(plan.level, 'L2', path); assert.deepEqual(plan.specs, availableSpecs);
      }
    }
  }
});

test('fishing spots HUD with state, input, camera, shared UI or unknown files requires L2', () => {
  for (const path of ['src/main.js', 'src/game/fishing-spots.js', 'src/world/fishing-spots.js',
    'src/game/fishing.js', 'src/input/fishing.js', 'src/input/controls.js',
    'src/rendering/camera.js', 'src/rendering/cast-visibility.js', 'src/rendering/fishing-spots.js',
    'src/ui/cast-notices.js', 'src/ui/hud.js', 'src/ui/fishing-hud.js', 'src/ui/collection-menu.js',
    'src/ui/sales-hud.js', 'src/ui/achievement-notice.js', 'src/ui/style.css', 'index.html',
    'src/ui/fishing-spots-hud-new.js', 'src/ui/nested/fishing-spots-hud.js', 'unknown.txt']) {
    for (const changes of [[change(spotsHUD), change(path)], [change(path), change(spotsHUD)]]) {
      const plan = classify(changes);
      assert.equal(plan.level, 'L2', path); assert.deepEqual(plan.specs, availableSpecs);
    }
  }
});

test('fishing spots HUD coverage specs remain L2 when changed alone or with the HUD', () => {
  for (const spec of spotsHUDSpecs) {
    for (const scope of [[change(spec)], [change(spotsHUD), change(spec)]]) {
      const plan = classify(scope);
      assert.equal(plan.level, 'L2', spec); assert.deepEqual(plan.specs, availableSpecs);
    }
  }
});

test('fishing spots HUD fails closed if any required spec, smoke or mapping is absent', () => {
  for (const missing of spotsHUDSpecs) {
    const plan = classify([change(spotsHUD)], { availableSpecs: availableSpecs.filter(path => path !== missing) });
    assert.equal(plan.level, 'L2', missing); assert.match(plan.reasons.join(' '), /欠落/);
  }
  for (const group of [undefined, { specs: [] }]) {
    const plan = classify([change(spotsHUD)], { groups: { ...L1_GROUPS, 'fishing-spots-hud': group } });
    assert.equal(plan.level, 'L2'); assert.match(plan.reasons.join(' '), /空・不整合/);
  }
});

test('fishing spots HUD requires its exact path and a complete NUL-delimited diff', () => {
  const prefix = `M\0${spotsHUD}\0`;
  assert.deepEqual(parseNameStatus(prefix), [change(spotsHUD)]);
  for (const path of ['src/ui/fishing spots-hud.js', 'src/ui/fishing-spots-hud.js.bak',
    'src/ui/Fishing-spots-hud.js', 'src/ui/fishing-spots\thud.js', 'src/ui/fishing-spots\nhud.js']) {
    const plan = classify(parseNameStatus(`${prefix}M\0${path}\0`));
    assert.equal(plan.level, 'L2', path);
  }
  for (const raw of [`${prefix}M`, `${prefix}R100\0${spotsHUD}\0`,
    Buffer.concat([Buffer.from(prefix), Buffer.from([0x4d, 0, 0xff, 0])])]) {
    assert.throws(() => parseNameStatus(raw));
  }
});

test('the P4-A2 classifier PR itself requires the full L2 inventory', () => {
  const changes = ['scripts/ci-risk.js', 'tests/ci-risk.test.js', 'docs/TESTING_WORKFLOW.md'].map(path => change(path));
  for (const scope of [changes, [...changes, change(spotsHUD)]]) {
    const plan = classify(scope);
    assert.equal(plan.level, 'L2'); assert.equal(plan.runE2E, true); assert.equal(plan.deploy, false);
    assert.deepEqual(plan.specs, availableSpecs);
  }
});

test('fish PNG allowlist matches exactly the twelve registered production files', () => {
  const production = readdirSync(new URL('../src/assets/fish/', import.meta.url), { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.png')).map(entry => `src/assets/fish/${entry.name}`).sort();
  assert.equal(fishPngSources.length, 12);
  assert.deepEqual([...fishPngSources].sort(), production);
  assert.deepEqual([...fishPngSources].sort(), FISH_SPECIES.map(fish => `src/assets/fish/${fish.id}.png`).sort());
});

test('each existing PNG and multiple existing PNG modifications select all six required specs', () => {
  for (const sources of [...fishPngSources.map(path => [path]), fishPngSources.slice(0, 2), fishPngSources]) {
    const plan = classify(sources.map(path => change(path)));
    assert.equal(plan.level, 'L1'); assert.equal(plan.runE2E, true); assert.equal(plan.deploy, false);
    assert.deepEqual(plan.specs, fishPngSpecs); assert.deepEqual(plan.smokeSpecs, SMOKE_SPECS);
  }
});

test('existing L0 documents can accompany modified fish PNGs', () => {
  for (const document of L0_DOCUMENTS) {
    const plan = classify([change(document), change(fishPng)]);
    assert.equal(plan.level, 'L1', document); assert.deepEqual(plan.specs, fishPngSpecs);
  }
});

test('fish PNG additions, deletions, type changes, renames and copies always require L2', () => {
  for (const path of fishPngSources) {
    const changes = ['A', 'D', 'T'].map(status => change(path, status));
    for (const status of ['R0', 'R75', 'R100', 'C0', 'C90', 'C100']) {
      for (const other of [fishPngSources.find(candidate => candidate !== path), 'src/assets/fish/new-fish.png', 'README.md']) {
        changes.push({ status, paths: [path, other] }, { status, paths: [other, path] });
      }
    }
    for (const item of changes) {
      const plan = classify([item]);
      assert.equal(plan.level, 'L2', JSON.stringify(item)); assert.deepEqual(plan.specs, availableSpecs);
    }
  }
});

test('PNG with references, product JS, UI, CSS, test infrastructure or unknown files requires L2', () => {
  for (const path of ['src/game/fish-species.js', 'src/game/fish-species-registry.js', 'src/game/fishing.js',
    'src/main.js', 'src/ui/fishing-hud.js', 'src/ui/collection-menu.js', 'src/ui/style.css',
    'tests/browser/ui-fixture.js', 'tests/browser/diagnostics-fixture.js', 'playwright.config.js',
    'src/assets/fish/new-fish.png', 'src/assets/fish/unknown.svg', 'src/assets/fish/black-bass.svg',
    'src/assets/fish/black-bass.jpg', 'src/assets/fish/black-bass.PNG', 'src/assets/fish/black-bass.png.bak',
    'src/assets/fish/nested/black-bass.png', 'unknown.txt']) {
    assert.equal(classify([change(fishPng), change(path)]).level, 'L2', path);
    assert.equal(classify([change(path), change(fishPng)]).level, 'L2', path);
  }
});

test('PNG cannot mix with any of the four existing L1 implementation groups or their individual specs', () => {
  for (const name of ['ambient-output', 'sound-settings', 'achievements-view', 'equipment-view']) {
    for (const path of [...L1_GROUPS[name].sources, ...L1_GROUPS[name].specs]) {
      assert.equal(classify([change(fishPng), change(path)]).level, 'L2', path);
      assert.equal(classify([change(path), change(fishPng)]).level, 'L2', path);
    }
  }
  for (const spec of fishPngSpecs) assert.equal(classify([change(fishPng), change(spec)]).level, 'L2', spec);
});

test('fish PNG selection fails closed if any required spec, smoke or mapping is absent', () => {
  for (const missing of fishPngSpecs) {
    const plan = classify([change(fishPng)], { availableSpecs: availableSpecs.filter(path => path !== missing) });
    assert.equal(plan.level, 'L2', missing); assert.match(plan.reasons.join(' '), /欠落/);
  }
  for (const group of [undefined, { specs: [] }]) {
    const plan = classify([change(fishPng)], { groups: { ...L1_GROUPS, 'fish-png': group } });
    assert.equal(plan.level, 'L2'); assert.match(plan.reasons.join(' '), /空・不整合/);
  }
});

test('PNG paths retain exact NUL parsing and incomplete or special-path diffs never reduce verification', () => {
  const prefix = `M\0${fishPng}\0`;
  assert.deepEqual(parseNameStatus(prefix), [change(fishPng)]);
  for (const path of ['src/assets/fish/black bass.png', 'src/assets/fish/black\tbass.png',
    'src/assets/fish/black\nbass.png', 'src/assets/fish/"black-bass"-$(x).png', 'src/assets/fish/black\\bass.png']) {
    const parsed = parseNameStatus(`${prefix}M\0${path}\0`);
    assert.deepEqual(parsed, [change(fishPng), change(path)]);
    assert.equal(classify(parsed).level, 'L2', path);
  }
  for (const raw of [`${prefix}M`, `${prefix}R100\0${fishPng}\0`, `${prefix}M\0../${fishPng}\0`,
    Buffer.concat([Buffer.from(prefix), Buffer.from([0x4d, 0, 0xff, 0])])]) {
    assert.throws(() => parseNameStatus(raw));
  }
});

test('the P4-A1 classifier PR itself requires the full L2 inventory', () => {
  const changes = ['scripts/ci-risk.js', 'tests/ci-risk.test.js', 'docs/TESTING_WORKFLOW.md'].map(path => change(path));
  for (const scope of [changes, [...changes, change(fishPng)]]) {
    const plan = classify(scope);
    assert.equal(plan.level, 'L2'); assert.equal(plan.runE2E, true); assert.equal(plan.deploy, false);
    assert.deepEqual(plan.specs, availableSpecs);
  }
});

test('main, shared systems, CI, dependencies and operations documents override lower risks', () => {
  for (const path of ['src/main.js', 'src/input/controls.js', 'src/audio/audio-session.js', 'src/audio/audio-mix.js',
    'src/audio/ambient-audio.js', 'src/ui/sales-hud.js', 'src/ui/achievement-notice.js', 'src/ui/style.css',
    'src/game/game-clock.js', 'src/game/save-data.js', 'src/rendering/camera.js', 'src/world/water.js',
    'tests/browser/diagnostics-fixture.js', 'tests/browser/clock-fixture.js', 'tests/browser/input-fixture.js',
    'playwright.config.js', '.github/workflows/pages.yml', 'scripts/ci-risk.js', 'tests/ci-risk.test.js',
    'package.json', 'package-lock.json', 'vite.config.js', 'AGENTS.md', 'docs/TESTING_WORKFLOW.md',
    'docs/new-operations.md', 'unknown.txt']) {
    const plan = classify([change('README.md'), change(audio), change(path)]);
    assert.equal(plan.level, 'L2', path); assert.equal(plan.runE2E, true, path);
    assert.deepEqual(plan.specs, availableSpecs, path);
  }
});

test('missing, failed, empty and malformed diff inputs cannot yield L0/L1', () => {
  for (const changes of [undefined, null, [], {}, { ok: false }, [change('')], [change('../README.md')],
    [{ status: 'M', paths: ['README.md', audio] }], [{ status: 'R100', paths: ['README.md'] }],
    [{ status: 'Z', paths: ['README.md'] }], [change('/README.md')], [change('docs//AUDIO_SYSTEM.md')]]) {
    assert.equal(classify(changes).level, 'L2');
  }
});

test('missing related spec or either smoke falls back to L2', () => {
  for (const missing of [...SMOKE_SPECS, ...L1_GROUPS['ambient-output'].specs]) {
    const plan = classify([change(audio)], { availableSpecs: availableSpecs.filter(path => path !== missing) });
    assert.equal(plan.level, 'L2', missing);
    assert.match(plan.reasons.join(' '), /欠落/);
  }
});

test('malformed inventory cannot produce reduced verification', () => {
  for (const inventory of [null, {}, ['README.md'], [undefined]]) {
    assert.equal(classify([change(audio)], { availableSpecs: inventory }).level, 'L2');
  }
});

test('empty related-spec mapping is full verification rather than empty L1 success', () => {
  const plan = classify([change(audio)], { groups: { ...L1_GROUPS, 'ambient-output': { specs: [] } } });
  assert.equal(plan.level, 'L2'); assert.match(plan.reasons.join(' '), /空・不整合/);
});

test('a corrupted mapping cannot omit the changed spec', () => {
  const plan = classify([change('tests/browser/audio.spec.js')], {
    groups: { ...L1_GROUPS, 'ambient-output': { specs: ['tests/browser/audio-gain.spec.js'] } },
  });
  assert.equal(plan.level, 'L2'); assert.match(plan.reasons.join(' '), /漏れ/);
});

test('deletions and both rename paths retain the highest risk', () => {
  assert.equal(classify([change(audio, 'D')]).level, 'L1');
  assert.equal(classify([change('src/main.js', 'D')]).level, 'L2');
  assert.equal(classify([{ status: 'R100', paths: ['README.md', 'docs/AUDIO_SYSTEM.md'] }]).level, 'L0');
  assert.equal(classify([{ status: 'R75', paths: [audio, 'docs/AUDIO_SYSTEM.md'] }]).level, 'L1');
  assert.equal(classify([{ status: 'R99', paths: ['src/main.js', 'README.md'] }]).level, 'L2');
  assert.equal(classify([{ status: 'R100', paths: ['README.md', 'unknown.md'] }]).level, 'L2');
  assert.equal(classify([{ status: 'C90', paths: ['src/main.js', 'README.md'] }]).level, 'L2');
  assert.equal(classify([change('README.md', 'T')]).level, 'L2');
});

test('known modified individual specs run themselves plus smoke and related coverage', () => {
  for (const path of ['audio', 'audio-gain', 'achievements', 'achievement-notice', 'equipment-ui', 'equipment-game']) {
    const spec = `tests/browser/${path}.spec.js`, plan = classify([change(spec)]);
    assert.equal(plan.level, 'L1', spec); assert.ok(plan.specs.includes(spec), spec);
    for (const smoke of SMOKE_SPECS) assert.ok(plan.specs.includes(smoke), spec);
  }
  assert.equal(classify([change('tests/browser/audio.spec.js'), change('tests/browser/audio-gain.spec.js')]).level, 'L1');
});

test('new/deleted/renamed/foundation/unknown and multiple-area specs require L2', () => {
  for (const item of [change('tests/browser/unknown.spec.js', 'A'), change('tests/browser/unknown.spec.js'),
    change('tests/browser/audio.spec.js', 'A'), change('tests/browser/audio.spec.js', 'D'),
    { status: 'R100', paths: ['tests/browser/audio.spec.js', 'tests/browser/audio-new.spec.js'] },
    change('tests/browser/collection-menu.spec.js'), ...SMOKE_SPECS.map(path => change(path))]) {
    assert.equal(classify([item]).level, 'L2');
  }
  assert.equal(classify([change('tests/browser/audio.spec.js'), change('tests/browser/equipment-ui.spec.js')]).level, 'L2');
});

test('NUL parsing preserves spaces, tabs, newlines, quotes and both rename paths', () => {
  const paths = ['docs/spaces here.md', 'docs/tab\tname.md', 'docs/line\nbreak.md', 'docs/"quote"-$(x).md'];
  assert.deepEqual(parseNameStatus(`M\0${paths[0]}\0D\0${paths[1]}\0R100\0${paths[2]}\0${paths[3]}\0`), [
    change(paths[0]), change(paths[1], 'D'), { status: 'R100', paths: paths.slice(2) },
  ]);
  for (const path of paths) assert.equal(classify([change(path)]).level, 'L2');
});

test('NUL parser rejects incomplete, empty, unknown-status and non-UTF8 diff data', () => {
  for (const raw of ['', '\0', 'M\0README.md', 'M\0', 'R100\0README.md\0', 'R101\0a\0b\0',
    'M\0../README.md\0', 'U\0README.md\0', Buffer.from([0x4d, 0, 0xff, 0])]) {
    assert.throws(() => parseNameStatus(raw));
  }
});

test('dispatch, schedule and unknown events always run all specs without Pages', () => {
  for (const eventName of ['workflow_dispatch', 'schedule', 'unknown', '']) {
    const plan = eventPlan(eventName, { ref: 'refs/heads/main', changes: [change('README.md')], availableSpecs });
    assert.equal(plan.level, 'L2'); assert.equal(plan.runE2E, true); assert.equal(plan.deploy, false);
    assert.deepEqual(plan.specs, availableSpecs);
  }
});

test('only main push skips E2E and prepares fresh build deployment', () => {
  const plan = eventPlan('push', { ref: 'refs/heads/main', availableSpecs });
  assert.equal(plan.level, 'L0'); assert.equal(plan.runE2E, false); assert.equal(plan.deploy, true);
  assert.deepEqual(plan.specs, []);
  assert.equal(eventPlan('push', { ref: 'refs/heads/feature', availableSpecs }).level, 'L2');
  assert.equal(eventPlan('pull_request', { ref: 'refs/heads/main', changes: [change('README.md')], availableSpecs }).deploy, false);
});

function git(cwd, ...args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, `git ${args[0]}: ${result.stderr}`);
  return result.stdout.trim();
}

function repo(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'barb-ci-risk-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  git(cwd, 'init', '-b', 'main');
  git(cwd, 'config', 'user.name', 'CI test'); git(cwd, 'config', 'user.email', 'ci-test@example.invalid');
  const write = (path, content) => { mkdirSync(join(cwd, path, '..'), { recursive: true }); writeFileSync(join(cwd, path), content); };
  write('README.md', 'original README\n'); write('docs/AUDIO_SYSTEM.md', 'original explanation\n');
  write('src/audio/ambient-player.js', 'export const example = 1;\n');
  write(fishPng, 'base image fixture\n');
  write(spotsHUD, 'export const example = 1;\n');
  for (const path of availableSpecs) write(path, '// inventory fixture\n');
  git(cwd, 'add', '.'); git(cwd, 'commit', '-m', 'base');
  const mergeBaseSha = git(cwd, 'rev-parse', 'HEAD');
  git(cwd, 'switch', '-c', 'feature');
  write('README.md', 'updated README\n');
  git(cwd, 'add', '.'); git(cwd, 'commit', '-m', 'README update');
  return { cwd, write, mergeBaseSha };
}

function mergeFeature(cwd) {
  const headSha = git(cwd, 'rev-parse', 'feature');
  git(cwd, 'switch', 'main'); const baseSha = git(cwd, 'rev-parse', 'HEAD');
  git(cwd, 'merge', '--no-ff', 'feature', '-m', 'synthetic PR merge');
  return { cwd, baseSha, headSha, validationSha: git(cwd, 'rev-parse', 'HEAD'), fetch: false };
}

test('git diff covers the whole PR using merge base, including earlier commits and special-path rename/delete', t => {
  const { cwd, write, mergeBaseSha } = repo(t);
  write('src/audio/ambient-player.js', 'export const example = 2;\n');
  const specialPath = 'docs/space tab\tline\n"quote".md';
  renameSync(join(cwd, 'docs/AUDIO_SYSTEM.md'), join(cwd, specialPath));
  git(cwd, 'add', '-A'); git(cwd, 'commit', '-m', 'local change and special rename');
  git(cwd, 'switch', 'main'); write('base-only.txt', 'new base content\n');
  git(cwd, 'add', '.'); git(cwd, 'commit', '-m', 'base advances independently');
  git(cwd, 'switch', 'feature');
  const input = mergeFeature(cwd), diff = readChangedFiles(input);
  assert.equal(diff.ok, true); assert.equal(diff.mergeBaseSha, mergeBaseSha);
  const paths = diff.changes.flatMap(item => item.paths);
  for (const path of ['README.md', 'src/audio/ambient-player.js', 'docs/AUDIO_SYSTEM.md', specialPath]) assert.ok(paths.includes(path), path);
  assert.ok(!paths.includes('base-only.txt'));
  assert.ok(diff.changes.some(item => item.status === 'R100' && item.paths[1] === specialPath));
});

test('missing history, stale HEAD, wrong base and head-only checkout return failed complete-diff acquisition', t => {
  const { cwd } = repo(t), input = mergeFeature(cwd);
  for (const overrides of [{ validationSha: input.headSha }, { headSha: 'a'.repeat(40) },
    { baseSha: input.headSha }, { baseSha: undefined }, { headSha: '--help' }]) {
    const diff = readChangedFiles({ ...input, ...overrides });
    assert.equal(diff.ok, false); assert.deepEqual(diff.changes, []);
  }
  git(cwd, 'checkout', input.headSha);
  const diff = readChangedFiles({ ...input, validationSha: input.headSha });
  assert.equal(diff.ok, false); assert.match(diff.error, /merge/);
});

test('shallow history cannot produce a low-risk partial PR diff', t => {
  const { cwd } = repo(t), input = mergeFeature(cwd);
  const shallow = mkdtempSync(join(tmpdir(), 'barb-ci-shallow-'));
  t.after(() => rmSync(shallow, { recursive: true, force: true }));
  git(shallow, 'clone', '--depth=1', `file://${cwd}`, '.');
  assert.equal(git(shallow, 'rev-parse', '--is-shallow-repository'), 'true');
  const diff = readChangedFiles({ ...input, cwd: shallow });
  assert.equal(diff.ok, false); assert.match(diff.error, /shallow/);
  const recovered = readChangedFiles({ ...input, cwd: shallow, fetch: true });
  assert.equal(recovered.ok, true); assert.deepEqual(recovered.changes, [change('README.md')]);
});

test('empty PR diff is anomalous and forces L2', t => {
  const { cwd } = repo(t);
  git(cwd, 'revert', '--no-edit', 'HEAD');
  const input = mergeFeature(cwd), diff = readChangedFiles(input);
  assert.equal(diff.ok, false); assert.match(diff.error, /Empty/);
});

test('createPlan records exact PR and integration SHA and handles L0/L1/L2 simulated diffs', t => {
  for (const [source, level] of [['README.md', 'L0'], [audio, 'L1'], [fishPng, 'L1'], [spotsHUD, 'L1'], ['.github/workflows/pages.yml', 'L2']]) {
    const { cwd, write } = repo(t);
    if (source !== 'README.md') { write(source, 'changed\n'); git(cwd, 'add', '.'); git(cwd, 'commit', '-m', 'scope'); }
    const input = mergeFeature(cwd), plan = createPlan({ ...input, eventName: 'pull_request', ref: 'refs/pull/42/merge',
      event: { number: 42, pull_request: { head: { sha: input.headSha }, base: { sha: input.baseSha } } } });
    assert.equal(plan.level, level); assert.equal(plan.prNumber, 42);
    assert.equal(plan.headSha, input.headSha); assert.equal(plan.baseSha, input.baseSha);
    assert.equal(plan.validationSha, input.validationSha); assert.equal(plan.validationRef, 'refs/pull/42/merge');
    assert.equal(plan.diff.ok, true); assert.equal(plan.deploy, false);
  }
});

test('a real HUD-only merge diff selects five specs, while SHA mismatches and missing disk specs force L2', t => {
  const { cwd, write, mergeBaseSha } = repo(t);
  git(cwd, 'restore', '--source', mergeBaseSha, 'README.md');
  write(spotsHUD, 'export const example = 2;\n');
  git(cwd, 'add', '.'); git(cwd, 'commit', '-m', 'HUD-only net diff');
  const input = mergeFeature(cwd);
  const options = { ...input, eventName: 'pull_request', ref: 'refs/pull/42/merge',
    event: { number: 42, pull_request: { head: { sha: input.headSha }, base: { sha: input.baseSha } } } };
  const plan = createPlan(options);
  assert.equal(plan.diff.ok, true); assert.deepEqual(plan.changes, [change(spotsHUD)]);
  assert.equal(plan.level, 'L1'); assert.deepEqual(plan.specs, spotsHUDSpecs);
  for (const overrides of [{ validationSha: input.headSha },
    { event: { pull_request: { head: { sha: 'a'.repeat(40) }, base: { sha: input.baseSha } } } },
    { event: { pull_request: { head: { sha: input.headSha }, base: { sha: input.headSha } } } }]) {
    const failed = createPlan({ ...options, ...overrides });
    assert.equal(failed.level, 'L2'); assert.equal(failed.diff.ok, false);
    assert.deepEqual(failed.specs, availableSpecs);
  }
  for (const missing of spotsHUDSpecs) {
    rmSync(join(cwd, missing));
    const failed = createPlan(options);
    assert.equal(failed.level, 'L2', missing); assert.match(failed.reasons.join(' '), /欠落/);
    assert.deepEqual(failed.specs, availableSpecs.filter(path => path !== missing));
    write(missing, '// restored inventory fixture\n');
  }
});

test('a real PNG-only merge diff selects six specs, while SHA mismatches and missing disk specs force L2', t => {
  const { cwd, write, mergeBaseSha } = repo(t);
  git(cwd, 'restore', '--source', mergeBaseSha, 'README.md');
  write(fishPng, 'modified image fixture\n');
  git(cwd, 'add', '.'); git(cwd, 'commit', '-m', 'PNG-only net diff');
  const input = mergeFeature(cwd);
  const options = { ...input, eventName: 'pull_request', ref: 'refs/pull/42/merge',
    event: { number: 42, pull_request: { head: { sha: input.headSha }, base: { sha: input.baseSha } } } };
  const plan = createPlan(options);
  assert.equal(plan.diff.ok, true); assert.deepEqual(plan.changes, [change(fishPng)]);
  assert.equal(plan.level, 'L1'); assert.deepEqual(plan.specs, fishPngSpecs);
  for (const overrides of [{ validationSha: input.headSha },
    { event: { pull_request: { head: { sha: 'a'.repeat(40) }, base: { sha: input.baseSha } } } },
    { event: { pull_request: { head: { sha: input.headSha }, base: { sha: input.headSha } } } }]) {
    const failed = createPlan({ ...options, ...overrides });
    assert.equal(failed.level, 'L2'); assert.equal(failed.diff.ok, false);
    assert.deepEqual(failed.specs, availableSpecs);
  }
  rmSync(join(cwd, 'tests/browser/fish-assets.spec.js'));
  const missing = createPlan(options);
  assert.equal(missing.level, 'L2'); assert.match(missing.reasons.join(' '), /欠落/);
});

test('missing PR metadata, failed inventory and invalid diff fail closed', t => {
  const { cwd } = repo(t), input = mergeFeature(cwd);
  const plan = createPlan({ ...input, eventName: 'pull_request', event: {}, ref: 'refs/pull/1/merge' });
  assert.equal(plan.level, 'L2'); assert.equal(plan.diff.ok, false); assert.equal(plan.runE2E, true);
  rmSync(join(cwd, 'tests/browser'), { recursive: true });
  const noInventory = createPlan({ ...input, eventName: 'workflow_dispatch', event: {}, ref: 'refs/heads/main' });
  assert.equal(noInventory.level, 'L2'); assert.equal(noInventory.runE2E, true); assert.deepEqual(noInventory.specs, []);
});
