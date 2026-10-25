import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compareSceneryCameras, verifySceneryCameraSource, writeComparison } from '../scripts/compare-lake-scenery.mjs';
import { readMobileImplementation, replayMobileCamera } from '../scripts/lib/mobile-comparison-source.js';

const base = await readMobileImplementation('cd2ca6d4defa39810b622602d417a1930a911541');
const changed = await readMobileImplementation('eb10aa13ec302a7a4c9b4a421a596f447c8f6e7c');
const ids = ['day-tps', 'day-fps', 'twilight', 'clear-night', 'fog-night', 'dense-night', 'portrait', 'landscape'];
function measurement(implementation, fishing = false) {
  const aspect = 1000 / 700;
  const frames = [{ update: false, dt: 0, aspect, mode: 'sailing', phase: 'inactive' },
    { update: true, dt: 0.25, aspect, mode: 'sailing', phase: 'inactive' },
    ...(fishing ? Array.from({ length: 12 }, () => ({ update: true, dt: 0.25, aspect, mode: 'fishing', phase: 'ready', tracking: null })) : [])];
  return { camera: { ...replayMobileCamera(implementation, frames), fov: 55 },
    cameraEvidence: { sha: implementation.sha, cameraBlob: implementation.cameraBlob, frames },
    viewport: { width: 1000, height: 700 }, deviceScaleFactor: 1, savedClockSeconds: 90, boat: [10, 20], heading: 0,
    waterTime: 0.25, fogStrength: 0, resources: { calls: 31, triangles: 221444, geometries: 24, textures: 3, programs: 12 } };
}

test('READY camera source replay identifies the exact initial-CI residual and subpixel projection', () => {
  const before = measurement(base, true), after = measurement(changed, true);
  verifySceneryCameraSource(before, base); verifySceneryCameraSource(after, changed);
  assert.deepEqual(after.camera.position, before.camera.position);
  assert.notDeepEqual(after.camera.quaternion, before.camera.quaternion);
  const delta = compareSceneryCameras(before, after, 'day-fps');
  assert.ok(Math.abs(delta.maximumX - 0.00021565716090687914) < 1e-10);
  assert.ok(Math.abs(delta.maximumY - 0.0007080279221471919) < 1e-10);
});

test('source replay rejects camera corruption even when its projection remains within 0.001 CSS px', () => {
  const metrics = measurement(changed, true);
  metrics.camera.quaternion[0] += 1e-8;
  compareSceneryCameras(measurement(base, true), metrics, 'day-fps');
  assert.throws(() => verifySceneryCameraSource(metrics, changed), /differs from its source/);
  for (const field of ['sha', 'cameraBlob']) {
    const tampered = measurement(changed, true); tampered.cameraEvidence[field] = 'f'.repeat(40);
    assert.throws(() => verifySceneryCameraSource(tampered, changed), /source .* differs/);
  }
});

test('READY comparison rejects visible pitch differences, any position/lens change, and changed cameras in other views', () => {
  const before = measurement(base, true);
  for (const mutate of [m => { m.camera.position[1] += 1e-12; }, m => { m.camera.fov = 55.000001; }, m => { m.camera.aspect += 1e-12; },
    m => { m.camera.quaternion[0] += 1e-5; }]) {
    const after = measurement(changed, true); mutate(after);
    assert.throws(() => compareSceneryCameras(before, after, 'day-fps'), /camera .*must match|projection exceeds/);
  }
  assert.throws(() => compareSceneryCameras(before, measurement(changed, true), 'day-tps'), /camera must match/);
});

test('the eight-view scenery report retains strict source, clock and resource-cost checks', async () => {
  // Synthetic records exercise acceptance rules, not browser measurements.
  const pair = implementation => new Map(ids.map(id => [id, { metrics: measurement(implementation, id === 'day-fps'), image: '' }]));
  const directory = await mkdtemp(join(tmpdir(), 'barb-scenery-contract-'));
  try {
    const output = join(directory, 'comparison.html');
    const result = await writeComparison(pair(base), pair(changed), output);
    assert.equal(result.length, 8);
    assert.ok(result.find(row => row.id === 'day-fps').cameraProjectionDelta.maximumY < 0.001);
    assert.ok((await readFile(output, 'utf8')).includes('0.001 CSS px'));
    for (const [mutate, expected] of [
      [m => { m.savedClockSeconds++; }, /savedClockSeconds must match/],
      [m => { m.resources.calls += 4; }, /draw call increase/],
      [m => { m.resources.triangles *= 1.16; }, /triangle increase/],
      [m => { m.cameraEvidence.cameraBlob = 'f'.repeat(40); }, /source blob differs/],
    ]) {
      const after = pair(changed); mutate(after.get('day-fps').metrics);
      await assert.rejects(writeComparison(pair(base), after, output), expected);
    }
    const missing = pair(changed); missing.delete('landscape');
    await assert.rejects(writeComparison(pair(base), missing, output), /all eight reference views/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
