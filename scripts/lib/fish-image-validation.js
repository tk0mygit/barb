import { crc32, inflateSync } from 'node:zlib';

// Resource limits for validation, not Phase 4C-1 art dimensions.
export const IMAGE_LIMITS = Object.freeze({ bytes: 8 * 1024 * 1024, svgBytes: 10000, dimension: 8192, pixels: 16 * 1024 * 1024 });
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const requireImage = (condition, message) => { if (!condition) throw new TypeError(`Invalid fish image: ${message}`); };

function dimensions(width, height) {
  requireImage(Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0
    && width <= IMAGE_LIMITS.dimension && height <= IMAGE_LIMITS.dimension && width * height <= IMAGE_LIMITS.pixels, 'dimensions');
}

function validateSVG(bytes) {
  requireImage(bytes.length < IMAGE_LIMITS.svgBytes, 'SVG size');
  const svg = bytes.toString('utf8');
  requireImage(/^\s*(?:<\?xml[^?]*\?>\s*)?<svg\s[^>]*xmlns=["']http:\/\/www.w3.org\/2000\/svg["'][^>]*>[\s\S]*<\/svg>\s*$/.test(svg), 'SVG document');
  // Retain the original script/foreignObject/reference/event checks and also
  // reject entities, embedded content and CSS resource references.
  requireImage(!/<script|<foreignObject|(?:href|src)\s*=|\bon\w+\s*=|<!DOCTYPE|<!ENTITY|<image|<use\b|<style|<animate|<set\b|@import/i.test(svg), 'unsafe SVG content');
  for (const match of svg.matchAll(/url\s*\(([^)]*)\)/gi)) requireImage(/^\s*["']?#[\w-]+["']?\s*$/.test(match[1]), 'external SVG resource');
  const viewBox = svg.match(/\bviewBox=["']([^"']+)["']/)?.[1].trim().split(/[\s,]+/).map(Number);
  requireImage(viewBox?.length === 4 && viewBox.every(Number.isFinite) && viewBox[2] > 0 && viewBox[3] > 0
    && viewBox[2] <= IMAGE_LIMITS.dimension && viewBox[3] <= IMAGE_LIMITS.dimension, 'SVG viewBox');
  return { format: 'svg', width: viewBox[2], height: viewBox[3] };
}

function validatePNG(bytes) {
  requireImage(bytes.subarray(0, 8).equals(signature), 'PNG signature');
  let offset = 8, header, palette, transparency, ended = false, idatEnded = false;
  const compressed = [];
  while (offset < bytes.length) {
    requireImage(offset + 12 <= bytes.length, 'truncated chunk');
    const length = bytes.readUInt32BE(offset), end = offset + 12 + length;
    requireImage(end <= bytes.length, 'chunk length');
    const type = bytes.toString('latin1', offset + 4, offset + 8);
    requireImage(/^[A-Za-z]{2}[A-Z][A-Za-z]$/.test(type), 'chunk type');
    requireImage(crc32(bytes.subarray(offset + 4, end - 4)) === bytes.readUInt32BE(end - 4), 'chunk CRC');
    const data = bytes.subarray(offset + 8, end - 4);
    requireImage(header || type === 'IHDR', 'IHDR must be first');
    if (compressed.length && type !== 'IDAT') idatEnded = true;
    if (type === 'IHDR') {
      requireImage(!header && length === 13, 'IHDR');
      const width = data.readUInt32BE(0), height = data.readUInt32BE(4);
      dimensions(width, height);
      const depth = data[8], color = data[9];
      const depths = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
      requireImage(depths[color]?.includes(depth) && data[10] === 0 && data[11] === 0 && data[12] === 0, 'unsupported pixel format (non-interlaced PNG required)');
      header = { width, height, depth, color };
    } else if (type === 'PLTE') {
      requireImage(!palette && !transparency && !compressed.length && ![0, 4].includes(header.color)
        && length > 0 && length % 3 === 0 && length <= 768, 'PLTE');
      requireImage(header.color !== 3 || length / 3 <= 2 ** header.depth, 'palette size');
      palette = data;
    } else if (type === 'tRNS') {
      requireImage(!transparency && !compressed.length, 'tRNS order');
      if (header.color === 3) requireImage(palette && length > 0 && length <= palette.length / 3 && data.some(alpha => alpha < 255), 'palette transparency');
      else {
        requireImage((header.color === 0 && length === 2) || (header.color === 2 && length === 6), 'tRNS format');
        for (let i = 0; i < length; i += 2) requireImage(data.readUInt16BE(i) < 2 ** header.depth, 'tRNS sample');
      }
      transparency = data;
    } else if (type === 'IDAT') {
      requireImage(!idatEnded && (header.color !== 3 || palette), 'IDAT order/palette');
      compressed.push(data);
    } else if (type === 'IEND') {
      requireImage(length === 0 && compressed.length && end === bytes.length, 'IEND');
      ended = true;
    } else {
      requireImage(type[0] === type[0].toLowerCase(), 'unknown critical chunk');
      requireImage(!['acTL', 'fcTL', 'fdAT'].includes(type), 'animated PNG is unsupported');
    }
    offset = end;
  }
  requireImage(ended && ([4, 6].includes(header.color) || transparency), 'missing end/transparency');
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[header.color];
  const stride = Math.ceil(header.width * channels * header.depth / 8);
  const expected = (stride + 1) * header.height;
  // Bound decompression even for a tiny, maliciously compressed file.
  requireImage(expected <= 64 * 1024 * 1024, 'decoded size');
  const input = Buffer.concat(compressed);
  let decoded;
  try { decoded = inflateSync(input, { maxOutputLength: expected, info: true }); }
  catch { throw new TypeError('Invalid fish image: compressed PNG data'); }
  requireImage(decoded.buffer.length === expected && decoded.engine.bytesWritten === input.length, 'PNG data length');
  const bpp = Math.max(1, Math.ceil(channels * header.depth / 8));
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < header.height; y++) {
    const start = y * (stride + 1), filter = decoded.buffer[start];
    requireImage(filter <= 4, 'PNG row filter');
    const row = Buffer.from(decoded.buffer.subarray(start + 1, start + 1 + stride));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? row[x - bpp] : 0, b = previous[x], c = x >= bpp ? previous[x - bpp] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const predictor = filter === 0 ? 0 : filter === 1 ? a : filter === 2 ? b : filter === 3 ? Math.floor((a + b) / 2)
        : pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      row[x] = (row[x] + predictor) & 255;
    }
    if (header.color === 3) for (let x = 0; x < header.width; x++) {
      const index = (row[Math.floor(x * header.depth / 8)] >>> (8 - header.depth - (x * header.depth % 8))) & ((1 << header.depth) - 1);
      requireImage(index < palette.length / 3, 'palette index');
    }
    previous = row;
  }
  return { format: 'png', width: header.width, height: header.height, bitDepth: header.depth, colorType: header.color, transparent: true };
}

export function validateFishImage(path, input) {
  const bytes = Buffer.from(input);
  requireImage(bytes.length > 0 && bytes.length <= IMAGE_LIMITS.bytes, 'file size');
  const extension = /\.([a-z0-9]+)$/.exec(path)?.[1];
  requireImage(extension === 'svg' || extension === 'png', 'extension');
  return Object.freeze(extension === 'svg' ? validateSVG(bytes) : validatePNG(bytes));
}
