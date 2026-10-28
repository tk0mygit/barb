// Optional G-2.5 review harness. Artifacts/builds stay outside the source tree.
// No runtime count switch, workflow change, full E2E run or real-device claim.
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, writeFile, symlink, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { chromium } from '@playwright/test';
import { PerspectiveCamera, Matrix4, Vector3 } from 'three';
import { setup } from '../tests/browser/day-night-fixture.js';
import { createSaveData } from '../src/game/save-data.js';
import { createCatchCollection } from '../src/game/catch-collection.js';
import { createAchievements } from '../src/game/achievements.js';
import { createBoatState } from '../src/game/boat.js';
import { createGameClock } from '../src/game/game-clock.js';
import { shoreRadius } from '../src/world/config.js';
import { readMobileImplementation, assertMobileWorkingSource } from './lib/mobile-comparison-source.js';

const exec = promisify(execFile), baseSha = '89de7dd3ba9fdfb3bb736c9d23ab62e7fdfc6b02';
const output = resolve(process.argv[2] ?? '/workspace/artifacts/g2-5');
const headSha = (await exec('git', ['rev-parse', 'HEAD'])).stdout.trim();
await assertMobileWorkingSource(await readMobileImplementation(headSha));
await mkdir(output, { recursive: true });
const work = await mkdtemp(join(tmpdir(), 'barb-forest-review-'));
const counts = [[850, 650, 200], [1000, 766, 234], [1100, 843, 257], [1200, 920, 280]];
const views = [
  { id: 'day-tps', seconds: 90 }, { id: 'day-fps', seconds: 90, fishing: true },
  { id: 'clear-night', seconds: 270 }, { id: 'fog-night', seconds: 3971 * 360 + 270 }, { id: 'dense-night', seconds: 630 },
  { id: 'touch-portrait', seconds: 90, width: 390, height: 844, dpr: 3, touch: true },
  { id: 'touch-landscape', seconds: 90, width: 844, height: 390, dpr: 3, touch: true },
  { id: 'near-shore', seconds: 90, boat: { x: 0, z: -120, heading: 0 } },
  { id: 'far-shore', seconds: 90, boat: { x: 10, z: 100, heading: 0 } },
  { id: 'north-spot', seconds: 90, boat: { x: 0, z: -65, heading: 0 }, fishing: true },
  { id: 'west-spot', seconds: 90, boat: { x: -75, z: 15, heading: -Math.PI / 2 }, fishing: true },
  { id: 'east-spot', seconds: 90, boat: { x: 70, z: -35, heading: Math.PI / 2 }, fishing: true },
];
const selected = process.env.BARB_FOREST_REVIEW_VIEWS?.split(',');
const synchronizeGpu = process.env.BARB_FOREST_SYNC_GPU === '1';
const activeViews = selected ? views.filter(v => selected.includes(v.id)) : views;
const digest = arrays => { const h = createHash('sha256'); for (const a of arrays) h.update(Buffer.from(a.buffer, a.byteOffset, a.byteLength)); return h.digest('hex'); };
const distribution = samples => {
  const sorted = [...samples].sort((a, b) => a - b), at = p => sorted[Math.floor((sorted.length - 1) * p)];
  return { n: samples.length, min: sorted[0], p50: at(0.5), p95: at(0.95), max: sorted.at(-1), samples };
};
const metric = (r, name) => r.metrics.find(v => v.name === name).value;
const records = [], manifests = [];
let browser, server, baseline;
async function stopServer() {
  if (!server) return;
  const current = server; server = null;
  if (current.exitCode === null && current.signalCode === null) await new Promise(done => { current.once('exit', done); current.kill('SIGTERM'); });
}
async function build(total, conifers, broadleaves) {
  const source = join(work, String(total)); await mkdir(source);
  const sha = total === 850 ? baseSha : headSha, archive = join(work, `${total}.tar`);
  await exec('git', ['archive', '--format=tar', '--output', archive, sha]);
  await exec('tar', ['-xf', archive, '-C', source]);
  if (total !== 850) {
    const path = join(source, 'src/world/terrain.js'), original = await readFile(path, 'utf8');
    const patched = original.replace(/total: \d+, conifers: \d+, broadleaves: \d+/, `total: ${total}, conifers: ${conifers}, broadleaves: ${broadleaves}`);
    assert(patched.includes(`total: ${total}, conifers: ${conifers}, broadleaves: ${broadleaves}`)); await writeFile(path, patched);
  }
  await symlink(resolve('node_modules'), join(source, 'node_modules'), 'dir');
  const blobs = {};
  async function scan(dir) {
    for (const entry of await readdir(join(source, dir), { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await scan(path);
      else blobs[path] = (await exec('git', ['hash-object', join(source, path)])).stdout.trim();
    }
  }
  await scan('src');
  for (const path of ['package-lock.json', 'index.html', 'vite.config.js']) blobs[path] = (await exec('git', ['hash-object', join(source, path)])).stdout.trim();
  const manifest = { total, conifers, broadleaves, archivedSha: sha, countOnlyPatch: total !== 850 && await readFile(join(source, 'src/world/terrain.js'), 'utf8') !== (await exec('git', ['show', `${sha}:src/world/terrain.js`])).stdout, blobs };
  manifests.push(manifest);
  const terrainModule = await import(pathToFileURL(join(source, 'src/world/terrain.js')));
  const samples = []; let terrain;
  for (let i = 0; i < 7; i++) {
    const start = performance.now(), t = terrainModule.createTerrain(); samples.push(performance.now() - start);
    if (i === 6) terrain = t;
    else { const g = new Set(), m = new Set(); t.traverse(o => { if (o.geometry) g.add(o.geometry); if (o.material) m.add(o.material); }); g.forEach(x => x.dispose()); m.forEach(x => x.dispose()); }
  }
  const resources = { triangles: 0, geometries: new Set(), materials: new Set(), textures: new Set(), instanceBytes: 0 }, fingerprints = {};
  for (const mesh of terrain.children) {
    resources.triangles += (mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count) / 3 * mesh.count;
    resources.geometries.add(mesh.geometry); resources.materials.add(mesh.material); if (mesh.material.map) resources.textures.add(mesh.material.map);
    const legacyCount = { 'tree-trunks': 850, 'tree-conifers': 650, 'tree-broadleaves': 200, 'shore-rocks': 90 }[mesh.name];
    fingerprints[mesh.name] = { geometry: digest([...Object.keys(mesh.geometry.attributes).sort().map(k => mesh.geometry.attributes[k].array), ...(mesh.geometry.index ? [mesh.geometry.index.array] : [])]),
      ...(mesh.instanceMatrix ? { legacyMatrix: digest([mesh.instanceMatrix.array.subarray(0, legacyCount * 16)]), legacyColor: mesh.instanceColor ? digest([mesh.instanceColor.array.subarray(0, legacyCount * 3)]) : null } : {}) };
    if (mesh.name.startsWith('tree-')) resources.instanceBytes += mesh.instanceMatrix.array.byteLength + (mesh.instanceColor?.array.byteLength ?? 0);
  }
  baseline ??= fingerprints; assert.deepEqual(fingerprints, baseline, `${total}: legacy/geometry drift`);
  assert.equal(resources.triangles, 196312 + (total - 850) * 216);
  const trunks = terrain.getObjectByName('tree-trunks'), matrix = new Matrix4(), trees = [], bands = [0, 0, 0, 0, 0], sectors = Array(12).fill(0);
  for (let i = 0; i < total; i++) {
    trunks.getMatrixAt(i, matrix); const root = new Vector3(0, -0.5, 0).applyMatrix4(matrix);
    const angle = (Math.atan2(root.z, root.x) + Math.PI * 2) % (Math.PI * 2), offset = Math.hypot(root.x, root.z) - shoreRadius(angle);
    bands[offset < 40 ? 0 : offset < 90 ? 1 : offset < 140 ? 2 : offset < 190 ? 3 : 4]++; sectors[Math.floor(angle / (Math.PI * 2) * 12)]++;
    trees.push(root.toArray());
  }
  const nearest = trees.map(([x, , z], i) => Math.min(...trees.filter((_, j) => i !== j).map(([px, , pz]) => Math.hypot(x - px, z - pz))));
  assert.ok(Math.min(...nearest) >= 3.8 - 1e-4);
  Object.assign(manifest, { staticResources: { ...resources, geometries: resources.geometries.size, materials: resources.materials.size, textures: resources.textures.size },
    generationMs: { cold: samples[0], warm: distribution(samples.slice(1)) }, roots: { nearest: distribution(nearest), bands, sectors }, fingerprints });
  await writeFile(join(output, `${total}-placement.json`), JSON.stringify({ ...manifest, rootsInIdOrder: trees }, null, 2));
  const result = await exec('npm', ['run', 'build'], { cwd: source }); await writeFile(join(output, `${total}-build.log`), result.stdout + result.stderr);
  server = spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js'), 'preview', '--host', '127.0.0.1', '--port', '4185', '--strictPort'], { cwd: source, stdio: 'ignore' });
  const deadline = Date.now() + 15000;
  while (true) {
    if (server.exitCode !== null) throw new Error('Review server exited');
    try { if ((await fetch('http://127.0.0.1:4185/barb/')).ok) break; } catch { /* startup only */ }
    assert(Date.now() < deadline, 'Review server startup timeout'); await new Promise(done => setTimeout(done, 100));
  }
  return { source, manifest };
}
async function capture(total, view, source, repeat = 0) {
  const viewport = { width: view.width ?? 1000, height: view.height ?? 700 }, boat = view.boat ?? { x: 10, z: 20, heading: 0 };
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:4185/barb/', viewport, deviceScaleFactor: view.dpr ?? 1, hasTouch: Boolean(view.touch), isMobile: Boolean(view.touch) });
  const page = await context.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  const cdp = await context.newCDPSession(page); await cdp.send('Performance.enable');
  const collection = createCatchCollection(), data = createSaveData({ collection, achievements: createAchievements({ collection }), boat: createBoatState(boat), clock: createGameClock(undefined, { elapsedSeconds: view.seconds }) });
  await page.addInitScript(data => {
    localStorage.setItem('barb.save.v1.slotA', JSON.stringify({ storageVersion: 1, generation: 1, data })); sessionStorage.setItem('lighting-seeded', 'yes');
    let devtools;
    Object.defineProperty(window, '__THREE_DEVTOOLS__', { configurable: true, get: () => devtools, set(value) {
      devtools = value; value.addEventListener('observe', ({ detail: renderer }) => {
        if (!renderer.isWebGLRenderer) return;
        let frame = null; window.forestFrames = [];
        const loop = renderer.setAnimationLoop;
        renderer.setAnimationLoop = function(callback) { let previous = performance.now(); return loop.call(this, callback && (now => {
          frame = { dt: Math.min(0.25, Math.max(0, (now - previous) / 1000)) }; previous = now;
          try { callback(now); } finally { frame = null; }
        })); };
        const render = renderer.render, resources = () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, programs: renderer.info.programs.length });
        renderer.render = function(scene, camera) {
          const result = render.call(this, scene, camera), gl = renderer.getContext();
          window.forestFrames.push({ update: Boolean(frame), dt: frame?.dt ?? 0, mode: document.body.classList.contains('fishing') ? 'fishing' : 'sailing' });
          const debug = gl.getExtension('WEBGL_debug_renderer_info');
          window.forestProbe = { resources: resources(), camera: { position: camera.position.toArray(), quaternion: camera.quaternion.toArray(), aspect: camera.aspect, fov: camera.fov },
            buffer: [gl.drawingBufferWidth, gl.drawingBufferHeight], pixelRatio: renderer.getPixelRatio(), gpu: gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER), timerQueryAvailable: Boolean(gl.getExtension('EXT_disjoint_timer_query_webgl2')) };
          window.forestFinish = () => gl.finish();
          window.forestDiagnostic = () => { const fixed = camera.clone(); fixed.position.set(10, 8.5, 38); fixed.lookAt(10, 2.5, 2); fixed.updateProjectionMatrix(); render.call(renderer, scene, fixed); const counts = resources(); render.call(renderer, scene, camera); return counts; };
          return result;
        };
      });
    } });
  }, data);
  const cpuStart = await cdp.send('Performance.getMetrics'), start = performance.now();
  await setup(page, view.seconds);
  const startupMs = performance.now() - start, ready = await cdp.send('Performance.getMetrics');
  if (view.fishing) {
    if (view.touch) await page.locator('#fish-button').tap(); else await page.locator('#fish-button').click();
    for (let i = 0; i < 12; i++) await page.clock.fastForward(250);
    assert.equal(await page.locator('#fishing-panel').getAttribute('data-phase'), 'ready');
  }
  const snapshot = await page.evaluate(() => ({ ...window.forestProbe, frames: window.forestFrames, lighting: window.lightingProbe.last }));
  // Replay each archived source and saved pose, without setting the live camera.
  const { createCameraRig } = await import(pathToFileURL(join(source, 'src/rendering/camera.js')));
  const camera = new PerspectiveCamera(55, viewport.width / viewport.height, 0.1, 2400), replayBoat = { ...boat, mode: 'sailing' }, rig = createCameraRig(camera, replayBoat);
  for (const f of snapshot.frames) { replayBoat.mode = f.mode; if (f.update) rig.update(f.dt, { lookX: 0, lookY: 0 }); }
  for (const field of ['position', 'quaternion']) camera[field].toArray().forEach((v, i) => assert(Math.abs(v - snapshot.camera[field][i]) < 1e-10, `${total}/${view.id}: camera source mismatch`));
  const image = `${total}-${view.id}${repeat ? `-repeat${repeat}` : ''}.png`;
  if (!repeat) await page.screenshot({ path: join(output, image) });
  const windows = [];
  async function sample() {
    if (synchronizeGpu) await page.evaluate(() => window.forestFinish());
    const frames = await page.evaluate(() => window.lightingProbe.renders);
    const before = await cdp.send('Performance.getMetrics'), begin = performance.now();
    await page.clock.runFor(96);
    if (synchronizeGpu) await page.evaluate(() => window.forestFinish());
    const after = await cdp.send('Performance.getMetrics'), wallMs = performance.now() - begin;
    const state = await page.evaluate(() => ({ frames: window.lightingProbe.renders, probe: window.forestProbe, lighting: window.lightingProbe.last }));
    assert.equal(state.frames - frames, 6);
    for (const key of ['geometries', 'textures', 'programs']) assert.equal(state.probe.resources[key], snapshot.resources[key], `${view.id}: allocation drift`);
    return { frames: 6, simulatedMs: 96, wallMs, taskMs: (metric(after, 'TaskDuration') - metric(before, 'TaskDuration')) * 1000, boat: state.lighting.boat };
  }
  for (let i = 0; i < 3; i++) windows.push(await sample());
  const sailing = [];
  if (view.id === 'day-tps' && repeat === 0) {
    await page.mouse.move(650, 400); await page.mouse.down(); await page.mouse.move(650, 280, { steps: 6 });
    for (let i = 0; i < 3; i++) sailing.push(await sample()); await page.mouse.up();
    assert(sailing.some(s => Math.hypot(s.boat[0] - boat.x, s.boat[1] - boat.z) > 0), 'Native sailing did not move');
  }
  const diagnosticResources = await page.evaluate(() => window.forestDiagnostic());
  assert.deepEqual(errors, []);
  const record = { total, view: view.id, repeat, viewport, dpr: view.dpr ?? 1, savedClockSeconds: view.seconds, boat,
    ...snapshot, synchronizeGpu, diagnosticResources, image: repeat ? null : image, startup: { wallMs: startupMs, taskMs: (metric(ready, 'TaskDuration') - metric(cpuStart, 'TaskDuration')) * 1000, heapBytes: metric(ready, 'JSHeapUsedSize') },
    continuing: { wallMsPerFrame: distribution(windows.map(w => w.wallMs / 6)), taskMsPerFrame: distribution(windows.map(w => w.taskMs / 6)), windows }, sailing, errors };
  records.push(record); await writeFile(join(output, `${total}-${view.id}${repeat ? `-repeat${repeat}` : ''}.json`), JSON.stringify(record, null, 2));
  console.log(`${total} ${view.id}${repeat ? ` repeat ${repeat}` : ''}: ready ${startupMs.toFixed(0)}ms; task/frame ${record.continuing.taskMsPerFrame.p50.toFixed(1)}ms`);
  await context.close();
}
try {
  browser = await chromium.launch({ ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}), args: ['--enable-unsafe-swiftshader'] });
  for (const [total, conifers, broadleaves] of counts) {
    const { source } = await build(total, conifers, broadleaves);
    for (const view of activeViews) await capture(total, view, source);
    if (activeViews.some(v => v.id === 'day-tps')) for (let i = 1; i <= 2; i++) await capture(total, views[0], source, i);
    await stopServer();
  }
  for (const view of activeViews) {
    const pairs = counts.map(([total]) => records.find(r => r.total === total && r.view === view.id && !r.repeat)), base = pairs[0];
    for (const row of pairs.slice(1)) {
      for (const field of ['camera', 'buffer', 'pixelRatio', 'boat', 'savedClockSeconds', 'lighting']) assert.deepEqual(row[field], base[field], `${view.id}: ${field} changed`);
      for (const key of ['calls', 'geometries', 'textures', 'programs']) {
        assert.equal(row.diagnosticResources[key], base.diagnosticResources[key], `${view.id}: diagnostic ${key} changed`);
        assert.equal(row.resources[key], base.resources[key], `${view.id}: actual ${key} changed`);
      }
      assert.equal(row.resources.triangles, base.resources.triangles + (row.total - 850) * 216, `${view.id}: actual triangle delta`);
      assert.equal(row.diagnosticResources.triangles, base.diagnosticResources.triangles + (row.total - 850) * 216, `${view.id}: triangle delta`);
    }
  }
  const metadata = { baseSha, headSha, browser: browser.version(), partial: Boolean(selected), synchronizeGpu, views: activeViews, manifests,
    limits: `Software Chromium/SwiftShader. Node wall and CDP TaskDuration, 3x6 simulated frames; startup day-TPS n=3, other views n=1. GPU completion synchronization: ${synchronizeGpu} (gl.finish before/after each diagnostic window). No device FPS, GPU frame timings, thermals or long-session acceptance. Diagnostic camera render occurs after timed windows. Cold setup includes module/network/automation and first GPU uploads.` };
  await writeFile(join(output, 'comparison.json'), JSON.stringify({ metadata, records }, null, 2));
  const rows = await Promise.all(activeViews.map(async view => `<section><h2>${view.id}</h2><div class="grid">${(await Promise.all(counts.map(async ([total]) => {
    const r = records.find(r => r.total === total && r.view === view.id && !r.repeat);
    return `<figure><figcaption>${total} trees · ${JSON.stringify(r.resources)}<br>ready ${r.startup.wallMs.toFixed(0)}ms · task/frame p50 ${r.continuing.taskMsPerFrame.p50.toFixed(1)}ms</figcaption><img src="data:image/png;base64,${(await readFile(join(output, r.image))).toString('base64')}"></figure>`;
  }))).join('')}</div></section>`));
  await writeFile(join(output, 'gallery.html'), `<!doctype html><html lang="ja"><meta charset="utf-8"><title>BARB G-2.5 forest review</title><style>body{background:#142329;color:#eee;font:14px system-ui;margin:20px}.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}figure{margin:0}img{width:100%;height:auto}figcaption{min-height:80px;font-size:12px}section{margin:30px 0}pre{white-space:pre-wrap}</style><h1>G-2.5 · 850 / 1000 / 1100 / 1200</h1><p>${metadata.limits}</p><p>base ${baseSha} · selected source ${headSha}. All camera poses replayed from archived source and matched across columns. RAW PNG / JSON accompany this self-contained gallery.</p>${rows.join('')}<details><summary>Source manifests</summary><pre>${JSON.stringify(metadata, null, 2)}</pre></details></html>`);
} catch (error) {
  await writeFile(join(output, 'comparison-incomplete.json'), JSON.stringify({ baseSha, headSha, error: error.stack, records, manifests }, null, 2));
  throw error;
} finally { await stopServer(); await browser?.close(); await rm(work, { recursive: true, force: true }); }
