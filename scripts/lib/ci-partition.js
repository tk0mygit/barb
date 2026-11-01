import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { hash, LANES, MOBILE_SPEC } from './ci-artifacts.js';

export const REGULAR_PROFILE = JSON.parse(readFileSync(new URL('../ci-regular-profile.json', import.meta.url), 'utf8'));
export const PARTITION_RULE = 'static-profile-v1; unprofiled inventory in filename order to lower estimated inventory load; ties regular_a; then filter original selection';
const REGULAR_LANES = ['regular_a', 'regular_b'];
const validSpec = spec => typeof spec === 'string' && /^tests\/browser\/[^/]+\.spec\.js$/.test(spec);

export function validateProfile(profile) {
  assert.equal(profile.schemaVersion, 1, 'Unknown regular profile schema');
  assert(typeof profile.version === 'string' && profile.version.length > 0, 'Missing regular profile version');
  assert(typeof profile.method === 'string' && profile.method.length > 0, 'Missing regular profile method');
  assert(Number.isSafeInteger(profile.fallbackEstimateMs) && profile.fallbackEstimateMs > 0, 'Invalid fallback estimate');
  assert(Array.isArray(profile.sources) && profile.sources.length > 0, 'Missing profile sources');
  for (const source of profile.sources) {
    assert(/^\d+$/.test(source.runId) && /^\d+$/.test(source.jobId), 'Invalid profile source run/job');
    assert.match(source.headSha ?? '', /^[a-f0-9]{40}$/, 'Invalid profile source SHA');
    assert(['success', 'failure'].includes(source.conclusion), 'Invalid profile source conclusion');
    assert(Number.isSafeInteger(source.observedTotalMs) && source.observedTotalMs > 0, 'Invalid source total');
  }
  assert.equal(new Set(profile.sources.map(source => source.runId)).size, profile.sources.length, 'Duplicate profile sources');
  assert(Array.isArray(profile.specs) && profile.specs.length > 0, 'Missing profile specs');
  assert.equal(new Set(profile.specs.map(row => row.spec)).size, profile.specs.length, 'Duplicate profile specs');
  for (const row of profile.specs) {
    assert(validSpec(row.spec) && row.spec !== MOBILE_SPEC, 'Invalid regular profile spec');
    assert(REGULAR_LANES.includes(row.lane), 'Invalid regular profile lane');
    assert(Array.isArray(row.observedMs) && row.observedMs.length === profile.sources.length
      && row.observedMs.every(ms => Number.isSafeInteger(ms) && ms > 0), 'Invalid profile duration');
  }
  for (const [index, source] of profile.sources.entries()) {
    assert.equal(profile.specs.reduce((sum, row) => sum + row.observedMs[index], 0), source.observedTotalMs,
      'Profile duration sum differs from source total');
  }
}

// Inventory and the independent Playwright collection define coverage. Profile
// rows only pin reviewed assignments/estimates, never select or omit a spec.
export function partitionSpecs(inventory, selectedSpecs, profile = REGULAR_PROFILE) {
  validateProfile(profile);
  const rows = new Map(profile.specs.map(row => [row.spec, row]));
  const assignments = {}, estimates = {}, inventoryEstimatedMs = { regular_a: 0, regular_b: 0 };
  const unprofiledSpecs = inventory.filter(spec => spec !== MOBILE_SPEC && !rows.has(spec)).sort();
  const staleProfileSpecs = profile.specs.map(row => row.spec).filter(spec => !inventory.includes(spec)).sort();
  for (const spec of inventory) {
    if (spec === MOBILE_SPEC) assignments[spec] = 'mobile';
    else if (rows.has(spec)) {
      const row = rows.get(spec);
      assignments[spec] = row.lane;
      estimates[spec] = row.observedMs.reduce((sum, ms) => sum + ms, 0) / row.observedMs.length;
      inventoryEstimatedMs[row.lane] += estimates[spec];
    }
  }
  for (const spec of unprofiledSpecs) {
    const lane = inventoryEstimatedMs.regular_a <= inventoryEstimatedMs.regular_b ? 'regular_a' : 'regular_b';
    assignments[spec] = lane;
    estimates[spec] = profile.fallbackEstimateMs;
    inventoryEstimatedMs[lane] += estimates[spec];
  }
  const lanes = Object.fromEntries(LANES.map(lane => [lane, selectedSpecs.filter(spec => assignments[spec] === lane)]));
  assert.deepEqual(Object.values(lanes).flat().sort(), [...selectedSpecs].sort(), 'Incomplete spec partition');
  const profileHash = hash(JSON.stringify(profile));
  return {
    lanes, assignments: Object.fromEntries(inventory.map(spec => [spec, assignments[spec]])),
    profile: { version: profile.version, hash: profileHash, sources: profile.sources, method: profile.method,
      fallbackEstimateMs: profile.fallbackEstimateMs },
    inputHash: hash(JSON.stringify({ inventory, selectedSpecs, profileHash })), rule: PARTITION_RULE,
    unprofiledSpecs, staleProfileSpecs,
    warnings: [
      ...(unprofiledSpecs.length ? [`Unprofiled regular specs require review: ${unprofiledSpecs.join(', ')}`] : []),
      ...(staleProfileSpecs.length ? [`Profile specs absent from inventory require review: ${staleProfileSpecs.join(', ')}`] : []),
    ],
    inventoryEstimatedMs,
    estimatedMs: Object.fromEntries(REGULAR_LANES.map(lane => [lane,
      lanes[lane].reduce((sum, spec) => sum + estimates[spec], 0)])),
  };
}
