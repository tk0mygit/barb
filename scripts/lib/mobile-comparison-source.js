import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { PerspectiveCamera } from 'three';

const exec = promisify(execFile);
export const HISTORICAL_MOBILE_BASE = 'd8cbbe8c9bbeace7345cab789ebe5b066270fa84';

export async function mobileGit(...args) {
  return (await exec('git', args)).stdout.trim();
}

// Read the exact commit that was archived for the reference build. Never infer
// an old renderer from the label "main", or use the PR calculator for its base.
export async function readMobileImplementation(sha) {
  assert.match(sha ?? '', /^[a-f0-9]{40}$/, 'Expected a full mobile implementation SHA');
  assert.equal(await mobileGit('rev-parse', `${sha}^{commit}`), sha);
  const main = await mobileGit('show', `${sha}:src/main.js`);
  const cameraSource = await mobileGit('show', `${sha}:src/rendering/camera.js`);
  const cameraModule = await import(`data:text/javascript;base64,${Buffer.from(cameraSource.replace("'three'", JSON.stringify(import.meta.resolve('three')))).toString('base64')}`);
  assert.equal(typeof cameraModule.createCameraRig, 'function', `${sha}: missing camera rig`);
  const castCamera = cameraSource.includes('prepareCast()');
  if (castCamera) {
    assert.equal(cameraModule.CAST_CAMERA_BACKOFF, 1.25, 'Prepared camera backoff changed');
    assert.equal(cameraModule.READY_PITCH_LIMIT, 12 * (Math.PI / 180), 'READY pitch limit changed');
    assert(main.includes('rig.prepareCast()'), 'Prepared camera is disconnected');
  }
  const hudSource = await mobileGit('show', `${sha}:src/ui/style.css`);
  const implementation = { sha,
    mainBlob: await mobileGit('rev-parse', `${sha}:src/main.js`),
    hudBlob: await mobileGit('rev-parse', `${sha}:src/ui/style.css`),
    hudLogicBlob: await mobileGit('rev-parse', `${sha}:src/ui/fishing-hud.js`),
    cameraBlob: await mobileGit('rev-parse', `${sha}:src/rendering/camera.js`),
    cameraModel: castCamera ? 'prepared-horizontal-aft-1.25' : 'legacy-transition',
    hudModel: hudSource.includes('[data-cast-view="true"]') ? 'cast-upper-controls' : 'original',
    createCameraRig: cameraModule.createCameraRig };
  if (main.includes("from './rendering/resolution.js'") && main.includes('calculateRenderResolution({')
    && main.includes('renderer.setDrawingBufferSize(width, height, pixelRatio)')) {
    const source = await mobileGit('show', `${sha}:src/rendering/resolution.js`);
    const { calculateRenderResolution: calculate } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
    assert.equal(typeof calculate, 'function', `${sha}: missing render-resolution export`);
    return { ...implementation, resolutionModel: 'mobile-budget',
      resolutionBlob: await mobileGit('rev-parse', `${sha}:src/rendering/resolution.js`), calculate };
  }
  // The historical path is deliberately bounded to the verified pre-4C-2A
  // source. An unknown implementation must fail instead of assuming 1.75.
  assert.equal(sha, HISTORICAL_MOBILE_BASE, `${sha}: unrecognized rendering implementation`);
  assert(main.includes('renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75))'), 'Historical renderer changed');
  return { ...implementation, resolutionModel: 'legacy-1.75', resolutionBlob: null,
    calculate: ({ width, height, devicePixelRatio }) => ({ width, height, pixelRatio: Math.min(devicePixelRatio, 1.75) }) };
}

export function mobileSourceMetadata({ calculate, createCameraRig, ...metadata }) { return metadata; }

export async function assertMobileWorkingSource(implementation) {
  for (const [file, expected] of [['src/main.js', implementation.mainBlob], ['src/ui/style.css', implementation.hudBlob],
    ['src/ui/fishing-hud.js', implementation.hudLogicBlob],
    ['src/rendering/camera.js', implementation.cameraBlob],
    ...(implementation.resolutionBlob ? [['src/rendering/resolution.js', implementation.resolutionBlob]] : [])]) {
    assert.equal(await mobileGit('hash-object', file), expected, `${file}: working source differs from recorded SHA`);
  }
}

// Reproduce the production camera with the recorded ordinary frame times and
// observed water target. Native input in this comparison has no look drag.
// Each side uses its own exact source SHA; the PR rig never models its base.
export function replayMobileCamera(implementation, frames) {
  assert(Array.isArray(frames) && frames.length, 'Missing camera frame history');
  const camera = new PerspectiveCamera(55, 1, 0.1, 2400);
  const boat = { x: 10, z: 20, heading: 0, mode: 'sailing' };
  const rig = implementation.createCameraRig(camera, boat);
  let previousPhase = 'inactive', preparing = null;
  for (const frame of frames) {
    camera.aspect = frame.aspect;
    boat.mode = frame.mode;
    if (frame.update) {
      const enteringAim = previousPhase === 'ready' && frame.phase === 'aim';
      if (implementation.cameraModel === 'prepared-horizontal-aft-1.25' && !preparing
        && (frame.preparing || enteringAim)) {
        const position = camera.position.clone(), quaternion = camera.quaternion.clone();
        rig.prepareCast();
        preparing = { position, quaternion, endPosition: camera.position.clone(), endQuaternion: camera.quaternion.clone(), time: 0 };
        camera.position.copy(position); camera.quaternion.copy(quaternion);
      }
      rig.update(frame.dt, { lookX: 0, lookY: 0 }, Boolean(preparing) || (boat.mode === 'fishing' && frame.phase !== 'ready'), frame.tracking);
      if (preparing) {
        preparing.time += frame.dt;
        const t = Math.min(1, preparing.time / 0.1), smooth = t * t * (3 - 2 * t);
        camera.position.lerpVectors(preparing.position, preparing.endPosition, smooth);
        camera.quaternion.slerpQuaternions(preparing.quaternion, preparing.endQuaternion, smooth);
        if (t === 1) preparing = null;
      }
      previousPhase = frame.phase;
    }
  }
  return { position: camera.position.toArray(), quaternion: camera.quaternion.toArray(), aspect: camera.aspect };
}

export function expectedMobileResolution(implementation, profile) {
  const { width, height, dpr, touch } = profile;
  const { pixelRatio } = implementation.calculate({ width, height, devicePixelRatio: dpr, coarsePointer: Boolean(touch) });
  return { pixelRatio, buffer: { width: Math.floor(width * pixelRatio), height: Math.floor(height * pixelRatio) }, aspect: width / height };
}
