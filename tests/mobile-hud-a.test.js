import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { compareMobileCapturePairWithSources, compareMobileCapturesWithSources, writeMobileComparison } from '../scripts/compare-mobile-performance.mjs';
import { mobileGit, readMobileImplementation, mobileSourceMetadata } from '../scripts/lib/mobile-comparison-source.js';
import { HUD_A_BASE, HUD_A_IDS, HUD_A_SOURCES, readHudATransition } from '../scripts/lib/mobile-hud-a.js';
import { validateMobileEvidence } from '../scripts/ci-summary.js';
import { hudAFixtureCommit, hudAGateFixture } from './helpers/hud-a-fixture.js';

const pair = (data, id = 'portrait-fight') => [data.before.find(c => c.id === id), data.after.find(c => c.id === id), data.metadata];
const payload = data => ({ mobile: { metadata: data.metadata, before: data.before, after: data.after, comparison: data.comparison }, record: { files: data.files } });

test('HUD A: 34 source-replayed synthetic pairs and final gate allow exactly nine geometry contracts', async () => {
  const data = await hudAGateFixture();
  assert.equal(data.metadata.baseSha, HUD_A_BASE);
  assert.equal(data.metadata.implementations.pr.sourceTree, HUD_A_SOURCES.after.sourceTree);
  assert.deepEqual(data.comparison.rows.filter(row => row.hudAComparison).map(row => row.id).sort(), [...HUD_A_IDS].sort());
  assert.equal(await validateMobileEvidence(payload(data), data.metadata), 34);
});

test('HUD A: every changed rectangle/occupancy and button field checks both base and approved values exactly', async () => {
  const data = await hudAGateFixture();
  for (const side of ['before', 'after']) for (const field of ['panel', 'meter', 'buttons', 'occupancy']) {
    const copy = structuredClone(data), entry = copy[side].find(c => c.id === 'portrait-fight');
    if (field === 'occupancy') entry.layout[field] += .000001;
    else if (field === 'buttons') entry.layout.buttons.find(b => b.id === 'return-button').width += .000001;
    else entry.layout[field].width += .000001;
    await assert.rejects(compareMobileCapturePairWithSources(...pair(copy)));
  }
});

test('HUD A: unchanged reticle, header/control identities, notice set, warning and overflow remain strict', async () => {
  for (const mutate of [
    e => { e.layout.reticle.x += .001; }, e => { e.layout.header.left += .001; },
    e => { e.layout.buttons.find(b => b.id === 'menu-button').id = 'other'; },
    e => { e.layout.notices.push({ left: 0, top: 0, right: 1, bottom: 1 }); },
    e => { e.layout.warning += ' '; }, e => { e.layout.scrollWidth++; },
  ]) {
    const data = await hudAGateFixture(); mutate(data.after.find(c => c.id === 'portrait-fight'));
    await assert.rejects(compareMobileCapturePairWithSources(...pair(data)));
  }
});

test('HUD A: camera, FOV, DPR, buffer and all resource counters gain no allowance', async () => {
  for (const mutate of [
    e => { e.metrics.camera.quaternion[1] += .000001; }, e => { e.metrics.resourceCamera.fov++; },
    e => { e.metrics.dpr++; }, e => { e.metrics.buffer.width++; },
    ...['resources', 'actualResources'].flatMap(field => ['calls', 'triangles', 'geometries', 'textures', 'programs']
      .map(key => e => { e.metrics[field][key]++; })),
  ]) {
    const data = await hudAGateFixture(); mutate(data.after.find(c => c.id === 'portrait-fight'));
    await assert.rejects(compareMobileCapturePairWithSources(...pair(data)));
  }
});

test('HUD A: unrelated IDs, substituted viewport and missing pairs cannot inherit an exception', async () => {
  let data = await hudAGateFixture();
  for (const entry of [data.before[0], data.after[0]]) entry.id = 'unexpected-day-tps';
  await assert.rejects(compareMobileCapturesWithSources(data.before, data.after, data.metadata), /Missing\/duplicate/);
  data = await hudAGateFixture();
  for (const entry of pair(data).slice(0, 2)) entry.id = 'unexpected-fight';
  await assert.rejects(compareMobileCapturePairWithSources(...pair({ ...data, before: data.before, after: data.after }, 'unexpected-fight')));
  data = await hudAGateFixture(); data.after.pop();
  await assert.rejects(compareMobileCapturesWithSources(data.before, data.after, data.metadata));
  data = await hudAGateFixture(); data.after.find(e => e.id === 'portrait-fight').layout.viewport.width++;
  await assert.rejects(compareMobileCapturePairWithSources(...pair(data)));
});

test('HUD A: changed CSS, notice coordinator, main or QTE source cannot reuse the source transition', async () => {
  const data = await hudAGateFixture();
  for (const path of ['src/ui/style.css', 'src/ui/cast-notices.js', 'src/main.js', 'src/ui/qte-layout.js']) {
    const original = await mobileGit('show', `${data.metadata.headSha}:${path}`);
    const text = path.endsWith('.css') ? original + '\n/* unit rejection */\n' : original + '\n// unit rejection\n';
    const sha = hudAFixtureCommit({ [path]: text }), changed = await readMobileImplementation(sha);
    assert.equal(readHudATransition(data.metadata.implementations.main, changed), null);
    const metadata = { ...data.metadata, headSha: sha, validationSha: sha,
      implementations: { ...data.metadata.implementations, pr: mobileSourceMetadata(changed) } };
    await assert.rejects(compareMobileCapturePairWithSources(...pair(data).slice(0, 2), metadata));
  }
});

test('HUD A: SHA, provenance and reversed validation-merge parents fail source revalidation', async () => {
  const data = await hudAGateFixture();
  let metadata = structuredClone(data.metadata); metadata.implementations.pr.hudBlob = 'f'.repeat(40);
  await assert.rejects(compareMobileCapturePairWithSources(...pair(data).slice(0, 2), metadata), /provenance/);
  metadata = structuredClone(data.metadata); metadata.headSha = HUD_A_BASE;
  await assert.rejects(compareMobileCapturePairWithSources(...pair(data).slice(0, 2), metadata), /merge/);
  const sha = hudAFixtureCommit({}, [data.metadata.headSha, HUD_A_BASE]);
  metadata = { ...data.metadata, validationSha: sha,
    implementations: { ...data.metadata.implementations, pr: mobileSourceMetadata(await readMobileImplementation(sha)) } };
  await assert.rejects(compareMobileCapturePairWithSources(...pair(data).slice(0, 2), metadata), /base\/HEAD merge/);
});

test('HUD A: final gate rejects image/individual JSON loss, incomplete artifacts and forged reports', async () => {
  for (const name of ['pr-portrait-fight.png', 'main-small-bite.json']) {
    const data = await hudAGateFixture(); delete data.files[`test-results/mobile-comparison/${name}`];
    await assert.rejects(validateMobileEvidence(payload(data), data.metadata), /Missing mobile artifact/);
  }
  let data = await hudAGateFixture(); data.files['test-results/mobile-comparison/comparison-incomplete.json'] = 'unit';
  await assert.rejects(validateMobileEvidence(payload(data), data.metadata), /Incomplete/);
  data = await hudAGateFixture(); data.comparison.rows.find(r => r.hudAComparison).hudAComparison.validationSha = 'f'.repeat(40);
  await assert.rejects(validateMobileEvidence(payload(data), data.metadata), /report differs/);
});

test('HUD A: missing real image rejects report writing and CLI exits nonzero for a forbidden rectangle', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'barb-hud-a-cli-'));
  try {
    const data = await hudAGateFixture();
    await assert.rejects(writeMobileComparison(data.before, data.after, join(directory, 'missing.html'), data.metadata), /ENOENT/);
    data.after.find(c => c.id === 'portrait-fight').layout.panel.width++;
    for (const [name, value] of [['before', data.before], ['after', data.after]]) await writeFile(join(directory, `${name}.json`), JSON.stringify(value));
    const result = spawnSync(process.execPath, ['scripts/compare-mobile-performance.mjs', join(directory, 'before.json'), join(directory, 'after.json'),
      join(directory, 'rejected.html'), 'regression', data.metadata.baseSha, data.metadata.headSha], { encoding: 'utf8' });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /HUD|occupancy/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
