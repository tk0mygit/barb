// Each factory belongs to one serial suite. Only browser-produced storageState
// crosses a test boundary; pages, contexts, listeners and traces remain owned by
// Playwright's ordinary test fixtures, including the diagnostics base fixture.
export function createStorageCheckpointTest(base) {
  let checkpoint;
  return base.extend({
    storageState: async ({}, use) => {
      await use(checkpoint === undefined ? undefined : structuredClone(checkpoint));
    },
    storageCheckpoint: async ({ context }, use) => {
      await use(Object.freeze({
        previous: checkpoint === undefined ? undefined : structuredClone(checkpoint),
        async capture() {
          checkpoint = await context.storageState();
        },
      }));
    },
  });
}
