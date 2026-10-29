import { readFile } from 'node:fs/promises';
import { MOBILE_CAPTURE_IDS, compareMobileCapturesWithSources } from '../../scripts/compare-mobile-performance.mjs';
import { mobileGit, readMobileImplementation, mobileSourceMetadata } from '../../scripts/lib/mobile-comparison-source.js';

// Actual recorded frame/metric inputs, with repeated histories deduplicated.
// Metadata binds those fixed inputs to the source being tested; it is a unit
// fixture, not a claim that a new browser run or artifact download took place.
const rotated = JSON.parse(await readFile(new URL('../fixtures/mobile-pr48-rotated-fight.json', import.meta.url)));
const support = JSON.parse(await readFile(new URL('../fixtures/mobile-pr48-support-captures.json', import.meta.url)));

export async function mobileGateFixture() {
  const base = await readMobileImplementation(rotated.capturedProvenance.base);
  const head = await readMobileImplementation(await mobileGit('rev-parse', 'HEAD'));
  const metadata = { mode: 'regression', baseSha: base.sha, headSha: head.sha, validationSha: head.sha,
    implementations: { main: mobileSourceMetadata(base), pr: mobileSourceMetadata(head) } };
  function captures(target) {
    const entries = support.captures[target].map(record => {
      const { frameTemplate, frameAspect, ...entry } = structuredClone(record);
      entry.metrics.cameraFrames = support.frameTemplates[frameTemplate].map(frame => ({ ...structuredClone(frame), aspect: frameAspect }));
      return entry;
    });
    entries.push(structuredClone(rotated.captures[target]));
    return MOBILE_CAPTURE_IDS.map(id => {
      const entry = entries.find(entry => entry.id === id);
      entry.image = `/unit-fixture/${target}-${id}.png`;
      return entry;
    });
  }
  const before = captures('main'), after = captures('pr');
  // Real Git source replays produce the report; no cached verified map is
  // injected into the gate. Its subsequent validation must replay again.
  const comparison = { metadata, rows: await compareMobileCapturesWithSources(before, after, metadata) };
  const names = ['comparison-metadata.json', 'main.json', 'pr.json', 'comparison.html', 'comparison.json',
    ...['main', 'pr'].flatMap(target => MOBILE_CAPTURE_IDS.flatMap(id => [`${target}-${id}.png`, `${target}-${id}.json`]))];
  return { metadata, before, after, comparison,
    // Presence-only unit manifest. Actual byte hashes are exercised by the
    // readRecord/verifyArtifacts tests, not represented as downloaded evidence.
    files: Object.fromEntries(names.map(name => [`test-results/mobile-comparison/${name}`, 'unit-manifest-hash'])) };
}
