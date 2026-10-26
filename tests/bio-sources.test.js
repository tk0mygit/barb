import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { createBioSourceFactory, BIO_VARIANTS } from '../src/audio/bio-sources.js';
import { BIO_SOURCE_URLS } from '../src/audio/bio-source-assets.js';
import { validateBioWav } from '../src/audio/bio-source-validation.js';
import { deferred } from './helpers/audio-fakes.js';

const files = new Map(Object.values(BIO_SOURCE_URLS).map(url => [url, readFileSync(new URL(url))]));
function pcmBuffer(input) {
  const info = validateBioWav(input), view = new DataView(input);
  const data = new Float32Array(info.frames);
  for (let i = 0; i < data.length; i++) data[i] = view.getInt16(info.dataOffset + i * 2, true) / 32768;
  return { sampleRate: 44100, length: data.length, duration: data.length / 44100,
    numberOfChannels: 1, getChannelData: () => data };
}
function harness({ fetcher, decoder } = {}) {
  const fetches = [], decodes = [];
  const context = { sampleRate: 44100, state: 'suspended',
    decodeAudioData(bytes) { decodes.push(bytes); return decoder ? decoder(bytes, decodes.length) : Promise.resolve(pcmBuffer(bytes)); },
    createBufferSource() { assert.fail('must not create source'); },
    createGain() { assert.fail('must not create gain'); },
    resume() { assert.fail('must not unlock'); }, close() { assert.fail('must not close shared context'); } };
  const factory = createBioSourceFactory(context, { fetcher(url, options) {
    assert(files.has(url), 'only fixed, known asset URLs may be requested');
    fetches.push({ url, signal: options.signal });
    return fetcher ? fetcher(url, options, fetches.length) : Promise.resolve(new Response(files.get(url)));
  } });
  return { factory, fetches, decodes, context };
}
const aborted = promise => assert.rejects(promise, { name: 'AbortError' });

test('six real delivered WAVs load/decode once; all callers share promises and cached AudioBuffers', async () => {
  const h = harness();
  const promises = BIO_VARIANTS.map(v => h.factory.get(v.id));
  promises.forEach((p, i) => assert.equal(p, h.factory.get(BIO_VARIANTS[i].id)));
  assert.equal(new Set(promises).size, 6);
  const buffers = await Promise.all(promises);
  assert.equal(new Set(buffers).size, 6); assert.equal(h.fetches.length, 6); assert.equal(h.decodes.length, 6);
  let memory = 0;
  for (const [i, v] of BIO_VARIANTS.entries()) {
    assert.equal(h.factory.get(v.id), promises[i]);
    assert.equal(await h.factory.get(v.id), buffers[i]);
    assert.equal(buffers[i].length, v.frames); assert.equal(buffers[i].duration, v.durationSeconds);
    assert(buffers[i].getChannelData(0).some(value => value !== 0));
    memory += buffers[i].getChannelData(0).byteLength;
  }
  assert.equal(memory, 3360420);
  h.factory.clear();
  assert.notEqual(await h.factory.get('bird-a'), buffers[0]);
  assert.equal(h.fetches.length, 7); assert.equal(h.decodes.length, 7);
  h.factory.dispose();
});

test('invalid IDs are rejected without fetch/decode and cannot use inherited URL properties', async () => {
  const h = harness();
  for (const id of ['bird-d', '__proto__', 'constructor', '', null, undefined, 0, {}])
    await assert.rejects(h.factory.get(id), RangeError);
  assert.equal(h.fetches.length, 0); assert.equal(h.decodes.length, 0); h.factory.dispose();
});

for (const kind of ['network', 'http', 'body', 'decode']) {
  test(`${kind} failure rejects shared callers, releases failed entry and allows retry`, async () => {
    const expected = new Error(`intentional ${kind} failure`);
    const h = harness({
      fetcher(url, options, attempt) {
        if (attempt === 1) {
          if (kind === 'network') return Promise.reject(expected);
          if (kind === 'http') return Promise.resolve(new Response('', { status: 503 }));
          if (kind === 'body') return Promise.resolve({ ok: true, arrayBuffer: () => Promise.reject(expected) });
        }
        return Promise.resolve(new Response(files.get(url)));
      },
      decoder(bytes, attempt) { return kind === 'decode' && attempt === 1 ? Promise.reject(expected) : Promise.resolve(pcmBuffer(bytes)); },
    });
    const first = h.factory.get('bird-a'); assert.equal(first, h.factory.get('bird-a'));
    await assert.rejects(first, kind === 'http' ? /503/ : error => error === expected);
    assert.equal(h.fetches[0].signal.aborted, true);
    const retry = h.factory.get('bird-a'); assert.notEqual(first, retry);
    assert.equal((await retry).length, BIO_VARIANTS[0].frames);
    assert.equal(h.fetches.length, 2); h.factory.dispose();
  });
}

test('corrupt WAV and same-format sample tampering fail before decode and are retryable', async () => {
  for (const corruption of ['truncated', 'sample', 'wrong-id']) {
    const h = harness({ fetcher(url, options, attempt) {
      let bytes = Buffer.from(files.get(url));
      if (attempt === 1) {
        if (corruption === 'truncated') bytes = bytes.subarray(0, -2);
        if (corruption === 'sample') bytes[1000] ^= 1;
        if (corruption === 'wrong-id') bytes = files.get(BIO_SOURCE_URLS['bird-b']);
      }
      return Promise.resolve(new Response(bytes));
    } });
    await assert.rejects(h.factory.get('bird-a'), corruption === 'sample' ? /SHA-256/ : /WAV/);
    assert.equal(h.decodes.length, 0);
    await h.factory.get('bird-a'); assert.equal(h.decodes.length, 1); h.factory.dispose();
  }
});

test('invalid decoded buffers are rejected rather than cached as successful results', async () => {
  for (const change of [b => null, b => ({ ...b, numberOfChannels: 2 }), b => ({ ...b, length: b.length - 5 }),
    b => ({ ...b, sampleRate: 48000 }), b => ({ ...b, duration: NaN }),
    b => { b.getChannelData(0)[10] = NaN; return b; }]) {
    const h = harness({ decoder(bytes, attempt) { const buffer = pcmBuffer(bytes); return Promise.resolve(attempt === 1 ? change(buffer) : buffer); } });
    await assert.rejects(h.factory.get('bird-a'), TypeError);
    await h.factory.get('bird-a'); assert.equal(h.decodes.length, 2); h.factory.dispose();
  }
});

test('clear before work starts immediately invalidates the request without starting fetch', async () => {
  const h = harness(), pending = h.factory.get('bird-a'), rejection = aborted(pending);
  h.factory.clear(); await rejection;
  assert.equal(h.fetches.length, 0); assert.equal(h.decodes.length, 0);
  await h.factory.get('bird-a'); assert.equal(h.fetches.length, 1); h.factory.dispose();
});

test('clear aborts an in-flight fetch; late failure cannot evict a newer cached request', async () => {
  const response = deferred(), started = deferred();
  const h = harness({ fetcher(url, options, attempt) {
    if (attempt === 1) { started.resolve(); return response.promise; } // deliberately ignores AbortSignal
    return Promise.resolve(new Response(files.get(url)));
  } });
  const old = h.factory.get('bird-a'); await started.promise;
  const rejection = aborted(old); h.factory.clear(); await rejection;
  assert.equal(h.fetches[0].signal.aborted, true);
  const fresh = h.factory.get('bird-a'), buffer = await fresh;
  response.reject(new Error('late old failure')); await nextTurn();
  assert.equal(h.factory.get('bird-a'), fresh); assert.equal(await fresh, buffer);
  assert.equal(h.decodes.length, 1); h.factory.dispose();
});

test('clear discards an unabortable old decode while the next generation remains reusable', async () => {
  const decode = deferred(), started = deferred();
  let oldBuffer;
  const h = harness({ decoder(bytes, attempt) {
    const buffer = pcmBuffer(bytes);
    if (attempt === 1) { oldBuffer = buffer; started.resolve(); return decode.promise; }
    return Promise.resolve(buffer);
  } });
  const old = h.factory.get('bird-a'); await started.promise;
  const rejection = aborted(old); h.factory.clear(); await rejection;
  const fresh = h.factory.get('bird-a'); const freshBuffer = await fresh;
  decode.resolve(oldBuffer); await nextTurn();
  assert.notEqual(freshBuffer, oldBuffer); assert.equal(h.factory.get('bird-a'), fresh);
  assert.equal(h.decodes.length, 2); h.factory.dispose();
});

test('dispose during fetch rejects promptly, aborts ownership, and never starts late decode', async () => {
  const response = deferred(), started = deferred();
  const h = harness({ fetcher() { started.resolve(); return response.promise; } });
  const pending = h.factory.get('bird-a'); await started.promise;
  const rejection = aborted(pending); h.factory.dispose(); await rejection;
  assert.equal(h.fetches[0].signal.aborted, true);
  response.resolve(new Response(files.get(BIO_SOURCE_URLS['bird-a']))); await nextTurn();
  assert.equal(h.decodes.length, 0);
  h.factory.clear(); h.factory.dispose();
  await assert.rejects(h.factory.get('bird-a'), { name: 'InvalidStateError' });
});

test('dispose during decode discards the late AudioBuffer and cannot resurrect the factory', async () => {
  const decode = deferred(), started = deferred(); let buffer;
  const h = harness({ decoder(bytes) { buffer = pcmBuffer(bytes); started.resolve(); return decode.promise; } });
  const pending = h.factory.get('bird-a'); await started.promise;
  const rejection = aborted(pending); h.factory.dispose(); await rejection;
  decode.resolve(buffer); await nextTurn();
  await assert.rejects(h.factory.get('bird-a'), { name: 'InvalidStateError' });
  assert.equal(h.fetches.length, 1); assert.equal(h.decodes.length, 1);
});

test('a closed supplied context is rejected without network and constructor validates its dependencies', async () => {
  const h = harness(); h.context.state = 'closed';
  await assert.rejects(h.factory.get('bird-a'), { name: 'InvalidStateError' });
  assert.equal(h.fetches.length, 0); h.factory.dispose();
  for (const context of [null, {}, { sampleRate: NaN, decodeAudioData() {} }])
    assert.throws(() => createBioSourceFactory(context), TypeError);
  assert.throws(() => createBioSourceFactory({ sampleRate: 44100, decodeAudioData() {} }, { fetcher: null }), TypeError);
});

test('unused module/factory never fetches, decodes, constructs AudioContexts or playback nodes', () => {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    let calls=0;
    const forbidden=()=>{calls++;throw Error('unexpected side effect')};
    globalThis.AudioContext=class { constructor(){forbidden()} };
    globalThis.OfflineAudioContext=globalThis.AudioContext;
    globalThis.fetch=forbidden;
    const {createBioSourceFactory}=await import('./src/audio/bio-sources.js');
    const factory=createBioSourceFactory({sampleRate:44100,decodeAudioData:forbidden,
      createBufferSource:forbidden,createGain:forbidden,resume:forbidden,close:forbidden});
    assert.equal(factory.variants.length,6);factory.clear();factory.dispose();assert.equal(calls,0);
  `], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});
