import test from 'node:test';
import assert from 'node:assert/strict';
import { assertColdFishingResources, assertLureInitialization, assertStableResourceIdentities, expectedColdNightResources } from './browser/lighting-resource-contract.js';

function snapshots() {
  const fishing = [{ id: 3, type: 'RingGeometry' }, { id: 4, type: 'LureGeometry' },
    { id: 5, type: 'CircleGeometry' }, { id: 6, type: 'BufferGeometry' }];
  const cold = { counts: { geometries: 2, programs: 1, textures: 3 }, catalog: {
    cpuGeometryIds: [1, 2, 3, 4, 5, 6], initializedGeometryIds: [1, 2], programKeys: ['world'], fishingVisible: false,
    fishing: fishing.map(row => ({ ...row, initialized: false, programKeys: [] })) } };
  const lure = structuredClone(cold);
  lure.counts = { geometries: 5, programs: 3, textures: 3 };
  lure.catalog.fishingVisible = true;
  lure.catalog.initializedGeometryIds = [1, 2, 3, 4, 6];
  lure.catalog.programKeys = ['line', 'lure', 'world'];
  lure.catalog.fishing = fishing.map(row => ({ ...row, initialized: row.type !== 'CircleGeometry',
    programKeys: row.type === 'RingGeometry' ? ['world'] : row.type === 'LureGeometry' ? ['lure'] : row.type === 'BufferGeometry' ? ['line'] : [] }));
  return { cold, lure };
}

test('cold and first-cast contracts distinguish allocation history from recreated resources', () => {
  const { cold, lure } = snapshots();
  assertColdFishingResources(cold);
  assertLureInitialization(cold, lure);
  assertStableResourceIdentities(lure, structuredClone(lure));
  assert.deepEqual(expectedColdNightResources(false), { calls: 31, triangles: 221444, geometries: 20, textures: 3, programs: 10 });
  assert.deepEqual(expectedColdNightResources(true), { calls: 34, triangles: 227588, geometries: 21, textures: 3, programs: 11 });
});

test('cold contract rejects eager marker upload even when the aggregate looks plausible', () => {
  const { cold } = snapshots();
  cold.catalog.initializedGeometryIds.push(3); cold.catalog.fishing[0].initialized = true; cold.counts.geometries++;
  assert.throws(() => assertColdFishingResources(cold), /uploaded before preparation/);
});

test('GPU count, ownership and shader leaks cannot hide behind an increased numeric ceiling', () => {
  for (const mutate of [
    after => after.counts.geometries++,
    after => { after.catalog.initializedGeometryIds.push(99); after.counts.geometries++; },
    after => { after.catalog.programKeys.push('leaked'); after.counts.programs++; },
    after => { after.catalog.cpuGeometryIds.push(7); },
  ]) {
    const { cold, lure } = snapshots(); mutate(lure);
    assert.throws(() => assertLureInitialization(cold, lure));
  }
});

test('repeated casts reject geometry identity churn, program churn and extra texture allocation', () => {
  for (const mutate of [
    after => { after.catalog.cpuGeometryIds.push(7); },
    after => { after.catalog.programKeys[0] = 'replacement'; },
    after => { after.counts.textures++; },
  ]) {
    const { lure } = snapshots(), after = structuredClone(lure); mutate(after);
    assert.throws(() => assertStableResourceIdentities(lure, after));
  }
});
