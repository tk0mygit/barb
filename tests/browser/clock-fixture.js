// Keep wall time fixed during the CDP round trip to pauseAt: no assumed
// one-second protocol deadline. Install before loading modules that bind clocks.
export async function installPausedClock(page, time = new Date('2026-01-01T00:00:00Z')) {
  await page.clock.install({ time });
  await page.clock.setFixedTime(time);
  await page.clock.pauseAt(time);
  await page.clock.setSystemTime(time);
}
