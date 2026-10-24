import { cp, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Isolated module graph: exercise real callers with an image-only substitution
// or a hypothetical species, never edit the checked-out production definitions.
export async function fishSpeciesSandbox(t, { png = false, extra = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'barb-fish-species-'));
  const dispose = () => rm(root, { recursive: true, force: true });
  t?.after(dispose);
  await cp(new URL('../../src/', import.meta.url), join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'package.json'), '{"type":"module"}');
  const path = join(root, 'src/game/fish-species.js');
  let source = await readFile(path, 'utf8');
  if (png) {
    await cp(new URL('../fixtures/fish-assets/transparent-test.png', import.meta.url), join(root, 'src/assets/fish/fixture.png'));
    source = source.replace("new URL('../assets/black-bass.svg', import.meta.url)", "new URL('../assets/fish/fixture.png', import.meta.url)");
  }
  if (extra) source = source.replace('  BLACK_BASS,', "  BLACK_BASS,\n  species({ ...BLACK_BASS, id: 'fixture-species', name: 'テスト専用魚' }),");
  await writeFile(path, source);
  return { root, dispose, load: name => import(pathToFileURL(join(root, `src/game/${name}.js`)).href) };
}
