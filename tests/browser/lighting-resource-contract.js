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
  if (catalog.surfaceEffects) {
    const e = catalog.surfaceEffects;
    assert.equal(e.name, 'fishing-water-effects'); assert.equal(e.vertices, 3456); assert.equal(e.colorItemSize, 4);
    assert.deepEqual(e.drawRange, { start: 0, count: 3456 }); assert.equal(e.forceSinglePass, true);
    assert(catalog.cpuGeometryIds.includes(e.id), 'Surface geometry lost its scene owner');
    assert.equal(e.initialized, catalog.initializedGeometryIds.includes(e.id), 'Surface geometry initialization differs');
    assert.equal(e.programKeys.length, e.initialized ? 1 : 0, 'Surface must use exactly one built-in RGBA shader');
  }
  if (catalog.stars) {
    const s = catalog.stars;
    assert.equal(s.name, 'clear-night-stars'); assert.equal(s.vertices, 240);
    assert(catalog.cpuGeometryIds.includes(s.id), 'Star geometry lost its scene owner');
    assert.equal(s.initialized, catalog.initializedGeometryIds.includes(s.id), 'Star initialization differs');
    assert.equal(s.programKeys.length, s.initialized ? 1 : 0, 'Stars require one shader program');
    if (s.visible) assert(s.initialized, 'Visible stars were not initialized');
    for (const key of s.programKeys) assert(catalog.programKeys.includes(key), 'Star shader missing from GPU catalog');
  }
}

export function assertColdFishingResources(snapshot) {
  assertResourceCatalog(snapshot);
  assert.equal(snapshot.counts.textures, 4, 'Cold scene requires three existing textures and one shared B crown map');
  assert.equal(snapshot.catalog.fishingVisible, false, 'Cold fishing group is visible');
  assert(snapshot.catalog.fishing.every(row => !row.initialized && row.programKeys.length === 0), 'Hidden fishing resources were uploaded before preparation');
  if (snapshot.catalog.surfaceEffects) assert.equal(snapshot.catalog.surfaceEffects.initialized, false, 'Cold surface uploaded early');
}

// The historical matched-night counters included four unused marker geometries
// and two marker shader variants uploaded by the old first BOAT render. Remove
// that identified initialization history, retaining the exact draw/texture cost.
export function expectedColdNightResources({ fogType, starInitialized = fogType === 'CLEAR' }) {
  assert(['CLEAR', 'FOG', 'DENSE_FOG'].includes(fogType), 'Expected an explicit night weather');
  const fog = fogType !== 'CLEAR', stars = fogType === 'CLEAR';
  // G-2.5: fixed 1100 trees, only the approved 250 * 216 triangle delta.
  return { calls: 31 + (fog ? 3 : 0) + Number(stars), triangles: 275444 + (fog ? 6144 : 0),
    geometries: 24 - FISHING_GEOMETRY_TYPES.length + (fog ? 1 : 0) + Number(starInitialized),
    // Shared B replaces the old untextured foliage program; it adds one map,
    // not a second material/program variant as the conifer-only preview did.
    textures: 4, programs: 12 - 2 + (fog ? 1 : 0) + Number(starInitialized) };
}

export function assertLureInitialization(before, after) {
  assertResourceCatalog(before); assertResourceCatalog(after);
  assert.deepEqual(after.catalog.cpuGeometryIds, before.catalog.cpuGeometryIds, 'Cast recreated scene geometry');
  const expectedIds = after.catalog.fishing.filter(row => LURE_GEOMETRY_TYPES.includes(row.type)).map(row => row.id);
  const surface = after.catalog.surfaceEffects;
  if (surface) {
    assert.equal(before.catalog.surfaceEffects?.id, surface.id, 'Cast recreated surface geometry');
    assert.equal(surface.initialized, true, 'Landing did not initialize surface geometry');
    expectedIds.push(surface.id);
  }
  const expectedNewIds = difference(expectedIds, before.catalog.initializedGeometryIds);
  assert.deepEqual(sorted(difference(after.catalog.initializedGeometryIds, before.catalog.initializedGeometryIds)), sorted(expectedNewIds), 'Cast uploaded geometry outside the existing lure/ring/line');
  assert.equal(after.counts.geometries, before.counts.geometries + expectedNewIds.length, 'Cast GPU allocation delta differs');
  assert(after.catalog.fishing.every(row => row.initialized === LURE_GEOMETRY_TYPES.includes(row.type)), 'LURE must upload ring/lure/line and leave the fish shadow cold');
  const programsFor = (type, count) => {
    const keys = after.catalog.fishing.find(row => row.type === type).programKeys;
    assert.equal(keys.length, count, `${type}: the first cast must retain its existing material shader variants`);
    assert.equal(new Set(keys).size, count, `${type}: duplicate material shader cache key`);
    return keys;
  };
  // Three renders the transparent DoubleSide ring in BackSide/FrontSide
  // passes. Both observed cache keys are already owned by the world markers.
  const ringKeys = programsFor('RingGeometry', 2), [lureKey] = programsFor('LureGeometry', 1), [lineKey] = programsFor('BufferGeometry', 1);
  assert.equal(new Set([...ringKeys, lureKey, lineKey]).size, 4, 'Marker materials lost their distinct shader identities');
  assert(ringKeys.every(key => before.catalog.programKeys.includes(key)), 'The existing ring shaders were not initialized by the world');
  assert(!before.catalog.programKeys.includes(lineKey), 'The hidden line shader was uploaded before the first cast');
  assert.deepEqual(after.catalog.fishing.find(row => row.type === 'CircleGeometry').programKeys, [], 'The hidden fish shadow shader was uploaded');
  // READY's rod/reel uses the lure's exact vertex-color shader. Reuse is
  // established by its actual cache identity, not an allocation-count ceiling.
  // The historical scene still initializes both the lure and line variants.
  const expectedNewKeys = [lineKey, ...(before.catalog.programKeys.includes(lureKey) ? [] : [lureKey])];
  if (surface) {
    const [surfaceKey] = surface.programKeys;
    assert(![...ringKeys, lureKey, lineKey].includes(surfaceKey), 'Surface lost its RGBA shader identity');
    if (!before.catalog.programKeys.includes(surfaceKey)) expectedNewKeys.push(surfaceKey);
  }
  assert.deepEqual(sorted(difference(after.catalog.programKeys, before.catalog.programKeys)), sorted(expectedNewKeys), 'Cast uploaded a shader outside the existing marker materials');
  assert.equal(after.counts.programs, before.counts.programs + expectedNewKeys.length, 'Cast GPU shader delta differs');
  assert.equal(after.counts.textures, before.counts.textures, 'Cast created a texture');
}

export function assertStableResourceIdentities(before, after) {
  assertResourceCatalog(before); assertResourceCatalog(after);
  for (const key of ['cpuGeometryIds', 'initializedGeometryIds', 'programKeys']) assert.deepEqual(after.catalog[key], before.catalog[key], `Repeated rendering changed ${key}`);
  for (const key of ['geometries', 'textures', 'programs']) assert.equal(after.counts[key], before.counts[key], `Repeated rendering changed ${key}`);
  if (before.catalog.stars) assert.deepEqual(after.catalog.stars, before.catalog.stars, 'Repeated rendering recreated stars');
}
