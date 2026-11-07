import { expect, test } from './diagnostics-fixture.js';
import { encounterModel, getRodEncounterModifiers } from '../../src/game/encounter-production.js';
import { getFishSpecies, calculateFishWeightKg } from '../../src/game/fish-species.js';
import { calculateSalePrice } from '../../src/game/fish-sales.js';

// Recompute the interval by stable ID: adding species must not select a
// different fish or couple its length to a new probability denominator.
export function createEncounterPlan({ speciesId, lengthRoll, rodLevel, lureId, conditions }) {
  const species = getFishSpecies(speciesId);
  if (!species || !Number.isFinite(lengthRoll) || lengthRoll < 0 || lengthRoll >= 1
    || !Number.isFinite(conditions.depthM) || conditions.depthM < 0
    || !['day', 'night'].includes(conditions.timeOfDay)) throw new TypeError('Invalid encounter fixture');
  const entries = encounterModel.getProbabilities(lureId, conditions, getRodEncounterModifiers(rodLevel));
  let start = 0;
  for (const entry of entries) {
    if (entry.speciesId === speciesId) {
      const end = start + entry.probability, speciesRoll = start + entry.probability / 2;
      const lengthCm = Math.round((species.minLengthCm + lengthRoll * (species.maxLengthCm - species.minLengthCm)) * 10) / 10;
      const weightKg = calculateFishWeightKg(speciesId, lengthCm);
      return { speciesId, name: species.name, rodLevel, lureId, conditions, start, end, speciesRoll, lengthRoll,
        lengthCm, weightKg, basePrice: calculateSalePrice({ speciesId, weightKg, qteSuccessCount: 0 }) };
    }
    start += entry.probability;
  }
  throw new RangeError(`Missing encounter fixture species: ${speciesId}`);
}

export async function armEncounter(page, { speciesId, lengthRoll, rodLevel }) {
  const evidence = await readFishingEvidence(page);
  expect(evidence.phase).toBe('lure');
  expect(evidence.conditions.depthM).not.toBe('');
  const conditions = { depthM: Number(evidence.conditions.depthM), timeOfDay: evidence.conditions.timeOfDay };
  const plan = createEncounterPlan({ speciesId, lengthRoll, rodLevel, lureId: evidence.lureId, conditions });
  // Bite budget was already sampled at CAST -> LURE. Only the next species
  // and length draws are queued. Preserve the old subsequent RNG fallback.
  await page.evaluate(({ speciesRoll, lengthRoll }) => {
    window.testRandomDraws = [speciesRoll, lengthRoll]; window.testRandomValue = lengthRoll;
  }, plan);
  return plan;
}

export async function verifyEncounterBite(page, plan) {
  const evidence = await readFishingEvidence(page);
  expect(evidence.phase).toBe('bite');
  expect(evidence.lureId).toBe(plan.lureId);
  expect(Number(evidence.conditions.depthM)).toBe(plan.conditions.depthM);
  expect(evidence.conditions.timeOfDay).toBe(plan.conditions.timeOfDay);
  expect(await page.evaluate(() => window.testRandomDraws)).toEqual([]);
  await test.info().attach('production-encounter-plan', {
    body: JSON.stringify({ plan, evidence }), contentType: 'application/json',
  });
}

// Read public UI only. No game reference, state mutation or production hook.
export function readFishingEvidence(page) {
  return page.evaluate(() => {
    const text = id => document.getElementById(id)?.textContent ?? '';
    const conditions = document.querySelector('#fishing-conditions');
    const qte = document.querySelector('.qte-hud');
    return {
      phase: document.querySelector('#fishing-panel')?.dataset.phase,
      lureId: document.querySelector('[data-lure-id][aria-pressed="true"]')?.dataset.lureId,
      conditions: { depthM: conditions?.dataset.depthM, timeOfDay: conditions?.dataset.timeOfDay,
        cycleProgress: conditions?.dataset.cycleProgress },
      tension: document.querySelector('#line-tension')?.value,
      distance: text('line-distance'),
      pointerCaptured: document.querySelector('#scene')?.hasPointerCapture(1),
      qte: { state: qte?.dataset.state, visible: Boolean(qte && !qte.hidden && qte.getBoundingClientRect().width) },
      catch: { open: document.querySelector('#catch-dialog')?.open, species: text('catch-species'),
        length: text('catch-length'), weight: text('catch-weight'), bonus: text('catch-qte-bonus'), price: text('catch-sale-price') },
    };
  });
}
