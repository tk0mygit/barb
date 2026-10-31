import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const implementations = new Map();
async function coldSource(sha) {
  assert.match(sha, /^[a-f0-9]{40}$/);
  if (!implementations.has(sha)) implementations.set(sha, (async () => {
    const dir = await mkdtemp(join(tmpdir(), 'barb-qte-audit-'));
    try {
      const archive = execFileSync('git', ['archive', '--format=tar', sha, 'src/game', 'package.json']);
      execFileSync('tar', ['-xf', '-', '-C', dir], { input: archive });
      const load = name => import(pathToFileURL(join(dir, `src/game/${name}.js`)).href);
      const [provider, operations, fight, species] = await Promise.all([
        load('qte-operation-provider'), load('qte-operations'), load('fight-qte'), load('fish-species'),
      ]);
      return { ...provider, ...operations, ...fight, ...species };
    } finally { await rm(dir, { recursive: true, force: true }); }
  })());
  return implementations.get(sha);
}

// Independent Node realm, exact committed sources, native capture-phase input.
// This verifies ON scoring and the state delta without exempting an existing
// image/camera comparison or treating a fixed expected number as provenance.
export async function auditProductionQte({ before, after, native }) {
  const source = before.source;
  const text = execFileSync('git', ['show', `${source.sha}:src/main.js`]);
  assert.equal(createHash('sha256').update(text).digest('hex'), source.mainSha256);
  assert.equal(execFileSync('git', ['rev-parse', `${source.sha}:src`]).toString().trim(), source.sourceTree);
  const code = await coldSource(source.sha);
  const identity = { fightId: before.fight.id, speciesId: before.encounter.speciesId, lengthCm: before.encounter.lengthCm };
  const provider = code.createQteOperationProvider(identity), index = before.descriptor.index;
  const descriptor = provider.getDescriptor(index);
  assert.deepEqual(descriptor, before.descriptor);
  assert.deepEqual(code.getQteDifficulty(code.getFishSpecies(identity.speciesId), identity.lengthCm), before.fight.difficulty);
  assert.deepEqual(before.snapshot.reasons, []);
  const offset = before.clockSample.raw - before.clockSample.active;
  const window = { active: before.snapshot.active, deadline: before.snapshot.deadline, cut: before.snapshot.cut };
  const handle = { adapter: {}, instance: {}, fightId: identity.fightId, index };
  const geometry = { revision: before.snapshot.geometryRevision, region: before.geometry.region, target: before.geometry.target };
  const edges = [], inputs = native.filter(e => e.fightId === identity.fightId && e.index === index);
  let contact = null, serial = 0, contactSerial = 0;
  for (const e of inputs) {
    assert.equal(e.trusted, true, 'Operation evidence must be native');
    assert.ok(e.coalescedCount <= 128, 'Native path evidence was truncated');
    const sourceTime = e.source - offset, receipt = e.receipt - offset;
    if (['pointercancel', 'lostpointercapture'].includes(e.type)) {
      // A normal completed up releases its capture. A lostcapture belonging
      // to an active contact cancels it; a self-release after up has no owner.
      if (contact?.pointerId === e.pointerId) { contact.cancelled = true; contact = null; }
      continue;
    }
    if (sourceTime < window.active || sourceTime > window.deadline || receipt >= window.cut) continue;
    if (e.type === 'pointerdown') {
      if (contact || !e.isPrimary || e.pointerType === 'mouse' && e.button !== 0) continue;
      contact = { ...handle, serial: ++contactSerial, generation: e.generation, lifecycle: 0,
        pointerId: e.pointerId, pointerType: e.pointerType, button: e.button, isPrimary: e.isPrimary,
        geometry, displayRevision: geometry.revision, downSource: sourceTime, downReceipt: receipt,
        startX: e.x, startY: e.y, endX: e.x, endY: e.y, maxDisplacement: 0, cancelled: false };
      edges.push({ type: 'down', source: sourceTime, receipt, serial: serial++, contact });
    } else if (contact && contact.pointerId === e.pointerId) {
      for (const point of [...e.coalesced, e]) {
        const at = point.source - offset;
        if (at < contact.downSource || at > window.deadline) { contact.cancelled = true; continue; }
        contact.maxDisplacement = Math.max(contact.maxDisplacement, Math.hypot(point.x - contact.startX, point.y - contact.startY));
      }
      contact.endX = e.x; contact.endY = e.y;
      if (e.type === 'pointerup') {
        contact.upSource = sourceTime; contact.upReceipt = receipt;
        edges.push({ type: 'up', source: sourceTime, receipt, serial: serial++, contact }); contact = null;
      }
    }
  }
  const score = code.createQteEvaluator(provider)({ handle, window, edges, completedOperations: 0, final: true });
  assert.equal(score.success, after.snapshot.success, 'Cold source scorer differs from browser delivery');
  const warning = before.events.find(e => e.type === 'qte-warning' && e.fight.id === identity.fightId && e.fight.qte.token.index === index).fight;
  const resolved = after.events.filter(e => e.type === 'qte-resolved' && e.fight.id === identity.fightId)[index].fight;
  const physical = { distance: warning.distance, tension: warning.tension };
  const failures = warning.qte.failures + (score.success ? 0 : 1);
  code.applyQteEffect(physical, score.success, failures, warning.startDistance, warning.scale, warning.landingDistance);
  assert.equal(resolved.distance, physical.distance, 'Effect distance differs from exact source replay');
  assert.equal(resolved.tension, physical.tension, 'Effect tension differs from exact source replay');
  assert.equal(resolved.qte.successes, warning.qte.successes + (score.success ? 1 : 0));
  assert.equal(resolved.qte.failures, failures);
  return { source, identity, descriptor, window, native: inputs,
    inputSha256: createHash('sha256').update(JSON.stringify(inputs)).digest('hex'),
    independentScore: score, independentEffect: physical, resolved,
    classification: 'QTE scoring/effect state delta; no rendering comparison exemption' };
}
