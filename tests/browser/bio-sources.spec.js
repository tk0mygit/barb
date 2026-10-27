import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { build } from 'vite';
import { test, expect } from './diagnostics-fixture.js';
import { BIO_VARIANTS } from '../../src/audio/bio-source-assets.js';
import { biteWav } from '../helpers/bite-audio-fixture.js';

test('isolated Vite bundle keeps /barb/ URLs and native decoding/cache at 44.1/48kHz without playback nodes', async ({ page }, info) => {
  const outDir = info.outputPath('isolated-bundle');
  await build({ configFile: false, root: process.cwd(), base: '/barb/', publicDir: false, logLevel: 'warn',
    build: { outDir, emptyOutDir: true, assetsInlineLimit: 0, minify: false,
      rollupOptions: { input: resolve('src/audio/bio-sources.js'), preserveEntrySignatures: 'strict',
        output: { entryFileNames: 'bio-sources.js', chunkFileNames: 'chunks/[name]-[hash].js', assetFileNames: 'assets/[name]-[hash][extname]' } } },
  });
  const emitted = readdirSync(join(outDir, 'assets')).filter(name => name.endsWith('.wav'));
  expect(emitted).toHaveLength(6);
  for (const v of BIO_VARIANTS) {
    const name = emitted.find(file => file.startsWith(`${v.id}-`));
    expect(name, v.id).toBeTruthy();
    expect(createHash('sha256').update(readFileSync(join(outDir, 'assets', name))).digest('hex')).toBe(v.sha256);
  }
  // Test-only route serves the separately built module/assets. The game build
  // and its entrypoints remain unchanged; common diagnostics still apply.
  await page.route('**/barb/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/barb/bio-audio-fixture.html')
      return route.fulfill({ body: '<!doctype html><title>Bio asset decode verification</title>', contentType: 'text/html' });
    const file = resolve(outDir, decodeURIComponent(url.pathname.slice('/barb/'.length)));
    if (relative(outDir, file).startsWith('..')) return route.abort();
    return route.fulfill({ body: readFileSync(file), contentType: file.endsWith('.wav') ? 'audio/wav' : 'text/javascript' });
  });
  await page.goto('./bio-audio-fixture.html');
  const result = await page.evaluate(async () => {
    const { createBioSourceFactory, BIO_VARIANTS } = await import('./bio-sources.js');
    const rates = [];
    for (const sampleRate of [44100, 48000]) {
      const offline = new OfflineAudioContext(1, 1, sampleRate);
      const requests = [], decodes = [];
      let nodes = 0;
      const forbidden = () => { nodes++; throw Error('Unexpected playback node'); };
      const context = { sampleRate, state: 'suspended',
        decodeAudioData(bytes) { decodes.push(bytes.byteLength); return offline.decodeAudioData(bytes); },
        createBufferSource: forbidden, createGain: forbidden, resume: forbidden, close: forbidden };
      const factory = createBioSourceFactory(context, { fetcher(url, options) { requests.push(url); return fetch(url, options); } });
      if (requests.length || decodes.length || nodes) throw Error('Eager side effect');
      const pending = BIO_VARIANTS.map(v => factory.get(v.id));
      if (!pending.every((promise, i) => factory.get(BIO_VARIANTS[i].id) === promise)) throw Error('Promise not shared');
      const buffers = await Promise.all(pending);
      const files = buffers.map((buffer, i) => {
        if (factory.get(BIO_VARIANTS[i].id) !== pending[i]) throw Error('Cache promise changed');
        const data = buffer.getChannelData(0);
        if (!data.every(Number.isFinite) || !data.some(v => Math.abs(v) > .001)) throw Error('Invalid native samples');
        if (data[0] !== 0 || data.at(-1) !== 0) throw Error('Nonzero edge');
        return { id: BIO_VARIANTS[i].id, channels: buffer.numberOfChannels, sampleRate: buffer.sampleRate,
          frames: buffer.length, durationSeconds: buffer.duration, pcmBytes: buffer.length * buffer.numberOfChannels * 4 };
      });
      const cachedSame = (await Promise.all(BIO_VARIANTS.map(v => factory.get(v.id)))).every((b, i) => b === buffers[i]);
      const firstRequestCount = requests.length;
      factory.clear();
      const afterClear = await factory.get('bird-a');
      const reacquired = afterClear !== buffers[0] && requests.length === firstRequestCount + 1;
      factory.dispose();
      let disposedRejected = false;
      try { await factory.get('bird-a'); } catch (error) { disposedRejected = error.name === 'InvalidStateError'; }
      rates.push({ sampleRate, files, requests, decodeCount: decodes.length, nodes, firstRequestCount,
        cachedSame, reacquired, disposedRejected, pcmBytes: files.reduce((sum, v) => sum + v.pcmBytes, 0) });
    }
    return { browser: navigator.userAgent, rates };
  });
  const report = info.outputPath('native-bio-sources.json');
  writeFileSync(report, JSON.stringify(result, null, 2));
  await info.attach('native-bio-sources', { path: report, contentType: 'application/json' });
  for (const row of result.rates) {
    expect(row.firstRequestCount).toBe(6); expect(row.decodeCount).toBe(7); expect(row.nodes).toBe(0);
    expect(row.cachedSame).toBe(true); expect(row.reacquired).toBe(true); expect(row.disposedRejected).toBe(true);
    expect(row.pcmBytes).toBe(row.sampleRate === 44100 ? 3360420 : 3657600);
    for (const url of row.requests) expect(new URL(url).pathname).toMatch(/^\/barb\/assets\/(bird|suzumushi)-[abc]-[^/]+\.wav$/);
    expect(new Set(row.requests.slice(0, 6)).size).toBe(6);
    for (const [index, file] of row.files.entries()) {
      expect(file.channels).toBe(1); expect(file.sampleRate).toBe(row.sampleRate);
      expect(Math.abs(file.durationSeconds - BIO_VARIANTS[index].durationSeconds)).toBeLessThanOrEqual(1 / row.sampleRate);
    }
  }
});

test('integrated game build emits exactly six bio WAVs and one Firefly bite under the Vite base', async ({ page }, info) => {
  const wav = readdirSync('dist/assets').filter(file => file.endsWith('.wav'));
  expect(wav).toHaveLength(7);
  const payloads = [];
  for (const v of BIO_VARIANTS) {
    const matches = wav.filter(name => name.startsWith(v.id + '-'));
    expect(matches, v.id).toHaveLength(1);
    const bytes = readFileSync(join('dist/assets', matches[0])), sha256 = createHash('sha256').update(bytes).digest('hex');
    expect(sha256).toBe(v.sha256);
    payloads.push({ id: v.id, file: matches[0], bytes: bytes.length, sha256 });
  }
  const bite = wav.filter(name => /^waterdrop-[\w-]+\.wav$/.test(name));
  expect(bite).toHaveLength(1);
  const bytes = readFileSync(join('dist/assets', bite[0]));
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  expect(bytes).toEqual(biteWav);
  expect(sha256).toBe('bf4b486ec972012fb5d6529b91f3586451245c0dae2ec25f3ca6b65e7db998ad');
  payloads.push({ id: 'bite-waterdrop', file: bite[0], bytes: bytes.length, sha256 });
  const expectedPath = '/barb/assets/' + bite[0];
  const responsePromise = page.waitForResponse(response => new URL(response.url()).pathname === expectedPath);
  await page.goto('./');
  const response = await responsePromise;
  expect(response.ok()).toBe(true);
  expect(new URL(response.url()).pathname).toBe(expectedPath);
  expect(await response.body()).toEqual(bytes);
  const report = info.outputPath('integrated-wav-payloads.json');
  writeFileSync(report, JSON.stringify({ payloads, notificationURL: response.url() }, null, 2));
  await info.attach('integrated-wav-payloads', { path: report, contentType: 'application/json' });
});
