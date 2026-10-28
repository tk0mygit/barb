import { readFileSync } from 'node:fs';
import { validateSaveData } from '../../src/game/save-data.js';

// Captured from this old main's createSaveData(), not from the PR serializer.
// Both comparison targets receive the same neutral Lv.1 / empty-history v1.
export const LIGHTING_SAVE_BASE_SHA = 'ae8c44678aea374b03755b182e722406e542e53a';
const original = JSON.parse(readFileSync(new URL('../fixtures/saves/lighting-save-v1.json', import.meta.url), 'utf8'));

export function createLightingSave(elapsedSeconds) {
  return validateSaveData({ ...original, clock: { elapsedSeconds } });
}
