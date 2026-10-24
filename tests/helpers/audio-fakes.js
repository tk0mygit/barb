export function fakeContext() {
  const context = new EventTarget();
  const parameters = [];
  const parameter = () => {
    const value = { value: 0, events: [], cancelAndHoldAtTime(time) { this.events.push(['hold', time]); },
      cancelScheduledValues(time) { this.events.push(['cancel', time]); },
      setValueAtTime(v, t) { this.value = v; this.events.push(['set', v, t]); },
      linearRampToValueAtTime(v, t) { this.value = v; this.events.push(['linear', v, t]); },
      exponentialRampToValueAtTime(v, t) { this.value = v; this.events.push(['exponential', v, t]); } };
    parameters.push(value); return value;
  };
  const nodes = [];
  const node = type => {
    const value = { type, connections: [], disconnected: false,
      connect(destination) { this.connections.push(destination); return destination; },
      disconnect() { this.connections = []; this.disconnected = true; } };
    nodes.push(value); return value;
  };
  Object.assign(context, { state: 'suspended', currentTime: 1, nodes, parameters, resumes: 0, destination: {},
    resume() { this.resumes++; this.change('running'); return Promise.resolve(); },
    close() { this.change('closed'); return Promise.resolve(); },
    change(state) { this.state = state; this.dispatchEvent(new Event('statechange')); },
    createGain() { return Object.assign(node('gain'), { gain: parameter() }); },
    createOscillator() { return Object.assign(node('oscillator'), { frequency: parameter(), start() { this.started = true; }, stop(time) { this.stopTime = time; } }); },
    createBufferSource() { return Object.assign(node('source'), { start(when, offset) { this.started = true; this.offset = offset; }, stop() { this.stopped = true; } }); },
    createBuffer(channels, length, rate) {
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      return { duration: length / rate, length, sampleRate: rate, numberOfChannels: channels, getChannelData: index => data[index] };
    },
  });
  return context;
}
export function fakeTimers() {
  let sequence = 0;
  const timers = new Map();
  return { timers, setTimer: fn => { timers.set(++sequence, fn); return sequence; },
    clearTimer: id => timers.delete(id), flush() { const jobs = [...timers.values()]; timers.clear(); for (const fn of jobs) fn(); } };
}
