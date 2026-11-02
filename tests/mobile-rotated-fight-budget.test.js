import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { expect } from '@playwright/test';

test('the approved rotated-FIGHT Playwright assertion accepts 41 calls and rejects 42', async () => {
  const spec = await readFile(new URL('./browser/mobile-performance.spec.js', import.meta.url), 'utf8');
  // Exercise the actual matcher and its literal budget from the browser spec,
  // so a later accidental increase changes this boundary test too.
  const caps = [...spec.matchAll(/expect\(metrics\.resources\.calls\)\.toBeLessThanOrEqual\((\d+)\)/g)];
  assert.equal(caps.length, 1, 'Only the rotated-FIGHT cap is revised');
  const limit = Number(caps[0][1]);
  assert.equal(limit, 41, 'The PM approval grants no automatic future increase');
  assert.doesNotThrow(() => expect(41).toBeLessThanOrEqual(limit));
  assert.throws(() => expect(42).toBeLessThanOrEqual(limit));
  assert.equal((spec.match(/expect\(before\.(?:actualResources|resources)\.calls\)\.toBeLessThan\(40\)/g) ?? []).length, 2,
    'The other rendering caps remain unchanged');
});
