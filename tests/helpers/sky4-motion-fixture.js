import { execFileSync } from 'node:child_process';
import { SKY4_MOTION_BASE } from '../../scripts/lib/sky4-motion-source.js';
import { SKY4_MOTION_BLOBS } from '../../scripts/lib/sky4-motion-pins.js';
import { readMobileImplementation, mobileSourceMetadata } from '../../scripts/lib/mobile-comparison-source.js';
import { MOBILE_CAPTURE_IDS, compareMobileCapturesWithSources } from '../../scripts/compare-mobile-performance.mjs';
import { auroraCapture } from './sky4-fixture.js';
const git = (args, input) => execFileSync('git', args, { input, encoding: 'utf8' }).trim();
function replace(tree, parts, blob) {
  const entries = git(['ls-tree', '-z', tree]).split('\0').filter(Boolean), i = entries.findIndex(row => row.split('\t')[1] === parts[0]);
  const next = parts.length === 1 ? blob : replace(entries[i].split(/\s+/)[2], parts.slice(1), blob);
  const row = `${parts.length === 1 ? '100644 blob' : '040000 tree'} ${next}\t${parts[0]}`;
  if (i < 0) entries.push(row); else entries[i] = row;
  return git(['mktree', '-z'], entries.join('\0') + '\0');
}
export function motionFixtureCommit(changes = {}, parent = SKY4_MOTION_BASE, extraParent) {
  let tree = git(['rev-parse', `${SKY4_MOTION_BASE}^{tree}`]);
  for (const [path, blob] of Object.entries({ ...SKY4_MOTION_BLOBS,
    'scripts/lib/sky4-motion-pins.js': git(['hash-object', '-w', 'scripts/lib/sky4-motion-pins.js']) })) tree = replace(tree, path.split('/'), blob);
  for (const [path, source] of Object.entries(changes)) tree = replace(tree, path.split('/'), git(['hash-object', '-w', '--stdin'], source));
  return git(['-c', 'user.name=Motion unit fixture', '-c', 'user.email=unit@example.invalid', 'commit-tree', tree,
    '-p', parent, ...(extraParent ? ['-p', extraParent] : [])], 'Synthetic motion source contract fixture\n');
}
let fixture;
export async function motionGateFixture() {
  if (!fixture) fixture = (async () => {
    const main = await readMobileImplementation(SKY4_MOTION_BASE), pr = await readMobileImplementation(motionFixtureCommit());
    const metadata = { mode: 'regression', baseSha: main.sha, headSha: pr.sha, validationSha: pr.sha,
      implementations: { main: mobileSourceMetadata(main), pr: mobileSourceMetadata(pr) } };
    const before = [], after = [];
    for (const id of MOBILE_CAPTURE_IDS) { before.push(await auroraCapture(main, id)); after.push(await auroraCapture(pr, id)); }
    const comparison = { metadata, rows: await compareMobileCapturesWithSources(before, after, metadata) };
    const names = ['comparison-metadata.json', 'main.json', 'pr.json', 'comparison.html', 'comparison.json',
      ...['main', 'pr'].flatMap(target => MOBILE_CAPTURE_IDS.flatMap(id => [`${target}-${id}.png`, `${target}-${id}.json`]))];
    return { metadata, before, after, comparison, files: Object.fromEntries(names.map(name => [`test-results/mobile-comparison/${name}`, 'synthetic-unit-manifest'])) };
  })();
  return structuredClone(await fixture);
}
