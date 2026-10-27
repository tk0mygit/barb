import { readFileSync } from 'node:fs';
import { fakeContext } from './audio-fakes.js';

export const biteWav = readFileSync(new URL('../../src/assets/audio/bite/waterdrop.wav', import.meta.url));
export const fetchBite = async () => ({ ok: true, arrayBuffer: async () => Uint8Array.from(biteWav).buffer });

// Read chunked PCM without assuming the 44-byte header used by the bio files.
export function readPcm(bytes) {
  const view = new DataView(bytes.buffer ?? bytes, bytes.byteOffset ?? 0, bytes.byteLength);
  let format, offset, size;
  const tag = i => String.fromCharCode(...new Uint8Array(view.buffer, view.byteOffset + i, 4));
  for (let p = 12; p + 8 <= view.byteLength;) {
    const length = view.getUint32(p + 4, true);
    if (tag(p) === 'fmt ') format = { channels: view.getUint16(p + 10, true),
      sampleRate: view.getUint32(p + 12, true), bits: view.getUint16(p + 22, true) };
    if (tag(p) === 'data') { offset = p + 8; size = length; }
    p += 8 + length + length % 2;
  }
  if (!format || format.bits !== 16 || offset === undefined) throw Error('Expected PCM16');
  const length = size / (format.channels * 2);
  const data = Array.from({ length: format.channels }, (_, c) => Float32Array.from({ length },
    (_, i) => view.getInt16(offset + (i * format.channels + c) * 2, true) / 32768));
  return { ...format, length, duration: length / format.sampleRate, data };
}
export function biteContext(options) {
  const context = fakeContext(options);
  context.sampleRate = 48000; context.decodes = 0;
  context.decodeAudioData = async bytes => {
    context.decodes++;
    const pcm = readPcm(bytes), buffer = context.createBuffer(pcm.channels, pcm.length, pcm.sampleRate);
    for (let c = 0; c < pcm.channels; c++) buffer.getChannelData(c).set(pcm.data[c]);
    return buffer;
  };
  const create = context.createBufferSource;
  context.createBufferSource = () => {
    const source = create(), start = source.start, stop = source.stop;
    source.start = function(when, offset) { this.startWhen = when; start.call(this, when, offset); };
    source.stop = function(when) { this.stopTime = when; stop.call(this, when); };
    return source;
  };
  return context;
}
