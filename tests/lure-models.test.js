import test from 'node:test';
import assert from 'node:assert/strict';
import { createLureModel, LURE_ENVELOPE, LURE_FOOTPRINT_ENVELOPES } from '../src/rendering/lure-models.js';
import { LURES } from '../src/game/lures.js';
const triangleBudgets = { minnow: 80, crankbait: 84, worm: 192, spinnerbait: 304 };

test('four distinct low-poly silhouettes share one mesh/material and stay in the declared rotating envelope', () => {
  const { mesh, select } = createLureModel(), material = mesh.material;
  const geometries = new Map();
  for (const { id } of LURES) {
    select(id);
    assert.equal(mesh.userData.lureId, id);
    assert.equal(mesh.material, material);
    assert.equal(mesh.children.length, 0, 'each complete lure takes one draw');
    const geometry = mesh.geometry, positions = geometry.attributes.position;
    assert.equal(geometry.type, 'LureGeometry');
    assert.equal(positions.count / 3, triangleBudgets[id], `${id}: exact triangle budget (default retains the old sphere's 80)`);
    assert.equal(geometry.groups.length, 0, 'no material groups / extra draws');
    assert.equal(geometry.attributes.color.count, positions.count);
    for (let i = 0; i < positions.count; i++) {
      assert.ok(Math.hypot(positions.getX(i), positions.getZ(i)) <= LURE_ENVELOPE.radius);
      assert.ok(positions.getY(i) >= LURE_ENVELOPE.minY && positions.getY(i) <= LURE_ENVELOPE.maxY);
      assert.ok(LURE_FOOTPRINT_ENVELOPES.some(e => Math.hypot(positions.getX(i), positions.getZ(i)) <= e.radius
        && positions.getY(i) >= e.minY && positions.getY(i) <= e.maxY), `${id}: missing footprint vertex`);
    }
    geometries.set(id, geometry);
  }
  assert.equal(new Set(geometries.values()).size, 4);
  assert.equal(new Set([...geometries.values()].map(g => JSON.stringify([...g.attributes.position.array]))).size, 4);
  for (let i = 0; i < 20; i++) for (const { id } of LURES) {
    select(id); assert.equal(mesh.geometry, geometries.get(id)); assert.equal(mesh.material, material);
  }
  assert.throws(() => select('unknown'), /Unknown lure/);
});
