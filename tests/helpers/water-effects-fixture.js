import { execFileSync } from 'node:child_process';
import { readMobileImplementation, mobileSourceMetadata, replayMobileCamera, expectedMobileResourceCamera } from '../../scripts/lib/mobile-comparison-source.js';
import { WATER_EFFECTS_BASE, WATER_EFFECTS_BLOB, WATER_CAPTURE_BLOB, replayWaterEffectsDisplay } from '../../scripts/lib/mobile-water-effects-replay.js';
import { FISHING_PHASE_IDS } from '../../scripts/lib/mobile-rod-reel-replay.js';
import { MOBILE_CAPTURE_IDS, compareMobileCapturesWithSources } from '../../scripts/compare-mobile-performance.mjs';
import { phaseCapture } from './fishing-phase-fixture.js';

// Reviewed immutable product/capture blobs, preserved by the eventual squash
// tree. No current-HEAD module supplies the baseline or fixture expectations.
const MAIN = '5540aa36ea7e616e9a987b39535c83942ed83499';
const VIEW = '227c042299f2ee1ebe37cdcb1b04be8078be62c3';
const git = (args, input) => execFileSync('git', args, { input, encoding: 'utf8' }).trim();
function replace(tree, parts, blob) {
  const rows = git(['ls-tree', '-z', tree]).split('\0').filter(Boolean);
  const index = rows.findIndex(row => row.split('\t')[1] === parts[0]);
  const old = index < 0 ? git(['mktree'], '') : rows[index].split(/\s+/)[2];
  const next = parts.length === 1 ? blob : replace(old, parts.slice(1), blob);
  const row = `${parts.length === 1 ? '100644 blob' : '040000 tree'} ${next}\t${parts[0]}`;
  if (index < 0) rows.push(row); else rows[index] = row;
  return git(['mktree', '-z'], rows.join('\0') + '\0');
}
export function waterFixtureCommit(changes = {}, parents = [WATER_EFFECTS_BASE]) {
  let tree = git(['rev-parse', `${WATER_EFFECTS_BASE}^{tree}`]);
  for (const [path, blob] of Object.entries({ 'src/main.js': MAIN, 'src/rendering/fishing.js': VIEW,
    'src/rendering/fishing-effects.js': WATER_EFFECTS_BLOB, 'tests/browser/mobile-performance.spec.js': WATER_CAPTURE_BLOB })) tree = replace(tree, path.split('/'), blob);
  for (const [path, text] of Object.entries(changes)) tree = replace(tree, path.split('/'), git(['hash-object', '-w', '--stdin'], text));
  return git(['-c', 'user.name=Surface unit fixture', '-c', 'user.email=unit@example.invalid', 'commit-tree', tree,
    ...parents.flatMap(parent => ['-p', parent])], 'Synthetic water effect contract fixture\n');
}

export async function waterCapture(implementation, id, firstFightDt = .016) {
  let entry;
  if (FISHING_PHASE_IDS.includes(id)) entry = await phaseCapture(implementation, id, firstFightDt);
  else {
    const viewport = { width: 1280, height: 800 }, phase = id.endsWith('day-fps') ? 'ready' : 'inactive';
    const cameraFrames = [{ update: false, dt: 0, aspect: 1.6, mode: phase === 'ready' ? 'fishing' : 'sailing', phase, preparing: false, tracking: null }];
    const camera = replayMobileCamera(implementation, cameraFrames);
    entry = { id, image: `/synthetic-unit/${id}.png`, metrics: { viewport, dpr: 1, pixelRatio: 1, buffer: viewport,
      pixels: 1024000, camera, cameraFrames, cameraExpected: camera, resourceCamera: expectedMobileResourceCamera(1.6) } };
  }
  const replay = await replayWaterEffectsDisplay(implementation, entry), hasEffects = Boolean(implementation.fishingEffectsBlob);
  const counters = (pass, calls, triangles) => ({ calls: calls + Object.values(replay.draws[pass]).reduce((n, d) => n + d.calls, 0),
    triangles: triangles + Object.values(replay.draws[pass]).reduce((n, d) => n + d.triangles, 0),
    geometries: 28 + Number(hasEffects), textures: 4, programs: 14 + Number(hasEffects) });
  entry.metrics.resources = counters('fixed', 20, 200000); entry.metrics.actualResources = counters('actual', 18, 199000);
  // The other 25 IDs retain their original marker draws (zero); warmup-only
  // effects still provide their complete buffer/material observation.
  const meshes = { ...replay.meshes, ...(replay.mesh ? { waterEffects: replay.mesh } : {}) };
  entry.metrics.fishingDisplay = { version: 1, phase: replay.phase, elapsed: replay.elapsed, meshes, line: replay.line ?? [0, 0, 0, 0, 0, 0],
    passes: { fixed: { resources: structuredClone(entry.metrics.resources), draws: replay.draws.fixed, camera: entry.metrics.resourceCamera },
      actual: { resources: structuredClone(entry.metrics.actualResources), draws: replay.draws.actual, camera: { ...entry.metrics.camera, fov: 55 } } } };
  return entry;
}

let fixturePromise;
export async function waterGateFixture() {
  if (!fixturePromise) fixturePromise = (async () => {
    const base = await readMobileImplementation(WATER_EFFECTS_BASE), head = await readMobileImplementation(waterFixtureCommit());
    const metadata = { mode: 'regression', baseSha: base.sha, headSha: head.sha, validationSha: head.sha,
      implementations: { main: mobileSourceMetadata(base), pr: mobileSourceMetadata(head) } };
    const before = [], after = [];
    for (const id of MOBILE_CAPTURE_IDS) { before.push(await waterCapture(base, id)); after.push(await waterCapture(head, id)); }
    const comparison = { metadata, rows: await compareMobileCapturesWithSources(before, after, metadata) };
    const names = ['comparison-metadata.json', 'main.json', 'pr.json', 'comparison.html', 'comparison.json',
      ...['main', 'pr'].flatMap(target => MOBILE_CAPTURE_IDS.flatMap(id => [`${target}-${id}.png`, `${target}-${id}.json`]))];
    return { metadata, before, after, comparison, files: Object.fromEntries(names.map(name => [`test-results/mobile-comparison/${name}`, 'synthetic-unit-manifest'])) };
  })();
  return JSON.parse(JSON.stringify(await fixturePromise));
}
