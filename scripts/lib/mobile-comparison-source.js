import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

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
  const implementation = { sha,
    mainBlob: await mobileGit('rev-parse', `${sha}:src/main.js`),
    hudBlob: await mobileGit('rev-parse', `${sha}:src/ui/style.css`) };
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

export function mobileSourceMetadata({ calculate, ...metadata }) { return metadata; }

export async function assertMobileWorkingSource(implementation) {
  for (const [file, expected] of [['src/main.js', implementation.mainBlob], ['src/ui/style.css', implementation.hudBlob],
    ...(implementation.resolutionBlob ? [['src/rendering/resolution.js', implementation.resolutionBlob]] : [])]) {
    assert.equal(await mobileGit('hash-object', file), expected, `${file}: working source differs from recorded SHA`);
  }
}

export function expectedMobileResolution(implementation, profile) {
  const { width, height, dpr, touch } = profile;
  const { pixelRatio } = implementation.calculate({ width, height, devicePixelRatio: dpr, coarsePointer: Boolean(touch) });
  return { pixelRatio, buffer: { width: Math.floor(width * pixelRatio), height: Math.floor(height * pixelRatio) }, aspect: width / height };
}
