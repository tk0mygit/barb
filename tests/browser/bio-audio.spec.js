import { test, expect } from './diagnostics-fixture.js';
import { setup, tick } from './day-night-fixture.js';
import { installAudioProbe, audioSnapshot, attachAudioDiagnostics, soundScreen } from './audio-fixture.js';
import { createBioCyclePlan } from '../../src/audio/bio-schedule.js';
import { BIO_FADE_SECONDS } from '../../src/audio/bio-player.js';
import { writeFileSync } from 'node:fs';

const prefs = { version: 1, enabled: true, volume: 40 };
async function enable(page, seconds = 0, touch = false) {
  await page.addInitScript(value => localStorage.setItem('barb.audio.preferences.v1', JSON.stringify(value)), prefs);
  await page.addInitScript(installAudioProbe, {});
  await setup(page, seconds);
  expect((await audioSnapshot(page)).contexts).toBe(0);
  if (touch) await page.locator('#fish-button').tap(); else await page.locator('#fish-button').click();
  await tick(page);
}
const elapsed = page => page.evaluate(() => window.lightingProbe.last.mistTime);
async function advanceTo(page, seconds) {
  const delta = seconds - await elapsed(page);
  if (delta > 0) await page.clock.fastForward(delta * 1000);
}
async function callAt(page, event, expectedContexts = 1) {
  await advanceTo(page, event.scheduledSeconds - .1);
  await expect.poll(async () => new Set((await audioSnapshot(page)).decoded
    .filter(v => v.id.startsWith(event.timeOfDay === 'day' ? 'bird-' : 'suzumushi-')).map(v => v.id)).size).toBe(3);
  const before = (await audioSnapshot(page)).totalBioSources;
  await tick(page);
  await expect.poll(async () => (await audioSnapshot(page)).totalBioSources).toBe(before + 1);
  const actual = await audioSnapshot(page);
  expect(actual.sources).toBe(3); expect(actual.startedSources).toBe(3); expect(actual.gainNodes).toBe(4);
  expect(actual.bioSources).toBe(1); expect(actual.bioIds).toEqual([event.sourceId]);
  const cricket = event.sourceId.startsWith('suzumushi-');
  expect(actual.bioGainNodes).toBe(cricket ? 2 : 1); expect(actual.bioEnvelopeNodes).toBe(cricket ? 1 : 0);
  expect(actual.totalGainNodes).toBe(cricket ? 6 : 5); expect(actual.liveNodes).toBe(cricket ? 10 : 9);
  expect(actual.bioDestinationConnected).toBe(true);
  if (cricket) {
    const [attack, release] = actual.bioEnvelopes[0];
    expect(actual.bioEnvelopes[0]).toHaveLength(2);
    expect(attack.duration).toBe(.5); expect(release.duration).toBe(.75);
    expect(release.time - attack.time).toBeCloseTo(event.durationSeconds - .75, 8);
    expect(attack.values[0]).toBe(0); expect(attack.values.at(-1)).toBe(1);
    expect(release.values[0]).toBe(1); expect(release.values.at(-1)).toBe(0);
  } else expect(actual.bioEnvelopes).toEqual([null]);
  expect(actual.contexts).toBe(expectedContexts);
  const now = await elapsed(page);
  expect(now).toBeGreaterThanOrEqual(event.scheduledSeconds); expect(now).toBeLessThanOrEqual(event.latestStartSeconds);
  return actual;
}

for (const viewport of [{ width: 1000, height: 700, touch: false }, { width: 390, height: 844, touch: true }, { width: 844, height: 390, touch: true }]) {
  test(`integrated bird/cricket one-shots and unchanged three loops at ${viewport.width}x${viewport.height}`, async ({ createContext }, info) => {
    const context = await createContext({ viewport, isMobile: viewport.touch, hasTouch: viewport.touch, deviceScaleFactor: .5 });
    const page = await context.newPage(), requests = [];
    page.on('request', request => { if (request.url().endsWith('.wav')) requests.push(request.url()); });
    try {
      await enable(page, 0, viewport.touch);
      await expect.poll(async () => (await audioSnapshot(page)).decoded.length).toBe(3);
      const plan = createBioCyclePlan(0), used = new Set(), observations = [];
      for (const event of plan.events) {
        if (used.has(event.sourceId)) continue;
        used.add(event.sourceId);
        const actual = await callAt(page, event); observations.push({ event, actualSeconds: await elapsed(page), gain: actual.bioGains[0] });
        expect(actual.bioGains[0]).toBeCloseTo(.0432, 8);
        await page.clock.fastForward((event.durationSeconds + .3) * 1000);
        // This deliberate long frame can request a stop fade before a fake
        // source's timer fires. Advance its defined audio teardown interval.
        await page.clock.fastForward((BIO_FADE_SECONDS + 1 / 60) * 1000);
        const ended = await audioSnapshot(page);
        expect(ended.bioSources).toBe(0); expect(ended.totalGainNodes).toBe(4); expect(ended.liveNodes).toBe(7);
      }
      expect([...used].sort()).toEqual(['bird-a', 'bird-b', 'bird-c', 'suzumushi-a', 'suzumushi-b', 'suzumushi-c']);
      // Six bio assets plus the independently prefetched notification WAV.
      expect(requests.filter(url => /\/waterdrop[^/]*\.wav$/.test(url))).toHaveLength(1);
      expect(requests).toHaveLength(7); expect(new Set(requests).size).toBe(7);
      await soundScreen(page, viewport.touch); await tick(page);
      expect((await audioSnapshot(page)).sources).toBe(0);
      if (viewport.touch) await page.locator('#collection-close').tap(); else await page.locator('#collection-close').click();
      await tick(page);
      expect((await audioSnapshot(page)).sources).toBe(3); expect((await audioSnapshot(page)).decoded).toHaveLength(6);
      expect(requests).toHaveLength(7);
      expect(await page.evaluate(() => window.audioProbe.nodes.filter(n => n.type === 'source' && n.loop === false)
        .every(n => n.disconnected && n.buffer === null && n.onended === null))).toBe(true);
      const path = info.outputPath('integrated-bio-calls.json'); writeFileSync(path, JSON.stringify({ observations, requests }, null, 2));
      await info.attach('integrated-bio-calls', { path, contentType: 'application/json' });
    } finally { await attachAudioDiagnostics(page, info); }
  });
}

test('stopping during first decode discards the old call; OFF clears the bank and a new enable fetches cleanly', async ({ page }, info) => {
  try {
    await page.addInitScript(value => localStorage.setItem('barb.audio.preferences.v1', JSON.stringify(value)), prefs);
    await page.addInitScript(installAudioProbe, {});
    await page.addInitScript(() => { window.audioProbe.holdDecode = true; });
    await setup(page, 0); await page.locator('#fish-button').click(); await tick(page);
    // Three bio decoders and the independent notification decoder are pending.
    await expect.poll(() => page.evaluate(() => window.audioProbe.decodeWaiters.length)).toBe(4);
    const first = createBioCyclePlan(0).events[0];
    await advanceTo(page, first.scheduledSeconds - .1); await tick(page);
    expect((await audioSnapshot(page)).bioSources).toBe(0);
    await soundScreen(page); await page.locator('#ambient-toggle').click(); await tick(page);
    await page.evaluate(() => { window.audioProbe.holdDecode = false; window.audioProbe.decodeWaiters.splice(0).forEach(done => done()); });
    expect((await audioSnapshot(page)).bioSources).toBe(0);
    await expect(page.locator('#ambient-status')).toContainText('OFF');
    await page.locator('#ambient-toggle').click();
    await expect.poll(async () => (await audioSnapshot(page)).decoded.length).toBe(6);
    await page.locator('#collection-close').click(); await tick(page);
    expect((await audioSnapshot(page)).bioSources).toBe(0);
    await callAt(page, createBioCyclePlan(0).events[1]);
  } finally { await attachAudioDiagnostics(page, info); }
});

for (const [cycle, factor] of [[0, 1], [1, .4], [7, 1]]) {
  test(`shared optical fog at cycle ${cycle}: cricket gain factor ${factor}`, async ({ page }, info) => {
    const event = createBioCyclePlan(cycle).events.find(e => e.timeOfDay === 'night' && e.scheduledSeconds > cycle * 360 + 200);
    try {
      await enable(page, event.scheduledSeconds - 1);
      const actual = await callAt(page, event);
      expect(actual.bioGains[0]).toBeCloseTo(.0432 * factor, 8);
      const dense = await page.evaluate(() => window.lightingProbe.denseFade);
      expect(dense).toBe(factor === 1 ? 0 : 1);
      expect(actual.master).toBeCloseTo(.12, 8);
    } finally { await attachAudioDiagnostics(page, info); }
  });
}

test('active one-shot obeys menu/blur/hidden/page/mute/OFF/context/WebGL stops and never resumes the old event', async ({ page }, info) => {
  try {
    await enable(page); const events = createBioCyclePlan(0).events;
    let index = 0;
    for (const reason of ['menu', 'blur', 'hidden', 'page', 'mute', 'off', 'suspended', 'interrupted', 'closed', 'webgl']) {
      const current = await callAt(page, events[index++]);
      const started = current.totalBioSources, decoded = current.decoded.length;
      if (['menu', 'mute', 'off'].includes(reason)) {
        await soundScreen(page);
        if (reason === 'mute') { await page.locator('#ambient-volume').focus(); await page.keyboard.press('Home'); }
        if (reason === 'off') await page.locator('#ambient-toggle').click();
        await tick(page);
        expect((await audioSnapshot(page)).bioSources).toBe(0);
        if (reason === 'mute') await page.keyboard.press('End');
        if (reason === 'off') await page.locator('#ambient-toggle').click();
        await page.locator('#collection-close').click(); await tick(page);
        if (reason === 'off') await expect.poll(async () => (await audioSnapshot(page)).decoded.length).toBe(decoded + 3);
      } else {
        await page.evaluate(reason => {
          if (reason === 'blur') window.dispatchEvent(new Event('blur'));
          if (reason === 'hidden') {
            Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
            document.dispatchEvent(new Event('visibilitychange'));
          }
          if (reason === 'page') window.dispatchEvent(new Event('pagehide'));
          if (['suspended', 'interrupted', 'closed'].includes(reason)) window.audioProbe.contexts.at(-1).change(reason);
          if (reason === 'webgl') document.querySelector('#scene').dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
        }, reason);
        await tick(page); expect((await audioSnapshot(page)).bioSources).toBe(0);
        if (reason === 'webgl') {
          expect((await audioSnapshot(page)).sources).toBe(0);
          expect((await audioSnapshot(page)).states).toEqual(['closed']); break;
        }
        const resumes = (await audioSnapshot(page)).resumes;
        await page.evaluate(reason => {
          if (reason === 'hidden') {
            Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
            document.dispatchEvent(new Event('visibilitychange'));
          }
          if (reason === 'page') window.dispatchEvent(new Event('pageshow'));
          window.dispatchEvent(new Event('focus'));
        }, reason);
        await tick(page); expect((await audioSnapshot(page)).resumes).toBe(resumes);
        if (['suspended', 'interrupted', 'closed'].includes(reason)) {
          await soundScreen(page); await page.locator('#collection-close').click(); await tick(page);
          if (reason === 'closed') {
            expect((await audioSnapshot(page)).contexts).toBe(2);
            await expect.poll(async () => (await audioSnapshot(page)).decoded.length).toBe(decoded + 3);
            // New context is tested; stop this page before testing another event
            // with callAt's original single-context expectation.
            const next = events[index++]; await callAt(page, next, 2);
            await page.evaluate(() => document.querySelector('#scene').dispatchEvent(new Event('webglcontextlost', { cancelable: true })));
            await tick(page); expect((await audioSnapshot(page)).bioSources).toBe(0);
            expect((await audioSnapshot(page)).sources).toBe(0); break;
          }
        }
      }
      const resumed = await audioSnapshot(page);
      expect(resumed.bioSources).toBe(0); expect(resumed.totalBioSources).toBe(started);
      expect(resumed.sources).toBe(3);
      if (reason === 'menu') expect(resumed.decoded.length).toBe(decoded);
    }
  } finally { await attachAudioDiagnostics(page, info); }
});

for (const mode of ['http', 'decode']) {
  test(`${mode} bio failures preserve BGM and retry after game-time backoff`, async ({ page }, info) => {
    let failing = true, count = 0;
    if (mode === 'http') await page.route('**/*.wav', route => {
      if (/\/waterdrop[^/]*\.wav$/.test(route.request().url())) return route.continue();
      count++; return failing ? route.fulfill({ status: 503, body: 'intentional' }) : route.continue();
    });
    try {
      await enable(page);
      if (mode === 'decode') {
        // OFF/ON establishes a fresh bank before injecting this failure.
        await soundScreen(page); await page.locator('#ambient-toggle').click();
        await page.evaluate(() => { window.audioProbe.failDecode = true; });
        await page.locator('#ambient-toggle').click(); await page.locator('#collection-close').click(); await tick(page);
      }
      await expect.poll(async () => (await audioSnapshot(page)).sources).toBe(3);
      if (mode === 'http') await expect.poll(() => count).toBe(3);
      const before = await audioSnapshot(page);
      await page.clock.fastForward(10000);
      expect((await audioSnapshot(page)).sources).toBe(3);
      if (mode === 'http') expect(count).toBe(3);
      const continuing = await audioSnapshot(page);
      expect(continuing.states).toEqual(['running']); expect(continuing.master).toBeCloseTo(.12, 8);
      failing = false; await page.evaluate(() => { window.audioProbe.failDecode = false; });
      await advanceTo(page, 15.5); await tick(page);
      await expect.poll(async () => (await audioSnapshot(page)).decoded.length).toBeGreaterThanOrEqual(before.decoded.length + 3);
      await callAt(page, createBioCyclePlan(0).events[1]);
      expect((await audioSnapshot(page)).contexts).toBe(1);
    } finally { await attachAudioDiagnostics(page, info); }
  });
}
