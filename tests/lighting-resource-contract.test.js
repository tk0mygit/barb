import test from 'node:test';
import assert from 'node:assert/strict';
import { assertColdFishingResources, assertLureInitialization, assertStableResourceIdentities, expectedColdNightResources } from './browser/lighting-resource-contract.js';

function snapshots() {
  const fishing = [{ id: 3, type: 'RingGeometry' }, { id: 4, type: 'LureGeometry' },
    { id: 5, type: 'CircleGeometry' }, { id: 6, type: 'BufferGeometry' }];
  const cold = { counts: { geometries: 2, programs: 2, textures: 4 }, catalog: {
    cpuGeometryIds: [1, 2, 3, 4, 5, 6], initializedGeometryIds: [1, 2], programKeys: ['world-back', 'world-front'], fishingVisible: false,
    fishing: fishing.map(row => ({ ...row, initialized: false, programKeys: [] })) } };
  const lure = structuredClone(cold);
  lure.counts = { geometries: 5, programs: 4, textures: 4 };
  lure.catalog.fishingVisible = true;
  lure.catalog.initializedGeometryIds = [1, 2, 3, 4, 6];
  lure.catalog.programKeys = ['line', 'lure', 'world-back', 'world-front'];
  lure.catalog.fishing = fishing.map(row => ({ ...row, initialized: row.type !== 'CircleGeometry',
    programKeys: row.type === 'RingGeometry' ? ['world-back', 'world-front'] : row.type === 'LureGeometry' ? ['lure'] : row.type === 'BufferGeometry' ? ['line'] : [] }));
  return { cold, lure };
}

test('cold and first-cast contracts distinguish allocation history from recreated resources', () => {
  const { cold, lure } = snapshots();
  assertColdFishingResources(cold);
  assertLureInitialization(cold, lure);
  assertStableResourceIdentities(lure, structuredClone(lure));
  assert.deepEqual(expectedColdNightResources({ fogType: 'CLEAR' }), { calls: 32, triangles: 275444, geometries: 21, textures: 4, programs: 11 });
  assert.deepEqual(expectedColdNightResources({ timeOfDay: 'day', fogType: 'CLEAR' }), { calls: 31, triangles: 275444, geometries: 20, textures: 4, programs: 10 });
  assert.deepEqual(expectedColdNightResources({ timeOfDay: 'day', fogType: 'CLEAR', starInitialized: true }), { calls: 31, triangles: 275444, geometries: 21, textures: 4, programs: 11 });
  for (const fogType of ['FOG', 'DENSE_FOG']) {
    assert.deepEqual(expectedColdNightResources({ fogType }), { calls: 34, triangles: 281588, geometries: 21, textures: 4, programs: 11 });
    assert.deepEqual(expectedColdNightResources({ fogType, starInitialized: true }), { calls: 34, triangles: 281588, geometries: 22, textures: 4, programs: 12 });
  }
});

test('cold startup rejects a missing shared map or any second crown texture', () => {
  for (const textures of [3, 5]) {
    const { cold } = snapshots(); cold.counts.textures = textures;
    assert.throws(() => assertColdFishingResources(cold), /one shared B crown map/);
  }
});

test('READY equipment reuses the exact lure shader while the first cast initializes only the line', () => {
  const { cold, lure } = snapshots();
  const ready = structuredClone(cold);
  ready.catalog.programKeys = ['lure', 'world-back', 'world-front']; ready.counts.programs = 3;
  assertLureInitialization(ready, lure);
});

test('the transparent ring retains both distinct preexisting BackSide and FrontSide shader keys', () => {
  for (const ringKeys of [
    ['world-back'],
    ['world-back', 'world-back'],
    ['world-back', 'world-front', 'extra-ring'],
    ['world-back', 'unseen-front'],
  ]) {
    const { cold, lure } = snapshots();
    lure.catalog.fishing.find(row => row.type === 'RingGeometry').programKeys = ringKeys;
    assert.throws(() => assertLureInitialization(cold, lure));
  }
});

test('first-cast shader reuse cannot conceal unknown programs or eager hidden material uploads', () => {
  for (const mutate of [
    (before, after) => { after.catalog.programKeys.push('leaked'); after.counts.programs++; },
    (before, after) => { after.catalog.fishing.find(row => row.type === 'LureGeometry').programKeys.push('extra-lure'); },
    (before, after) => { after.catalog.fishing.find(row => row.type === 'RingGeometry').programKeys = ['world-back', 'new-ring'];
      after.catalog.programKeys.push('new-ring'); after.counts.programs++; },
    before => { before.catalog.programKeys.push('line'); before.counts.programs++; },
    (before, after) => { after.catalog.fishing.find(row => row.type === 'CircleGeometry').programKeys = ['world-back']; },
    (before, after) => { after.catalog.fishing.find(row => row.type === 'BufferGeometry').programKeys = ['lure']; },
  ]) {
    const { cold, lure } = snapshots();
    cold.catalog.programKeys = ['lure', 'world-back', 'world-front']; cold.counts.programs = 3;
    mutate(cold, lure);
    assert.throws(() => assertLureInitialization(cold, lure));
  }
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

test('5F-1B surface upload is exactly one owned geometry and one distinct RGBA single-pass program', () => {
  const make = () => {
    const { cold, lure } = snapshots();
    cold.catalog.cpuGeometryIds.push(7); lure.catalog.cpuGeometryIds.push(7);
    cold.catalog.surfaceEffects = { id: 7, name: 'fishing-water-effects', vertices: 3456, colorItemSize: 4,
      drawRange: { start: 0, count: 3456 }, forceSinglePass: true, initialized: false, programKeys: [] };
    lure.catalog.surfaceEffects = { ...structuredClone(cold.catalog.surfaceEffects), initialized: true, programKeys: ['water-rgba'] };
    lure.catalog.initializedGeometryIds.push(7); lure.catalog.programKeys.push('water-rgba');
    lure.counts.geometries++; lure.counts.programs++;
    return { cold, lure };
  };
  const p = make(); assertColdFishingResources(p.cold); assertLureInitialization(p.cold, p.lure);
  assertStableResourceIdentities(p.lure, structuredClone(p.lure));
  for (const mutate of [q => { q.lure.catalog.surfaceEffects.forceSinglePass = false; },
    q => { q.lure.catalog.surfaceEffects.vertices++; }, q => { q.lure.catalog.surfaceEffects.colorItemSize = 3; },
    q => { q.lure.catalog.surfaceEffects.programKeys.push('extra'); }, q => { q.lure.counts.geometries++; },
    q => { q.lure.counts.programs--; }, q => { q.lure.catalog.surfaceEffects.id = 99; },
    q => { delete q.lure.catalog.surfaceEffects; }]) {
    const q = make(); mutate(q); assert.throws(() => assertLureInitialization(q.cold, q.lure));
  }
});

test('Sky-2 has one owned 240-point geometry and one shader identity; reuse never hides allocation churn', () => {
  const { cold } = snapshots();
  cold.catalog.cpuGeometryIds.push(7);
  cold.catalog.stars = { id: 7, name: 'clear-night-stars', vertices: 240, initialized: true, visible: true, programKeys: ['star-shader'] };
  cold.catalog.initializedGeometryIds.push(7); cold.counts.geometries++;
  cold.catalog.programKeys.push('star-shader'); cold.counts.programs++;
  assertColdFishingResources(cold); assertStableResourceIdentities(cold, structuredClone(cold));
  for (const mutate of [s => { s.catalog.stars.vertices--; }, s => { s.catalog.stars.id = 99; },
    s => { s.catalog.stars.programKeys.push('extra'); }, s => { s.catalog.stars.initialized = false; },
    s => { s.catalog.stars.id++; }, s => { s.counts.geometries++; }]) {
    const bad = structuredClone(cold); mutate(bad); assert.throws(() => assertStableResourceIdentities(cold, bad));
  }
});
