// Web Audio observability/fault injection exists only in Playwright init scripts.
export function installAudioProbe({ native = false, reject = false, unsupported = false } = {}) {
  const probe = window.audioProbe = { contexts: [], nodes: [], buffers: [], reject, native, resumeGestures: [] };
  if (unsupported) { window.AudioContext = undefined; window.webkitAudioContext = undefined; return; }
  const Native = window.AudioContext;
  if (native) {
    window.AudioContext = class extends Native {
      constructor() {
        super(); probe.contexts.push(this);
        const create = this.createBufferSource.bind(this);
        this.createBufferSource = () => { const source = create(); probe.nodes.push(source); return source; };
      }
    };
    return;
  }
  function parameter() {
    return { value: 0, cancelAndHoldAtTime() {}, cancelScheduledValues() {},
      setValueAtTime(value) { this.value = value; }, linearRampToValueAtTime(value) { this.value = value; },
      exponentialRampToValueAtTime(value) { this.value = value; } };
  }
  function node(type) {
    const node = { type, connections: [], disconnected: false,
      connect(next) { this.connections.push(next); return next; }, disconnect() { this.connections = []; this.disconnected = true; },
      start(when, offset) { this.started = true; this.offset = offset; }, stop(time) { this.stopped = true; this.stopTime = time; } };
    probe.nodes.push(node); return node;
  }
  window.AudioContext = class extends EventTarget {
    constructor() { super(); this.state = 'suspended'; this.destination = {}; probe.contexts.push(this); }
    get currentTime() { return performance.now() / 1000; }
    change(state) { this.state = state; this.dispatchEvent(new Event('statechange')); }
    resume() {
      probe.resumeGestures.push(navigator.userActivation.isActive);
      if (probe.reject) return Promise.reject(new Error('test playback rejection'));
      this.change('running'); return Promise.resolve();
    }
    close() { this.change('closed'); return Promise.resolve(); }
    createGain() { if (probe.failGain) throw Error('test audio allocation failure'); return Object.assign(node('gain'), { gain: parameter() }); }
    createBufferSource() { return node('source'); }
    createOscillator() { return Object.assign(node('oscillator'), { frequency: parameter() }); }
    createBuffer(channels, length, rate) {
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      const buffer = { duration: length / rate, getChannelData: i => data[i], kind: ['day', 'night', 'nature'][probe.buffers.length % 3] };
      probe.buffers.push(buffer); return buffer;
    }
  };
}
export const audioSnapshot = page => page.evaluate(() => {
  const probe = window.audioProbe;
  const sources = probe.nodes.filter(n => n.type === 'source' && !n.disconnected);
  return {
    contexts: probe.contexts.length, sources: sources.length, totalSources: probe.nodes.filter(n => n.type === 'source').length,
    gains: Object.fromEntries(sources.map(n => [n.buffer.kind, n.connections[0].gain.value])),
    master: sources[0]?.connections[0].connections[0].gain.value,
    offsets: sources.map(n => n.offset), resumes: probe.resumeGestures.length,
    gestures: probe.resumeGestures, buffers: probe.buffers.length,
    liveNodes: probe.nodes.filter(n => !n.disconnected).length,
  };
});
export async function soundScreen(page, touch = false) {
  const activate = locator => touch ? locator.tap() : locator.click();
  await activate(page.locator('#menu-button'));
  await activate(page.locator('[data-view="sound"]'));
}
