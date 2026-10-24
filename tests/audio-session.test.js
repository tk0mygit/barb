import test from 'node:test';
import assert from 'node:assert/strict';
import { createAudioSession } from '../src/audio/audio-session.js';
import { createAmbientAudio } from '../src/audio/ambient-audio.js';
import { createGameClock } from '../src/game/game-clock.js';
import { fakeContext } from './helpers/audio-fakes.js';

test('a new gesture resumes the same context while the first request stays pending forever', async () => {
  const context = fakeContext({ deferResume: true }); let creations = 0;
  const session = createAudioSession({ createContext: () => { creations++; return context; } });
  assert.equal(creations, 0); assert.equal(session.status, 'waiting');
  const first = session.unlock();
  assert.equal(context.resumes, 1); assert.equal(session.status, 'starting');
  let firstSettled = false; first.then(() => { firstSettled = true; });
  context.deferResume = false;
  const second = session.unlock();
  // resume must run inside the caller's gesture, before any microtask.
  assert.equal(context.resumes, 2); assert.equal(session.status, 'ready');
  assert.equal(await second, true);
  assert.equal(firstSettled, false); assert.equal(creations, 1);
  session.dispose();
});

for (const outcome of ['resolve', 'reject']) {
  for (const when of ['during the next request', 'after the next request succeeds']) {
    test(`a stale ${outcome} ${when} cannot overwrite the new state`, async () => {
      const context = fakeContext({ deferResume: true });
      const session = createAudioSession({ createContext: () => context });
      const first = session.unlock(), second = session.unlock();
      const settleFirst = () => context.resumeAttempts[0][outcome](new Error('old request'));
      if (when === 'during the next request') {
        settleFirst(); assert.equal(await first, false);
        assert.equal(session.status, 'starting');
      }
      context.change('running');
      context.resumeAttempts[1].resolve();
      assert.equal(await second, true); assert.equal(session.status, 'ready');
      if (when === 'after the next request succeeds') {
        settleFirst(); assert.equal(await first, true);
        assert.equal(session.status, 'ready');
      }
      assert.equal(context.resumes, 2); session.dispose();
    });
  }
}

test('running statechange is authoritative before resume settles, including a later rejection', async () => {
  const context = fakeContext({ deferResume: true });
  const session = createAudioSession({ createContext: () => context });
  const request = session.unlock();
  assert.equal(session.status, 'starting');
  context.change('running'); assert.equal(session.status, 'ready');
  assert.equal(await session.unlock(), true); assert.equal(context.resumes, 1);
  context.resumeAttempts[0].reject(new Error('promise settled after statechange'));
  assert.equal(await request, true); assert.equal(session.status, 'ready');
  session.dispose();
});

test('a stale rejection cannot replace interruption, and a new gesture recovers it', async () => {
  const context = fakeContext({ deferResume: true });
  const session = createAudioSession({ createContext: () => context });
  const first = session.unlock();
  context.change('running'); context.change('interrupted');
  context.resumeAttempts[0].reject(new Error('old request'));
  assert.equal(await first, false); assert.equal(session.status, 'interrupted');
  context.deferResume = false;
  assert.equal(await session.unlock(), true); assert.equal(session.status, 'ready');
  assert.equal(context.resumes, 2); session.dispose();
});

test('rejected and synchronously thrown resume calls stay retryable without false success', async () => {
  const context = fakeContext({ deferResume: true });
  const session = createAudioSession({ createContext: () => context });
  const first = session.unlock();
  context.resumeAttempts[0].reject(new Error('denied'));
  assert.equal(await first, false); assert.equal(session.status, 'blocked');
  const second = session.unlock();
  assert.equal(session.status, 'starting');
  context.resumeAttempts[1].resolve();
  assert.equal(await second, false); assert.equal(session.status, 'interrupted');
  const resume = context.resume;
  context.resume = () => { throw new Error('denied synchronously'); };
  assert.equal(await session.unlock(), false); assert.equal(session.status, 'blocked');
  context.resume = resume; context.deferResume = false;
  assert.equal(await session.unlock(), true); assert.equal(session.status, 'ready');
  session.dispose();
});

for (const outcome of ['resolve', 'reject']) {
  test(`closed context is replaced only on a gesture; old-context ${outcome} is ignored`, async () => {
    const firstContext = fakeContext({ deferResume: true }), secondContext = fakeContext({ deferResume: true });
    let creations = 0;
    const session = createAudioSession({ createContext: () => (++creations === 1 ? firstContext : secondContext) });
    const first = session.unlock();
    firstContext.change('closed'); assert.equal(session.status, 'interrupted');
    assert.equal(creations, 1);
    const second = session.unlock();
    assert.equal(creations, 2); assert.equal(session.context, secondContext);
    firstContext.resumeAttempts[0][outcome](new Error('retired context'));
    assert.equal(await first, false); assert.equal(session.status, 'starting');
    firstContext.change('running'); assert.equal(session.status, 'starting');
    secondContext.change('running'); secondContext.resumeAttempts[0].resolve();
    assert.equal(await second, true); assert.equal(session.status, 'ready');
    assert.equal(await session.unlock(), true); assert.equal(creations, 2);
    session.dispose();
  });
}

for (const outcome of ['resolve', 'reject']) {
  test(`dispose during a pending resume contains its later ${outcome}`, async () => {
    const context = fakeContext({ deferResume: true }); let changes = 0;
    const session = createAudioSession({ createContext: () => context });
    session.subscribe(() => { changes++; });
    const request = session.unlock();
    session.dispose(); const changesAtDispose = changes;
    assert.equal(context.state, 'closed');
    context.resumeAttempts[0][outcome](new Error('disposed request'));
    assert.equal(await request, false); assert.equal(changes, changesAtDispose);
    assert.equal(await session.unlock(), false); assert.equal(context.resumes, 1);
  });
}

test('OFF/ON while resume is pending cannot let an old result restart or block ambient playback', async () => {
  const context = fakeContext({ deferResume: true });
  const session = createAudioSession({ createContext: () => context });
  let plays = 0;
  const ambient = createAmbientAudio({ session, clock: createGameClock(),
    preferencesStore: {
      load: () => ({ preferences: { version: 1, enabled: false, volume: 40 }, persistence: 'default' }),
      save: () => 'saved',
    },
    player: { play() { plays++; }, stop() {}, dispose() {} },
  });
  ambient.setPreferences({ enabled: true });
  ambient.unlock();
  assert.equal(context.resumes, 1); assert.notEqual(ambient.state.playback, 'playing');
  ambient.setPreferences({ enabled: false });
  assert.equal(ambient.state.playback, 'off'); assert.equal(plays, 0);
  ambient.setPreferences({ enabled: true }); context.deferResume = false;
  ambient.unlock(); await Promise.resolve();
  assert.equal(ambient.state.playback, 'playing');
  context.resumeAttempts[0].reject(new Error('old ON request'));
  await Promise.resolve(); await Promise.resolve();
  assert.equal(ambient.state.playback, 'playing'); assert.equal(context.resumes, 2);
  ambient.setPreferences({ enabled: false });
  context.change('interrupted'); assert.equal(ambient.state.playback, 'off');
  ambient.dispose(); session.dispose();
});
