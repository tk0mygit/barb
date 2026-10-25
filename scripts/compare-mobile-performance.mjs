import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

export async function writeMobileComparison(before, after, output) {
  assert.equal(before.length, 34, 'Expected all 25 render and 9 HUD captures');
  assert.equal(before.length, after.length);
  const rows = await Promise.all(before.map(async b => {
    const a = after.find(a => a.id === b.id);
    assert(a, `Missing comparison ${b.id}`);
    for (const key of ['viewport', 'dpr', 'savedClockSeconds', 'boat', 'waterTime', 'fogStrength', 'camera']) {
      assert.deepEqual(a.metrics[key], b.metrics[key], `${b.id}: ${key} differs`);
    }
    assert.deepEqual(a.metrics.resources, b.metrics.resources, `${b.id}: resource regression`);
    const pixelReduction = (1 - a.metrics.pixels / b.metrics.pixels) * 100;
    if (/^(portrait|landscape|small)-/.test(b.id)) assert(pixelReduction >= 20, `${b.id}: mobile pixel reduction`);
    else if (b.id.startsWith('pc')) assert.equal(a.metrics.pixels, b.metrics.pixels, `${b.id}: desktop pixels`);
    if (b.layout && b.id.endsWith('fight') && !b.id.startsWith('pc')) assert(a.layout.occupancy < b.layout.occupancy, `${b.id}: HUD area did not shrink`);
    return { id: b.id, before: b.metrics, after: a.metrics,
      pixelReduction,
      ...(b.layout ? { beforeLayout: b.layout, afterLayout: a.layout } : {}),
      images: b.image ? [await readFile(b.image), await readFile(a.image)] : [] };
  }));
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output.replace(/\.html$/, '.json'), JSON.stringify(rows.map(({ images, ...r }) => r), null, 2));
  const figures = rows.map(r => `<article id="${r.id}"><h2>${r.id}</h2><p>buffer ${r.before.buffer.width}×${r.before.buffer.height} → ${r.after.buffer.width}×${r.after.buffer.height}; pixels −${r.pixelReduction.toFixed(2)}%${r.beforeLayout ? `; HUD ${r.beforeLayout.occupancy.toFixed(2)}% → ${r.afterLayout.occupancy.toFixed(2)}%` : ''}</p><div>${r.images.map((image, i) => `<figure><figcaption>${i ? 'PR' : 'main'}</figcaption><img src="data:image/png;base64,${image.toString('base64')}"></figure>`).join('')}</div><details><summary>Metrics / layout</summary><pre>${JSON.stringify({ before: r.before, after: r.after, beforeLayout: r.beforeLayout, afterLayout: r.afterLayout }, null, 2)}</pre></details></article>`).join('');
  await writeFile(output, `<!doctype html><html lang="ja"><meta charset="utf-8"><title>BARB mobile comparison</title><style>body{background:#142329;color:#eee;font:15px system-ui;margin:24px}article{border-top:1px solid #789;padding:20px 0}article>div{display:flex;align-items:start;gap:12px}figure{margin:0;max-width:49%}img{max-width:100%;height:auto}pre{white-space:pre-wrap}</style><h1>Phase 4C-2A main / PR</h1><p>Production builds, boat (10,20), heading 0, saved clock, viewport / DPR and native fishing input fixed. Software Chromium / SwiftShader, single sample: setup→ready and 6 ordinary frames (96ms virtual time), Node monotonic wall clock and CDP TaskDuration. Includes automation overhead and waits; these are not device FPS or GPU timings. HUD images use actual BITE / FIGHT state transitions. Raw JSON accompanies this report.</p>${figures}</html>`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [before, after, output] = process.argv.slice(2);
  await writeMobileComparison(JSON.parse(await readFile(before)), JSON.parse(await readFile(after)), output);
}
