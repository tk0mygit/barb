import test from 'node:test';
import assert from 'node:assert/strict';
import { executionPlan, playwrightArgs, splitSpecs, validateExecutionPlan, validateLaneCollection } from '../scripts/ci-e2e.js';
import { listBrowserSpecs, SMOKE_SPECS } from '../scripts/ci-risk.js';
import { LANES, MOBILE_SPEC } from '../scripts/lib/ci-artifacts.js';
import { partitionSpecs, REGULAR_PROFILE, validateProfile } from '../scripts/lib/ci-partition.js';

const inventory = listBrowserSpecs();
const profiledInventory = [...REGULAR_PROFILE.specs.map(row => row.spec), MOBILE_SPEC].sort();
const full = { level: 'L2', runE2E: true, specs: inventory };
const clone = value => structuredClone(value);

test('runner filters are anchored and escaped, with one worker and forbid-only', () => {
  const spec = 'tests/browser/audio+[x].spec.js';
  const args = playwrightArgs([spec]);
  assert(args.includes('--workers=1')); assert(args.includes('--forbid-only'));
  const filter = new RegExp(args[1]);
  assert(filter.test(`/checkout/${spec}`));
  for (const wrong of ['tests/browser/not-audio+[x].spec.js', `${spec}.extra`, 'tests/browser/audioxxspecxjs']) {
    assert(!filter.test(wrong), wrong);
  }
});

test('reviewed 32-spec profile preserves A/B membership, measured totals and initial balance', () => {
  validateProfile(REGULAR_PROFILE);
  const partition = partitionSpecs(profiledInventory, profiledInventory);
  assert.equal(REGULAR_PROFILE.specs.filter(row => row.lane === 'regular_a').length, 15);
  assert.equal(REGULAR_PROFILE.specs.filter(row => row.lane === 'regular_b').length, 17);
  for (const row of REGULAR_PROFILE.specs) {
    assert(partition.lanes[row.lane].includes(row.spec), row.spec);
    assert(!partition.lanes[row.lane === 'regular_a' ? 'regular_b' : 'regular_a'].includes(row.spec));
  }
  assert.deepEqual(partition.lanes.mobile, [MOBILE_SPEC]);
  assert.deepEqual(Object.values(partition.lanes).flat().sort(), profiledInventory);
  assert.equal(new Set(Object.values(partition.lanes).flat()).size, profiledInventory.length);
  assert.deepEqual(partition.unprofiledSpecs, []);
  assert.deepEqual(partition.staleProfileSpecs, []);
  const loads = partition.estimatedMs;
  assert(loads.regular_a > 20 * 60000 && loads.regular_a < 21 * 60000);
  assert(loads.regular_b > 20 * 60000 && loads.regular_b < 21 * 60000);
  assert(Math.abs(loads.regular_a - loads.regular_b) < .13 * 60000);
  assert.equal(loads.regular_a + loads.regular_b,
    REGULAR_PROFILE.sources.reduce((sum, source) => sum + source.observedTotalMs, 0) / REGULAR_PROFILE.sources.length);
  // A future unprofiled file must also pass this baseline test and reach the
  // runner through the warning/fallback contract, rather than block npm test.
  const current = partitionSpecs(inventory, inventory);
  assert.deepEqual(Object.values(current.lanes).flat().sort(), inventory);
  assert.deepEqual(current.unprofiledSpecs, inventory.filter(spec => !profiledInventory.includes(spec)));
});

test('new specs use deterministic fallback, retain coverage and record review warnings', () => {
  const additions = ['tests/browser/new-a.spec.js', 'tests/browser/new-b.spec.js'];
  const expanded = [...profiledInventory, ...additions].sort();
  const partition = partitionSpecs(expanded, expanded);
  assert.deepEqual(partition, partitionSpecs(expanded, expanded));
  assert.deepEqual(partition.unprofiledSpecs, additions);
  assert.match(partition.warnings.join('\n'), /Unprofiled.*require review/);
  assert.deepEqual(Object.values(partition.lanes).flat().sort(), expanded);
  // The baseline has B slightly lighter; after one fallback estimate A is lighter.
  assert(partition.lanes.regular_b.includes(additions[0]));
  assert(partition.lanes.regular_a.includes(additions[1]));
  const l1 = [...SMOKE_SPECS, additions[0]].sort();
  const selected = partitionSpecs(expanded, l1);
  for (const spec of l1) assert.equal(selected.assignments[spec], partition.assignments[spec]);
  assert.equal(Object.values(selected.lanes).flat().filter(spec => spec === additions[0]).length, 1);
  const incomplete = { ...executionPlan({ ...full, specs: expanded }, expanded, {} ) };
  incomplete.lanes.regular_b = incomplete.lanes.regular_b.filter(spec => spec !== additions[0]);
  assert.throws(() => validateExecutionPlan({ ...full, specs: expanded }, incomplete, expanded, {}), /Inconsistent execution plan/);
});

test('fallback tie goes to A and profile removals warn without inventing selected specs', () => {
  const profile = clone(REGULAR_PROFILE);
  const kept = profile.specs[0].spec;
  const added = ['tests/browser/new-a.spec.js', 'tests/browser/new-b.spec.js'];
  // No profiled files exist in this inventory: both lanes start at zero.
  const fallback = partitionSpecs(added, added, profile);
  assert.deepEqual(fallback.lanes.regular_a, [added[0]]);
  assert.deepEqual(fallback.lanes.regular_b, [added[1]]);
  assert.equal(fallback.staleProfileSpecs.length, profile.specs.length);
  const removed = inventory.filter(spec => spec !== kept);
  const partition = partitionSpecs(removed, removed, profile);
  assert.deepEqual(partition.staleProfileSpecs, [kept]);
  assert.match(partition.warnings.join('\n'), /absent from inventory require review/);
  assert(!Object.values(partition.lanes).flat().includes(kept));
});

test('invalid profile schema, lanes, duplicate files, sources and nonpositive/nonfinite durations fail', () => {
  for (const mutate of [
    p => p.schemaVersion = 0, p => p.version = '', p => p.method = '',
    p => p.fallbackEstimateMs = 0, p => p.fallbackEstimateMs = NaN,
    p => p.specs.push(clone(p.specs[0])), p => p.specs[0].spec = MOBILE_SPEC,
    p => p.specs[0].lane = 'regular', p => p.specs[0].lane = 'mobile',
    p => p.specs[0].observedMs = [], p => p.specs[0].observedMs[0] = 0,
    p => p.specs[0].observedMs[0] = -1, p => p.specs[0].observedMs[0] = NaN,
    p => p.specs[0].observedMs[0] = Infinity, p => p.specs[0].observedMs[0] = '100',
    p => p.specs[0].observedMs[0] += 1, p => p.sources = [],
    p => p.sources[0].headSha = 'stale', p => p.sources[0].observedTotalMs -= 1,
  ]) {
    const profile = clone(REGULAR_PROFILE); mutate(profile);
    assert.throws(() => partitionSpecs(inventory, inventory, profile));
  }
});

test('unknown selection, inventory duplicates, missing full specs and invalid paths fail', () => {
  for (const [plan, files] of [
    [full, [...inventory, inventory[0]]],
    [{ ...full, specs: [...inventory, inventory[0]] }, inventory],
    [{ ...full, specs: [...inventory, 'tests/browser/unknown.spec.js'] }, inventory],
    [{ ...full, specs: inventory.slice(1) }, inventory],
    [{ ...full, specs: ['tests/browser/../escape.spec.js'] }, ['tests/browser/../escape.spec.js']],
  ]) assert.throws(() => splitSpecs(plan, files));
});

test('schema, hash, context, inputs and assignment changes cannot reuse a prepared plan', () => {
  const context = { validationSha: 'a'.repeat(40) };
  const original = executionPlan(full, inventory, context);
  assert.equal(original.schemaVersion, 2);
  assert.deepEqual(original.selectedSpecs, full.specs);
  assert.match(original.profile.hash, /^[a-f0-9]{64}$/);
  assert.match(original.inputHash, /^[a-f0-9]{64}$/);
  for (const mutate of [
    p => p.schemaVersion = 1, p => p.planHash = 'forged',
    p => p.profile.version = 'future', p => p.profile.hash = 'forged',
    p => p.rule = 'random', p => p.context.validationSha = 'b'.repeat(40),
    p => p.inventory.pop(), p => p.selectedSpecs.pop(),
    p => p.assignments[original.lanes.regular_b[0]] = 'regular_a',
    p => p.lanes.regular_a.push(p.lanes.regular_b[0]),
    p => p.lanes.regular_b.pop(), p => p.lanes.mobile.push(p.lanes.regular_a[0]),
    p => p.estimatedMs.regular_a += 1,
  ]) {
    const changed = clone(original); mutate(changed);
    assert.throws(() => validateExecutionPlan(full, changed, inventory, context));
  }
});

function report(specs) {
  return { suites: [{ specs: specs.map(file => ({
    id: file, file: file.replace('tests/browser/', ''), tests: [{ projectName: '' }],
  })) }] };
}

test('L1 smoke selection is validated on the original; either empty regular lane can stay inactive', () => {
  const selected = [...SMOKE_SPECS, 'tests/browser/audio-gain.spec.js'].sort();
  const profile = clone(REGULAR_PROFILE);
  // A future reviewed assignment may put a smoke on either runner.
  profile.specs.find(row => row.spec === SMOKE_SPECS[1]).lane = 'regular_b';
  const plan = { level: 'L1', runE2E: true, specs: selected };
  const split = partitionSpecs(inventory, selected, profile);
  for (const lane of LANES.filter(lane => split.lanes[lane].length)) {
    assert.equal(validateLaneCollection(plan, split, report(selected), report(split.lanes[lane]), lane).length,
      split.lanes[lane].length);
  }
  profile.specs.find(row => row.spec === SMOKE_SPECS[0]).lane = 'regular_b';
  const onlyB = partitionSpecs(inventory, selected, profile);
  assert.deepEqual(onlyB.lanes.regular_a, []);
  assert.deepEqual(onlyB.lanes.regular_b, selected);
  for (const missing of SMOKE_SPECS) {
    const specs = selected.filter(spec => spec !== missing);
    assert.throws(() => splitSpecs({ ...plan, specs }, inventory), /Missing smoke/);
  }
});
