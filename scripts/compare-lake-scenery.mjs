import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { PerspectiveCamera, Vector3 } from 'three';
import { readMobileImplementation, replayMobileCamera, mobileSourceMetadata } from './lib/mobile-comparison-source.js';
import { expectedMobileResources } from './compare-mobile-performance.mjs';

// The scenery capture uses the real camera, including its ordinary settling.
// Verify that pose against its exact source before comparing the two views.
export function verifySceneryCameraSource(metrics, implementation) {
  const evidence = metrics.cameraEvidence;
  assert(evidence, 'Missing scenery camera source evidence');
  assert.equal(evidence.sha, implementation.sha, 'Scenery camera source SHA differs');
  assert.equal(evidence.cameraBlob, implementation.cameraBlob, 'Scenery camera source blob differs');
  const expected = replayMobileCamera(implementation, evidence.frames);
  for (const field of ['position', 'quaternion']) {
    assert.equal(metrics.camera[field].length, expected[field].length, `Scenery camera ${field} dimensions`);
    metrics.camera[field].forEach((value, index) => assert(Math.abs(value - expected[field][index]) <= 1e-12,
      `Scenery camera ${field}[${index}] differs from its source`));
  }
  assert.equal(metrics.camera.aspect, expected.aspect, 'Scenery camera source aspect differs');
  assert.equal(metrics.camera.fov, 55, 'Scenery camera FOV must remain 55 degrees');
  return expected;
}

export function compareSceneryCameras(before, after, id) {
  if (id !== 'day-fps') {
    assert.deepEqual(after.camera, before.camera, `${id}: camera must match`);
    return { maximumX: 0, maximumY: 0 };
  }
  // READY now interpolates angles instead of target vectors. At the same
  // 3-second capture its residual pitch differs by 8.29e-7rad (0.000708 CSS px).
  // Permit that visible-area difference only: positions/lens remain exact, and
  // both actual poses must separately pass source replay in writeComparison.
  for (const field of ['position', 'fov', 'aspect']) assert.deepEqual(after.camera[field], before.camera[field], `${id}: camera ${field} must match`);
  const make = metrics => {
    const camera = new PerspectiveCamera(metrics.camera.fov, metrics.camera.aspect, 0.1, 2400);
    camera.position.fromArray(metrics.camera.position); camera.quaternion.fromArray(metrics.camera.quaternion);
    camera.updateMatrixWorld(); return camera;
  };
  const a = make(before), b = make(after), { width, height } = before.viewport;
  let maximumX = 0, maximumY = 0;
  for (const x of [-1, 0, 1]) for (const y of [-1, 0, 1]) {
    const projected = new Vector3(x, y, 0).unproject(a).project(b);
    maximumX = Math.max(maximumX, Math.abs(projected.x - x) * width / 2);
    maximumY = Math.max(maximumY, Math.abs(projected.y - y) * height / 2);
  }
  assert(maximumX < 0.001 && maximumY < 0.001, `${id}: READY camera projection exceeds 0.001 CSS px`);
  return { maximumX, maximumY };
}

export async function loadCaptures(directory) {
  const result = new Map();
  async function visit(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const filename = join(path, entry.name);
      if (entry.isDirectory()) { if (entry.name !== 'attachments') await visit(filename); }
      else if (/^(day-tps|day-fps|twilight|clear-night|fog-night|dense-night|portrait|landscape)-metrics\.json$/.test(entry.name)) {
        const id = entry.name.replace('-metrics.json', '');
        assert.ok(!result.has(id), `Duplicate ${id}: use separate main and PR result directories`);
        result.set(id, { metrics: JSON.parse(await readFile(filename, 'utf8')), image: (await readFile(join(path, `${id}.png`))).toString('base64') });
      }
    }
  }
  await visit(resolve(directory));
  return result;
}

export async function writeComparison(main, pr, destination, mainLabel = 'main d500542') {
  assert.equal(main.size, 8, 'main needs all eight reference views');
  assert.equal(pr.size, 8, 'PR needs all eight reference views');
  const comparisons = [], figures = [], sources = new Map();
  async function verifySource(metrics) {
    const sha = metrics.cameraEvidence?.sha;
    if (!sources.has(sha)) sources.set(sha, await readMobileImplementation(sha));
    verifySceneryCameraSource(metrics, sources.get(sha));
  }
  for (const [id, before] of main) {
    const after = pr.get(id);
    assert.ok(after, `Missing PR view ${id}`);
    await verifySource(before.metrics); await verifySource(after.metrics);
    for (const field of ['viewport', 'deviceScaleFactor', 'savedClockSeconds', 'boat', 'heading', 'waterTime', 'fogStrength']) {
      assert.deepEqual(after.metrics[field], before.metrics[field], `${id}: ${field} must match`);
    }
    const cameraProjectionDelta = compareSceneryCameras(before.metrics, after.metrics, id);
    const a = before.metrics.resources, b = after.metrics.resources;
    const delta = Object.fromEntries(Object.keys(a).map(field => [field, b[field] - a[field]]));
    const main = sources.get(before.metrics.cameraEvidence.sha), candidate = sources.get(after.metrics.cameraEvidence.sha);
    const expected = expectedMobileResources(a, { mode: 'regression', baseSha: main.sha, validationSha: candidate.sha,
      implementations: { main: mobileSourceMetadata(main), pr: mobileSourceMetadata(candidate) } });
    if (expected.transition?.startsWith('forest-G2.5:')) assert.deepEqual(b, expected.resources, `${id}: exact forest resource transition`);
    else {
      assert.ok(delta.calls <= 3, `${id}: draw call increase exceeds +3`);
      assert.ok(b.triangles <= a.triangles * 1.15, `${id}: triangle increase exceeds 15%`);
    }
    const result = { id, before: before.metrics, after: after.metrics, delta, cameraProjectionDelta,
      ...(expected.transition?.startsWith('forest-G2.5:') ? { resourceTransition: expected.transition } : {}),
      triangleIncreasePercent: (b.triangles / a.triangles - 1) * 100 };
    comparisons.push(result);
    figures.push(`<section><h2>${id}</h2><p>Draw calls ${a.calls} → ${b.calls}; triangles ${a.triangles.toLocaleString('en-US')} → ${b.triangles.toLocaleString('en-US')} (${result.triangleIncreasePercent.toFixed(2)}%); geometries ${a.geometries} → ${b.geometries}; textures ${a.textures} → ${b.textures}; programs ${a.programs} → ${b.programs}.</p><div class="pair"><figure><figcaption>${mainLabel}</figcaption><img src="data:image/png;base64,${before.image}"></figure><figure><figcaption>Phase 4C-1A</figcaption><img src="data:image/png;base64,${after.image}"></figure></div><details><summary>Measurement JSON</summary><pre>${JSON.stringify(result, null, 2)}</pre></details></section>`);
  }
  await mkdir(dirname(resolve(destination)), { recursive: true });
  await writeFile(destination, `<!doctype html><html lang="ja"><meta charset="utf-8"><title>BARB scenery: main / Phase 4C-1A</title><style>body{background:#15242a;color:#edf0e9;font:15px system-ui;margin:24px}h1{font-size:24px}section{margin:42px 0}.pair{display:grid;grid-template-columns:1fr 1fr;gap:16px}figure{margin:0}figcaption{padding:8px 0;color:#adbeaf}img{width:100%;height:auto}pre{white-space:pre-wrap;font-size:12px}summary{cursor:pointer;margin:12px 0}@media(max-width:800px){.pair{grid-template-columns:1fr}}</style><h1>BARB Phase 4C-1A — main / PR visual comparison</h1><p>同一の保存座標(10,20)、向き0、時計、viewport、DPR 1で収集。実カメラは各SHAのsource再生で厳密照合。READYのday-fpsだけは同一位置・FOV55を保ち、補間整定残差の画面9点投影差が0.001 CSS px未満であることを検証。その他の視点はカメラも完全一致。8条件の画像とrenderer.infoを比較。ソフトウェアChromiumの測定であり、スマートフォン実機FPSやGPU時間を保証しません。初回負荷・継続描画時間の定義と実測は各JSONを参照してください。公開ゲームには含めません。</p>${figures.join('')}</html>`);
  await writeFile(destination.replace(/\.html$/, '') + '.json', JSON.stringify(comparisons, null, 2));
  return comparisons;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [mainDirectory, prDirectory, destination] = process.argv.slice(2);
  if (!mainDirectory || !prDirectory || !destination) throw new Error('Usage: node scripts/compare-lake-scenery.mjs MAIN_RESULTS PR_RESULTS OUTPUT.html');
  const comparisons = await writeComparison(await loadCaptures(mainDirectory), await loadCaptures(prDirectory), destination);
  console.log(JSON.stringify(comparisons.map(({ id, delta, triangleIncreasePercent }) => ({ id, delta, triangleIncreasePercent })), null, 2));
}
