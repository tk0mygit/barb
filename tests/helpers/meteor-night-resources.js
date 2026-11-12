import assert from 'node:assert/strict';
import { assertResourceCatalog } from '../browser/lighting-resource-contract.js';

const sorted = values => [...values].sort((a, b) => typeof a === 'number' ? a - b : a.localeCompare(b));
const ownership = aurora => ({ id: aurora.id,
  layers: aurora.layers.map(({ geometryId, materialId }) => ({ geometryId, materialId })) });
const identity = row => {
  if (!row) return row;
  const { visible, ...fields } = row; return fields;
};

// A late first Aurora draw can warm its one shared geometry/program after
// history[5]. Bind that exact delta to owned IDs, retaining the whole plateau
// for every other resource. previous also anchors buffers after the first use.
export function assertMeteorNightResources(previous, current, baseline) {
  for (const snapshot of [previous, current, ...(baseline ? [baseline] : [])]) assertResourceCatalog(snapshot);
  const before = previous.catalog.aurora, after = current.catalog.aurora;
  assert(before && after, 'Missing Aurora lifetime evidence');
  assert.deepEqual(current.catalog.cpuGeometryIds, previous.catalog.cpuGeometryIds, 'Night cycle recreated scene geometry');
  assert.deepEqual(ownership(after), ownership(before), 'Night cycle changed Aurora geometry/material ownership');
  assert(Number(after.initialized) >= Number(before.initialized), 'Aurora GPU initialization went backwards');
  for (const aurora of [before, after]) {
    assert.deepEqual(sorted(new Set(aurora.layers.flatMap(layer => layer.programKeys))), aurora.programKeys,
      'Aurora shader key is not owned by its two materials');
    if (aurora.initialized) for (const buffer of Object.values(aurora.buffers))
      assert(Number.isSafeInteger(buffer.id) && buffer.id > 0, 'Invalid Aurora GPU buffer identity');
  }
  if (before.initialized) {
    assert.deepEqual(after.programKeys, before.programKeys, 'Aurora shader identity changed after upload');
    assert.deepEqual(after.buffers, before.buffers, 'Aurora buffer identity/upload changed after first draw');
  }
  before.layers.forEach((layer, i) => {
    if (layer.programKeys.length) assert.deepEqual(after.layers[i].programKeys, layer.programKeys, 'Aurora material lost its cached shader');
  });
  if (!baseline) return;

  const original = baseline.catalog.aurora;
  assert(original, 'Missing baseline Aurora ownership');
  assert.deepEqual(ownership(after), ownership(original), 'Aurora differs from plateau ownership');
  const delta = Number(after.initialized) - Number(original.initialized);
  assert(delta === 0 || delta === 1, 'Aurora plateau initialization went backwards');
  assert.deepEqual(current.catalog.cpuGeometryIds, baseline.catalog.cpuGeometryIds, 'Plateau CPU geometry identities changed');
  assert.deepEqual(current.catalog.initializedGeometryIds,
    sorted([...baseline.catalog.initializedGeometryIds, ...(delta ? [after.id] : [])]), 'GPU geometry increase is not exactly the owned Aurora ID');
  assert.deepEqual(current.catalog.programKeys,
    sorted([...baseline.catalog.programKeys, ...(delta ? after.programKeys : [])]), 'GPU program increase is not exactly the shared Aurora shader key');
  for (const key of ['geometries', 'programs'])
    assert.equal(current.counts[key], baseline.counts[key] + delta, `Unexpected ${key} outside the Aurora first upload`);
  assert.equal(current.counts.textures, baseline.counts.textures, 'Night cycle added a texture');
  for (const key of ['stars', 'meteor']) assert.deepEqual(identity(current.catalog[key]), identity(baseline.catalog[key]), `Night cycle changed ${key} resources`);
  for (const key of ['fishingVisible', 'fishing', 'surfaceEffects'])
    assert.deepEqual(current.catalog[key], baseline.catalog[key], `Night cycle changed hidden ${key} resources`);
}
