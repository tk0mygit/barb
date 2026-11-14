import assert from 'node:assert/strict';
import { mobileGit, readMobileImplementation } from './mobile-comparison-source.js';
import { SKY4R2_BASE, readSky4R2Transition } from './sky4r2-source.js';

export const SKY5_BASE = '65021907bf06f5a0f765af9ea18dc5f91d43289b';
// One reviewed runtime tree, not a generic allowance for post-R2 changes.
export const SKY5_SOURCE_TREE = '4134216b8067fbbfce7ff44ea25587975d8e7c35';
const BRIDGE = `    // Read-only binding to the existing batches; observation never owns or
    // changes their sampling, material, transform or GPU resources.
    celestial: Object.freeze({ aurora: Object.freeze([...aurora.meshes]), meteor: meteor.mesh }),
`;
const invariantPaths = ['src/world/aurora.js', 'src/world/meteor.js', 'src/world/stars.js', 'src/world/water.js',
  'src/world/terrain.js', 'src/world/day-night.js', 'src/world/night-fog.js', 'src/game/game-clock.js',
  'src/game/time-skip.js', 'src/rendering/camera.js', 'src/input', 'public', 'package.json', 'package-lock.json',
  'index.html', 'vite.config.js', 'playwright.config.js', '.github', 'AGENTS.md',
  'scripts/ci-risk.js', 'scripts/ci-e2e.js', 'scripts/ci-summary.js'];

export function verifySky5LakeBridge(before, after) {
  assert.equal(after.split(BRIDGE).length, 2, 'Sky-5: missing/duplicate read-only lake bridge');
  assert.equal(after.replace(BRIDGE, ''), before, 'Sky-5: lake update/render/sampling changed');
}

// Both the capture path and the CLI/final gate call this against real Git
// sources. It grants zero resource, camera, clock, shader or image tolerance.
export async function readSky5Preservation(main, pr, headSha) {
  if (main.sha !== SKY5_BASE) return null;
  assert.equal(await mobileGit('rev-parse', `${pr.sha}:src`), pr.sourceTree, 'Sky-5: forged runtime tree');
  if (main.sourceTree === pr.sourceTree) return null;
  assert.equal(pr.sourceTree, SKY5_SOURCE_TREE, 'Sky-5: unreviewed runtime tree');
  assert.equal(await mobileGit('merge-base', main.sha, pr.sha), main.sha, 'Sky-5: base is not ancestor');
  const parents = (await mobileGit('show', '-s', '--format=%P', pr.sha)).split(' ');
  headSha ??= parents.length === 2 ? parents[1] : pr.sha;
  if (headSha !== pr.sha) assert.deepEqual(parents, [main.sha, headSha], 'Sky-5: validation merge parents differ');
  assert.equal(await mobileGit('rev-parse', `${headSha}:src`), SKY5_SOURCE_TREE, 'Sky-5: HEAD/validation runtime differs');
  assert.equal(await mobileGit('diff', '--name-only', main.sha, pr.sha, '--', ...invariantPaths), '', 'Sky-5: protected optical/input/build source changed');
  verifySky5LakeBridge(await mobileGit('show', `${main.sha}:src/world/lake.js`), await mobileGit('show', `${pr.sha}:src/world/lake.js`));
  return { kind: 'celestial-observation-preserves-Sky4R2', baseSha: main.sha, headSha, validationSha: pr.sha,
    sourceTree: SKY5_SOURCE_TREE, lakeBridge: 'frozen-existing-three-mesh-references',
    resourceDelta: { geometries: 0, materials: 0, programs: 0, textures: 0, lights: 0, calls: 0, passes: 0 } };
}

// Keep the original R2 introduction proof intact, then independently prove
// that this one Sky-5 implementation preserves its complete optical source.
export async function readSky5WorldLightReference(pr) {
  const accepted = await readMobileImplementation(SKY5_BASE);
  await readSky4R2Transition(await readMobileImplementation(SKY4R2_BASE), accepted);
  const proof = await readSky5Preservation(accepted, pr);
  assert(proof, 'Sky-5: no reviewed observation implementation');
  return proof;
}
