import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { crc32 } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { validateFishImage } from './lib/fish-image-validation.js';

function chunk(type, data = Buffer.alloc(0)) {
  const bytes = Buffer.alloc(data.length + 12);
  bytes.writeUInt32BE(data.length); bytes.write(type, 4); data.copy(bytes, 8);
  bytes.writeUInt32BE(crc32(bytes.subarray(4, -4)), bytes.length - 4);
  return bytes;
}

// Technical delivery conversion only: never stretches, paints, trims a fin,
// replaces a background, or changes the generated species morphology.
export async function normalizeFishArtwork(input, output) {
  const temporary = await mkdtemp(join(tmpdir(), 'barb-fish-art-'));
  try {
    const converted = join(temporary, 'rgba.png');
    execFileSync('magick', [resolve(input), '-resize', '1136x464>',
      // Generated body samples are often alpha 250..254. Restore opaque cores
      // after resampling; retain every softer fin/outline alpha and clear pixel.
      '-channel', 'A', '-fx', 'u>=250/255?1:u', '+channel', '-gravity', 'center',
      '-background', 'none', '-extent', '1280x560', '-colorspace', 'sRGB', '-depth', '8',
      '-interlace', 'none', '-define', 'png:color-type=6', '-define', 'png:compression-level=9', converted]);
    const png = await readFile(converted), parts = [png.subarray(0, 8)];
    // Explicit sRGB intent; omit timestamps, comments and redundant background
    // metadata. IDAT bytes (and therefore every RGBA sample) are unchanged.
    for (let offset = 8; offset < png.length;) {
      const length = png.readUInt32BE(offset), end = offset + length + 12;
      const type = png.toString('ascii', offset + 4, offset + 8);
      if (['IHDR', 'IDAT', 'IEND'].includes(type)) parts.push(png.subarray(offset, end));
      if (type === 'IHDR') parts.push(chunk('sRGB', Buffer.from([0])));
      offset = end;
    }
    const result = Buffer.concat(parts);
    validateFishImage(output, result);
    await mkdir(dirname(resolve(output)), { recursive: true });
    await writeFile(output, result);
    return result.length;
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output || !output.endsWith('.png')) throw new Error('Usage: node scripts/normalize-fish-artwork.mjs ORIGINAL.png OUTPUT.png');
  console.log(`${output}: ${await normalizeFishArtwork(input, output)} bytes`);
}
