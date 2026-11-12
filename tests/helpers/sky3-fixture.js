import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { SKY3_BASE, SKY3_OBSERVER_BLOBS, replayMeteorCapture } from '../../scripts/lib/sky3-source.js';
import { starCapture } from './sky2-fixture.js';
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
export function sky3FixtureCommit(changes = {}) {
  let tree = git(['rev-parse', `${SKY3_BASE}^{tree}`]);
  for (const path of ['src/world/lake.js', 'src/world/meteor.js', ...Object.keys(SKY3_OBSERVER_BLOBS)]) {
    tree = replace(tree, path.split('/'), git(['hash-object', '-w', '--stdin'], readFileSync(path)));
  }
  for (const [path, source] of Object.entries(changes)) tree = replace(tree, path.split('/'), git(['hash-object', '-w', '--stdin'], source));
  return git(['-c', 'user.name=Sky-3 unit fixture', '-c', 'user.email=unit@example.invalid', 'commit-tree', tree, '-p', SKY3_BASE], 'Synthetic Sky-3 source contract fixture\n');
}
export async function meteorCapture(implementation, id, options) {
  const entry = await starCapture(implementation, id), m = entry.metrics;
  m.meteorDisplay = { clockSeconds: m.starDisplay.clockSeconds };
  const replay = await replayMeteorCapture(implementation, m, options);
  m.meteorDisplay.snapshot = replay.snapshot; m.meteorDisplay.draws = replay.draws;
  m.meteorDisplay.gpu = replay.snapshot ? { geometryId: replay.snapshot.geometryId, materialId: replay.snapshot.materialId,
    programKeys: replay.initialized ? ['synthetic-unit-meteor-program'] : [], programInstances: Number(replay.initialized), objects: 1 } : null;
  for (const [key, pass] of [['resources', 'fixed'], ['actualResources', 'actual']]) {
    m[key].calls += replay.draws[pass].calls; m[key].triangles += replay.draws[pass].triangles;
    m[key].geometries += Number(replay.initialized); m[key].programs += Number(replay.initialized);
  }
  m.fixedResources = structuredClone(m.resources);
  return entry;
}
let fixture;
export async function meteorGateFixture() {
  if (!fixture) fixture = (async () => {
    const main = await readMobileImplementation(SKY3_BASE), pr = await readMobileImplementation(sky3FixtureCommit());
    const metadata = { mode: 'regression', baseSha: main.sha, headSha: pr.sha, validationSha: pr.sha,
      implementations: { main: mobileSourceMetadata(main), pr: mobileSourceMetadata(pr) } };
    const before = [], after = [];
    for (const id of MOBILE_CAPTURE_IDS) { before.push(await meteorCapture(main, id)); after.push(await meteorCapture(pr, id)); }
    const comparison = { metadata, rows: await compareMobileCapturesWithSources(before, after, metadata) };
    const names = ['comparison-metadata.json', 'main.json', 'pr.json', 'comparison.html', 'comparison.json',
      ...['main', 'pr'].flatMap(target => MOBILE_CAPTURE_IDS.flatMap(id => [`${target}-${id}.png`, `${target}-${id}.json`]))];
    return { metadata, before, after, comparison, files: Object.fromEntries(names.map(name => [`test-results/mobile-comparison/${name}`, 'synthetic-unit-manifest'])) };
  })();
  return JSON.parse(JSON.stringify(await fixture));
}
