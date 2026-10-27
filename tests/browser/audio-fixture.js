import { writeFile } from 'node:fs/promises';

// Web Audio observability/fault injection exists only in Playwright init scripts.
export function installAudioProbe({ native = false, reject = false, pending = false, unsupported = false } = {}) {
  const probe = window.audioProbe = {
    contexts: [], nodes: [], buffers: [], decoded: [], decodeWaiters: [], reject, pending, native,
    resumeGestures: [], attempts: [], events: [], sequence: 0,
  };
  const activation = () => navigator.userActivation?.isActive ?? null;
  const record = (type, details = {}) => {
    const event = { sequence: ++probe.sequence, type, time: performance.now(), active: activation(),
      hidden: document.hidden, visibility: document.visibilityState, focused: document.hasFocus(), ...details };
    probe.events.push(event); if (probe.events.length > 200) probe.events.shift();
    return event;
  };
  for (const type of ['pointerdown', 'pointerup', 'touchstart', 'touchend', 'click', 'keydown', 'blur', 'focus', 'visibilitychange', 'pagehide', 'pageshow']) {
    window.addEventListener(type, event => {
      const entry = record(type, { trusted: event.isTrusted, pointerType: event.pointerType,
        target: event.target?.closest?.('button')?.id || event.target?.id });
      if (['pointerdown', 'pointerup', 'touchstart', 'touchend', 'click', 'keydown'].includes(type)) probe.lastInput = entry;
    }, true);
  }
  const beginResume = context => {
    const attempt = { id: probe.attempts.length, before: context.state, status: 'pending', active: activation(),
      input: probe.lastInput?.type, inputSequence: probe.lastInput?.sequence };
    probe.attempts.push(attempt); probe.resumeGestures.push(attempt.active);
    record('resume', { id: attempt.id, state: context.state, input: attempt.input });
    return attempt;
  };
  const observeResume = (context, attempt, promise) => Promise.resolve(promise).then(value => {
    attempt.status = 'resolved'; attempt.after = context.state;
    record('resume-resolved', { id: attempt.id, state: context.state }); return value;
  }, error => {
    attempt.status = 'rejected'; attempt.after = context.state;
    record('resume-rejected', { id: attempt.id, state: context.state }); throw error;
  });
  const observeContext = context => {
    probe.contexts.push(context); record('context-created', { state: context.state, input: probe.lastInput?.type });
    context.addEventListener('statechange', () => record('statechange', { state: context.state }));
  };
  if (unsupported) { window.AudioContext = undefined; window.webkitAudioContext = undefined; return; }
  const Native = window.AudioContext;
  const bioId = buffer => ({ 2.1: 'bird-a', 2.55: 'bird-b', 2.85: 'bird-c',
    3.6: 'suzumushi-a', 4.1: 'suzumushi-b', 3.85: 'suzumushi-c' })[Number(buffer?.duration?.toFixed(2))];
  const observeBuffer = (source, nativeSource = false) => {
    const property = nativeSource ? Object.getOwnPropertyDescriptor(AudioBufferSourceNode.prototype, 'buffer') : null;
    let current;
    Object.defineProperty(source, 'buffer', {
      configurable: true,
      get: () => property ? property.get.call(source) : current,
      set(buffer) {
        if (property) property.set.call(source, buffer); else current = buffer;
        if (!buffer) return; // Preserve identity after teardown clears the PCM.
        source.bioId = bioId(buffer);
        source.audioProbeKind = source.bioId ? 'bio' : buffer.duration === 1 ? 'bite' : 'unclassified';
      },
    });
    return source;
  };
  const sourceStarted = value => {
    if ((value.audioProbeType ?? value.type) !== 'source' || value.loop) return;
    value.bioId = bioId(value.buffer);
    if (!value.bioId) {
      record('bite-start', { duration: value.buffer?.duration, offset: value.offset, scheduled: value.startWhen });
      return;
    }
    const voice = value.bioId?.startsWith('suzumushi-') ? value.connections[0]?.connections[0] : value.connections[0];
    record('bio-start', { sourceId: value.bioId, seconds: window.lightingProbe?.last?.mistTime,
      gain: voice?.gain.value, duration: value.buffer?.duration });
  };
  if (native) {
    window.AudioContext = class extends Native {
      constructor() {
        super(); observeContext(this);
        const createBuffer = this.createBuffer.bind(this);
        const decode = this.decodeAudioData.bind(this);
        this.decodeAudioData = bytes => decode(bytes).then(buffer => {
          probe.decoded.push({ id: bioId(buffer), frames: buffer.length, sampleRate: buffer.sampleRate }); return buffer;
        });
        this.createBuffer = (...args) => {
          const buffer = createBuffer(...args); buffer.kind = ['day', 'night', 'nature'][probe.buffers.length % 3];
          probe.buffers.push(buffer); record('buffer-created', { kind: buffer.kind }); return buffer;
        };
        for (const [method, type] of [['createBufferSource', 'source'], ['createGain', 'gain'], ['createOscillator', 'oscillator']]) {
          const create = this[method].bind(this);
          this[method] = () => {
            const value = create(); value.audioProbeType = type; value.connections = []; value.disconnected = false;
            if (type === 'source') observeBuffer(value, true);
            const connect = value.connect.bind(value), disconnect = value.disconnect.bind(value);
            value.connect = next => { value.connections.push(next); return connect(next); };
            value.disconnect = () => { value.connections = []; value.disconnected = true; return disconnect(); };
            if (value.start) {
              const start = value.start.bind(value), stop = value.stop.bind(value);
              value.start = (...args) => { const result = start(...args); value.started = true;
                value.startWhen = args[0]; value.offset = args[1]; sourceStarted(value); record('source-start', { kind: type }); return result; };
              value.stop = (...args) => { const result = stop(...args); value.stopped = true; return result; };
            }
            probe.nodes.push(value); record('node-created', { kind: type }); return value;
          };
        }
      }
      resume() {
        const attempt = beginResume(this);
        return observeResume(this, attempt, super.resume());
      }
    };
    return;
  }
  function parameter() {
    return { value: 0, events: [], cancelAndHoldAtTime() {}, cancelScheduledValues() {},
      setValueAtTime(value) { this.value = value; }, linearRampToValueAtTime(value) { this.value = value; },
      setValueCurveAtTime(values, time, duration) { this.value = values.at(-1); this.events.push({ values: Array.from(values), time, duration }); },
      setTargetAtTime(value) { this.value = value; }, exponentialRampToValueAtTime(value) { this.value = value; } };
  }
  function node(type, context) {
    let endTimer;
    const finish = () => { node.ended = true; node.onended?.(); };
    const node = { type, connections: [], disconnected: false,
      connect(next) { this.connections.push(next); return next; }, disconnect() { this.connections = []; this.disconnected = true; },
      start(when, offset) {
        this.started = true; this.startWhen = when; this.offset = offset; sourceStarted(this); record('source-start', { kind: type });
        if (type === 'source' && !this.loop && this.buffer) endTimer = setTimeout(finish, this.buffer.duration * 1000);
      },
      stop(time) {
        this.stopped = true; this.stopTime = time;
        if (!this.loop) {
          clearTimeout(endTimer);
          if (!this.ended && this.onended) endTimer = setTimeout(finish, Math.max(0, (time ?? 0) - context.currentTime) * 1000);
        }
      } };
    if (type === 'source') observeBuffer(node);
    probe.nodes.push(node); record('node-created', { kind: type }); return node;
  }
  window.AudioContext = class extends EventTarget {
    constructor() { super(); this.state = 'suspended'; this.sampleRate = 44100; this.destination = {}; observeContext(this); }
    get currentTime() { return performance.now() / 1000; }
    change(state) { this.state = state; this.dispatchEvent(new Event('statechange')); }
    resume() {
      const attempt = beginResume(this);
      let promise;
      if (probe.reject) promise = Promise.reject(new Error('test playback rejection'));
      else if (probe.pending) promise = new Promise((resolve, reject) => {
        attempt.resolve = resolve; attempt.reject = () => reject(new Error('test late rejection'));
      });
      else { this.change('running'); promise = Promise.resolve(); }
      return observeResume(this, attempt, promise);
    }
    close() { this.change('closed'); return Promise.resolve(); }
    createGain() { if (probe.failGain) throw Error('test audio allocation failure'); return Object.assign(node('gain', this), { gain: parameter() }); }
    createBufferSource() { return node('source', this); }
    createOscillator() { return Object.assign(node('oscillator', this), { frequency: parameter() }); }
    decodeAudioData(bytes) {
      if (probe.failDecode) return Promise.reject(Error('test decode failure'));
      const view = new DataView(bytes);
      let channels, sourceRate, dataOffset, dataBytes;
      for (let p = 12; p + 8 <= view.byteLength;) {
        const tag = String.fromCharCode(...new Uint8Array(bytes, p, 4)), size = view.getUint32(p + 4, true);
        if (tag === 'fmt ') { channels = view.getUint16(p + 10, true); sourceRate = view.getUint32(p + 12, true); }
        if (tag === 'data') { dataOffset = p + 8; dataBytes = size; }
        p += 8 + size + size % 2;
      }
      const sourceFrames = dataBytes / channels / 2, frames = Math.round(sourceFrames * this.sampleRate / sourceRate);
      const data = Array.from({ length: channels }, (_, c) => Float32Array.from({ length: frames }, (_, i) => {
        const position = Math.min(sourceFrames - 1, i * sourceRate / this.sampleRate), a = Math.floor(position);
        const value = frame => view.getInt16(dataOffset + (frame * channels + c) * 2, true) / 32768;
        return value(a) + (value(Math.min(sourceFrames - 1, a + 1)) - value(a)) * (position - a);
      }));
      const buffer = { sampleRate: this.sampleRate, length: frames, numberOfChannels: channels,
        duration: frames / this.sampleRate, getChannelData: c => data[c] };
      probe.decoded.push({ id: bioId(buffer), frames, sampleRate: this.sampleRate });
      return probe.holdDecode ? new Promise(resolve => probe.decodeWaiters.push(() => resolve(buffer))) : Promise.resolve(buffer);
    }
    createBuffer(channels, length, rate) {
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      const buffer = { duration: length / rate, getChannelData: i => data[i], kind: ['day', 'night', 'nature'][probe.buffers.length % 3] };
      probe.buffers.push(buffer); record('buffer-created', { kind: buffer.kind }); return buffer;
    }
  };
}
export const audioSnapshot = page => page.evaluate(() => {
  const probe = window.audioProbe;
  const allSources = probe.nodes.filter(n => (n.audioProbeType ?? n.type) === 'source');
  const sources = allSources.filter(n => n.loop === true && !n.disconnected);
  const bio = allSources.filter(n => n.loop === false && n.bioId && !n.disconnected);
  const bites = allSources.filter(n => n.audioProbeKind === 'bite');
  const bioChains = bio.map(n => {
    const envelope = n.bioId?.startsWith('suzumushi-') ? n.connections[0] : undefined;
    return { envelope, voice: envelope ? envelope.connections[0] : n.connections[0] };
  });
  const bioGainSet = new Set(bioChains.flatMap(n => [n.envelope, n.voice])
    .filter(n => (n?.audioProbeType ?? n?.type) === 'gain'));
  const gains = sources.map(n => n.connections[0]);
  const master = gains[0]?.connections[0];
  return {
    contexts: probe.contexts.length, states: probe.contexts.map(context => context.state),
    sources: sources.length, totalSources: allSources.filter(n => n.loop === true).length,
    bioSources: bio.length, totalBioSources: allSources.filter(n => n.loop === false && n.bioId).length,
    bioGains: bioChains.map(n => n.voice?.gain.value), bioIds: bio.map(n => n.bioId),
    decoded: probe.decoded.filter(n => n.id), allDecoded: probe.decoded,
    biteDecoded: probe.decoded.filter(n => !n.id), biteSources: bites.filter(n => !n.disconnected).length,
    totalBiteSources: bites.length,
    bioGainNodes: bioGainSet.size, bioEnvelopeNodes: bioChains.filter(n => n.envelope).length,
    bioEnvelopes: bioChains.map(n => n.envelope?.gain.events ?? null),
    bioDestinationConnected: bioChains.every(n => n.voice?.connections.length === 1
      && n.voice.connections[0] === probe.contexts.at(-1)?.destination),
    startedSources: sources.filter(n => n.started).length,
    gains: Object.fromEntries(sources.map((n, i) => [n.buffer?.kind ?? i, n.connections[0]?.gain.value])),
    // Preserve the original exact gain-count assertion, excluding only gains
    // proven to belong to a live one-shot. Unclassified leaks still count.
    gainNodes: probe.nodes.filter(n => (n.audioProbeType ?? n.type) === 'gain' && !n.disconnected && !bioGainSet.has(n)).length,
    totalGainNodes: probe.nodes.filter(n => (n.audioProbeType ?? n.type) === 'gain' && !n.disconnected).length,
    master: master?.gain.value, destinationConnected: Boolean(master?.connections.includes(probe.contexts.at(-1)?.destination)),
    offsets: sources.map(n => n.offset), resumes: probe.resumeGestures.length,
    gestures: probe.resumeGestures, buffers: probe.buffers.length,
    attempts: probe.attempts.map(({ resolve, reject, ...attempt }) => attempt),
    liveNodes: probe.nodes.filter(n => !n.disconnected).length,
    ui: document.querySelector('#ambient-status')?.textContent,
  };
});
export async function attachAudioDiagnostics(page, info) {
  const snapshot = await audioSnapshot(page);
  const events = await page.evaluate(() => window.audioProbe.events);
  const path = info.outputPath('audio-diagnostics.json');
  await writeFile(path, JSON.stringify({ ...snapshot, events }, null, 2));
  await info.attach('audio-diagnostics', { path, contentType: 'application/json' });
}
export async function soundScreen(page, touch = false) {
  const activate = locator => touch ? locator.tap() : locator.click();
  await activate(page.locator('#menu-button'));
  await activate(page.locator('[data-view="sound"]'));
}
