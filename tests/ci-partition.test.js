import test from 'node:test';
import assert from 'node:assert/strict';
import { executionPlan, playwrightArgs, splitSpecs, validateExecutionPlan, validateLaneCollection } from '../scripts/ci-e2e.js';
import { listBrowserSpecs, SMOKE_SPECS } from '../scripts/ci-risk.js';
import { hash, LANES, MOBILE_SPEC } from '../scripts/lib/ci-artifacts.js';
import { partitionSpecs, REGULAR_PROFILE, validateProfile } from '../scripts/lib/ci-partition.js';

const inventory = listBrowserSpecs();
const profiledInventory = [...REGULAR_PROFILE.specs.map(row => row.spec), MOBILE_SPEC].sort();
const full = { level: 'L2', runE2E: true, specs: inventory };
const clone = value => structuredClone(value);
const regularLanes = ['regular_a', 'regular_b', 'regular_c'];

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

test('reviewed 42-spec profile preserves all three assignments and both runs source totals', () => {
  validateProfile(REGULAR_PROFILE);
  const partition = partitionSpecs(profiledInventory, profiledInventory);
  const reviewed = {
    regular_a: 'achievement-notice achievements audio-gain collection-menu final-stability fish-assets fish-image-loading fishing-effects fishing lake-scenery phase6a qte-operations species-discovery',
    regular_b: 'audio autosave bio-audio-quality cast-motion equipment-game equipment-ui fishing-spots phase6b phase6c qte-economy qte-production rod-reel save-data smoke-pc',
    regular_c: 'bio-audio bio-sources cast-visibility day-night depth-time fish-sales game mobile-layout night-fog opening-title qte-public-on qte-ui-production sale-notice smoke-touch species-discovery-production',
  };
  for (const [lane, names] of Object.entries(reviewed)) {
    assert.deepEqual(partition.lanes[lane], names.split(' ').map(name => `tests/browser/${name}.spec.js`).sort());
  }
  assert.deepEqual(partition.lanes.mobile, [MOBILE_SPEC]);
  assert.deepEqual(Object.values(partition.lanes).flat().sort(), profiledInventory);
  assert.equal(new Set(Object.values(partition.lanes).flat()).size, profiledInventory.length);
  assert.deepEqual(partition.unprofiledSpecs, []);
  assert.deepEqual(partition.staleProfileSpecs, []);
  const loads = partition.estimatedMs;
  assert.deepEqual(loads, { regular_a: 1924859.5, regular_b: 1830126, regular_c: 1864433.5 });
  assert.equal(Object.values(loads).reduce((sum, ms) => sum + ms, 0),
    REGULAR_PROFILE.sources.reduce((sum, source) => sum + source.observedTotalMs, 0) / REGULAR_PROFILE.sources.length);
  assert.deepEqual(REGULAR_PROFILE.sources.map(source => source.runId), ['42496910978', '42450140652']);
  assert.deepEqual(REGULAR_PROFILE.sources.map(source => source.observedTotalMs), [5859219, 5379619]);
  const { version, ...content } = REGULAR_PROFILE;
  assert.equal(version, `regular-2026-11-09-${hash(JSON.stringify(content)).slice(0, 12)}`);
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
  // All three full-inventory loads participate, before filtering L1 selection.
  assert(partition.lanes.regular_b.includes(additions[0]));
  assert(partition.lanes.regular_c.includes(additions[1]));
  const l1 = [...SMOKE_SPECS, additions[0]].sort();
  const selected = partitionSpecs(expanded, l1);
  for (const spec of l1) assert.equal(selected.assignments[spec], partition.assignments[spec]);
  assert.equal(Object.values(selected.lanes).flat().filter(spec => spec === additions[0]).length, 1);
  const incomplete = { ...executionPlan({ ...full, specs: expanded }, expanded, {} ) };
  incomplete.lanes.regular_b = incomplete.lanes.regular_b.filter(spec => spec !== additions[0]);
  assert.throws(() => validateExecutionPlan({ ...full, specs: expanded }, incomplete, expanded, {}), /Inconsistent execution plan/);
});

test('fallback ties go to A then B then C and profile removals retain full coverage warnings', () => {
  const profile = clone(REGULAR_PROFILE);
  const kept = profile.specs[0].spec;
  const added = ['a', 'b', 'c', 'd'].map(name => `tests/browser/new-${name}.spec.js`);
  // No profiled files exist in this inventory: all three lanes start at zero.
  const fallback = partitionSpecs(added, added, profile);
  assert.deepEqual(fallback.lanes.regular_a, [added[0], added[3]]);
  assert.deepEqual(fallback.lanes.regular_b, [added[1]]);
  assert.deepEqual(fallback.lanes.regular_c, [added[2]]);
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
    p => p.sources[0].validationSha = 'stale', p => p.sources[0].jobs = [],
    p => p.sources.push(clone(p.sources[0])),
    p => p.sources[0].jobs.push(clone(p.sources[0].jobs[0])),
    p => p.sources[0].jobs[0].jobId = 'invalid', p => p.sources[0].jobs[0].lane = 'mobile',
    p => p.sources[0].jobs[0].logSha256 = 'invalid', p => p.sources[0].jobs[0].testCount = 0,
    p => p.sources[0].jobs[0].specCount += 1, p => p.sources[0].jobs[0].finishedAt = 'invalid',
    p => p.specs[0].sourceJobs = [], p => p.specs[0].sourceJobs[0] = 'unknown-job',
    p => { p.specs[0].observedMs[0] += 1; p.specs.find(row => row.sourceJobs[0] !== p.specs[0].sourceJobs[0]).observedMs[0] -= 1; },
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
  assert.equal(original.schemaVersion, 3);
  assert.deepEqual(original.selectedSpecs, full.specs);
  assert.match(original.profile.hash, /^[a-f0-9]{64}$/);
  assert.match(original.inputHash, /^[a-f0-9]{64}$/);
  for (const mutate of [
    p => p.schemaVersion = 1, p => p.schemaVersion = 2, p => p.planHash = 'forged',
    p => p.profile.version = 'future', p => p.profile.hash = 'forged',
    p => p.rule = 'random', p => p.context.validationSha = 'b'.repeat(40),
    p => p.inventory.pop(), p => p.selectedSpecs.pop(),
    p => p.assignments[original.lanes.regular_b[0]] = 'regular_a',
    p => p.lanes.regular_a.push(p.lanes.regular_b[0]),
    p => p.lanes.regular_b.pop(), p => p.lanes.mobile.push(p.lanes.regular_a[0]),
    p => p.lanes.regular_c = [], p => delete p.lanes.regular_c,
    p => p.assignments[original.lanes.regular_c[0]] = 'regular_b',
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

test('L1 smoke selection is validated on the original; any empty regular lane can stay inactive', () => {
  const selected = [...SMOKE_SPECS, 'tests/browser/audio-gain.spec.js'].sort();
  const profile = clone(REGULAR_PROFILE);
  const plan = { level: 'L1', runE2E: true, specs: selected };
  const split = partitionSpecs(inventory, selected, profile);
  for (const lane of LANES.filter(lane => split.lanes[lane].length)) {
    assert.equal(validateLaneCollection(plan, split, report(selected), report(split.lanes[lane]), lane).length,
      split.lanes[lane].length);
  }
  for (const active of regularLanes) {
    // A future reviewed assignment can move the whole spec, including smoke.
    for (const row of profile.specs.filter(row => selected.includes(row.spec))) row.lane = active;
    const only = partitionSpecs(inventory, selected, profile);
    assert.deepEqual(only.lanes[active], selected);
    for (const inactive of regularLanes.filter(lane => lane !== active)) assert.deepEqual(only.lanes[inactive], []);
  }
  for (const missing of SMOKE_SPECS) {
    const specs = selected.filter(spec => spec !== missing);
    assert.throws(() => splitSpecs({ ...plan, specs }, inventory), /Missing smoke/);
  }
});

test('continuous fishing remains a whole file on A and Mobile stays dedicated', () => {
  const partition = partitionSpecs(inventory, inventory);
  const fishing = 'tests/browser/fishing.spec.js';
  assert.equal(partition.assignments[fishing], 'regular_a');
  assert.equal(Object.values(partition.lanes).flat().filter(spec => spec === fishing).length, 1);
  assert.deepEqual(partition.lanes.mobile, [MOBILE_SPEC]);
  assert(regularLanes.every(lane => !partition.lanes[lane].includes(MOBILE_SPEC)));
  const args = playwrightArgs([fishing]);
  assert.equal(args.length, 4);
  assert.doesNotMatch(args.join(' '), /--shard|--grep|fullyParallel/);
});
