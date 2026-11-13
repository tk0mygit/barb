import { execFileSync } from 'node:child_process';
import { SKY4_BASE, replayAuroraCapture } from '../../scripts/lib/sky4-source.js';
import { SKY4_SOURCE_BLOBS } from '../../scripts/lib/sky4-source-pins.js';
import { starCapture } from './sky2-fixture.js';
import { replayStarCapture } from '../../scripts/lib/sky2-source.js';
import { replayMeteorCapture } from '../../scripts/lib/sky3-source.js';
import { findAuroraNight } from './aurora-event.js';
import { readMobileImplementation, mobileSourceMetadata } from '../../scripts/lib/mobile-comparison-source.js';
import { MOBILE_CAPTURE_IDS, compareMobileCapturesWithSources } from '../../scripts/compare-mobile-performance.mjs';

const git = (args, input) => execFileSync('git', args, { input, encoding: 'utf8' }).trim();
function replace(tree, parts, blob) {
  const entries = git(['ls-tree', '-z', tree]).split('\0').filter(Boolean), index = entries.findIndex(row => row.split('\t')[1] === parts[0]);
  const next = parts.length === 1 ? blob : replace(entries[index].split(/\s+/)[2], parts.slice(1), blob);
  const row = `${parts.length === 1 ? '100644 blob' : '040000 tree'} ${next}\t${parts[0]}`;
  if (index < 0) entries.push(row); else entries[index] = row;
  return git(['mktree', '-z'], entries.join('\0') + '\0');
}
export function sky4FixtureCommit(changes = {}) {
  let tree = git(['rev-parse', `${SKY4_BASE}^{tree}`]);
  for (const [path, blob] of Object.entries({ ...SKY4_SOURCE_BLOBS,
    'scripts/lib/sky4-source-pins.js': git(['hash-object', '-w', 'scripts/lib/sky4-source-pins.js']),
    // Original Sky-4 wiring, independent of later world-light integrations.
    'src/world/lake.js': '74e948aabe6d55fad7fe64afaf5d9943a01eb2eb' })) tree = replace(tree, path.split('/'), blob);
  for (const [path, source] of Object.entries(changes)) tree = replace(tree, path.split('/'), git(['hash-object', '-w', '--stdin'], source));
  return git(['-c', 'user.name=Sky-4 unit fixture', '-c', 'user.email=unit@example.invalid', 'commit-tree', tree, '-p', SKY4_BASE], 'Synthetic Sky-4 source contract fixture\n');
}
export function auroraGPUFixture(replay) {
  if (!replay.snapshot) return null;
  const key = 'synthetic-unit-aurora-shared-program';
  return { objects: 2, layers: replay.snapshot.layers.map((layer, i) => ({ geometryId: layer.geometryId, materialId: layer.materialId,
    programKeys: replay.initializedLayers[i] ? [key] : [] })), programKeys: replay.initialized ? [key] : [], programInstances: Number(replay.initialized),
    buffers: Object.fromEntries([['position', 10692], ['uv', 7128], ['index', 9600]].map(([name, bytes], i) =>
      [name, replay.initialized ? { id: i + 1, bytes, uploads: 1 } : null])) };
}
export async function auroraCapture(implementation, id, options) {
  const entry = await starCapture(implementation, id), m = entry.metrics;
  if (id.endsWith('clear-night')) {
    const previous = await replayStarCapture(implementation, m);
    m.savedClockSeconds = m.starDisplay.clockSeconds = findAuroraNight({ forward: true }) * 360 + 270;
    const next = await replayStarCapture(implementation, m);
    for (const [key, pass] of [['resources', 'fixed'], ['actualResources', 'actual']]) m[key].calls += next.draws[pass] - previous.draws[pass];
    m.starDisplay.snapshot = next.snapshot; m.starDisplay.draws = next.draws;
  }
  m.meteorDisplay = { clockSeconds: m.starDisplay.clockSeconds };
  const meteor = await replayMeteorCapture(implementation, m, options);
  Object.assign(m.meteorDisplay, { snapshot: meteor.snapshot, draws: meteor.draws,
    gpu: meteor.snapshot ? { geometryId: meteor.snapshot.geometryId, materialId: meteor.snapshot.materialId,
      programKeys: meteor.initialized ? ['synthetic-unit-meteor-program'] : [], programInstances: Number(meteor.initialized), objects: 1 } : null });
  m.auroraDisplay = { clockSeconds: m.starDisplay.clockSeconds };
  const aurora = await replayAuroraCapture(implementation, m, options);
  Object.assign(m.auroraDisplay, { snapshot: aurora.snapshot, draws: aurora.draws, gpu: auroraGPUFixture(aurora) });
  for (const replay of [meteor, aurora]) for (const [key, pass] of [['resources', 'fixed'], ['actualResources', 'actual']]) {
    const draws = Array.isArray(replay.draws[pass]) ? replay.draws[pass] : [replay.draws[pass]];
    m[key].calls += draws.reduce((n, row) => n + row.calls, 0); m[key].triangles += draws.reduce((n, row) => n + row.triangles, 0);
    m[key].geometries += Number(replay.initialized); m[key].programs += Number(replay.initialized);
  }
  m.fixedResources = structuredClone(m.resources); return entry;
}
let fixture;
export async function auroraGateFixture() {
  if (!fixture) fixture = (async () => {
    const main = await readMobileImplementation(SKY4_BASE), pr = await readMobileImplementation(sky4FixtureCommit());
    const metadata = { mode: 'regression', baseSha: main.sha, headSha: pr.sha, validationSha: pr.sha,
      implementations: { main: mobileSourceMetadata(main), pr: mobileSourceMetadata(pr) } };
    const before = [], after = [];
    for (const id of MOBILE_CAPTURE_IDS) { before.push(await auroraCapture(main, id)); after.push(await auroraCapture(pr, id)); }
    const comparison = { metadata, rows: await compareMobileCapturesWithSources(before, after, metadata) };
    const names = ['comparison-metadata.json', 'main.json', 'pr.json', 'comparison.html', 'comparison.json',
      ...['main', 'pr'].flatMap(target => MOBILE_CAPTURE_IDS.flatMap(id => [`${target}-${id}.png`, `${target}-${id}.json`]))];
    return { metadata, before, after, comparison, files: Object.fromEntries(names.map(name => [`test-results/mobile-comparison/${name}`, 'synthetic-unit-manifest'])) };
  })();
  return JSON.parse(JSON.stringify(await fixture));
}
