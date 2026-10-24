import { writeFile } from 'node:fs/promises';

// Web Audio observability/fault injection exists only in Playwright init scripts.
export function installAudioProbe({ native = false, reject = false, pending = false, unsupported = false } = {}) {
  const probe = window.audioProbe = {
    contexts: [], nodes: [], buffers: [], reject, pending, native,
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
  if (native) {
    window.AudioContext = class extends Native {
      constructor() {
        super(); observeContext(this);
        const createBuffer = this.createBuffer.bind(this);
        this.createBuffer = (...args) => {
          const buffer = createBuffer(...args); buffer.kind = ['day', 'night', 'nature'][probe.buffers.length % 3];
          probe.buffers.push(buffer); record('buffer-created', { kind: buffer.kind }); return buffer;
        };
        for (const [method, type] of [['createBufferSource', 'source'], ['createGain', 'gain'], ['createOscillator', 'oscillator']]) {
          const create = this[method].bind(this);
          this[method] = () => {
            const value = create(); value.audioProbeType = type; value.connections = []; value.disconnected = false;
            const connect = value.connect.bind(value), disconnect = value.disconnect.bind(value);
            value.connect = next => { value.connections.push(next); return connect(next); };
            value.disconnect = () => { value.connections = []; value.disconnected = true; return disconnect(); };
            if (value.start) {
              const start = value.start.bind(value), stop = value.stop.bind(value);
              value.start = (...args) => { const result = start(...args); value.started = true; record('source-start', { kind: type }); return result; };
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
    return { value: 0, cancelAndHoldAtTime() {}, cancelScheduledValues() {},
      setValueAtTime(value) { this.value = value; }, linearRampToValueAtTime(value) { this.value = value; },
      setTargetAtTime(value) { this.value = value; }, exponentialRampToValueAtTime(value) { this.value = value; } };
  }
  function node(type) {
    const node = { type, connections: [], disconnected: false,
      connect(next) { this.connections.push(next); return next; }, disconnect() { this.connections = []; this.disconnected = true; },
      start(when, offset) { this.started = true; this.offset = offset; record('source-start', { kind: type }); },
      stop(time) { this.stopped = true; this.stopTime = time; } };
    probe.nodes.push(node); record('node-created', { kind: type }); return node;
  }
  window.AudioContext = class extends EventTarget {
    constructor() { super(); this.state = 'suspended'; this.destination = {}; observeContext(this); }
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
    createGain() { if (probe.failGain) throw Error('test audio allocation failure'); return Object.assign(node('gain'), { gain: parameter() }); }
    createBufferSource() { return node('source'); }
    createOscillator() { return Object.assign(node('oscillator'), { frequency: parameter() }); }
    createBuffer(channels, length, rate) {
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      const buffer = { duration: length / rate, getChannelData: i => data[i], kind: ['day', 'night', 'nature'][probe.buffers.length % 3] };
      probe.buffers.push(buffer); record('buffer-created', { kind: buffer.kind }); return buffer;
    }
  };
}
export const audioSnapshot = page => page.evaluate(() => {
  const probe = window.audioProbe;
  const sources = probe.nodes.filter(n => (n.audioProbeType ?? n.type) === 'source' && !n.disconnected);
  const gains = sources.map(n => n.connections[0]);
  const master = gains[0]?.connections[0];
  return {
    contexts: probe.contexts.length, states: probe.contexts.map(context => context.state),
    sources: sources.length, totalSources: probe.nodes.filter(n => (n.audioProbeType ?? n.type) === 'source').length,
    startedSources: sources.filter(n => n.started).length,
    gains: Object.fromEntries(sources.map((n, i) => [n.buffer?.kind ?? i, n.connections[0]?.gain.value])),
    gainNodes: probe.nodes.filter(n => (n.audioProbeType ?? n.type) === 'gain' && !n.disconnected).length,
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
