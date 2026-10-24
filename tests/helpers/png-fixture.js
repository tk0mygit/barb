import { crc32, deflateSync } from 'node:zlib';

// Independent native CRC for test construction (not the validator's CRC code).
export function pngChunk(type, data = Buffer.alloc(0)) {
  const chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length); chunk.write(type, 4); data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, chunk.length - 4)), chunk.length - 4);
  return chunk;
}
export function makePNG({ width = 1, height = 1, depth = 8, color = 6, interlace = 0,
  raw = Buffer.from([0, 20, 80, 160, 0]), palette, transparency, compressed, extra = [] } = {}) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = depth; header[9] = color; header[12] = interlace;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', header),
    ...(palette ? [pngChunk('PLTE', palette)] : []), ...(transparency ? [pngChunk('tRNS', transparency)] : []),
    ...extra, pngChunk('IDAT', compressed ?? deflateSync(raw)), pngChunk('IEND')]);
}
