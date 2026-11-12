import test from 'node:test';
import assert from 'node:assert/strict';
import { assertMeteorNightResources } from './helpers/meteor-night-resources.js';

function cold() {
  return { counts: { geometries: 4, programs: 4, textures: 4 }, catalog: {
    cpuGeometryIds: [1, 2, 3, 4, 5, 6, 7, 8, 9], initializedGeometryIds: [1, 2, 7, 8],
    programKeys: ['meteor', 'stars', 'world-back', 'world-front'], fishingVisible: false,
    fishing: ['RingGeometry', 'LureGeometry', 'CircleGeometry', 'BufferGeometry'].map((type, i) =>
      ({ id: i + 3, type, initialized: false, programKeys: [] })),
    stars: { id: 7, name: 'clear-night-stars', vertices: 960, initialized: true, visible: true, programKeys: ['stars'] },
    meteor: { id: 8, materialId: 12, name: 'clear-night-meteor', vertices: 6, initialized: true, visible: false, programKeys: ['meteor'] },
    aurora: { id: 9, initialized: false, objects: 2,
      layers: [20, 21].map(materialId => ({ geometryId: 9, materialId, programKeys: [] })),
      programKeys: [], programInstances: 0, buffers: { position: null, uv: null, index: null } } } };
}
function warm(before = cold(), partial = false) {
  const result = structuredClone(before), a = result.catalog.aurora;
  result.counts.geometries++; result.counts.programs++;
  result.catalog.initializedGeometryIds.push(a.id); result.catalog.programKeys.unshift('aurora');
  Object.assign(a, { initialized: true, programKeys: ['aurora'], programInstances: 1,
    buffers: { position: { id: 98, bytes: 10692, uploads: 1 }, uv: { id: 99, bytes: 7128, uploads: 1 }, index: { id: 100, bytes: 9600, uploads: 1 } } });
  a.layers.forEach((layer, i) => { layer.programKeys = partial && i === 0 ? [] : ['aurora']; });
  return result;
}

test('meteor plateau accepts cold nights and only the exact first Aurora geometry/program upload without mutating evidence', () => {
  const baseline = cold(), first = warm(baseline), after = structuredClone(first);
  const bytes = JSON.stringify([baseline, first, after]);
  assertMeteorNightResources(baseline, structuredClone(baseline));
  assertMeteorNightResources(baseline, structuredClone(baseline), baseline);
  assertMeteorNightResources(baseline, first, baseline);
  assertMeteorNightResources(first, after, baseline);
  assert.equal(JSON.stringify([baseline, first, after]), bytes);
});

test('already warm baselines and a second layer joining the same shader add no GPU resources', () => {
  const baseline = warm(cold(), true), after = structuredClone(baseline);
  after.catalog.aurora.layers[0].programKeys = ['aurora']; after.catalog.stars.visible = false;
  assertMeteorNightResources(baseline, after, baseline);
  assertMeteorNightResources(after, structuredClone(after), baseline);
});

test('extra geometry/program/texture or foreign ownership cannot hide inside a numeric plus-one allowance', () => {
  const baseline = cold(), first = warm(baseline);
  for (const mutate of [
    s => { s.counts.geometries++; s.catalog.cpuGeometryIds.push(10); s.catalog.initializedGeometryIds.push(10); },
    s => { s.counts.programs++; s.catalog.programKeys.push('unrelated'); },
    s => { s.counts.textures++; },
    s => { s.catalog.aurora.id = 7; s.catalog.aurora.layers.forEach(layer => { layer.geometryId = 7; }); },
    s => { s.catalog.aurora.programKeys = ['meteor']; s.catalog.aurora.layers.forEach(layer => { layer.programKeys = ['meteor']; }); },
    s => { s.catalog.aurora.layers[1].materialId++; },
    s => { s.catalog.aurora.layers[1].geometryId++; },
    s => { s.catalog.initializedGeometryIds = [1, 2, 3, 7, 8]; s.catalog.fishing[0].initialized = true; },
  ]) {
    const bad = structuredClone(first); mutate(bad);
    assert.throws(() => assertMeteorNightResources(baseline, bad, baseline));
  }
});

test('warm cache rejects recreation, repeated upload, shader churn, lost initialization and hidden-resource changes', () => {
  const baseline = cold(), previous = warm(baseline);
  for (const mutate of [
    s => { s.catalog.aurora.buffers.position.id++; },
    s => { s.catalog.aurora.buffers.uv.uploads++; },
    s => { s.catalog.aurora.buffers.index.bytes++; },
    s => { s.catalog.aurora.buffers.index.id = s.catalog.aurora.buffers.position.id; },
    s => { s.catalog.aurora.buffers.position.id = '98'; },
    s => { s.catalog.aurora.programInstances++; },
    s => { s.catalog.aurora.layers[0].programKeys = []; },
    s => { s.catalog.aurora.layers.forEach(layer => { layer.programKeys = []; }); },
    s => { s.catalog.aurora.layers.forEach(layer => { layer.programKeys = ['new']; }); s.catalog.aurora.programKeys = ['new']; s.catalog.programKeys[0] = 'new'; s.catalog.programKeys.sort(); },
    s => { s.catalog.meteor.materialId++; },
    s => { s.catalog.fishingVisible = true; },
    s => { s.catalog.fishing[0].id++; },
  ]) {
    const bad = structuredClone(previous); mutate(bad);
    assert.throws(() => assertMeteorNightResources(previous, bad, baseline));
  }
  assert.throws(() => assertMeteorNightResources(previous, baseline, baseline), /backwards/);
});
