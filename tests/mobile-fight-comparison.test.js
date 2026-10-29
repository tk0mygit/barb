import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MOBILE_CAPTURE_IDS, compareMobileCapturePairWithSources, verifyMobileSourceCapture,
  writeMobileComparison } from '../scripts/compare-mobile-performance.mjs';
import { mobileGit, readMobileImplementation, mobileSourceMetadata, replayMobileCamera } from '../scripts/lib/mobile-comparison-source.js';
import { PR48_REPLAY_SHA } from './helpers/mobile-gate-fixture.js';

const fixture = JSON.parse(await readFile(new URL('./fixtures/mobile-pr48-rotated-fight.json', import.meta.url)));
const base = await readMobileImplementation(fixture.capturedProvenance.base);
const head = await readMobileImplementation(PR48_REPLAY_SHA);
// The recorded frames are fixed input to this unit regression. Metadata here
// is synthetic and binds that input to the tested source, not a relabeling of
// the original browser run. The original run/SHA is retained in the fixture.
function pair(sameSource = false) {
  const before = structuredClone(fixture.captures[sameSource ? 'pr' : 'main']);
  const after = structuredClone(fixture.captures.pr);
  const metadata = { mode: 'regression', baseSha: sameSource ? head.sha : base.sha,
    headSha: head.sha, validationSha: head.sha,
    implementations: { main: mobileSourceMetadata(sameSource ? head : base), pr: mobileSourceMetadata(head) } };
  return { before, after, metadata };
}
const compare = p => compareMobileCapturePairWithSources(p.before, p.after, p.metadata);

test('PR48 real tracking histories match their source physics and normalized camera inputs', async () => {
  const p = pair(), row = await compare(p);
  assert.equal(row.cameraComparison.kind, 'source-replayed-fight-tracking');
  assert.equal(row.cameraComparison.normalizedHistories, 2);
  assert.notDeepEqual(p.before.metrics.camera, p.after.metrics.camera);
  for (const [entry, proof] of [[p.before, row.cameraComparison.before], [p.after, row.cameraComparison.after]]) {
    assert.equal(proof.distance, 20 - entry.metrics.cameraFrames.at(-1).tracking.z);
    assert.equal(proof.tension, entry.layout.tension);
    assert.equal(proof.trace.length, entry.metrics.cameraFrames.filter(f => f.phase === 'fight').length);
  }
});

test('PR48 fixed frames cannot be relabeled as the current 5C-1R FIGHT source', async () => {
  const current = await readMobileImplementation(await mobileGit('rev-parse', 'HEAD'));
  await assert.rejects(() => verifyMobileSourceCapture(current, structuredClone(fixture.captures.pr)),
    /tracking z: differs from source FIGHT replay/);
});

test('identical tracking/time keeps exact camera equality, including a sub-tolerance mutation', async () => {
  const p = pair(true); assert.equal((await compare(p)).cameraComparison, undefined);
  p.after.metrics.camera.quaternion[0] += 1e-12;
  await assert.rejects(compare(p), /same source pose cannot explain a camera difference/);
});

test('changing both actual and recorded expected camera cannot forge source replay', async () => {
  const p = pair(); p.after.metrics.camera.quaternion[0] += .01;
  p.after.metrics.cameraExpected = structuredClone(p.after.metrics.camera);
  await assert.rejects(compare(p), /camera quaternion\[0\] differs from source/);
});

test('a forged target with a consistent camera still fails independent FIGHT replay', async () => {
  const p = pair();
  p.after.metrics.cameraFrames.at(-1).tracking.z += .25;
  p.after.metrics.camera = replayMobileCamera(head, p.after.metrics.cameraFrames);
  p.after.metrics.cameraExpected = structuredClone(p.after.metrics.camera);
  await assert.rejects(compare(p), /tracking z: differs from source FIGHT replay/);
});

test('HUD tension and FIGHT interruption are checked against the source domain', async () => {
  const tension = pair(); tension.after.layout.tension += .01;
  await assert.rejects(compare(tension), /HUD tension: differs from source FIGHT replay/);
  const interrupted = pair(); interrupted.after.metrics.cameraFrames.at(-1).phase = 'failed';
  interrupted.after.metrics.camera = replayMobileCamera(head, interrupted.after.metrics.cameraFrames);
  interrupted.after.metrics.cameraExpected = structuredClone(interrupted.after.metrics.camera);
  await assert.rejects(compare(interrupted), /FIGHT interrupted/);
});

for (const field of ['calls', 'triangles', 'geometries', 'textures', 'programs']) {
  test(`legal tracking differences still reject ${field} resource changes`, async () => {
    const p = pair(); p.after.metrics.resources[field]++;
    await assert.rejects(compare(p), /resource regression/);
  });
}

test('viewport, diagnostic camera and HUD geometry retain independent guards', async () => {
  const viewport = pair(); viewport.after.metrics.viewport.width++;
  await assert.rejects(compare(viewport), /source camera viewport/);
  const resourceCamera = pair(); resourceCamera.after.metrics.resourceCamera.position[0] += .01;
  await assert.rejects(compare(resourceCamera), /resource camera: camera position\[0\] differs from source/);
  const layout = pair();
  for (const key of ['x', 'left', 'right']) layout.after.layout.panel[key]++;
  await assert.rejects(compare(layout), /HUD panel regression/);
});

test('all other33 IDs retain strict camera comparison despite valid source histories', async () => {
  for (const id of MOBILE_CAPTURE_IDS.filter(id => id !== 'rotated-fight')) {
    const p = pair(); p.before.id = p.after.id = id;
    await assert.rejects(compare(p), /camera differs/, id);
  }
});

test('base, HEAD, validation and implementation provenance mismatches fail', async () => {
  for (const [key, message] of [['baseSha', /base SHA differs/], ['headSha', /Validation SHA is not the recorded base\/HEAD merge/],
    ['validationSha', /validation SHA differs/]]) {
    const p = pair(); p.metadata[key] = 'b'.repeat(40); await assert.rejects(compare(p), message);
  }
  const source = pair(); source.metadata.implementations.pr.cameraBlob = 'b'.repeat(40);
  await assert.rejects(compare(source), /implementation provenance differs/);
});

test('missing frame history cannot bypass source verification', async () => {
  const p = pair(); delete p.after.metrics.cameraFrames;
  await assert.rejects(compare(p), /Missing camera frame history/);
});

test('final report rechecks source camera, not a forged expected value from saveCapture', async () => {
  const p = pair(); await verifyMobileSourceCapture(head, p.after);
  p.after.metrics.camera.quaternion[0] += .01;
  p.after.metrics.cameraExpected = structuredClone(p.after.metrics.camera);
  const dir = await mkdtemp(join(tmpdir(), 'barb-mobile-source-report-'));
  try {
    await assert.rejects(writeMobileComparison([p.before], [p.after], join(dir, 'comparison.html'), p.metadata),
      /camera quaternion\[0\] differs from source/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
