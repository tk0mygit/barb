import { execFileSync } from 'node:child_process';
import { SKY4R2_BASE } from '../../scripts/lib/sky4r2-source.js';
import { SKY4R2_BLOBS } from '../../scripts/lib/sky4r2-pins.js';
import { readMobileImplementation, mobileSourceMetadata } from '../../scripts/lib/mobile-comparison-source.js';
import { MOBILE_CAPTURE_IDS, compareMobileCapturesWithSources } from '../../scripts/compare-mobile-performance.mjs';
import { auroraCapture } from './sky4-fixture.js';
import { replayWorldLightCapture } from '../../scripts/lib/sky4r2-source.js';
const git = (args, input) => execFileSync('git', args, { input, encoding: 'utf8' }).trim();
function replace(tree, parts, blob) {
  const entries = git(['ls-tree', '-z', tree]).split('\0').filter(Boolean), i = entries.findIndex(row => row.split('\t')[1] === parts[0]);
  const next = parts.length === 1 ? blob : replace(entries[i].split(/\s+/)[2], parts.slice(1), blob);
  const row = `${parts.length === 1 ? '100644 blob' : '040000 tree'} ${next}\t${parts[0]}`;
  if (i < 0) entries.push(row); else entries[i] = row;
  return git(['mktree', '-z'], entries.join('\0') + '\0');
}
export function worldFixtureCommit(changes = {}, parent = SKY4R2_BASE, extraParent) {
  let tree = git(['rev-parse', `${SKY4R2_BASE}^{tree}`]);
  for (const [path, blob] of Object.entries({ ...SKY4R2_BLOBS,
    'scripts/lib/sky4r2-pins.js': git(['hash-object', '-w', 'scripts/lib/sky4r2-pins.js']) })) tree = replace(tree, path.split('/'), blob);
  for (const [path, source] of Object.entries(changes)) tree = replace(tree, path.split('/'), git(['hash-object', '-w', '--stdin'], source));
  return git(['-c', 'user.name=World light unit fixture', '-c', 'user.email=unit@example.invalid', 'commit-tree', tree,
    '-p', parent, ...(extraParent ? ['-p', extraParent] : [])], 'Synthetic world light source contract fixture\n');
}
export async function worldCapture(implementation, id, options) {
  const entry = await auroraCapture(implementation, id, options), m = entry.metrics;
  const replay = await replayWorldLightCapture(implementation, m), { water, ambient, state, lights } = replay;
  const lightIds = [30000, 30001, 30002], geometryId = 30003, materialId = 30004, key = 'synthetic-unit-water-program';
  const sizes = Object.entries(water.attributes).map(([key, value]) => [key, value.bytes]).concat([['index', water.index.bytes]]);
  m.worldLight = { clockSeconds: m.auroraDisplay.clockSeconds, model: state.model,
    ambient: { id: lightIds[0], color: ambient.ambientSky, ground: ambient.ambientGround, intensity: ambient.ambientIntensity },
    lights: lights.map((light, i) => ({ id: lightIds[i], ...light })),
    hemisphereGPU: { programKey: 'synthetic-unit-standard-program', sky: ambient.ambientSky.map(v => Math.fround(v * ambient.ambientIntensity)),
      ground: ambient.ambientGround.map(v => Math.fround(v * ambient.ambientIntensity)) },
    water: { ...water, geometryId, materialId,
      gpuLight: water.light ? { color: water.light.color.map(Math.fround), strength: Math.fround(water.light.strength), direction: water.light.direction.map(Math.fround) }
        : { color: null, strength: null, direction: null },
      gpu: { objects: 1, layers: [{ geometryId, materialId, programKeys: [key] }], programKeys: [key], programInstances: 1,
        buffers: Object.fromEntries(sizes.map(([name, bytes], i) => [name, { id: 10 + i, bytes, uploads: 1 }])) } } };
  return entry;
}
let fixture;
export async function worldGateFixture() {
  if (!fixture) fixture = (async () => {
    const main = await readMobileImplementation(SKY4R2_BASE), pr = await readMobileImplementation(worldFixtureCommit());
    const metadata = { mode: 'regression', baseSha: main.sha, headSha: pr.sha, validationSha: pr.sha,
      implementations: { main: mobileSourceMetadata(main), pr: mobileSourceMetadata(pr) } };
    const before = [], after = [];
    for (const id of MOBILE_CAPTURE_IDS) { before.push(await worldCapture(main, id)); after.push(await worldCapture(pr, id)); }
    const comparison = { metadata, rows: await compareMobileCapturesWithSources(before, after, metadata) };
    const names = ['comparison-metadata.json', 'main.json', 'pr.json', 'comparison.html', 'comparison.json',
      ...['main', 'pr'].flatMap(target => MOBILE_CAPTURE_IDS.flatMap(id => [`${target}-${id}.png`, `${target}-${id}.json`]))];
    return { metadata, before, after, comparison, files: Object.fromEntries(names.map(name => [`test-results/mobile-comparison/${name}`, 'synthetic-unit-manifest'])) };
  })();
  return structuredClone(await fixture);
}
