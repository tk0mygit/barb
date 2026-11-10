import assert from 'node:assert/strict';
import layouts from './mobile-hud-a-layouts.json' with { type: 'json' };

// One reviewed transition. Pin the entire runtime tree and root build inputs,
// not merely a CSS filename/model or the branch name. Later product changes
// receive no allowance, even if they reuse these capture IDs.
export const HUD_A_BASE = '05dd8fcb45726cbbfe439d43c89f295f5affac93';
export const HUD_A_SOURCES = Object.freeze({
  before: Object.freeze({ sourceTree: '2ff6ac86a5649300509daa0f94590a135297b544',
    hudBlob: 'a486537a1f595ada6061ea52b688cbdeebde7163', indexBlob: 'fe457d5bb2210eb5fbe85e8f63e62054e3d3f959' }),
  after: Object.freeze({ sourceTree: '9dc87e7865871c341711ae141ae02ae3ca05f3f9',
    hudBlob: '23b6ed193819de92948843d964999cfdaad20743', indexBlob: '82d9bc6eac6411c4c4494a9a4586cc8c09e2c0b9' }),
  build: Object.freeze({ lockBlob: '47245ebaa299d7e7521020579099984095cc556d',
    viteBlob: 'b0d324b56a47ba5b7ff1b0580db1f6a9f2d3fcb3' }),
});
export const HUD_A_IDS = Object.freeze(['portrait', 'landscape', 'small', 'pc'].flatMap(p => [`${p}-bite`, `${p}-fight`]).concat('rotated-fight'));
const fieldsFor = id => id.endsWith('bite')
  ? ['panel', 'occupancy', ...(/^(portrait|small)-/.test(id) ? ['buttons'] : [])]
  : ['panel', 'occupancy', 'meter', 'buttons', ...(['landscape-fight', 'rotated-fight'].includes(id) ? ['header'] : [])];
const matches = (source, identity) => Object.entries(identity).every(([key, value]) => source[key] === value);
const identity = source => Object.fromEntries(Object.keys(HUD_A_SOURCES.before).map(key => [key, source[key]]));

export function readHudATransition(main, pr) {
  if (main.sha !== HUD_A_BASE || !matches(main, HUD_A_SOURCES.before) || !matches(pr, HUD_A_SOURCES.after)
    || !matches(main, HUD_A_SOURCES.build) || !matches(pr, HUD_A_SOURCES.build)) return null;
  return { kind: 'ux-b3-hud-a', baseSha: main.sha, validationSha: pr.sha,
    before: identity(main), after: identity(pr), captureIds: [...HUD_A_IDS] };
}

export function checkHudAProof(proof, metadata) {
  assert.equal(metadata.mode, 'regression', 'HUD A: regression mode required');
  assert.equal(metadata.baseSha, HUD_A_BASE, 'HUD A: base differs');
  assert.equal(metadata.implementations.main.sha, metadata.baseSha, 'HUD A: main SHA differs');
  assert.equal(metadata.implementations.pr.sha, metadata.validationSha, 'HUD A: validation SHA differs');
  const expected = readHudATransition(metadata.implementations.main, metadata.implementations.pr);
  assert(expected, 'HUD A: unapproved runtime/build source');
  assert.deepEqual(proof, expected, 'HUD A: forged proof');
}

// This table is a reviewed geometry contract, not an expectation supplied by
// a capture. Both sides must match exactly. It includes only fields which
// actually changed, per ID; every other field retains the ordinary equality.
export function checkHudAField(id, key, before, after, viewport) {
  if (!HUD_A_IDS.includes(id)) return false;
  assert.equal(layouts.version, 1, 'HUD A: unknown geometry contract');
  assert.deepEqual(Object.keys(layouts.pairs).sort(), [...HUD_A_IDS].sort(), 'HUD A: incomplete ID contract');
  const contract = layouts.pairs[id];
  assert.deepEqual(viewport, contract.viewport, `${id}: HUD A viewport differs`);
  assert.deepEqual(Object.keys(contract.before), fieldsFor(id), `${id}: HUD A unsupported field`);
  assert.deepEqual(Object.keys(contract.before), Object.keys(contract.after), `${id}: HUD A field contract differs`);
  if (!Object.hasOwn(contract.before, key)) return false;
  assert.deepEqual(before, contract.before[key], `${id}: HUD A base ${key} differs`);
  assert.deepEqual(after, contract.after[key], `${id}: HUD A approved ${key} differs`);
  return true;
}
