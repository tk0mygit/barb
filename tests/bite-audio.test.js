import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createAudioSession } from '../src/audio/audio-session.js';
import { createAmbientAudio } from '../src/audio/ambient-audio.js';
import { createGameClock } from '../src/game/game-clock.js';
import { createFishingAudio, BITE_SOURCE_URL, BITE_GAIN, BITE_OFFSET_SECONDS } from '../src/ui/fishing-audio.js';
import { deferred } from './helpers/audio-fakes.js';
import { biteWav, readPcm, fetchBite, biteContext } from './helpers/bite-audio-fixture.js';

const live = context => context.nodes.filter(n => !n.disconnected);
const sources = context => context.nodes.filter(n => n.type === 'source');
const fixture = (context = biteContext(), options = {}) => {
  const session = createAudioSession({ createContext: () => context });
  const documentTarget = Object.assign(new EventTarget(), { hidden: false }), windowTarget = new EventTarget();
  const audio = createFishingAudio({ session, fetcher: fetchBite, documentTarget, windowTarget, ...options });
  return { context, session, documentTarget, windowTarget, audio };
};
async function ready(f) { await f.session.unlock(); assert.equal(await f.audio.preload(), true); }

test('attached PCM and Adobe provenance are preserved; finite samples, headroom and prompt onset', () => {
  assert.equal(biteWav.length, 192770);
  assert.equal(createHash('sha256').update(biteWav).digest('hex'),
    'bf4b486ec972012fb5d6529b91f3586451245c0dae2ec25f3ca6b65e7db998ad');
  assert.match(biteWav.toString(), /https:\/\/cai-manifests.adobe.com\/manifests\//);
  const pcm = readPcm(biteWav);
  assert.equal(pcm.sampleRate, 48000); assert.equal(pcm.channels, 2);
  assert.equal(pcm.length, 48000); assert.equal(pcm.duration, 1);
  let peak = 0, energy = 0, clipped = 0, first = Infinity;
  for (const channel of pcm.data) for (let i = 0; i < channel.length; i++) {
    const value = channel[i];
    assert.ok(Number.isFinite(value));
    peak = Math.max(peak, Math.abs(value)); energy += value * value;
    if (Math.abs(value) >= 32767 / 32768) clipped++;
    if (i >= BITE_OFFSET_SECONDS * pcm.sampleRate && Math.abs(value * BITE_GAIN) > 0.01)
      first = Math.min(first, i / pcm.sampleRate - BITE_OFFSET_SECONDS);
  }
  assert.equal(peak, 0.984375); assert.equal(clipped, 0);
  assert.ok(Math.abs(Math.sqrt(energy / (pcm.length * pcm.channels)) - 0.03350870665710903) < 1e-10);
  assert.ok(first >= 0 && first < 0.02, 'waveform onset ' + first + 's');
  assert.ok(peak * BITE_GAIN < 0.2);
});

test('fetch starts ahead of unlock, shares one request, and neither bite nor late preparation queues audio', async () => {
  const request = deferred(); let fetches = 0, requestedUrl;
  const f = fixture(biteContext(), { fetcher: url => { fetches++; requestedUrl = url; return request.promise; } });
  const preparation = f.audio.preload();
  await Promise.resolve();
  assert.equal(fetches, 1); assert.equal(requestedUrl, BITE_SOURCE_URL);
  assert.equal(f.session.context, undefined); assert.equal(f.context.decodes, 0);
  assert.equal(f.audio.bite(), undefined);
  await f.session.unlock();
  for (let i = 0; i < 20; i++) f.audio.bite();
  assert.equal(fetches, 1); assert.equal(sources(f.context).length, 0);
  request.resolve(await fetchBite()); assert.equal(await preparation, true);
  assert.equal(sources(f.context).length, 0); assert.equal(f.context.decodes, 1);
  f.audio.bite(); assert.equal(sources(f.context).length, 1);
  assert.equal(fetches, 1); assert.equal(f.context.decodes, 1);
  f.audio.dispose(); f.session.dispose();
});

test('a pending decoder skips the current bite and completion cannot play it later', async () => {
  const decoded = deferred(), context = biteContext();
  const buffer = context.createBuffer(2, 48000, 48000);
  context.decodeAudioData = () => { context.decodes++; return decoded.promise; };
  const f = fixture(context); await f.session.unlock();
  const pending = f.audio.preload();
  await new Promise(setImmediate);
  assert.equal(context.decodes, 1); f.audio.bite(); assert.equal(sources(context).length, 0);
  decoded.resolve(buffer); assert.equal(await pending, true);
  assert.equal(sources(context).length, 0);
  f.audio.bite(); assert.equal(sources(context).length, 1);
  f.audio.dispose(); f.session.dispose();
});

test('1000 consecutive bites retain one decoded buffer and at most one source/gain pair', async () => {
  const f = fixture(); await ready(f);
  let pcm, oldEnded, maximum = 0;
  for (let i = 0; i < 1000; i++) {
    f.audio.bite(); maximum = Math.max(maximum, live(f.context).length);
    const source = sources(f.context).at(-1);
    pcm ??= source.buffer; assert.equal(source.buffer, pcm);
    if (oldEnded) oldEnded();
    assert.equal(live(f.context).length, 2); oldEnded = source.onended;
  }
  assert.equal(maximum, 2); assert.equal(f.context.decodes, 1);
  assert.equal(pcm.length * pcm.numberOfChannels * 4, 384000);
  const current = sources(f.context).at(-1); current.onended();
  assert.equal(live(f.context).length, 0);
  assert.ok(sources(f.context).every(n => n.buffer === null));
  f.audio.dispose(); f.session.dispose();
});

for (const reason of ['blur', 'hidden', 'pagehide', 'interrupted', 'suspended', 'closed', 'dispose', 'webglcontextlost']) {
  test('active bite releases immediately on ' + reason + ' and never resumes the old voice', async () => {
    const f = fixture(); await ready(f); f.audio.bite();
    assert.equal(live(f.context).length, 2);
    const resumes = f.context.resumes, starts = sources(f.context).length;
    if (reason === 'hidden') { f.documentTarget.hidden = true; f.documentTarget.dispatchEvent(new Event('visibilitychange')); }
    else if (['interrupted', 'suspended', 'closed'].includes(reason)) f.context.change(reason);
    else if (reason === 'dispose') f.audio.dispose();
    else f.windowTarget.dispatchEvent(new Event(reason));
    assert.equal(live(f.context).length, 0);
    assert.ok(sources(f.context).every(n => n.buffer === null && n.stopped));
    f.documentTarget.hidden = false; f.documentTarget.dispatchEvent(new Event('visibilitychange'));
    f.windowTarget.dispatchEvent(new Event('focus')); f.windowTarget.dispatchEvent(new Event('pageshow'));
    await Promise.resolve();
    assert.equal(f.context.resumes, resumes); assert.equal(sources(f.context).length, starts);
    assert.equal(live(f.context).length, 0);
    if (['dispose', 'webglcontextlost'].includes(reason)) {
      f.audio.bite(); assert.equal(sources(f.context).length, starts);
      assert.equal(await f.audio.unlock(), false); assert.equal(f.context.resumes, resumes);
    }
    f.audio.dispose(); f.session.dispose();
  });
}

test('hidden/pagehide bites are skipped; a fresh bite after return uses cached PCM', async () => {
  const f = fixture(); await ready(f);
  f.documentTarget.hidden = true; f.audio.bite(); assert.equal(sources(f.context).length, 0);
  f.documentTarget.hidden = false; f.windowTarget.dispatchEvent(new Event('pagehide'));
  f.audio.bite(); assert.equal(sources(f.context).length, 0);
  f.windowTarget.dispatchEvent(new Event('pageshow')); f.audio.bite();
  assert.equal(sources(f.context).length, 1); assert.equal(f.context.decodes, 1);
  f.audio.dispose(); f.session.dispose();
});

for (const failure of ['http', 'fetch-throw', 'body', 'decode', 'invalid-pcm', 'oversized']) {
  test(failure + ' is silent, bounded and retryable on a fresh session unlock', async () => {
    const context = biteContext(), decode = context.decodeAudioData;
    let broken = true, fetches = 0;
    context.decodeAudioData = bytes => {
      if (broken && failure === 'decode') return Promise.reject(Error('decoder'));
      if (broken && failure === 'invalid-pcm') {
        const bad = context.createBuffer(2, 48000, 48000); bad.getChannelData(0)[0] = NaN;
        return Promise.resolve(bad);
      }
      return decode(bytes);
    };
    const f = fixture(context, { fetcher: async () => {
      fetches++;
      if (broken && failure === 'fetch-throw') throw Error('request');
      if (broken && failure === 'http') return { ok: false, status: 404 };
      if (broken && failure === 'body') return { ok: true, arrayBuffer: () => Promise.reject(Error('body')) };
      if (broken && failure === 'oversized') return { ok: true, arrayBuffer: async () => new ArrayBuffer(262145) };
      return fetchBite();
    } });
    await f.session.unlock(); assert.equal(await f.audio.preload(), false);
    const attempts = fetches;
    for (let i = 0; i < 20; i++) assert.doesNotThrow(() => f.audio.bite());
    assert.equal(await f.audio.preload(), false); assert.equal(fetches, attempts);
    assert.equal(live(context).length, 0);
    context.change('interrupted'); broken = false;
    await ready(f); f.audio.bite(); assert.equal(live(context).length, 2);
    f.audio.dispose(); f.session.dispose();
  });
}

for (const failure of ['source', 'gain', 'connect', 'start', 'stop']) {
  test('partial ' + failure + ' failure cannot leak nodes or escape bite()', async () => {
    const f = fixture(); await ready(f);
    const create = f.context.createBufferSource;
    f.context.createBufferSource = () => {
      if (failure === 'source') throw Error('source');
      const source = create();
      if (failure === 'connect') source.connect = () => { throw Error('connect'); };
      if (failure === 'start') source.start = () => { throw Error('start'); };
      if (failure === 'stop') source.stop = () => { throw Error('stop'); };
      return source;
    };
    if (failure === 'gain') f.context.createGain = () => { throw Error('gain'); };
    assert.doesNotThrow(() => f.audio.bite()); assert.equal(live(f.context).length, 0);
    assert.ok(sources(f.context).every(n => n.buffer === null));
    f.audio.dispose(); f.session.dispose();
  });
}

test('session disposal clears its subscribers first, but the direct context observer still releases the voice', async () => {
  const f = fixture(); await ready(f); f.audio.bite(); f.session.dispose();
  assert.equal(live(f.context).length, 0); assert.equal(await f.audio.preload(), false);
  f.audio.bite(); assert.equal(live(f.context).length, 0); f.audio.dispose();
});

test('pending decode is discarded across close/replacement; only one decoder may be in flight', async () => {
  const old = biteContext(), next = biteContext(), pending = deferred(); let calls = 0;
  const session = createAudioSession({ createContext: () => session.context ? next : old });
  old.decodeAudioData = () => { calls++; return pending.promise; };
  const audio = createFishingAudio({ session, fetcher: fetchBite });
  await session.unlock(); const first = audio.preload(); await new Promise(setImmediate);
  old.change('closed'); await session.unlock(); audio.bite();
  assert.equal(next.decodes, 0); assert.equal(calls, 1);
  pending.resolve(old.createBuffer(2, 48000, 48000)); assert.equal(await first, false);
  assert.equal(await audio.preload(), true);
  assert.equal(next.decodes, 1); assert.equal(sources(next).length, 0);
  audio.bite(); assert.equal(sources(next).length, 1);
  audio.dispose(); session.dispose();
});

test('dispose aborts an outstanding request and stale completion retains no playable PCM', async () => {
  const request = deferred(); let signal;
  const f = fixture(biteContext(), { fetcher: (_url, options) => { signal = options.signal; return request.promise; } });
  await f.session.unlock(); const pending = f.audio.preload(); await Promise.resolve();
  f.audio.dispose(); assert.equal(signal.aborted, true);
  request.resolve(await fetchBite()); assert.equal(await pending, false);
  f.audio.bite(); assert.equal(f.context.decodes, 0); assert.equal(live(f.context).length, 0);
  f.session.dispose();
});

test('ambient OFF/zero and resume rejection never couple the notification to settings or input', async () => {
  const f = fixture(), clock = createGameClock();
  const ambient = createAmbientAudio({ session: f.session, clock,
    player: { play() { throw Error('OFF must not play'); }, stop() {}, dispose() {} },
    bioPlayer: { update() {}, dispose() {} },
    preferencesStore: { load: () => ({ preferences: { version: 1, enabled: false, volume: 0 } }), save: () => 'saved' } });
  f.context.resume = () => Promise.reject(Error('denied'));
  assert.equal(await f.audio.unlock(), false); await f.audio.preload();
  f.audio.bite(); assert.equal(live(f.context).length, 0); assert.equal(ambient.state.playback, 'off');
  f.context.resume = () => { f.context.change('running'); return Promise.resolve(); };
  await ready(f); f.audio.bite(); assert.equal(live(f.context).length, 2);
  assert.equal(ambient.state.playback, 'off');
  ambient.dispose(); f.audio.dispose(); f.session.dispose();
});

test('unsupported audio stays silent and does not create a context or voice', async () => {
  const session = createAudioSession({ createContext: () => null });
  const audio = createFishingAudio({ session, fetcher: fetchBite });
  assert.equal(await audio.unlock(), false); assert.equal(await audio.preload(), false);
  assert.doesNotThrow(() => audio.bite()); audio.dispose(); session.dispose();
});
