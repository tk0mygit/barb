import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, posix } from 'node:path';
import { pathToFileURL } from 'node:url';

const exec = promisify(execFile), sources = new Map();
const compact = source => source.replace(/\s+/g, '');
const trackingContract = compact(`const tracking = [PHASE.FIGHT, PHASE.LANDING].includes(fishing.state.phase) ? {
  x: fishing.state.origin.x + Math.sin(fishing.state.heading) * fishing.state.distance,
  z: fishing.state.origin.z - Math.cos(fishing.state.heading) * fishing.state.distance,
} : null;
rig.update(dt, input, Boolean(preparation) || (boat.mode === 'fishing' && fishing.state.phase !== PHASE.READY), tracking);`);

// Load the pure game/input dependency graph from Git, never from the current
// checkout for its base. The temporary graph is removed after static imports.
async function loadSource(sha) {
  const source = async file => (await exec('git', ['show', `${sha}:${file}`])).stdout;
  const main = await source('src/main.js'), view = await source('src/rendering/fishing.js');
  assert(compact(main).includes(trackingContract), `${sha}: unrecognized production tracking connection`);
  assert(compact(view).includes(compact('let { x, z } = getLurePosition(s);')),
    `${sha}: unrecognized fishing position observation`);
  assert(compact(view).includes(compact('ring.position.set(s.phase === PHASE.CAST ? s.target.x : x, 0.12, s.phase === PHASE.CAST ? s.target.z : z);')),
    `${sha}: unrecognized water target observation`);
  const root = await mkdtemp(join(tmpdir(), 'barb-mobile-fight-')), seen = new Set();
  try {
    await writeFile(join(root, 'package.json'), '{"type":"module"}\n');
    async function materialize(file) {
      assert(file.startsWith('src/') && file.endsWith('.js'), 'Unexpected pure replay dependency');
      if (seen.has(file)) return;
      seen.add(file);
      const text = await source(file), path = join(root, file);
      await mkdir(dirname(path), { recursive: true }); await writeFile(path, text);
      const imports = [...text.matchAll(/\b(?:import|export)\s+(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]/g)];
      for (const [, specifier] of imports) {
        assert(specifier.startsWith('.'), `${file}: non-relative pure replay dependency`);
        await materialize(posix.normalize(posix.join(posix.dirname(file), specifier)));
      }
    }
    const entries = ['src/game/fishing.js', 'src/input/fishing.js', 'src/world/depth.js', 'src/game/game-clock.js'];
    for (const file of entries) await materialize(file);
    const [game, input, depth, clock] = await Promise.all(entries.map(file => import(pathToFileURL(join(root, file)).href)));
    return { ...game, ...input, ...depth, ...clock };
  } finally { await rm(root, { recursive: true, force: true }); }
}

export async function readMobileFightSource(sha) {
  assert.match(sha ?? '', /^[a-f0-9]{40}$/, 'Expected a full FIGHT source SHA');
  if (!sources.has(sha)) sources.set(sha, loadSource(sha).catch(error => { sources.delete(sha); throw error; }));
  return sources.get(sha);
}

const near = (actual, expected, label) => assert(Number.isFinite(actual) && Number.isFinite(expected)
  && Math.abs(actual - expected) <= 1e-10, `${label}: differs from source FIGHT replay`);

// This is the fixed native HUD fixture in mobile-performance.spec.js: neutral
// saved gear, seeded RNG, 150px cast, hook, hold to high tension, release to low,
// then a synchronous portrait->landscape resize. No measured target/tension is
// used to drive the model; every observed sample must match its source engine.
export async function verifyMobileFightCapture(implementation, entry) {
  if (!entry.id.endsWith('-fight') || implementation.cameraModel !== 'prepared-horizontal-aft-1.25') return null;
  const source = await readMobileFightSource(implementation.sha);
  const frames = entry.metrics.cameraFrames, first = frames.findIndex(frame => frame.phase === 'fight');
  assert(first >= 0, `${entry.id}: missing FIGHT history`);
  const boat = { x: 10, z: 20, heading: 0 }, clock = source.createGameClock(undefined, { elapsedSeconds: 90 });
  const fishing = source.createFishing({ random: () => .5, getBoatPosition: () => boat,
    getEnvironment: position => ({ depthM: source.estimateWaterDepth(position), ...clock.state }) });
  assert.equal(fishing.prepare(boat, 0), true); fishing.aim(0, 150); fishing.cast();
  for (let i = 0; i < 480 && fishing.state.phase !== 'bite'; i++) { fishing.step(.25); clock.step(.25); }
  assert.equal(fishing.state.phase, 'bite', `${entry.id}: source fixture did not reach BITE`);
  assert.equal(fishing.hook(), true);
  const input = source.createFishingInput(fishing), trace = [];
  let elapsed = 0, stage = 'initial', holdingFrames = 0, relaxingFrames = 0;
  for (const frame of frames.slice(first)) {
    assert.equal(frame.phase, 'fight', `${entry.id}: FIGHT interrupted`);
    assert.equal(frame.mode, 'fishing'); assert.equal(frame.preparing, false);
    assert(frame.tracking && Number.isFinite(frame.dt) && frame.dt >= 0 && frame.dt <= .25, `${entry.id}: invalid FIGHT frame`);
    if (frame.update) {
      assert.notEqual(stage, 'settled', `${entry.id}: unexpected update after native low-tension stop`);
      if (stage === 'holding') assert(++holdingFrames <= 12, `${entry.id}: native hold exceeded its fixture limit`);
      if (stage === 'relaxing') assert(++relaxingFrames <= 16, `${entry.id}: native release exceeded its fixture limit`);
      elapsed += frame.dt; input.step(frame.dt, elapsed * 1000); fishing.step(frame.dt);
    } else assert.equal(frame.dt, 0);
    assert.equal(fishing.state.phase, 'fight', `${entry.id}: source FIGHT ended`);
    const position = source.getLurePosition(fishing.state);
    near(frame.tracking.x, position.x, `${entry.id}: tracking x`);
    near(frame.tracking.z, position.z, `${entry.id}: tracking z`);
    trace.push({ elapsed, update: frame.update, tracking: position, distance: fishing.state.distance, tension: fishing.state.tension });
    if (stage === 'initial') { input.down(0, 0, elapsed * 1000); stage = 'holding'; }
    else if (stage === 'holding' && fishing.state.tension > .78) { input.up(elapsed * 1000); stage = 'relaxing'; }
    else if (stage === 'relaxing' && fishing.state.tension < .18) stage = 'settled';
  }
  assert.equal(entry.layout?.phase, 'fight', `${entry.id}: missing FIGHT HUD`);
  assert.equal(entry.layout.state, 'ファイト');
  near(entry.layout.tension, fishing.state.tension, `${entry.id}: HUD tension`);
  assert.equal(entry.layout.warning, fishing.state.tension > .78 ? '離して緩める！'
    : fishing.state.tension < .18 ? '長押しで巻く！' : 'テンションを保つ');
  if (entry.id === 'rotated-fight') {
    assert.equal(stage, 'settled', 'rotated-fight: missing native hold/release cycle');
    assert.equal(frames.at(-1).update, false, 'rotated-fight: resize advanced physics');
    assert(frames[first].aspect < 1 && frames.at(-1).aspect > 1, 'rotated-fight: missing portrait rotation');
  }
  return { elapsed, distance: fishing.state.distance, tension: fishing.state.tension, trace };
}
