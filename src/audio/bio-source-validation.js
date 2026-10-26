// Shared, side-effect-free acceptance rules for the six delivered D-2A assets.
export const BIO_SOURCE_IDS = Object.freeze([
  'bird-a', 'bird-b', 'bird-c', 'suzumushi-a', 'suzumushi-b', 'suzumushi-c',
]);
export const D2A_MANIFEST_SHA256 = '11b7fb680dcf8239df7d445d886455288054893ca634bc9c61156912dee67ae4';
export const D2A_ZIP_SHA256 = '84519a9562b7374aa0ae94cf2d8e835b065f093ceafaf7215b9d21f8ed797b25';

export function validateBioManifest(manifest) {
  if (manifest?.version !== 1 || manifest.phase !== '4.5-D-2A'
    || manifest.sampleRate !== 44100 || manifest.channels !== 1
    || manifest.encoding !== 'RIFF WAVE PCM signed 16-bit little-endian'
    || !Array.isArray(manifest.variants) || manifest.variants.length !== BIO_SOURCE_IDS.length)
    throw new TypeError('Invalid D-2A bio manifest');
  const seen = new Set();
  for (const v of manifest.variants) {
    if (!v || !BIO_SOURCE_IDS.includes(v.id) || seen.has(v.id)
      || v.kind !== (v.id.startsWith('bird-') ? 'bird' : 'suzumushi')
      || v.file !== `wav/${v.id}.wav` || v.sampleRate !== 44100 || v.channels !== 1 || v.loop !== false
      || !Number.isInteger(v.frames) || v.frames <= 0 || v.frames > 44100 * 5
      || v.durationSeconds !== v.frames / 44100 || v.wavBytes !== 44 + v.frames * 2
      || v.float32Bytes !== v.frames * 4 || !/^[0-9a-f]{64}$/.test(v.sha256))
      throw new TypeError('Invalid or duplicate bio variant');
    seen.add(v.id);
  }
  return Object.freeze(BIO_SOURCE_IDS.map(id => {
    const v = manifest.variants.find(item => item.id === id);
    return Object.freeze({ id, kind: v.kind, file: v.file, sampleRate: v.sampleRate,
      channels: v.channels, frames: v.frames, durationSeconds: v.durationSeconds,
      wavBytes: v.wavBytes, float32Bytes: v.float32Bytes, sha256: v.sha256, loop: false });
  }));
}

export function validateBioWav(input, expected) {
  const bytes = input instanceof ArrayBuffer ? new Uint8Array(input)
    : ArrayBuffer.isView(input) ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength) : null;
  const invalid = () => { throw new TypeError('Invalid or mismatched bio PCM16 WAV'); };
  if (!bytes || bytes.length < 44 || bytes.length > 1024 * 1024) invalid();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = offset => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  if (text(0) !== 'RIFF' || text(8) !== 'WAVE' || view.getUint32(4, true) + 8 !== bytes.length) invalid();
  let format, dataOffset, dataBytes, offset = 12;
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) invalid();
    const kind = text(offset), size = view.getUint32(offset + 4, true), from = offset + 8;
    const end = from + size, next = end + (size % 2);
    if (next > bytes.length) invalid();
    if (kind === 'fmt ') {
      if (format || dataOffset !== undefined || size !== 16) invalid();
      format = { code: view.getUint16(from, true), channels: view.getUint16(from + 2, true),
        sampleRate: view.getUint32(from + 4, true), byteRate: view.getUint32(from + 8, true),
        blockAlign: view.getUint16(from + 12, true), bitsPerSample: view.getUint16(from + 14, true) };
      if (format.code !== 1 || format.channels !== 1 || format.sampleRate !== 44100
        || format.byteRate !== 88200 || format.blockAlign !== 2 || format.bitsPerSample !== 16) invalid();
    } else if (kind === 'data') {
      if (!format || dataOffset !== undefined || size === 0 || size % 2) invalid();
      dataOffset = from; dataBytes = size;
    }
    offset = next;
  }
  if (!format || dataOffset === undefined) invalid();
  const frames = dataBytes / 2, durationSeconds = frames / format.sampleRate;
  if (expected && (bytes.length !== expected.wavBytes || frames !== expected.frames
    || format.sampleRate !== expected.sampleRate || format.channels !== expected.channels
    || durationSeconds !== expected.durationSeconds)) invalid();
  return Object.freeze({ format: 'pcm16', sampleRate: format.sampleRate, channels: format.channels,
    bitsPerSample: format.bitsPerSample, frames, durationSeconds, dataOffset, dataBytes, wavBytes: bytes.length });
}

// decodeAudioData resamples to the supplied context rate; allow one frame of rounding.
export function validateDecodedBioBuffer(buffer, variant, contextRate) {
  if (!buffer || buffer.numberOfChannels !== 1 || buffer.sampleRate !== contextRate
    || !Number.isInteger(buffer.length) || buffer.length <= 0
    || Math.abs(buffer.length - variant.durationSeconds * contextRate) > 1
    || !Number.isFinite(buffer.duration) || Math.abs(buffer.duration - variant.durationSeconds) > 1 / contextRate
    || typeof buffer.getChannelData !== 'function') throw new TypeError('Invalid decoded bio AudioBuffer');
  const data = buffer.getChannelData(0);
  if (!(data instanceof Float32Array) || data.length !== buffer.length || !data.every(Number.isFinite))
    throw new TypeError('Invalid decoded bio samples');
  return buffer;
}
