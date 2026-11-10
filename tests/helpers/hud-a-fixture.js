import { execFileSync } from 'node:child_process';
import { readMobileImplementation, mobileSourceMetadata, replayMobileCamera, expectedMobileResourceCamera } from '../../scripts/lib/mobile-comparison-source.js';
import { readMobileFightSource } from '../../scripts/lib/mobile-fight-replay.js';
import { HUD_A_BASE, HUD_A_SOURCES, HUD_A_IDS } from '../../scripts/lib/mobile-hud-a.js';
import geometry from '../../scripts/lib/mobile-hud-a-layouts.json' with { type: 'json' };
import { MOBILE_CAPTURE_IDS, compareMobileCapturesWithSources } from '../../scripts/compare-mobile-performance.mjs';

const git = (args, input) => execFileSync('git', args, { input, encoding: 'utf8' }).trim();
function replace(tree, parts, blob) {
  const entries = git(['ls-tree', '-z', tree]).split('\0').filter(Boolean);
  const index = entries.findIndex(entry => entry.split('\t')[1] === parts[0]);
  if (index < 0) throw Error(`Missing HUD fixture entry: ${parts[0]}`);
  const next = parts.length === 1 ? blob : replace(entries[index].split(/\s+/)[2], parts.slice(1), blob);
  entries[index] = `${parts.length === 1 ? '100644 blob' : '040000 tree'} ${next}\t${parts[0]}`;
  return git(['mktree', '-z'], entries.join('\0') + '\0');
}
// Synthetic commits from reviewed product blobs survive squash merges. This
// does not assume the future working HEAD or an unpublished WIP SHA as base.
export function hudAFixtureCommit(changes = {}, parents = [HUD_A_BASE]) {
  let tree = git(['rev-parse', `${HUD_A_BASE}^{tree}`]);
  for (const [path, blob] of Object.entries({ 'src/ui/style.css': HUD_A_SOURCES.after.hudBlob,
    'src/ui/cast-notices.js': '599beca0f497f83a9dc9d073ea7b9546d5a7c0f3', 'index.html': HUD_A_SOURCES.after.indexBlob })) tree = replace(tree, path.split('/'), blob);
  for (const [path, text] of Object.entries(changes)) tree = replace(tree, path.split('/'), git(['hash-object', '-w', '--stdin'], text));
  return git(['-c', 'user.name=HUD unit fixture', '-c', 'user.email=unit@example.invalid',
    'commit-tree', tree, ...parents.flatMap(sha => ['-p', sha])], 'Synthetic UX-B3 HUD contract\n');
}

const box = (x, y, width, height) => ({ x, y, width, height, left: x, top: y, right: x + width, bottom: y + height });
async function nativeHistory(id) {
  const source = await readMobileFightSource(HUD_A_BASE), rotated = id === 'rotated-fight';
  const viewport = geometry.pairs[id].viewport;
  let aspect = rotated ? 390 / 844 : viewport.width / viewport.height, elapsed = 0;
  const boat = { x: 10, z: 20, heading: 0 }, clock = source.createGameClock(undefined, { elapsedSeconds: 90 });
  const fishing = source.createFishing({ random: () => .5, getBoatPosition: () => boat,
    getEnvironment: position => ({ depthM: source.estimateWaterDepth(position), ...clock.state }) });
  const input = source.createFishingInput(fishing);
  const frames = [{ update: false, dt: 0, aspect, mode: 'sailing', phase: 'inactive', preparing: false, tracking: null }];
  function frame(dt, update = true) {
    if (update) { elapsed += dt; clock.step(dt); input.step(dt, elapsed * 1000); fishing.step(dt); }
    frames.push({ update, dt, aspect, mode: 'fishing', phase: fishing.state.phase, preparing: false,
      tracking: fishing.state.phase === 'fight' ? source.getLurePosition(fishing.state) : null });
  }
  for (let n = 0; n < 12; n++) frame(.25);
  fishing.prepare(boat, 0); frame(.25); fishing.aim(0, 150); frame(.25); fishing.cast();
  for (let n = 0; n < 480 && fishing.state.phase !== 'bite'; n++) frame(.25);
  if (!id.endsWith('bite')) {
    fishing.hook(); frame(.016);
    if (rotated) {
      input.down(0, 0, elapsed * 1000);
      for (let n = 0; n < 12 && fishing.state.tension <= .78; n++) frame(.25);
      input.up(elapsed * 1000);
      for (let n = 0; n < 16 && fishing.state.tension >= .18; n++) frame(.25);
      aspect = 844 / 390; frame(0, false);
    }
  }
  return { frames, fishing, source };
}

let pending;
export async function hudAGateFixture() {
  pending ??= (async () => {
    const base = await readMobileImplementation(HUD_A_BASE), head = await readMobileImplementation(hudAFixtureCommit());
    const metadata = { mode: 'regression', baseSha: base.sha, headSha: head.sha, validationSha: head.sha,
      implementations: { main: mobileSourceMetadata(base), pr: mobileSourceMetadata(head) } };
    const histories = Object.fromEntries(await Promise.all(HUD_A_IDS.map(async id => [id, await nativeHistory(id)])));
    async function entries(implementation, side) {
      return MOBILE_CAPTURE_IDS.map(id => {
        const hud = HUD_A_IDS.includes(id), data = histories[id], viewport = hud ? geometry.pairs[id].viewport : { width: 1280, height: 800 };
        const frames = hud ? data.frames : [{ update: false, dt: 0, aspect: viewport.width / viewport.height, mode: 'sailing', phase: 'inactive', preparing: false, tracking: null }];
        const camera = replayMobileCamera(implementation, frames);
        const panel = geometry.pairs[id]?.[side].panel ?? box(12, 200, 280, 100), f = data?.fishing.state;
        const layout = hud && { viewport, phase: f.phase, state: data.source.hudText[f.phase], tension: f.tension,
          warning: f.tension > .78 ? '離して緩める！' : f.tension < .18 ? '長押しで巻く！' : data.source.hudText.safeTension,
          conditions: '合成Unit: source clock/physics replay', panel, occupancy: panel.width * panel.height / (viewport.width * viewport.height) * 100,
          reticle: box(viewport.width / 2 - 6, viewport.height / 2 - 6, 12, 12), meter: box(0, 0, 0, 0),
          buttons: [], header: box(10, 10, 80, 25), notices: [], scrollWidth: viewport.width, pointerEvents: 'none', hit: 'scene', ...geometry.pairs[id][side] };
        return { id, image: `/synthetic-hud-unit/${side}-${id}.png`, ...(hud ? { layout } : {}),
          metrics: { viewport, dpr: 1, pixelRatio: 1, buffer: { ...viewport }, pixels: viewport.width * viewport.height,
            camera, cameraExpected: camera, resourceCamera: expectedMobileResourceCamera(camera.aspect), cameraFrames: frames, fishingRandomValue: .5,
            resources: { calls: 30, triangles: 200000, geometries: 28, textures: 4, programs: 14 },
            actualResources: { calls: 25, triangles: 199000, geometries: 28, textures: 4, programs: 14 } } };
      });
    }
    const before = await entries(base, 'before'), after = await entries(head, 'after');
    const comparison = { metadata, rows: await compareMobileCapturesWithSources(before, after, metadata) };
    const names = ['comparison-metadata.json', 'main.json', 'pr.json', 'comparison.html', 'comparison.json',
      ...['main', 'pr'].flatMap(target => MOBILE_CAPTURE_IDS.flatMap(id => [`${target}-${id}.png`, `${target}-${id}.json`]))];
    return { metadata, before, after, comparison,
      files: Object.fromEntries(names.map(name => [`test-results/mobile-comparison/${name}`, 'synthetic-unit-presence-only'])) };
  })();
  return structuredClone(await pending);
}
