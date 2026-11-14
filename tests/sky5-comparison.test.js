import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readMobileImplementation, mobileSourceMetadata, mobileGit } from '../scripts/lib/mobile-comparison-source.js';
import { SKY5_BASE, SKY5_SOURCE_TREE, readSky5Preservation, readSky5WorldLightReference, verifySky5LakeBridge } from '../scripts/lib/sky5-source.js';
import { compareMobileCapturePairWithSources, compareMobileCapturesWithSources, MOBILE_CAPTURE_IDS } from '../scripts/compare-mobile-performance.mjs';
import { validateMobileEvidence } from '../scripts/ci-summary.js';
import { worldCapture } from './helpers/sky4r2-fixture.js';
import { writeComparison } from '../scripts/compare-lake-scenery.mjs';

let fixture;
async function sky5Fixture() {
  if (!fixture) fixture = (async () => {
    const main = await readMobileImplementation(SKY5_BASE), pr = await readMobileImplementation(await mobileGit('rev-parse', 'HEAD'));
    const metadata = { mode: 'regression', baseSha: main.sha, headSha: pr.sha, validationSha: pr.sha,
      implementations: { main: mobileSourceMetadata(main), pr: mobileSourceMetadata(pr) } };
    const before = [], after = [];
    for (const id of MOBILE_CAPTURE_IDS) { before.push(await worldCapture(main, id)); after.push(await worldCapture(pr, id)); }
    const comparison = { metadata, rows: await compareMobileCapturesWithSources(before, after, metadata) };
    const files = Object.fromEntries(['comparison-metadata.json', 'main.json', 'pr.json', 'comparison.html', 'comparison.json',
      ...['main', 'pr'].flatMap(target => MOBILE_CAPTURE_IDS.flatMap(id => [`${target}-${id}.png`, `${target}-${id}.json`]))]
      .map(name => [`test-results/mobile-comparison/${name}`, 'synthetic-unit-manifest']));
    return { main, pr, metadata, before, after, comparison, files };
  })();
  return structuredClone(await fixture.then(({ main, pr, ...data }) => data));
}

test('Sky-5 optical preservation pins one actual runtime tree and reverses only the read-only lake bridge; R2 introduction proof stays independent', async () => {
  const main = await readMobileImplementation(SKY5_BASE), pr = await readMobileImplementation(await mobileGit('rev-parse', 'HEAD'));
  assert.equal(pr.sourceTree, SKY5_SOURCE_TREE); assert.equal((await readSky5Preservation(main, pr)).sourceTree, SKY5_SOURCE_TREE);
  assert.equal((await readSky5WorldLightReference(pr)).baseSha, SKY5_BASE);
  const before = await mobileGit('show', `${main.sha}:src/world/lake.js`), after = await mobileGit('show', `${pr.sha}:src/world/lake.js`);
  verifySky5LakeBridge(before, after);
  for (const bad of [before, after + '\n// unrelated', after.replace('...aurora.meshes', '...[]')]) assert.throws(() => verifySky5LakeBridge(before, bad));
  await assert.rejects(readSky5Preservation(main, { ...pr, sourceTree: 'a'.repeat(40) }), /forged runtime tree/);
  await assert.rejects(readSky5Preservation(main, { ...pr, sha: main.sha }), /forged runtime tree/);
  await assert.rejects(readSky5Preservation(main, pr, main.sha), /validation merge parents|runtime differs/);
  const mergeSha = execFileSync('git', ['-c', 'user.name=Sky5 Unit', '-c', 'user.email=unit@example.invalid', 'commit-tree',
    await mobileGit('rev-parse', `${pr.sha}^{tree}`), '-p', main.sha, '-p', pr.sha], { input: 'Synthetic validation merge\n', encoding: 'utf8' }).trim();
  const merge = await readMobileImplementation(mergeSha);
  assert.equal((await readSky5Preservation(main, merge)).headSha, pr.sha);
  assert.equal((await readSky5Preservation(main, merge, pr.sha)).validationSha, mergeSha);
  await assert.rejects(readSky5Preservation(main, merge, main.sha), /validation merge parents/);
});

test('an actual modified shader-source commit cannot inherit the Sky-5 proof', async () => {
  const main = await readMobileImplementation(SKY5_BASE), dir = await mkdtemp(join(tmpdir(), 'barb-sky5-index-'));
  try {
    const env = { ...process.env, GIT_INDEX_FILE: join(dir, 'index') };
    const git = (args, input) => execFileSync('git', args, { env, input, encoding: 'utf8' }).trim();
    git(['read-tree', 'HEAD']);
    const text = git(['show', 'HEAD:src/world/aurora.js']) + '\n// unrelated optical source';
    const blob = git(['hash-object', '-w', '--stdin'], text);
    git(['update-index', '--cacheinfo', `100644,${blob},src/world/aurora.js`]);
    const sha = git(['-c', 'user.name=Sky5 Unit', '-c', 'user.email=unit@example.invalid', 'commit-tree', git(['write-tree']), '-p', git(['rev-parse', 'HEAD'])], 'Synthetic rejected optical source\n');
    await assert.rejects(readSky5Preservation(main, await readMobileImplementation(sha)), /unreviewed runtime tree/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('34 synthetic pairs keep zero resource allowance, full source replay and final 68-image completeness', async () => {
  const p = await sky5Fixture(); assert.equal(p.comparison.rows.length, 34);
  for (const row of p.comparison.rows) {
    assert.equal(row.sky5Preservation.sourceTree, SKY5_SOURCE_TREE);
    assert.deepEqual(row.before.resources, row.after.resources); assert.deepEqual(row.before.actualResources, row.after.actualResources);
  }
  assert.equal(await validateMobileEvidence({ record: { files: p.files }, mobile: p }, p.metadata), 34);
  const missing = { ...p.files }; delete missing['test-results/mobile-comparison/main-pc-clear-night.png'];
  await assert.rejects(validateMobileEvidence({ record: { files: missing }, mobile: p }, p.metadata), /Missing mobile artifact/);
  const forged = structuredClone(p); forged.comparison.rows[0].sky5Preservation.resourceDelta.calls = 1;
  await assert.rejects(validateMobileEvidence({ record: { files: p.files }, mobile: forged }, p.metadata), /report differs/);
});

test('capture, CLI and final gate reject raw shader/light/draw/clock/camera/resource corruption for Sky-5', async () => {
  const p = await sky5Fixture(), before = p.before.find(row => row.id === 'pc-clear-night'), good = p.after.find(row => row.id === before.id);
  for (const change of [m => { m.worldLight.water.material.fragmentShader += '// corrupt'; },
    m => { m.worldLight.water.gpuLight.strength += .001; }, m => { m.auroraDisplay.draws.actual[0].calls++; },
    m => { m.auroraDisplay.clockSeconds++; }, m => { m.camera.position[0] += .000001; },
    ...['resources', 'actualResources'].flatMap(pass => ['calls', 'triangles', 'geometries', 'textures', 'programs'].map(key => m => { m[pass][key]++; }))]) {
    const bad = structuredClone(good); change(bad.metrics); await assert.rejects(compareMobileCapturePairWithSources(before, bad, p.metadata));
  }
  p.after[0].metrics.actualResources.calls++;
  await assert.rejects(validateMobileEvidence({ record: { files: p.files }, mobile: p }, p.metadata), /resource regression/);
  const dir = await mkdtemp(join(tmpdir(), 'barb-sky5-cli-'));
  try {
    await writeFile(join(dir, 'main.json'), JSON.stringify(p.before)); await writeFile(join(dir, 'pr.json'), JSON.stringify(p.after));
    const result = spawnSync(process.execPath, ['scripts/compare-mobile-performance.mjs', join(dir, 'main.json'), join(dir, 'pr.json'),
      join(dir, 'comparison.html'), 'regression', p.metadata.baseSha, p.metadata.headSha], { encoding: 'utf8' });
    assert.equal(result.status, 1); assert.match(result.stderr, /resource regression/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('all eight cold scenery views independently preserve Sky-5 optics with zero resource allowance', async () => {
  const main = await readMobileImplementation(SKY5_BASE), pr = await readMobileImplementation(await mobileGit('rev-parse', 'HEAD'));
  const views = async source => {
    const rows = [];
    for (const id of ['day-tps', 'day-fps', 'twilight', 'clear-night', 'fog-night', 'dense-night', 'portrait', 'landscape']) {
      const entry = await worldCapture(source, `pc-${['twilight', 'portrait', 'landscape'].includes(id) ? 'day-tps' : id}`, { warmed: false }), m = entry.metrics;
      m.camera = { ...m.camera, fov: 55 }; m.cameraEvidence = { sha: source.sha, cameraBlob: source.cameraBlob, frames: m.cameraFrames };
      m.resources = m.actualResources; delete m.fixedResources;
      Object.assign(m, { deviceScaleFactor: 1, boat: [10, 20], heading: 0, waterTime: .25, fogStrength: 0 }); rows.push([id, { metrics: m, image: '' }]);
    }
    return new Map(rows);
  };
  const before = await views(main), after = await views(pr), dir = await mkdtemp(join(tmpdir(), 'barb-sky5-scenery-'));
  try {
    const output = join(dir, 'comparison.html'), rows = await writeComparison(before, after, output);
    assert.equal(rows.length, 8); assert(rows.every(row => row.sky5Preservation.sourceTree === SKY5_SOURCE_TREE));
    for (const key of ['calls', 'triangles', 'geometries', 'programs', 'textures']) {
      const bad = structuredClone(after); bad.get('clear-night').metrics.resources[key]++;
      await assert.rejects(writeComparison(before, bad, output), /resource regression/);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
