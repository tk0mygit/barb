import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { BIO_VARIANTS, BIO_SOURCE_URLS } from '../src/audio/bio-source-assets.js';
import { D2A_MANIFEST_SHA256, validateBioWav } from '../src/audio/bio-source-validation.js';

export async function verifyBioAssets() {
  const manifest = await readFile(new URL('../src/assets/audio/bio/manifest.json', import.meta.url));
  if (createHash('sha256').update(manifest).digest('hex') !== D2A_MANIFEST_SHA256)
    throw new Error('D-2A manifest differs from delivered bytes');
  const rows = [];
  for (const variant of BIO_VARIANTS) {
    const bytes = await readFile(new URL(BIO_SOURCE_URLS[variant.id]));
    const hash = createHash('sha256').update(bytes).digest('hex');
    if (hash !== variant.sha256) throw new Error(`SHA-256 mismatch: ${variant.id}`);
    rows.push({ id: variant.id, file: variant.file, sha256: hash, ...validateBioWav(bytes, variant) });
  }
  return { manifestSHA256: D2A_MANIFEST_SHA256, variants: rows,
    wavBytes: rows.reduce((sum, row) => sum + row.wavBytes, 0),
    float32Bytes44100: BIO_VARIANTS.reduce((sum, row) => sum + row.float32Bytes, 0) };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  console.log(JSON.stringify(await verifyBioAssets(), null, 2));
