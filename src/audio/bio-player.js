import { createBioSourceFactory, BIO_VARIANTS } from './bio-sources.js';
import { createBioScheduler, BIO_SCHEDULE_CONFIG } from './bio-schedule.js';
import { AMBIENT_GAIN } from './ambient-player.js';
import { sampleAudioMix } from './audio-mix.js';
import { FOG_TYPE } from '../world/night-fog.js';
import { GAME_CLOCK_CONFIG } from '../game/game-clock.js';

export const BIO_VOICE_GAIN = .45;
export const BIO_DENSE_FACTOR = .4;
export const BIO_FADE_SECONDS = .04;
export const BIO_PRELOAD_SECONDS = 30;
export const BIO_RETRY_SECONDS = 15;

export function sampleBioGain(mix, volume, timeOfDay) {
  const dense = timeOfDay === 'night' && mix.fogType === FOG_TYPE.DENSE_FOG ? mix.intensity : 0;
  return BIO_VOICE_GAIN * AMBIENT_GAIN * Math.max(0, Math.min(100, volume)) / 100
    * (1 - (1 - BIO_DENSE_FACTOR) * dense);
}

// Owns one one-shot and one six-entry factory, never an AudioContext or a JS
// timer. The existing ambient controller supplies unlock and stop reasons.
export function createBioPlayer({ clock, makeFactory = createBioSourceFactory, scheduler = createBioScheduler() }) {
  let context, factory, voice, pending, active = false, disposed = false, epoch = 0, bankEpoch = 0;
  let volume = 0, previousClock, factoryRetryAt = 0, attemptedContext, consumed = -Infinity, lastEventId;
  const ready = new Map(), loading = new Map(), retryAt = new Map();
  const counts = { starts: 0, released: 0, loadFailures: 0, playbackFailures: 0,
    expired: 0, busy: 0, largeSteps: 0, largestStepSeconds: 0 };
  function detachUnusedContext() {
    if (factory || voice || !context) return;
    context.removeEventListener('statechange', contextChanged); context = undefined;
  }
  function invalidate() { active = false; epoch++; pending = undefined; }
  function sync() { scheduler.sync(clock.state); previousClock = undefined; }
  function release(entry) {
    if (!entry || voice !== entry) return;
    voice = undefined;
    entry.source.onended = null;
    try { entry.source.stop(); } catch { /* ended or unavailable context */ }
    try { entry.source.disconnect(); } catch { /* best effort teardown */ }
    try { entry.gain?.disconnect(); } catch { /* partial allocation */ }
    entry.source.buffer = null; entry.ramp = null;
    counts.released++; detachUnusedContext();
  }
  function ramp(entry, target) {
    const now = entry.context.currentTime, prior = entry.ramp;
    const progress = prior ? Math.max(0, Math.min(1, (now - prior.time) / BIO_FADE_SECONDS)) : 0;
    const from = prior ? prior.from + (prior.target - prior.from) * progress : 0;
    const gain = entry.gain.gain;
    gain.cancelScheduledValues(now); gain.setValueAtTime(from, now);
    gain.linearRampToValueAtTime(target, now + BIO_FADE_SECONDS);
    entry.ramp = { from, target, time: now };
  }
  function stopVoice(immediate = false) {
    const entry = voice;
    if (!entry) return;
    if (immediate || entry.context.state !== 'running') { release(entry); return; }
    if (entry.stopping) return;
    try {
      ramp(entry, 0); entry.stopping = true;
      entry.source.stop(entry.context.currentTime + BIO_FADE_SECONDS);
    } catch { release(entry); }
  }
  function discardBank() {
    bankEpoch++;
    const old = factory; factory = undefined;
    ready.clear(); loading.clear(); retryAt.clear();
    try { old?.dispose(); } catch { /* bio failure cannot affect other layers */ }
    detachUnusedContext();
  }
  function contextChanged() {
    if (context?.state === 'running') return;
    invalidate(); stopVoice(true);
    try { sync(); } catch { /* shutdown may already have invalidated the clock */ }
    if (context?.state === 'closed') discardBank();
  }
  function ensureFactory(next, now) {
    if (context !== next) {
      invalidate(); stopVoice(true); discardBank();
      if (context) { context.removeEventListener('statechange', contextChanged); context = undefined; }
      if (attemptedContext !== next) factoryRetryAt = 0;
      attemptedContext = next;
    }
    if (factory) return true;
    if (now.elapsedSeconds < factoryRetryAt) return false;
    try {
      if (!context) { context = next; context.addEventListener('statechange', contextChanged); }
      factory = makeFactory(context); return true;
    } catch {
      counts.loadFailures++; factoryRetryAt = now.elapsedSeconds + BIO_RETRY_SECONDS;
      detachUnusedContext(); return false;
    }
  }
  function load(id, now) {
    if (ready.has(id)) return Promise.resolve(ready.get(id));
    if (loading.has(id)) return loading.get(id);
    if (!factory || now.elapsedSeconds < (retryAt.get(id) ?? 0)) return Promise.resolve(null);
    const bank = factory, generation = bankEpoch;
    const promise = Promise.resolve().then(() => bank.get(id)).then(buffer => {
      if (disposed || factory !== bank || bankEpoch !== generation) return null;
      ready.set(id, buffer); retryAt.delete(id); return buffer;
    }, () => {
      if (!disposed && factory === bank && bankEpoch === generation) {
        counts.loadFailures++; retryAt.set(id, clock.state.elapsedSeconds + BIO_RETRY_SECONDS);
      }
      return null;
    }).catch(() => null).then(buffer => {
      if (loading.get(id) === promise) loading.delete(id);
      return buffer;
    });
    loading.set(id, promise); return promise;
  }
  function prepare(now) {
    const seconds = now.timeOfDay === 'day' ? GAME_CLOCK_CONFIG.daySeconds : GAME_CLOCK_CONFIG.nightSeconds;
    const lookAhead = (1 - now.phaseProgress) * seconds <= BIO_PRELOAD_SECONDS;
    for (const v of BIO_VARIANTS) {
      if ((lookAhead || (v.kind === 'bird') === (now.timeOfDay === 'day'))
        && !ready.has(v.id) && !loading.has(v.id) && now.elapsedSeconds >= (retryAt.get(v.id) ?? 0)) void load(v.id, now);
    }
  }
  function start(buffer, event, now) {
    let entry;
    try {
      const source = context.createBufferSource();
      entry = { source, context, event, gain: null, ramp: null, stopping: false };
      voice = entry; // Track the source before any later allocation can fail.
      const gain = entry.gain = context.createGain();
      source.buffer = buffer; source.loop = false;
      gain.gain.setValueAtTime(0, context.currentTime);
      source.connect(gain).connect(context.destination);
      source.onended = () => release(entry);
      ramp(entry, sampleBioGain(sampleAudioMix(now), volume, event.timeOfDay));
      source.start(context.currentTime); counts.starts++;
    } catch { counts.playbackFailures++; release(entry); }
  }
  function request(event, now) {
    if (event.eventId === lastEventId || event.scheduledSeconds <= consumed) return;
    consumed = event.scheduledSeconds; lastEventId = event.eventId;
    if (voice || pending) { counts.busy++; return; }
    const job = { event, epoch, context }; pending = job;
    void load(event.sourceId, now).then(buffer => {
      if (pending !== job) return;
      pending = undefined;
      if (!buffer || disposed || !active || epoch !== job.epoch || context !== job.context
        || context.state !== 'running' || volume <= 0) return;
      const current = clock.state;
      if (current.timeOfDay !== event.timeOfDay || current.elapsedSeconds < event.scheduledSeconds
        || current.elapsedSeconds > event.latestStartSeconds
        || current.elapsedSeconds + buffer.duration > event.phaseEndSeconds) { counts.expired++; return; }
      if (voice) { counts.busy++; return; }
      start(buffer, event, current);
    }).catch(() => { if (pending === job) pending = undefined; counts.playbackFailures++; });
  }
  return {
    update({ context: nextContext, mix, volume: nextVolume, enabled, playing, ready: unlocked }) {
      if (disposed) return;
      try {
        const now = clock.state;
        volume = nextVolume;
        const delta = previousClock ? now.elapsedSeconds - previousClock.elapsedSeconds : 0;
        const discontinuity = previousClock && (delta > BIO_SCHEDULE_CONFIG.maxStepSeconds || delta < 0
          || now.timeOfDay !== previousClock.timeOfDay);
        if (delta > BIO_SCHEDULE_CONFIG.maxStepSeconds) {
          counts.largeSteps++; counts.largestStepSeconds = Math.max(counts.largestStepSeconds, delta);
        }
        const audible = enabled && unlocked && playing && nextContext?.state === 'running' && volume > 0;
        if (!audible || discontinuity) {
          invalidate(); stopVoice(nextContext?.state !== 'running'); sync();
        }
        if (!enabled || nextContext?.state === 'closed') { discardBank(); factoryRetryAt = 0; attemptedContext = undefined; }
        if (!enabled || !unlocked || !nextContext || nextContext.state !== 'running' || volume <= 0) return;
        if (!ensureFactory(nextContext, now)) return;
        prepare(now); // asynchronous; never waits for fetch/decode in a frame
        if (!playing) return;
        if (!active) { scheduler.sync(now); active = true; previousClock = now; return; }
        previousClock = now;
        if (pending && now.elapsedSeconds > pending.event.latestStartSeconds) { pending = undefined; counts.expired++; }
        if (voice && !voice.stopping) {
          const target = sampleBioGain(mix, volume, voice.event.timeOfDay);
          if (voice.ramp?.target !== target) ramp(voice, target);
        }
        const event = scheduler.update(now);
        if (event) request(event, now);
      } catch { counts.playbackFailures++; invalidate(); stopVoice(true); }
    },
    retry() { factoryRetryAt = 0; retryAt.clear(); },
    dispose() {
      if (disposed) return;
      disposed = true; invalidate(); stopVoice(); discardBank();
      // The final fading voice releases onended, or immediately on context loss.
    },
    get state() {
      return { ...counts, activeVoices: voice ? 1 : 0, pendingEvent: pending?.event.eventId ?? null,
        decodedCount: ready.size, loadingCount: loading.size,
        pcmBytes: [...ready.values()].reduce((sum, buffer) => sum + buffer.length * buffer.numberOfChannels * 4, 0),
        retainedCycles: scheduler.state.retainedCycleCount };
    },
  };
}
