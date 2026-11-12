import { execFileSync } from 'node:child_process';
import { SKY2_BASE, SKY2_STARS_BLOB, SKY2_CAPTURE_BLOB, SKY2_SNAPSHOT_BLOB, replayStarCapture } from '../../scripts/lib/sky2-source.js';
import { readMobileImplementation, mobileSourceMetadata, replayMobileCamera, expectedMobileResourceCamera } from '../../scripts/lib/mobile-comparison-source.js';
import { MOBILE_CAPTURE_IDS, compareMobileCapturesWithSources } from '../../scripts/compare-mobile-performance.mjs';
import { readMobileFightSource } from '../../scripts/lib/mobile-fight-replay.js';

const git = (args, input) => execFileSync('git', args, { input, encoding: 'utf8' }).trim();
function replace(tree, parts, blob) {
  const entries = git(['ls-tree', '-z', tree]).split('\0').filter(Boolean);
  const index = entries.findIndex(row => row.split('\t')[1] === parts[0]);
  const next = parts.length === 1 ? blob : replace(entries[index].split(/\s+/)[2], parts.slice(1), blob);
  const row = `${parts.length === 1 ? '100644 blob' : '040000 tree'} ${next}\t${parts[0]}`;
  if (index < 0) entries.push(row); else entries[index] = row;
  return git(['mktree', '-z'], entries.join('\0') + '\0');
}
export function sky2FixtureCommit(changes = {}) {
  let tree = git(['rev-parse', `${SKY2_BASE}^{tree}`]);
  for (const [path, blob] of Object.entries({ 'src/world/stars.js': SKY2_STARS_BLOB,
    'src/world/lake.js': '1714c24da8c6e71f803e65f015632b33346979a9',
    'tests/browser/mobile-performance.spec.js': SKY2_CAPTURE_BLOB, 'tests/helpers/star-snapshot.js': SKY2_SNAPSHOT_BLOB })) {
    tree = replace(tree, path.split('/'), blob);
  }
  for (const [path, value] of Object.entries(changes)) tree = replace(tree, path.split('/'), git(['hash-object', '-w', '--stdin'], value));
  return git(['-c', 'user.name=Sky-2 unit fixture', '-c', 'user.email=unit@example.invalid', 'commit-tree', tree, '-p', SKY2_BASE], 'Synthetic Sky-2 source contract fixture\n');
}
async function nativeCapture(implementation, id) {
  const source = await readMobileFightSource(implementation.sha), rotated = id === 'rotated-fight';
  let viewport = id.startsWith('pc') ? { width: 1280, height: 800 } : id.startsWith('small') ? { width: 360, height: 740 }
    : id.startsWith('landscape') ? { width: 844, height: 390 } : { width: 390, height: 844 };
  let aspect = viewport.width / viewport.height, elapsed = 0;
  const boat = { x: 10, z: 20, heading: 0 }, clock = source.createGameClock(undefined, { elapsedSeconds: 90 });
  const fishing = source.createFishing({ random: () => .01, getBoatPosition: () => boat,
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
    fishing.hook(); frame(.016);
    if (rotated) {
      input.down(0, 0, elapsed * 1000);
      for (let i = 0; i < 12 && fishing.state.tension <= .78; i++) frame(.25);
      input.up(elapsed * 1000);
      for (let i = 0; i < 16 && fishing.state.tension >= .18; i++) frame(.25);
      viewport = { width: 844, height: 390 }; aspect = viewport.width / viewport.height; frame(0, false);
    }
  }
  const camera = replayMobileCamera(implementation, frames), box = (x, y, width, height) => ({ x, y, width, height, left: x, top: y, right: x + width, bottom: y + height });
  const panel = box(12, 200, 280, 100);
  return { id, image: `/synthetic-unit/${id}.png`, metrics: { viewport, dpr: 1, pixelRatio: 1, buffer: viewport,
    pixels: viewport.width * viewport.height, cameraFrames: frames, camera, cameraExpected: camera,
    fishingRandomValue: .01, resourceCamera: expectedMobileResourceCamera(aspect),
    resources: { calls: 30, triangles: 275444, geometries: 28, textures: 4, programs: 15 },
    actualResources: { calls: 29, triangles: 270000, geometries: 28, textures: 4, programs: 15 } },
    layout: { viewport, phase: fishing.state.phase, state: id.endsWith('bite') ? source.hudText.bite : source.hudText.fight,
      tension: fishing.state.tension, warning: fishing.state.tension > .78 ? '離して緩める！' : fishing.state.tension < .18 ? '長押しで巻く！' : source.hudText.safeTension,
      panel, occupancy: 28000 / (viewport.width * viewport.height) * 100,
      reticle: box(viewport.width / 2 - 6, viewport.height / 2 - 6, 12, 12), meter: box(20, 240, 200, 18),
      buttons: [], header: box(10, 10, 80, 25), notices: [], scrollWidth: viewport.width, pointerEvents: 'none', hit: 'scene' } };
}
export async function starCapture(implementation, id) {
  let entry;
  if (/-bite$|-fight$/.test(id)) entry = await nativeCapture(implementation, id);
  else {
    const profile = id.split('-')[0], viewport = profile === 'portrait' ? { width: 390, height: 844 }
      : profile === 'landscape' ? { width: 844, height: 390 } : profile === 'small' ? { width: 360, height: 740 } : { width: 1280, height: 800 };
    const cameraFrames = [{ update: false, dt: 0, aspect: viewport.width / viewport.height,
      mode: id.endsWith('day-fps') ? 'fishing' : 'sailing', phase: id.endsWith('day-fps') ? 'ready' : 'inactive', preparing: false, tracking: null }];
    const camera = replayMobileCamera(implementation, cameraFrames);
    entry = { id, image: `/synthetic-unit/${id}.png`, metrics: { viewport, dpr: 1, pixelRatio: 1,
      buffer: viewport, pixels: viewport.width * viewport.height, cameraFrames, camera, cameraExpected: camera,
      resourceCamera: expectedMobileResourceCamera(camera.aspect),
      resources: { calls: 31, triangles: 275444, geometries: 26, textures: 4, programs: 15 },
      actualResources: { calls: 31, triangles: 275444, geometries: 26, textures: 4, programs: 15 } } };
  }
  const m = entry.metrics;
  m.savedClockSeconds = id.endsWith('clear-night') ? 1710 : id.endsWith('fog-night') ? 3971 * 360 + 270 : id.endsWith('dense-night') ? 630 : 90;
  m.cameraFrames = m.cameraFrames.map(frame => ({ ...frame, clockDt: frame.dt }));
  m.starDisplay = { clockSeconds: m.savedClockSeconds + m.cameraFrames.reduce((sum, frame) => sum + (frame.update ? frame.dt : 0), 0) };
  const replay = await replayStarCapture(implementation, m);
  m.starDisplay.snapshot = replay.snapshot; m.starDisplay.draws = replay.draws;
  for (const [key, pass] of [['resources', 'fixed'], ['actualResources', 'actual']]) {
    m[key].calls += replay.draws[pass]; m[key].geometries += Number(replay.initialized); m[key].programs += Number(replay.initialized);
  }
  m.fixedResources = structuredClone(m.resources);
  return entry;
}
let fixture;
export async function starGateFixture() {
  if (!fixture) fixture = (async () => {
    const main = await readMobileImplementation(SKY2_BASE), pr = await readMobileImplementation(sky2FixtureCommit());
    const metadata = { mode: 'regression', baseSha: main.sha, headSha: pr.sha, validationSha: pr.sha,
      implementations: { main: mobileSourceMetadata(main), pr: mobileSourceMetadata(pr) } };
    const before = [], after = [];
    for (const id of MOBILE_CAPTURE_IDS) { before.push(await starCapture(main, id)); after.push(await starCapture(pr, id)); }
    const comparison = { metadata, rows: await compareMobileCapturesWithSources(before, after, metadata) };
    const names = ['comparison-metadata.json', 'main.json', 'pr.json', 'comparison.html', 'comparison.json',
      ...['main', 'pr'].flatMap(target => MOBILE_CAPTURE_IDS.flatMap(id => [`${target}-${id}.png`, `${target}-${id}.json`]))];
    return { metadata, before, after, comparison, files: Object.fromEntries(names.map(name => [`test-results/mobile-comparison/${name}`, 'synthetic-unit-manifest'])) };
  })();
  return JSON.parse(JSON.stringify(await fixture));
}
