import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { HISTORICAL_MOBILE_BASE, readMobileImplementation, mobileSourceMetadata, replayMobileCamera,
  mobileGit, expectedMobileResourceCamera } from './lib/mobile-comparison-source.js';
import { verifyMobileFightCapture } from './lib/mobile-fight-replay.js';
import { readMobileRodReelTransition, readMobileCastDisplayTransition, expectedRodReelResources, verifyRodReelCapture,
  readMobileFishingPhaseTransition, verifyFishingPhaseCapture, expectedFishingPhaseResources, FISHING_PHASE_IDS } from './lib/mobile-rod-reel-replay.js';
import { readMobileWaterEffectsTransition, verifyWaterEffectsCapture, expectedWaterEffectsResources,
  WATER_EFFECTS_BASE, WATER_EFFECTS_BLOB } from './lib/mobile-water-effects-replay.js';
import { readSky2Transition, verifyStarCapture, expectedStarResources } from './lib/sky2-source.js';
import { readSky3Transition, verifyMeteorCapture, expectedMeteorResources } from './lib/sky3-source.js';
import { verifyAuroraCapture, expectedAuroraResources } from './lib/sky4-source.js';
import { readAuroraTransition } from './lib/sky4-motion-source.js';

export const MOBILE_COMPARISON_MODES = ['regression', 'historical-improvement'];
// One reviewed product-source transition, not a per-PR resource allowance.
// sourceTree covers all src files, including water/lights/boat/fishing. Root
// build inputs must also match. A future source tree falls back to exact equality.
const SHARED_B = {
  baseSha: '6c92a1c6d004580144db72011bf5999fa5a2e651',
  before: { sourceTree: 'f82f21d7f502afcc69580e9240a3ee61b260f4df', terrainBlob: 'fe35f303bd66416de3c84fc91fbc04d8e093fb3a', crownTextureBlob: null },
  after: { sourceTree: 'b2b8cd1d51494a6332633c59f1ad580cd489a151', terrainBlob: '4035462c3a09c46e20510e86a663da9d772a5d07', crownTextureBlob: 'f867ba84e5ed9727004ba313232078d61469c25d' },
  build: { lockBlob: '47245ebaa299d7e7521020579099984095cc556d', indexBlob: '4f4a23265ef8e4a7bf2e74afedd5fc41ce585651', viteBlob: 'b0d324b56a47ba5b7ff1b0580db1f6a9f2d3fcb3' },
};

const FOREST_DENSITY = {
  baseSha: '89de7dd3ba9fdfb3bb736c9d23ab62e7fdfc6b02',
  before: { sourceTree: '1c769c1d52837741b46449e992037b46db83011c', terrainBlob: '92e5dd83fbfedfd0b3f50d6528375e66c8299e8f', crownTextureBlob: 'f867ba84e5ed9727004ba313232078d61469c25d' },
  after: { sourceTree: '62a706d6e942b955a8100022677cb343fbe56c21', terrainBlob: 'd2cd4ccf2a97d788c807f778c300ba4d1414641d', crownTextureBlob: 'f867ba84e5ed9727004ba313232078d61469c25d' },
};

export function expectedMobileResources(before, metadata) {
  const { main, pr } = metadata.implementations;
  const matches = (source, identity) => Object.entries(identity).every(([key, value]) => source[key] === value);
  const density = metadata.mode === 'regression' && metadata.baseSha === FOREST_DENSITY.baseSha
    && main.sha === metadata.baseSha && pr.sha === metadata.validationSha
    && matches(main, FOREST_DENSITY.before) && matches(pr, FOREST_DENSITY.after)
    && matches(main, SHARED_B.build) && matches(pr, SHARED_B.build);
  if (density) {
    assert.equal(before.textures, 4, 'Forest transition requires the verified shared-B base');
    // 250 additional instances, exactly 20 trunk + 196 crown triangles each.
    // Whole src/build identities bind the exception to this one transition.
    return { resources: { ...before, triangles: before.triangles + 250 * 216 },
      transition: 'forest-G2.5: triangles +54000, all other resources exact' };
  }
  const sharedB = metadata.mode === 'regression' && metadata.baseSha === SHARED_B.baseSha
    && main.sha === metadata.baseSha && pr.sha === metadata.validationSha
    && matches(main, SHARED_B.before) && matches(pr, SHARED_B.after)
    && matches(main, SHARED_B.build) && matches(pr, SHARED_B.build);
  if (!sharedB) return { resources: before, transition: null };
  assert.equal(before.textures, 3, 'Shared B transition requires the verified three-texture base');
  // Reusing one material replaces the old foliage shader: no program delta.
  return { resources: { ...before, textures: 4 }, transition: 'shared-crown-B: texture +1, all other resources exact' };
}
export const MOBILE_CAPTURE_IDS = [
  ...['portrait', 'landscape', 'small', 'pc', 'pc-hidpi'].flatMap(profile =>
    ['day-tps', 'day-fps', 'clear-night', 'fog-night', 'dense-night'].map(scene => `${profile}-${scene}`)),
  ...['portrait', 'landscape', 'small', 'pc'].flatMap(profile => [`${profile}-bite`, `${profile}-fight`]),
  'rotated-fight',
];
const separated = (a, b, margin) => a.right + margin <= b.left || b.right + margin <= a.left
  || a.bottom + margin <= b.top || b.bottom + margin <= a.top;

function checkLayout(s, id) {
  assert(s, `${id}: missing HUD layout`);
  const p = s.panel;
  assert(p.left >= 8 && p.top >= 8 && p.right <= s.viewport.width - 8 && p.bottom <= s.viewport.height - 8, `${id}: HUD outside viewport`);
  assert.equal(s.occupancy, p.width * p.height / (s.viewport.width * s.viewport.height) * 100, `${id}: HUD occupancy`);
  assert(separated(p, s.reticle, 12), `${id}: HUD overlaps reticle`);
  for (const r of [...s.buttons, s.header, ...s.notices]) assert(separated(p, r, 8), `${id}: HUD overlaps controls/header/notices`);
  assert.equal(s.pointerEvents, 'none', `${id}: HUD blocks input`);
  assert.equal(s.hit, 'scene', `${id}: HUD hit target`);
  assert.equal(s.scrollWidth, s.viewport.width, `${id}: horizontal overflow`);
}

function checkCamera(actual, expected, id) {
  assert(expected, `${id}: missing source-replayed camera`);
  assert.equal(actual.aspect, expected.aspect, `${id}: camera aspect differs from source`);
  for (const key of ['position', 'quaternion']) {
    assert.equal(actual[key].length, expected[key].length, `${id}: camera ${key} dimensions`);
    actual[key].forEach((v, i) => assert(Math.abs(v - expected[key][i]) <= 1e-10, `${id}: camera ${key}[${i}] differs from source`));
  }
}

const box = (x, y, width, height) => ({ x, y, width, height, top: y, right: x + width, bottom: y + height, left: x });

// Removing BITE's 30px hint row and its 8px gap raises the return button;
// portrait FIGHT's 18px hint and 8px margin collapse above that button.
// Bind those display differences to the reviewed source blobs;
// do not grant a layout allowance to later HUD/CSS/index changes.
export async function readFishingHintRemoval(main, pr) {
  if (main.sha !== '87c7822e0dd0af71e08baa3b92e2e85f23fae897'
    || main.hudLogicBlob !== '1d07d872d4540490ca72883584026b4f2f302b26'
    || pr.hudLogicBlob !== '43e7908b9bfe9be76ec044f85a77a6302a160871'
    || main.hudBlob !== 'ffcae1f9a3a05756cbe8c4d1120fd533c3f42608' || pr.hudBlob !== main.hudBlob
    || main.indexBlob !== '893848201e58ed949b2ef0a12bced9b71bda2c34'
    || pr.indexBlob !== 'b6ee30353cb2176c7f96c6717800e35c2dbf1da5') return null;
  const [before, after] = await Promise.all([main, pr].map(source => mobileGit('rev-parse', `${source.sha}:src/ui/hud.js`)));
  if (before !== '35fecd7d9a6aecd51e166d4e5c1a8b7b4d32503e' || after !== '883d74243f3974795f6cca5c8fb7259d0228b201') return null;
  return { kind: 'fishing-hint-removal-5E2B', baseSha: main.sha, validationSha: pr.sha,
    beforeHud: main.hudLogicBlob, afterHud: pr.hudLogicBlob, returnOffsetY: -38, fightOffsetY: 26 };
}

function checkUpperCastBiteLayout(s, id) {
  const { width, height } = s.viewport, portrait = width <= 640 && height > 500;
  const mobile = width <= 640 || height <= 500;
  const left = mobile ? 22 : 42, top = portrait ? 88 : height <= 500 ? 84 : 100;
  const panelWidth = portrait ? width - 44 : 320;
  // These fixed comparison profiles fit BITE's condition text on one line:
  // 27px state + 18px distance + 18px conditions,
  // two 6px row gaps, 20px padding, and the existing 2px BITE border.
  assert.deepEqual(s.panel, box(left, top, panelWidth, 99), `${id}: cast HUD panel placement`);
  const actionLeft = portrait ? left : width - left - 420;
  const actionTop = portrait ? top + s.panel.height + 8 : top;
  const actionWidth = portrait ? panelWidth : 420;
  const back = s.buttons.find(button => button.id === 'return-button');
  assert.deepEqual(back, { id: 'return-button', ...box(actionLeft, actionTop + 38, (actionWidth - 8) / 2, 50) }, `${id}: cast return button placement`);
}

function checkMetadata(metadata) {
  assert(MOBILE_COMPARISON_MODES.includes(metadata.mode), 'Unknown mobile comparison mode');
  for (const key of ['baseSha', 'headSha', 'validationSha']) assert.match(metadata[key] ?? '', /^[a-f0-9]{40}$/, `Missing ${key}`);
}

export function compareMobileCaptures(before, after, metadata, sources) {
  checkMetadata(metadata);
  if (metadata.mode === 'historical-improvement') {
    assert.equal(metadata.baseSha, HISTORICAL_MOBILE_BASE, 'Historical comparison requires the explicit pre-4C-2A SHA');
    assert.equal(metadata.implementations.main.resolutionModel, 'legacy-1.75');
    assert.equal(metadata.implementations.pr.resolutionModel, 'mobile-budget');
  }
  assert.equal(before.length, 34, 'Expected all 25 render and 9 HUD captures');
  assert.equal(before.length, after.length);
  for (const entries of [before, after]) assert.deepEqual(entries.map(c => c.id).sort(), [...MOBILE_CAPTURE_IDS].sort(), 'Missing/duplicate mobile capture');
  return before.map(b => compareMobileCapturePair(b, after.find(a => a.id === b.id), metadata, sources));
}

// Also used by selected local pairs. Serialized cameraExpected is never the
// authority: both camera and FIGHT are replayed from each exact Git SHA.
export async function verifyMobileSourceCapture(implementation, entry) {
  const m = entry.metrics, camera = replayMobileCamera(implementation, m.cameraFrames);
  assert.equal(camera.aspect, m.viewport.width / m.viewport.height, `${entry.id}: source camera viewport`);
  checkCamera(m.camera, camera, entry.id);
  if (m.cameraExpected) checkCamera(m.cameraExpected, camera, `${entry.id}: recorded expected`);
  checkCamera(m.resourceCamera, expectedMobileResourceCamera(camera.aspect), `${entry.id}: resource camera`);
  assert.equal(m.resourceCamera.fov, 55, `${entry.id}: resource camera FOV`);
  return { camera, fight: await verifyMobileFightCapture(implementation, entry) };
}

async function readComparisonSources(metadata) {
  checkMetadata(metadata);
  assert.equal(metadata.implementations.main.sha, metadata.baseSha, 'main: base SHA differs');
  assert.equal(metadata.implementations.pr.sha, metadata.validationSha, 'pr: validation SHA differs');
  if (metadata.validationSha !== metadata.headSha) {
    const parents = (await mobileGit('show', '-s', '--format=%P', metadata.validationSha)).split(' ');
    assert.deepEqual(parents, [metadata.baseSha, metadata.headSha], 'Validation SHA is not the recorded base/HEAD merge');
  } else if (metadata.baseSha !== metadata.headSha) {
    assert.equal(await mobileGit('merge-base', metadata.baseSha, metadata.headSha), metadata.baseSha, 'Base is not an ancestor of local HEAD');
  }
  const implementations = {};
  for (const [target, sha] of [['main', metadata.baseSha], ['pr', metadata.validationSha]]) {
    implementations[target] = await readMobileImplementation(sha);
    assert.deepEqual(metadata.implementations[target], mobileSourceMetadata(implementations[target]), `${target}: implementation provenance differs`);
  }
  const [rodReelTransition, castDisplayTransition, fishingHintRemoval, fishingPhaseTransition, waterEffectsTransition] = await Promise.all([
    readMobileRodReelTransition(implementations.main, implementations.pr),
    readMobileCastDisplayTransition(implementations.main, implementations.pr),
    readFishingHintRemoval(implementations.main, implementations.pr),
    readMobileFishingPhaseTransition(implementations.main, implementations.pr),
    readMobileWaterEffectsTransition(implementations.main, implementations.pr),
  ]);
  const sky2Transition = await readSky2Transition(implementations.main, implementations.pr);
  const sky3Transition = await readSky3Transition(implementations.main, implementations.pr);
  const sky4Transition = await readAuroraTransition(implementations.main, implementations.pr, metadata.headSha);
  return { implementations, verified: new Map(), rodReelTransition, castDisplayTransition, fishingHintRemoval, fishingPhaseTransition, waterEffectsTransition, sky2Transition, sky3Transition, sky4Transition };
}

async function verifyEntries(sources, target, entries) {
  for (const entry of entries) {
    if (sources.rodReelTransition || sources.castDisplayTransition) verifyRodReelCapture(entry);
    const verified = await verifyMobileSourceCapture(sources.implementations[target], entry);
    if (sources.fishingPhaseTransition) verified.fishingPhase = await verifyFishingPhaseCapture(sources.implementations[target], entry);
    if (sources.waterEffectsTransition) verified.waterEffects = await verifyWaterEffectsCapture(sources.implementations[target], entry);
    if (sources.sky2Transition || sources.sky3Transition || sources.sky4Transition) verified.stars = await verifyStarCapture(sources.implementations[target], entry);
    if (sources.sky3Transition || sources.sky4Transition) verified.meteor = await verifyMeteorCapture(sources.implementations[target], entry);
    if (sources.sky4Transition) verified.aurora = await verifyAuroraCapture(sources.implementations[target], entry);
    sources.verified.set(entry, verified);
  }
}

export async function compareMobileCapturePairWithSources(before, after, metadata) {
  const sources = await readComparisonSources(metadata);
  await verifyEntries(sources, 'main', [before]); await verifyEntries(sources, 'pr', [after]);
  return compareMobileCapturePair(before, after, metadata, sources);
}

export async function compareMobileCapturesWithSources(before, after, metadata) {
  const sources = await readComparisonSources(metadata);
  await verifyEntries(sources, 'main', before); await verifyEntries(sources, 'pr', after);
  return compareMobileCaptures(before, after, metadata, sources);
}

function compareRotatedFightCamera(before, after, metadata, sources) {
  assert.equal(metadata.mode, 'regression', 'rotated-fight: requires regression mode');
  for (const key of ['cameraBlob', 'hudBlob', 'hudLogicBlob', 'resolutionBlob']) {
    assert.equal(metadata.implementations.main[key], metadata.implementations.pr[key], `rotated-fight: ${key} differs`);
  }
  if (metadata.implementations.main.fishingViewBlob !== metadata.implementations.pr.fishingViewBlob) {
    assert(sources.castDisplayTransition || sources.fishingPhaseTransition || sources.waterEffectsTransition, 'rotated-fight: fishingViewBlob differs without a source-verified display transition');
    if (sources.waterEffectsTransition) checkWaterEffectsProof(sources.waterEffectsTransition, metadata);
    else if (sources.fishingPhaseTransition) checkFishingPhaseProof(sources.fishingPhaseTransition, metadata);
    else checkCastDisplayProof(sources.castDisplayTransition, metadata);
  }
  const b = sources.verified.get(before), a = sources.verified.get(after);
  assert(b?.fight && a?.fight, 'rotated-fight: missing source FIGHT verification');
  assert.deepEqual(after.metrics.camera.position, before.metrics.camera.position, 'rotated-fight: camera position differs');
  assert.equal(after.metrics.camera.aspect, before.metrics.camera.aspect, 'rotated-fight: camera aspect differs');
  assert(!isDeepStrictEqual(a.camera, b.camera), 'rotated-fight: same source pose cannot explain a camera difference');
  // Normalize both tracking AND time inputs. Check both actual histories with
  // both source rigs; this does not replace either side's actual-frame replay.
  for (const entry of [before, after]) {
    assert.deepEqual(replayMobileCamera(sources.implementations.main, entry.metrics.cameraFrames),
      replayMobileCamera(sources.implementations.pr, entry.metrics.cameraFrames), 'rotated-fight: normalized source camera regression');
  }
  assert.deepEqual(after.metrics.resourceCamera, before.metrics.resourceCamera, 'rotated-fight: diagnostic resource camera differs');
  return { kind: 'source-replayed-fight-tracking', normalizedHistories: 2,
    before: b.fight, after: a.fight };
}

function checkCastDisplayProof(proof, metadata) {
  assert.equal(metadata.mode, 'regression', 'Cast display requires regression mode');
  assert.equal(proof.kind, 'rod-tip-display-5D2', 'Unknown cast display proof');
  assert.equal(proof.baseSha, metadata.baseSha, 'Cast display proof base differs');
  assert.equal(proof.validationSha, metadata.validationSha, 'Cast display proof validation differs');
  assert.equal(proof.resources, 'exact', 'Cast display grants no resource allowance');
  for (const [target, side] of [['main', 'before'], ['pr', 'after']]) {
    for (const key of ['mainBlob', 'fishingViewBlob']) {
      assert.equal(proof[side][key], metadata.implementations[target][key], `Cast display ${target} ${key} proof differs`);
    }
  }
}

function checkFishingPhaseProof(proof, metadata) {
  assert.equal(metadata.mode, 'regression', '5F-1A: requires regression mode');
  assert.equal(proof.kind, 'fishing-phase-5F1A', '5F-1A: unknown proof');
  assert.equal(proof.baseSha, metadata.baseSha, '5F-1A: proof base differs');
  assert.equal(proof.validationSha, metadata.validationSha, '5F-1A: proof validation differs');
  for (const [target, side] of [['main', 'before'], ['pr', 'after']]) {
    assert.equal(proof[side].fishingViewBlob, metadata.implementations[target].fishingViewBlob, '5F-1A: proof source differs');
  }
}

function checkWaterEffectsProof(proof, metadata) {
  assert.equal(metadata.mode, 'regression', '5F-1B: requires regression mode');
  assert.equal(proof.kind, 'water-effects-5F1B');
  assert.equal(proof.baseSha, WATER_EFFECTS_BASE); assert.equal(proof.baseSha, metadata.baseSha);
  assert.equal(proof.validationSha, metadata.validationSha);
  assert.equal(proof.after.fishingEffectsBlob, WATER_EFFECTS_BLOB);
  assert.deepEqual(proof.resources, { geometries: 1, materials: 1, textures: 0, programs: 1, maximumCalls: 1, maximumTriangles: 1152 });
  for (const [target, side] of [['main', 'before'], ['pr', 'after']]) {
    for (const key of ['mainBlob', 'fishingViewBlob', 'fishingEffectsBlob']) assert.equal(proof[side][key], metadata.implementations[target][key], `5F-1B: ${key} proof differs`);
  }
}

// Local selection can verify its real pairs with the same rules without
// presenting them as the complete 34-pair report required by PR CI.
export function compareMobileCapturePair(b, a, metadata, sources) {
    checkMetadata(metadata);
    const castDisplay = sources?.castDisplayTransition;
    if (castDisplay) checkCastDisplayProof(castDisplay, metadata);
    const phaseDisplay = sources?.fishingPhaseTransition;
    if (phaseDisplay) checkFishingPhaseProof(phaseDisplay, metadata);
    const waterEffects = sources?.waterEffectsTransition;
    if (waterEffects) checkWaterEffectsProof(waterEffects, metadata);
    const hintRemoval = sources?.fishingHintRemoval;
    if (hintRemoval) {
      assert.equal(hintRemoval.kind, 'fishing-hint-removal-5E2B');
      assert.equal(hintRemoval.baseSha, metadata.baseSha); assert.equal(hintRemoval.validationSha, metadata.validationSha);
      assert.equal(hintRemoval.beforeHud, metadata.implementations.main.hudLogicBlob);
      assert.equal(hintRemoval.afterHud, metadata.implementations.pr.hudLogicBlob);
      assert.equal(hintRemoval.returnOffsetY, -38);
      assert.equal(hintRemoval.fightOffsetY, 26);
    }
    let cameraComparison;
    assert.equal(a?.id, b.id, `Missing comparison ${b.id}`);
    assert(a, `Missing comparison ${b.id}`);
    for (const entry of [b, a]) {
      if (entry.comparison) assert.deepEqual(entry.comparison, metadata, `${b.id}: mixed comparison provenance`);
      const m = entry.metrics;
      assert.deepEqual(m.buffer, { width: Math.floor(m.viewport.width * m.pixelRatio), height: Math.floor(m.viewport.height * m.pixelRatio) }, `${b.id}: drawing buffer dimensions`);
      assert.equal(m.pixels, m.buffer.width * m.buffer.height, `${b.id}: drawing buffer pixels`);
    }
    for (const key of ['viewport', 'dpr', 'savedClockSeconds', 'boat', 'waterTime', 'fogStrength', 'fishingRandomValue']) {
      assert.deepEqual(a.metrics[key], b.metrics[key], `${b.id}: ${key} differs`);
    }
    if (a.metrics.resourceCamera || b.metrics.resourceCamera) {
      assert.deepEqual(a.metrics.resourceCamera, b.metrics.resourceCamera, `${b.id}: diagnostic resource camera differs`);
    }
    const changedCamera = metadata.implementations.main.cameraBlob !== metadata.implementations.pr.cameraBlob;
    if (changedCamera) {
      for (const entry of [b, a]) checkCamera(entry.metrics.camera, entry.metrics.cameraExpected, entry.id);
      assert.deepEqual(a.metrics.resourceCamera, b.metrics.resourceCamera, `${b.id}: diagnostic resource camera differs`);
      assert(a.metrics.resourceCamera, `${b.id}: missing diagnostic resource camera`);
      if (b.id.endsWith('bite') && metadata.implementations.pr.cameraModel === 'prepared-horizontal-aft-1.25') {
        checkCamera(a.metrics.camera, { position: [10, 2.15, 21.25], quaternion: [0, 0, 0, 1], aspect: a.metrics.camera.aspect }, b.id);
      }
    } else if (sources && b.id === 'rotated-fight' && !isDeepStrictEqual(a.metrics.camera, b.metrics.camera)) {
      cameraComparison = compareRotatedFightCamera(b, a, metadata, sources);
    } else assert.deepEqual(a.metrics.camera, b.metrics.camera, `${b.id}: camera differs`);
    const gearTransition = sources?.rodReelTransition;
    const gearResources = expectedRodReelResources(b.metrics.resources, b.id, gearTransition);
    let expected = gearResources ? { resources: gearResources,
      transition: 'rod-reel-5D1: exact-source Lv1 mesh counts; all other resources exact' }
      : expectedMobileResources(b.metrics.resources, metadata);
    let fishingPhaseComparison;
    let waterEffectsComparison;
    let starComparison;
    let meteorComparison;
    let auroraComparison;
    if (sources?.sky4Transition) {
      assert.equal(metadata.mode, 'regression', 'Sky-4: regression mode required');
      assert(!sources.sky2Transition && !sources.sky3Transition && !gearTransition && !castDisplay && !phaseDisplay && !waterEffects && !hintRemoval, 'Sky-4: cannot combine historical allowances');
      assert(MOBILE_CAPTURE_IDS.includes(b.id), 'Sky-4: unsupported capture ID');
      const beforeReplay = sources.verified.get(b)?.aurora, afterReplay = sources.verified.get(a)?.aurora;
      for (const sky of ['stars', 'meteor']) assert.deepEqual(sources.verified.get(a)[sky].draws,
        sources.verified.get(b)[sky].draws, `Sky-4: existing ${sky} submissions changed`);
      expected = { resources: expectedAuroraResources(b.metrics.resources, a.metrics.resources, beforeReplay, afterReplay, 'fixed'),
        transition: sources.sky4Transition.kind === 'clear-night-aurora-motion-Sky4'
          ? 'Sky-4 motion: independently replayed curtains/culling; existing shared geometry/program/buffers; textures exact'
          : 'Sky-4: exact-source two curtain submissions; warmed geometry +1 / shared program +1 / textures exact' };
      expectedAuroraResources(b.metrics.actualResources, a.metrics.actualResources, beforeReplay, afterReplay, 'actual');
      auroraComparison = { proof: sources.sky4Transition, beforeState: beforeReplay.state, afterState: afterReplay.state,
        beforeDraws: beforeReplay.draws, afterDraws: afterReplay.draws };
    }
    if (sources?.sky3Transition) {
      assert.equal(metadata.mode, 'regression', 'Sky-3: regression mode required');
      assert(!sources.sky2Transition && !gearTransition && !castDisplay && !phaseDisplay && !waterEffects && !hintRemoval, 'Sky-3: cannot combine historical allowances');
      assert(MOBILE_CAPTURE_IDS.includes(b.id), 'Sky-3: unsupported capture ID');
      const beforeReplay = sources.verified.get(b)?.meteor, afterReplay = sources.verified.get(a)?.meteor;
      expected = { resources: expectedMeteorResources(b.metrics.resources, a.metrics.resources, beforeReplay, afterReplay, 'fixed'),
        transition: 'Sky-3: exact-source meteor submissions; warmed geometry +1 / program +1 / textures exact' };
      expectedMeteorResources(b.metrics.actualResources, a.metrics.actualResources, beforeReplay, afterReplay, 'actual');
      meteorComparison = { proof: sources.sky3Transition, beforeState: beforeReplay.state, afterState: afterReplay.state,
        beforeDraws: beforeReplay.draws, afterDraws: afterReplay.draws };
    }
    if (sources?.sky2Transition) {
      assert(!gearTransition && !castDisplay && !phaseDisplay && !waterEffects && !hintRemoval, 'Sky-2: cannot combine historical allowances');
      assert(MOBILE_CAPTURE_IDS.includes(b.id), 'Sky-2: unsupported capture ID');
      const beforeReplay = sources.verified.get(b)?.stars, afterReplay = sources.verified.get(a)?.stars;
      expected = { resources: expectedStarResources(b.metrics.resources, a.metrics.resources, beforeReplay, afterReplay, 'fixed'),
        transition: 'Sky-2: exact-source CLEAR-night batch; warmed geometry +1 / program +1 / textures exact' };
      expectedStarResources(b.metrics.actualResources, a.metrics.actualResources, beforeReplay, afterReplay, 'actual');
      starComparison = { proof: sources.sky2Transition, beforeDraws: beforeReplay.draws, afterDraws: afterReplay.draws };
    }
    if (phaseDisplay) {
      assert(!gearTransition && !castDisplay, '5F-1A: cannot combine historical display transitions');
      assert(b.metrics.actualResources && a.metrics.actualResources, `${b.id}: missing production-view resources`);
      if (FISHING_PHASE_IDS.includes(b.id)) {
        const beforeReplay = sources.verified.get(b)?.fishingPhase, afterReplay = sources.verified.get(a)?.fishingPhase;
        expected = { resources: expectedFishingPhaseResources(b.metrics.resources, a.metrics.resources, 'fixed', beforeReplay, afterReplay),
          transition: 'fishing-phase-5F1A: source-replayed hidden submissions only' };
        expectedFishingPhaseResources(b.metrics.actualResources, a.metrics.actualResources, 'actual', beforeReplay, afterReplay);
        fishingPhaseComparison = { proof: phaseDisplay, beforeDraws: beforeReplay.draws, afterDraws: afterReplay.draws };
      } else assert.deepEqual(a.metrics.actualResources, b.metrics.actualResources, `${b.id}: production-view resource regression`);
    }
    if (waterEffects) {
      assert(!gearTransition && !castDisplay && !phaseDisplay && !hintRemoval, '5F-1B: cannot combine historical allowances');
      assert(MOBILE_CAPTURE_IDS.includes(b.id), '5F-1B: unsupported capture ID');
      const beforeReplay = sources.verified.get(b)?.waterEffects, afterReplay = sources.verified.get(a)?.waterEffects;
      expected = { resources: expectedWaterEffectsResources(b.metrics.resources, a.metrics.resources, b.id, 'fixed', beforeReplay, afterReplay, waterEffects),
        transition: 'water-effects-5F1B: exact source-replayed batch draws; warmed geometry +1 / program +1' };
      expectedWaterEffectsResources(b.metrics.actualResources, a.metrics.actualResources, b.id, 'actual', beforeReplay, afterReplay, waterEffects);
      waterEffectsComparison = { proof: waterEffects, beforeState: beforeReplay.state, afterState: afterReplay.state,
        beforeDraws: beforeReplay.draws, afterDraws: afterReplay.draws };
    }
    assert.deepEqual(a.metrics.resources, expected.resources, `${b.id}: resource regression`);
    if (gearTransition) {
      assert(MOBILE_CAPTURE_IDS.includes(b.id), `${b.id}: unrecognized rod/reel comparison ID`);
      assert(b.metrics.actualResources && a.metrics.actualResources, `${b.id}: missing production-view resources`);
      assert.deepEqual(a.metrics.actualResources,
        expectedRodReelResources(b.metrics.actualResources, b.id, gearTransition), `${b.id}: production-view resource regression`);
    }
    if (castDisplay) {
      assert(!gearTransition, 'Cast display cannot reuse the rod/reel introduction allowance');
      assert(MOBILE_CAPTURE_IDS.includes(b.id), `${b.id}: unrecognized cast display comparison ID`);
      assert(b.metrics.actualResources && a.metrics.actualResources, `${b.id}: missing production-view resources`);
      assert.deepEqual(a.metrics.actualResources, b.metrics.actualResources, `${b.id}: production-view resource regression`);
    }
    const pixelReduction = (1 - a.metrics.pixels / b.metrics.pixels) * 100;
    if (metadata.mode === 'regression') {
      // With unchanged rendering, both increasing cost and reducing quality
      // are regressions. Do not let equal *area* hide different dimensions.
      assert.equal(a.metrics.pixelRatio, b.metrics.pixelRatio, `${b.id}: pixel ratio regression`);
      assert.deepEqual(a.metrics.buffer, b.metrics.buffer, `${b.id}: drawing buffer regression`);
      assert.equal(a.metrics.pixels, b.metrics.pixels, `${b.id}: pixel regression`);
    } else if (!b.id.startsWith('pc')) assert(pixelReduction >= 20, `${b.id}: historical mobile pixel reduction`);
    else assert.equal(a.metrics.pixels, b.metrics.pixels, `${b.id}: desktop pixels`);
    if (/-bite$|-fight$/.test(b.id)) {
      checkLayout(a.layout, b.id);
      if (metadata.mode === 'regression') {
        checkLayout(b.layout, b.id);
        const upperCast = b.id.endsWith('bite') && metadata.implementations.main.hudModel !== metadata.implementations.pr.hudModel;
        if (upperCast) {
          assert.equal(metadata.implementations.pr.hudModel, 'cast-upper-controls', `${b.id}: unrecognized HUD change`);
          checkUpperCastBiteLayout(a.layout, b.id);
        }
        for (const key of ['viewport', 'panel', 'occupancy', 'reticle', 'meter', 'buttons', 'header', 'notices', 'scrollWidth']) {
          if (hintRemoval && ['portrait-fight', 'small-fight'].includes(b.id) && ['panel', 'meter'].includes(key)) {
            const expected = { ...b.layout[key] };
            for (const coordinate of ['y', 'top', 'bottom']) expected[coordinate] += 26;
            assert.deepEqual(a.layout[key], expected, `${b.id}: hint removal ${key} regression`);
            continue;
          }
          if (key === 'buttons' && hintRemoval && ['portrait-bite', 'landscape-bite', 'small-bite', 'pc-bite'].includes(b.id)) {
            assert.equal(b.layout.buttons.filter(button => button.id === 'return-button').length, 1, `${b.id}: missing return button`);
            const expected = b.layout.buttons.map(button => button.id === 'return-button'
              ? { ...button, y: button.y - 38, top: button.top - 38, bottom: button.bottom - 38 } : button);
            assert.deepEqual(a.layout.buttons, expected, `${b.id}: hint removal return button regression`);
            continue;
          }
          if (upperCast && ['panel', 'occupancy'].includes(key)) continue; // checked against the explicit upper HUD geometry above
          if (upperCast && key === 'buttons') {
            assert.deepEqual(a.layout.buttons.filter(button => button.id !== 'return-button'), b.layout.buttons.filter(button => button.id !== 'return-button'), `${b.id}: HUD other buttons regression`);
            continue;
          }
          assert.deepEqual(a.layout[key], b.layout[key], `${b.id}: HUD ${key} regression`);
        }
      } else if (b.id.endsWith('fight') && !b.id.startsWith('pc')) {
        assert(a.layout.occupancy < b.layout.occupancy, `${b.id}: historical HUD area did not shrink`);
      }
    }
    return { id: b.id, before: b.metrics, after: a.metrics,
      ...(cameraComparison ? { cameraComparison } : {}),
      ...(expected.transition ? { resourceTransition: expected.transition } : {}),
      ...(gearTransition ? { rodReelComparison: gearTransition } : {}),
      ...(castDisplay ? { castDisplayComparison: castDisplay } : {}),
      ...(fishingPhaseComparison ? { fishingPhaseComparison } : {}),
      ...(waterEffectsComparison ? { waterEffectsComparison } : {}),
      ...(starComparison ? { starComparison } : {}),
      ...(meteorComparison ? { meteorComparison } : {}),
      ...(auroraComparison ? { auroraComparison } : {}),
      ...(hintRemoval && ['portrait-bite', 'landscape-bite', 'small-bite', 'pc-bite', 'portrait-fight', 'small-fight'].includes(b.id)
        ? { fishingHintRemoval: hintRemoval } : {}),
      pixelReduction,
      ...(b.layout ? { beforeLayout: b.layout, afterLayout: a.layout } : {}) };
}

export async function writeMobileComparison(before, after, output, metadata = before[0]?.comparison) {
  assert(metadata, 'Comparison mode and source SHAs are required (old captures need explicit CLI arguments)');
  // Re-verify the recorded source SHAs when combining separately collected
  // JSON as well as when called directly from the E2E spec.
  const rows = await compareMobileCapturesWithSources(before, after, metadata);
  const images = await Promise.all(before.map(async b => {
    const a = after.find(a => a.id === b.id);
    assert(b.image && a.image, `${b.id}: missing comparison image`);
    return [await readFile(b.image), await readFile(a.image)];
  }));
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output.replace(/\.html$/, '.json'), JSON.stringify({ metadata, rows }, null, 2));
  const figures = rows.map((r, index) => `<article id="${r.id}"><h2>${r.id}</h2><p>buffer ${r.before.buffer.width}×${r.before.buffer.height} → ${r.after.buffer.width}×${r.after.buffer.height}; pixel reduction ${r.pixelReduction.toFixed(2)}%${r.beforeLayout ? `; HUD ${r.beforeLayout.occupancy.toFixed(2)}% → ${r.afterLayout.occupancy.toFixed(2)}%` : ''}</p><div>${images[index].map((image, i) => `<figure><figcaption>${i ? 'PR' : 'main'}</figcaption><img src="data:image/png;base64,${image.toString('base64')}"></figure>`).join('')}</div><details><summary>Metrics / layout</summary><pre>${JSON.stringify({ before: r.before, after: r.after, beforeLayout: r.beforeLayout, afterLayout: r.afterLayout, cameraComparison: r.cameraComparison, resourceTransition: r.resourceTransition, rodReelComparison: r.rodReelComparison, castDisplayComparison: r.castDisplayComparison, fishingPhaseComparison: r.fishingPhaseComparison, waterEffectsComparison: r.waterEffectsComparison, starComparison: r.starComparison, meteorComparison: r.meteorComparison, auroraComparison: r.auroraComparison }, null, 2)}</pre></details></article>`).join('');
  await writeFile(output, `<!doctype html><html lang="ja"><meta charset="utf-8"><title>BARB mobile comparison</title><style>body{background:#142329;color:#eee;font:15px system-ui;margin:24px}article{border-top:1px solid #789;padding:20px 0}article>div{display:flex;align-items:start;gap:12px}figure{margin:0;max-width:49%}img{max-width:100%;height:auto}pre{white-space:pre-wrap}</style><h1>BARB mobile comparison: ${metadata.mode}</h1><pre>${JSON.stringify(metadata, null, 2)}</pre><p>Production builds, boat (10,20), heading 0, saved clock, viewport / DPR and native fishing input fixed. Software Chromium / SwiftShader, single sample: setup→ready and 6 ordinary frames (96ms virtual time), Node monotonic wall clock and CDP TaskDuration. Includes automation overhead, paired diagnostic renders and waits; these are not device FPS or GPU timings. Screenshots and actualResources retain the production camera. Resources are compared strictly using the same fixed diagnostic camera; production camera poses are replayed from each recorded source SHA. Only rotated-fight can have a different quaternion with unchanged camera code: its tracking and HUD tension must independently match each source FIGHT engine, and both camera rigs must agree under each common tracking/time history. BITE's intentional upper HUD is checked against explicit geometry. Phase 5E-2B's exact-source hint removal permits only the BITE return button moving up 38px and portrait/small FIGHT panel and meter moving down 26px; sizes, other controls, other coordinates and all other captures retain exact comparison. Raw JSON accompanies this report. The approved rod/reel introduction independently loads both exact Git sources and reverses its additive main connection, then permits only two warmed geometries and the exact Lv1 draws/triangles in the 14 fishing captures; textures, shader programs, all other resources and the production-view counters remain exact. Phase 5D-2 grants no resource allowance: its approved-base origin/update-order changes must reverse exactly, both model sources are inspected, and all fixed-camera and production-view resources remain identical. Phase 5F-1A separately reverses its exact display patch against its approved base, replays each native game history and both source view factories, and checks the recorded per-mesh submissions against geometry, transparency and frustum culling for each camera. Only the four BITE, four FIGHT and rotated-fight captures can subtract the verified hidden meshes; all other counters and captures remain exact. Its independent source proof also preserves both-history rotated-FIGHT camera replay. Phase 5F-1B has a separate proof bound to base b562b3f4d9d39ed38b05049e2981923bac175cfc: its complete production wiring reverses exactly, its new effect module and capture observer are pinned, and each source independently replays the native phase/input history and seconds-based scheduler. Recorded effect vertex/color buffers, visibility, bounds and per-camera submissions must match. Only source-visible effects in the nine BITE/FIGHT IDs add one single-pass batch (at most 1152 triangles); all 34 complete-scene warmups add exactly one geometry and one built-in RGBA program, with zero new textures. Inactive effects submit zero draws. Constructor UUID entropy is isolated only during the four synchronous visual constructors, restored in finally, and independently checked with shared-RNG and multi-seed domain/state tests. Sky-3 is separately bound to the Sky-2 main eb3d77b310110aa49958292064774b4d35446c73: the complete meteor lake connection reverses exactly, the meteor and observers are pinned, existing stars and all other runtime/build/assets stay fixed, and the native clock, CLEAR weather, slot, immutable ribbon and submissions are independently replayed for each camera. All 34 warmups add exactly one geometry/program and zero textures; only an ordinary winning midpoint window can submit one two-triangle batch. Cold scenery tracks earlier uploads from its complete native render history. Historical transition rules remain separate. Regression mode otherwise expects unchanged resolution/resources and unchanged layouts outside the explicit cast HUD; historical-improvement requires the explicit pre-4C-2A SHA and the original ≥20% mobile pixel reduction and smaller fight HUD.</p>${figures}</html>`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [beforeFile, afterFile, output, mode, baseSha, headSha] = process.argv.slice(2);
  const before = JSON.parse(await readFile(beforeFile)), after = JSON.parse(await readFile(afterFile));
  const metadata = mode ? { mode, baseSha, headSha, validationSha: headSha, implementations: {
    main: mobileSourceMetadata(await readMobileImplementation(baseSha)), pr: mobileSourceMetadata(await readMobileImplementation(headSha)) } } : before[0]?.comparison;
  await writeMobileComparison(before, after, output, metadata);
}
