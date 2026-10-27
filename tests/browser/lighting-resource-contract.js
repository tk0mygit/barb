import assert from 'node:assert/strict';

const FISHING_GEOMETRY_TYPES = ['BufferGeometry', 'CircleGeometry', 'LureGeometry', 'RingGeometry'];
const LURE_GEOMETRY_TYPES = ['BufferGeometry', 'LureGeometry', 'RingGeometry'];
const sorted = values => [...values].sort((a, b) => typeof a === 'number' ? a - b : a.localeCompare(b));
const difference = (after, before) => after.filter(value => !before.includes(value));

export function assertResourceCatalog({ counts, catalog }) {
  assert(catalog, 'Missing lighting GPU resource catalog');
  assert.deepEqual(sorted(catalog.fishing.map(row => row.type)), FISHING_GEOMETRY_TYPES, 'Fishing factory resource types changed');
  assert.equal(new Set(catalog.fishing.map(row => row.id)).size, 4, 'Fishing factory must retain its four geometries');
  assert.equal(new Set(catalog.cpuGeometryIds).size, catalog.cpuGeometryIds.length, 'Duplicate CPU geometry id');
  assert.equal(new Set(catalog.initializedGeometryIds).size, catalog.initializedGeometryIds.length, 'Duplicate initialized geometry id');
  for (const id of catalog.initializedGeometryIds) assert(catalog.cpuGeometryIds.includes(id), 'GPU geometry is no longer owned by the scene');
  assert.equal(counts.geometries, catalog.initializedGeometryIds.length, 'GPU geometry count differs from the actual draw identities');
  assert.equal(counts.programs, catalog.programKeys.length, 'GPU program count differs from the actual cache keys');
  assert.equal(new Set(catalog.programKeys).size, catalog.programKeys.length, 'Duplicate GPU program cache key');
  for (const row of catalog.fishing) assert.equal(row.initialized, catalog.initializedGeometryIds.includes(row.id), 'Fishing geometry initialization flag differs');
}

export function assertColdFishingResources(snapshot) {
  assertResourceCatalog(snapshot);
  assert.equal(snapshot.counts.textures, 4, 'Cold scene requires three existing textures and one shared B crown map');
  assert.equal(snapshot.catalog.fishingVisible, false, 'Cold fishing group is visible');
  assert(snapshot.catalog.fishing.every(row => !row.initialized && row.programKeys.length === 0), 'Hidden fishing resources were uploaded before preparation');
}

// The historical matched-night counters included four unused marker geometries
// and two marker shader variants uploaded by the old first BOAT render. Remove
// that identified initialization history, retaining the exact draw/texture cost.
export function expectedColdNightResources(fog) {
  return { calls: 31 + (fog ? 3 : 0), triangles: 221444 + (fog ? 6144 : 0),
    geometries: 24 - FISHING_GEOMETRY_TYPES.length + (fog ? 1 : 0),
    // Shared B replaces the old untextured foliage program; it adds one map,
    // not a second material/program variant as the conifer-only preview did.
    textures: 4, programs: 12 - 2 + (fog ? 1 : 0) };
}

export function assertLureInitialization(before, after) {
  assertResourceCatalog(before); assertResourceCatalog(after);
  assert.deepEqual(after.catalog.cpuGeometryIds, before.catalog.cpuGeometryIds, 'Cast recreated scene geometry');
  const expectedIds = after.catalog.fishing.filter(row => LURE_GEOMETRY_TYPES.includes(row.type)).map(row => row.id);
  const expectedNewIds = difference(expectedIds, before.catalog.initializedGeometryIds);
  assert.deepEqual(sorted(difference(after.catalog.initializedGeometryIds, before.catalog.initializedGeometryIds)), sorted(expectedNewIds), 'Cast uploaded geometry outside the existing lure/ring/line');
  assert.equal(after.counts.geometries, before.counts.geometries + expectedNewIds.length, 'Cast GPU allocation delta differs');
  assert(after.catalog.fishing.every(row => row.initialized === LURE_GEOMETRY_TYPES.includes(row.type)), 'LURE must upload ring/lure/line and leave the fish shadow cold');
  const materialKeys = [...new Set(after.catalog.fishing.flatMap(row => row.programKeys))];
  const expectedNewKeys = difference(materialKeys, before.catalog.programKeys);
  assert.equal(expectedNewKeys.length, 2, 'The first cast must initialize only the existing lure and line shader variants');
  assert.deepEqual(sorted(difference(after.catalog.programKeys, before.catalog.programKeys)), sorted(expectedNewKeys), 'Cast uploaded a shader outside the existing marker materials');
  assert.equal(after.counts.programs, before.counts.programs + expectedNewKeys.length, 'Cast GPU shader delta differs');
  assert.equal(after.counts.textures, before.counts.textures, 'Cast created a texture');
}

export function assertStableResourceIdentities(before, after) {
  assertResourceCatalog(before); assertResourceCatalog(after);
  for (const key of ['cpuGeometryIds', 'initializedGeometryIds', 'programKeys']) assert.deepEqual(after.catalog[key], before.catalog[key], `Repeated rendering changed ${key}`);
  for (const key of ['geometries', 'textures', 'programs']) assert.equal(after.counts[key], before.counts[key], `Repeated rendering changed ${key}`);
}
