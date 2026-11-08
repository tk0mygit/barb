import test from 'node:test';
import assert from 'node:assert/strict';
import { createRareDiscoveryCue, RARE_CUE_GAIN, RARE_CUE_SECONDS } from '../src/audio/rare-discovery-cue.js';
import { createAudioSession } from '../src/audio/audio-session.js';
import { fakeContext } from './helpers/audio-fakes.js';

function fixture(options = {}) {
  const context = fakeContext(options);
  let created = 0;
  const session = createAudioSession({ createContext: () => { created++; return context; } });
  const documentTarget = Object.assign(new EventTarget(), { hidden: false }), windowTarget = new EventTarget();
  const cue = createRareDiscoveryCue({ session, documentTarget, windowTarget });
  return { context, session, documentTarget, windowTarget, cue, get created() { return created; } };
}
const live = f => f.context.nodes.filter(node => !node.disconnected);

test('never creates or resumes a context; one short sine voice with bounded attack/release', async () => {
  const f = fixture(); f.cue.play(); assert.equal(f.created, 0); assert.equal(f.context.resumes, 0);
  await f.session.unlock(); f.cue.play(); f.cue.play();
  assert.equal(f.created, 1); assert.equal(f.context.resumes, 1); assert.equal(live(f).length, 2);
  const [source, gain] = live(f);
  assert.equal(source.type, 'sine');
  assert.deepEqual(source.frequency.events, [['set', 146.83, 1], ['linear', 110, 1 + RARE_CUE_SECONDS]]);
  assert.deepEqual(gain.gain.events, [['set', 0, 1], ['linear', RARE_CUE_GAIN, 1.025], ['linear', 0, 1 + RARE_CUE_SECONDS]]);
  assert.equal(source.stopTime, 1.32); assert.equal(RARE_CUE_GAIN, .055);
  source.onended(); assert.equal(live(f).length, 0);
  f.cue.dispose(); f.session.dispose();
});

test('blocked, unsupported, interrupted and closed sessions are silent; permission never changes', async () => {
  const f = fixture({ deferResume: true }); const unlocking = f.session.unlock();
  f.cue.play(); assert.equal(live(f).length, 0);
  f.context.resumeAttempts[0].reject(Error('blocked')); await unlocking;
  f.cue.play(); assert.equal(live(f).length, 0); assert.equal(f.context.resumes, 1);
  f.context.change('running'); f.cue.play(); assert.equal(live(f).length, 2);
  for (const state of ['interrupted', 'suspended', 'closed']) {
    f.context.change(state); f.cue.play(); assert.equal(live(f).length, 0);
  }
  f.cue.dispose(); f.session.dispose();
  const session = createAudioSession({ createContext: () => null });
  await session.unlock(); const cue = createRareDiscoveryCue({ session });
  assert.doesNotThrow(() => cue.play()); cue.dispose(); session.dispose();
});

test('hidden/blur/pagehide stop immediately, pageshow never replays; teardown and partial allocation release all nodes', async () => {
  for (const lifecycle of ['hidden', 'blur', 'pagehide', 'dispose', 'gain-failure']) {
    const f = fixture(); await f.session.unlock();
    if (lifecycle === 'gain-failure') f.context.createGain = () => { throw Error('allocation'); };
    f.cue.play();
    if (lifecycle === 'hidden') { f.documentTarget.hidden = true; f.documentTarget.dispatchEvent(new Event('visibilitychange')); f.cue.play(); }
    else if (lifecycle === 'dispose') f.cue.dispose();
    else if (lifecycle !== 'gain-failure') f.windowTarget.dispatchEvent(new Event(lifecycle));
    assert.equal(live(f).length, 0);
    f.windowTarget.dispatchEvent(new Event('pageshow')); assert.equal(live(f).length, 0);
    f.cue.dispose(); f.session.dispose();
  }
});
