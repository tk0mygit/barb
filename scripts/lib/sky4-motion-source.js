import assert from 'node:assert/strict';
import { mobileGit } from './mobile-comparison-source.js';
import { readSky4Transition, readAuroraSource } from './sky4-source.js';
import { SKY4_SOURCE_BLOBS } from './sky4-source-pins.js';
import { SKY4_MOTION_BLOBS } from './sky4-motion-pins.js';

export const SKY4_MOTION_BASE = '8986d7d06b5742f0cd0788dc5fc6d2ea8f4d0190';
const AURORA = 'src/world/aurora.js', MANIFEST = 'scripts/lib/sky4-motion-pins.js';
// Exact, reviewable edits; every other byte (including alpha, color, hash,
// clock, geometry and material construction) must remain the base source.
export const SKY4_MOTION_EDITS = Object.freeze([
  ['// The two bounded shader displacements are <= 47m in total.', '// |dx| <= 45m, |dy| <= 29m: 80m exceeds even their 74m L1 bound.', 1],
  ['Math.sqrt(squaredRadius) + 48;', 'Math.sqrt(squaredRadius) + 80;', 1],
  ['auroraTime * 0.00872664625997;', 'auroraTime * 0.03490658503988;', 2],
  ['point.x += 28.0 *', 'point.x += 45.0 *', 1],
  ['point.y += 18.0 *', 'point.y += 29.0 *', 1],
  ['float fold = u + 0.022 *', 'float fold = u + 0.031 *', 1],
  ['+ 0.009 * sin(u * 31.0', '+ 0.013 * sin(u * 31.0', 1],
  ['float hem = 0.15 + 0.055 *', 'float hem = 0.15 + 0.077 *', 1],
  ['+ 0.035 * sin(u * 23.0', '+ 0.049 * sin(u * 23.0', 1],
]);
export function verifyAuroraMotionEdit(before, after) {
  for (const [old, tuned, count] of SKY4_MOTION_EDITS) {
    assert.equal(before.split(old).length - 1, count, `Sky-4 motion: unexpected base expression ${old}`);
    before = before.replaceAll(old, tuned);
  }
  assert.equal(after, before, 'Sky-4 motion: change outside approved shader/bound lines');
}

export async function readSky4MotionTransition(main, pr, headSha = pr.sha) {
  assert.equal(main.sha, SKY4_MOTION_BASE, 'Sky-4 motion: unapproved base SHA');
  assert.match(headSha, /^[a-f0-9]{40}$/, 'Sky-4 motion: full HEAD required');
  assert.equal(await mobileGit('rev-parse', `${headSha}^{commit}`), headSha);
  if (headSha !== pr.sha) assert.deepEqual((await mobileGit('show', '-s', '--format=%P', pr.sha)).split(' '),
    [main.sha, headSha], 'Sky-4 motion: validation merge parents differ');
  assert.equal(await mobileGit('merge-base', main.sha, pr.sha), main.sha, 'Sky-4 motion: base is not ancestor');
  assert.equal(main.auroraBlob, SKY4_SOURCE_BLOBS[AURORA], 'Sky-4 motion: initial aurora source differs');
  assert.equal(pr.auroraBlob, SKY4_MOTION_BLOBS[AURORA], 'Sky-4 motion: unapproved tuned aurora');
  assert.deepEqual((await mobileGit('diff', '--name-only', main.sha, pr.sha, '--', 'src')).split('\n'), [AURORA],
    'Sky-4 motion: unrelated runtime change');
  assert.equal(await mobileGit('diff', '--name-only', main.sha, pr.sha, '--', 'public', 'package.json', 'package-lock.json',
    'index.html', 'vite.config.js', 'playwright.config.js', '.github', 'scripts/ci-risk.js', 'scripts/ci-e2e.js', 'scripts/ci-summary.js'), '',
  'Sky-4 motion: assets/build/CI changed');
  const allowed = Object.keys(SKY4_MOTION_BLOBS).filter(path => path.startsWith('scripts/lib')).concat(MANIFEST).sort();
  assert.deepEqual((await mobileGit('diff', '--name-only', main.sha, pr.sha, '--', 'scripts/lib')).split('\n').sort(), allowed,
    'Sky-4 motion: legacy replay changed');
  for (const path of ['tests/helpers/aurora-snapshot.js', 'tests/helpers/aurora-event.js', 'tests/helpers/star-snapshot.js',
    'tests/helpers/meteor-snapshot.js', 'tests/browser/day-night-fixture.js', 'tests/browser/lighting-resource-contract.js',
    'tests/browser/mobile-performance.spec.js', 'tests/browser/lake-scenery.spec.js', 'tests/helpers/sky4-fixture.js', 'tests/sky4-comparison.test.js']) {
    assert.equal(await mobileGit('diff', '--name-only', main.sha, pr.sha, '--', path), '', `Sky-4 motion: observer/historical fixture changed ${path}`);
  }
  const manifest = await mobileGit('show', `${pr.sha}:${MANIFEST}`);
  const literal = manifest.match(/^\/\/ Reviewed motion-tune blobs; the literal manifest has no circular self-hash\.\nexport const SKY4_MOTION_BLOBS = Object\.freeze\((\{[\s\S]*\})\);$/);
  assert(literal, 'Sky-4 motion: nonliteral manifest');
  assert.deepEqual(JSON.parse(literal[1]), SKY4_MOTION_BLOBS, 'Sky-4 motion: manifest differs from replay');
  for (const [path, blob] of Object.entries(SKY4_MOTION_BLOBS)) {
    assert.match(await mobileGit('ls-tree', pr.sha, '--', path), /^100644 blob /, 'Sky-4 motion: invalid file mode');
    assert.equal(await mobileGit('rev-parse', `${pr.sha}:${path}`), blob, `Sky-4 motion: unapproved source ${path}`);
  }
  verifyAuroraMotionEdit(await mobileGit('show', `${main.sha}:${AURORA}`), await mobileGit('show', `${pr.sha}:${AURORA}`));
  const before = await readAuroraSource(main.sha), after = await readAuroraSource(pr.sha);
  assert.deepEqual(after.AURORA_CONFIG, before.AURORA_CONFIG, 'Sky-4 motion: timing/probability/geometry changed');
  return { kind: 'clear-night-aurora-motion-Sky4', baseSha: main.sha, headSha, validationSha: pr.sha,
    before: { auroraBlob: main.auroraBlob, starsBlob: main.starsBlob, meteorBlob: main.meteorBlob },
    after: { auroraBlob: pr.auroraBlob, starsBlob: pr.starsBlob, meteorBlob: pr.meteorBlob }, sources: SKY4_MOTION_BLOBS,
    tuning: { speedMultiplier: 4, xAmplitude: 45, yAmplitude: 29, fold: [.031, .013], hem: [.077, .049], boundsPadding: 80 },
    resources: { geometries: 0, materials: 0, programs: 0, buffers: 0, textures: 0, maximumCalls: 2, maximumTriangles: 3200 } };
}

// Preserve the historical introduction contract and its immutable pins.
export async function readAuroraTransition(main, pr, headSha = pr.sha) {
  if (main.sha === SKY4_MOTION_BASE && await mobileGit('ls-tree', pr.sha, '--', MANIFEST))
    return readSky4MotionTransition(main, pr, headSha);
  if (main.auroraBlob === pr.auroraBlob) return null;
  return main.sha === SKY4_MOTION_BASE ? readSky4MotionTransition(main, pr, headSha) : readSky4Transition(main, pr);
}
