import { execFileSync } from 'node:child_process';
import { readMobileImplementation, mobileSourceMetadata, replayMobileCamera, expectedMobileResourceCamera } from '../../scripts/lib/mobile-comparison-source.js';
import { readMobileFightSource } from '../../scripts/lib/mobile-fight-replay.js';
import { FISHING_PHASE_BASE, FISHING_PHASE_IDS, replayFishingPhaseDisplay } from '../../scripts/lib/mobile-rod-reel-replay.js';
import { MOBILE_CAPTURE_IDS, compareMobileCapturesWithSources } from '../../scripts/compare-mobile-performance.mjs';

// The reviewed product blob survives squash merges. No WIP commit, generated
// screenshot, cache directory or current-HEAD game implementation is a fixture.
export const PHASE_VIEW_BLOB = 'e155d7f57d153ab6f3e9c04f30e29225d7a201f4';
const git = (args, input) => execFileSync('git', args, { encoding: 'utf8', input }).trim();
function replaceFile(tree, parts, blob) {
  const entries = git(['ls-tree', '-z', tree]).split('\0').filter(Boolean);
  const index = entries.findIndex(entry => entry.split('\t')[1] === parts[0]);
  if (index < 0) throw new Error(`Missing fixture tree entry: ${parts[0]}`);
  const next = parts.length === 1 ? blob : replaceFile(entries[index].split(/\s+/)[2], parts.slice(1), blob);
  entries[index] = `${parts.length === 1 ? '100644 blob' : '040000 tree'} ${next}\t${parts[0]}`;
  return git(['mktree', '-z'], entries.join('\0') + '\0');
}
export function phaseFixtureCommit(changes = {}, parents = [FISHING_PHASE_BASE]) {
  let tree = git(['rev-parse', `${FISHING_PHASE_BASE}^{tree}`]);
  tree = replaceFile(tree, ['src', 'rendering', 'fishing.js'], PHASE_VIEW_BLOB);
  for (const [path, source] of Object.entries(changes)) {
    tree = replaceFile(tree, path.split('/'), git(['hash-object', '-w', '--stdin'], source));
  }
  return git(['-c', 'user.name=Display unit fixture', '-c', 'user.email=unit@example.invalid',
    'commit-tree', tree, ...parents.flatMap(sha => ['-p', sha])], 'Synthetic display contract fixture\n');
}

async function nativeHistory(id, firstFightDt) {
  const source = await readMobileFightSource(FISHING_PHASE_BASE);
  const rotated = id === 'rotated-fight';
  const size = id.startsWith('pc') ? [1280, 800] : id.startsWith('small') ? [360, 740]
    : id.startsWith('landscape') ? [844, 390] : [390, 844];
  let aspect = size[0] / size[1], elapsed = 0;
  const boat = { x: 10, z: 20, heading: 0 }, clock = source.createGameClock(undefined, { elapsedSeconds: 90 });
  const fishing = source.createFishing({ random: () => .5, getBoatPosition: () => boat,
    getEnvironment: position => ({ depthM: source.estimateWaterDepth(position), ...clock.state }) });
  const input = source.createFishingInput(fishing);
  const frames = [{ update: false, dt: 0, aspect, mode: 'sailing', phase: 'inactive', preparing: false, tracking: null }];
  const frame = (dt, update = true) => {
    if (update) { elapsed += dt; clock.step(dt); input.step(dt, elapsed * 1000); fishing.step(dt); }
    frames.push({ update, dt, aspect, mode: 'fishing', phase: fishing.state.phase, preparing: false,
      tracking: fishing.state.phase === 'fight' ? source.getLurePosition(fishing.state) : null });
  };
  for (let i = 0; i < 12; i++) frame(.25);
  fishing.prepare(boat, 0); frame(.25); fishing.aim(0, 150); frame(.25); fishing.cast();
  for (let i = 0; i < 480 && fishing.state.phase !== 'bite'; i++) frame(.25);
  if (!id.endsWith('bite')) {
    fishing.hook(); frame(firstFightDt);
    if (rotated) {
      input.down(0, 0, elapsed * 1000);
      for (let i = 0; i < 12 && fishing.state.tension <= .78; i++) frame(.25);
      input.up(elapsed * 1000);
      for (let i = 0; i < 16 && fishing.state.tension >= .18; i++) frame(.25);
      aspect = 844 / 390; frame(0, false);
    }
  }
  return { frames, viewport: rotated ? { width: 844, height: 390 } : { width: size[0], height: size[1] },
    tension: fishing.state.tension, warning: fishing.state.tension > .78 ? '離して緩める！'
      : fishing.state.tension < .18 ? '長押しで巻く！' : source.hudText.safeTension, text: source.hudText };
}

export async function phaseCapture(implementation, id, firstFightDt = .016) {
  const native = await nativeHistory(id, firstFightDt), viewport = native.viewport;
  const camera = replayMobileCamera(implementation, native.frames);
  const entry = { id, metrics: { viewport, dpr: id.startsWith('pc') ? 1 : 2, pixelRatio: 1,
    buffer: { ...viewport }, pixels: viewport.width * viewport.height,
    camera, cameraExpected: structuredClone(camera), resourceCamera: expectedMobileResourceCamera(camera.aspect),
    cameraFrames: native.frames }, image: `/synthetic-unit/${id}.png` };
  const replay = await replayFishingPhaseDisplay(implementation, entry);
  const counters = (pass, calls, triangles) => ({ calls: calls + Object.values(replay.draws[pass]).reduce((n, draw) => n + draw.calls, 0),
    triangles: triangles + Object.values(replay.draws[pass]).reduce((n, draw) => n + draw.triangles, 0), geometries: 28, textures: 4, programs: 14 });
  entry.metrics.resources = counters('fixed', 30, 200000);
  entry.metrics.actualResources = counters('actual', 25, 199000);
  entry.metrics.fishingDisplay = { version: 1, phase: replay.phase, elapsed: replay.elapsed, meshes: replay.meshes, line: replay.line,
    passes: { fixed: { resources: structuredClone(entry.metrics.resources), draws: replay.draws.fixed, camera: entry.metrics.resourceCamera },
      actual: { resources: structuredClone(entry.metrics.actualResources), draws: replay.draws.actual, camera: { ...camera, fov: 55 } } } };
  const box = (x, y, width, height) => ({ x, y, width, height, left: x, top: y, right: x + width, bottom: y + height });
  const panel = box(12, 200, 280, 100);
  entry.layout = { viewport, phase: replay.phase, state: replay.phase === 'bite' ? native.text.bite : native.text.fight,
    tension: native.tension, warning: native.warning, panel, occupancy: 28000 / entry.metrics.pixels * 100,
    reticle: box(viewport.width / 2 - 6, viewport.height / 2 - 6, 12, 12), meter: box(20, 240, 200, 18), buttons: [],
    header: box(10, 10, 80, 25), notices: [], scrollWidth: viewport.width, pointerEvents: 'none', hit: 'scene' };
  return entry;
}

let fixturePromise;
export async function fishingPhaseGateFixture() {
  if (!fixturePromise) fixturePromise = (async () => {
    const base = await readMobileImplementation(FISHING_PHASE_BASE), head = await readMobileImplementation(phaseFixtureCommit());
    const metadata = { mode: 'regression', baseSha: base.sha, headSha: head.sha, validationSha: head.sha,
      implementations: { main: mobileSourceMetadata(base), pr: mobileSourceMetadata(head) } };
    const captures = async implementation => Promise.all(MOBILE_CAPTURE_IDS.map(async id => {
      if (FISHING_PHASE_IDS.includes(id)) return phaseCapture(implementation, id);
      const frames = [{ update: false, dt: 0, aspect: 1.6, mode: 'sailing', phase: 'inactive', preparing: false, tracking: null }];
      const camera = replayMobileCamera(implementation, frames);
      return { id, metrics: { viewport: { width: 1280, height: 800 }, dpr: 1, pixelRatio: 1,
        buffer: { width: 1280, height: 800 }, pixels: 1024000, camera, cameraExpected: camera,
        resourceCamera: expectedMobileResourceCamera(1.6), cameraFrames: frames,
        resources: { calls: 30, triangles: 200000, geometries: 28, textures: 4, programs: 14 },
        actualResources: { calls: 25, triangles: 199000, geometries: 28, textures: 4, programs: 14 } }, image: `/synthetic-unit/${id}.png` };
    }));
    const before = await captures(base), after = await captures(head);
    const comparison = { metadata, rows: await compareMobileCapturesWithSources(before, after, metadata) };
    const names = ['comparison-metadata.json', 'main.json', 'pr.json', 'comparison.html', 'comparison.json',
      ...['main', 'pr'].flatMap(target => MOBILE_CAPTURE_IDS.flatMap(id => [`${target}-${id}.png`, `${target}-${id}.json`]))];
    return { metadata, before, after, comparison, files: Object.fromEntries(names.map(name => [`test-results/mobile-comparison/${name}`, 'synthetic-unit-manifest'])) };
  })();
  // Match separately serialized capture/report JSON, without shared aliases.
  return JSON.parse(JSON.stringify(await fixturePromise));
}
