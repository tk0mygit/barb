import { writeFile } from 'node:fs/promises';
import { expect } from './diagnostics-fixture.js';
import { FISH_SPECIES } from '../../src/game/fish-species.js';

// Reuse mobile-capture's read-only renderer probe. Collect at scenario
// checkpoints, never retain scenes, textures, renderer instances or frame logs.
export async function createResourceDiagnostics(page) {
  const samples = [], errors = [], imageRequests = new Map();
  const onError = error => { if (errors.length < 100) errors.push({ type: 'pageerror', message: error.message }); };
  const onConsole = message => {
    if (message.type() === 'error' && errors.length < 100) errors.push({ type: 'console.error', message: message.text() });
  };
  const onRequest = request => {
    if (request.resourceType() === 'image') imageRequests.set(request.url(), (imageRequests.get(request.url()) ?? 0) + 1);
  };
  page.on('pageerror', onError); page.on('console', onConsole); page.on('request', onRequest);
  await page.addInitScript(() => {
    window.resourceContextLosses = 0;
    // Capture also observes the non-bubbling canvas event.
    document.addEventListener('webglcontextlost', () => window.resourceContextLosses++, true);
  });
  const cdp = await page.context().newCDPSession(page);
  return {
    samples,
    async snapshot(label) {
      const state = await page.evaluate(() => {
        const p = window.lightingProbe?.last;
        return {
          renderer: window.mobileProbe ?? null,
          environment: p ? { boat: p.boat, boatSpeed: p.boatSpeed, waterTime: p.waterTime,
            fogStrength: p.fogStrength, mistAmount: p.mistAmount, fogDensity: p.fogDensity,
            sunDirection: p.sunDirection, moonDirection: p.moonDirection } : null,
          contextLosses: window.resourceContextLosses,
          phase: document.querySelector('#fishing-panel')?.dataset.phase,
          imagesInDOM: [...document.images].map(image => ({ src: image.currentSrc || image.src,
            complete: image.complete, width: image.naturalWidth, height: image.naturalHeight })),
        };
      });
      // CDP heap is JavaScript memory for the page isolate, not GPU memory or
      // decoded-image / audio-PCM cache usage. Do not force GC or assert a noisy
      // used-heap plateau from a short sample.
      let heap;
      try { heap = { available: true, ...await cdp.send('Runtime.getHeapUsage') }; }
      catch (error) { heap = { available: false, reason: error.message }; }
      const sample = { label, ...state, heap,
        images: { uniqueUrls: [...imageRequests.keys()].sort(),
          requests: [...imageRequests.values()].reduce((sum, count) => sum + count, 0),
          requestCounts: Object.fromEntries(imageRequests) }, errors: [...errors] };
      samples.push(sample);
      return sample;
    },
    async save(info) {
      try {
        const path = info.outputPath('resource-stability.json');
        await writeFile(path, JSON.stringify({ samples, errors,
          imageRequests: Object.fromEntries(imageRequests),
          limits: ['Finite accelerated gameplay checkpoints; not a real-time endurance test.',
            'Renderer counts describe live renderer resources, not GPU memory in bytes.',
            'CDP usedSize/totalSize describe JavaScript heap; GC timing can change them.',
            'Image URL/request counts observe reuse; decoded browser cache size is unavailable.',
            'Audio PCM cache behavior is covered separately by audio diagnostics.'] }, null, 2));
        await info.attach('resource-stability', { path, contentType: 'application/json' });
      } finally {
        page.off('pageerror', onError); page.off('console', onConsole); page.off('request', onRequest);
        // A timed-out test may already have closed its page. Keep the original
        // failure and the saved samples instead of adding a teardown error.
        try { await cdp.detach(); }
        catch (error) { if (!page.isClosed()) throw error; }
      }
    },
  };
}

export function assertResourcePlateau(before, after) {
  expect(before.renderer).not.toBeNull(); expect(after.renderer).not.toBeNull();
  // Guard the measurement conditions before comparing submitted work. Aspect
  // changes / culling are not evidence of a leak. Camera smoothing has a tiny
  // floating-point tail, so use a spatial tolerance rather than exact equality.
  expect(after.renderer.viewport).toEqual(before.renderer.viewport);
  expect(after.renderer.dpr).toBe(before.renderer.dpr);
  expect(after.renderer.pixelRatio).toBe(before.renderer.pixelRatio);
  expect(after.renderer.buffer).toEqual(before.renderer.buffer);
  expect(after.renderer.camera.aspect).toBe(before.renderer.camera.aspect);
  for (const key of ['position', 'quaternion']) {
    after.renderer.camera[key].forEach((value, i) => expect(value).toBeCloseTo(before.renderer.camera[key][i], 5));
  }
  after.environment.boat.forEach((value, i) => expect(value).toBeCloseTo(before.environment.boat[i], 5));
  expect(after.environment.boatSpeed).toBe(0); expect(before.environment.boatSpeed).toBe(0);
  for (const key of ['sunDirection', 'moonDirection']) {
    after.environment[key].forEach((value, i) => expect(value).toBeCloseTo(before.environment[key][i], 4));
  }
  for (const key of ['fogStrength', 'mistAmount', 'fogDensity']) expect(after.environment[key]).toBe(before.environment[key]);
  expect(after.phase).toBe('ready'); expect(before.phase).toBe('ready');
  expect(after.renderer.resources).toEqual(before.renderer.resources);
  expect(before.contextLosses).toBe(0); expect(after.contextLosses).toBe(0);
  expect(before.errors).toEqual([]); expect(after.errors).toEqual([]);
  // The browser may legitimately cache newly discovered art. The namespace is
  // bounded by the registry and one silhouette, not by catches or menu opens.
  expect(after.images.uniqueUrls.length).toBeLessThanOrEqual(FISH_SPECIES.length + 1);
}
