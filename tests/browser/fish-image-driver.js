// Real domain operations only, shared by the image regressions and local
// measurement harness. Neither phases nor catch/encounter records are assigned.
export async function biteFish(page, speciesId = 'black-bass') {
  return page.evaluate(async speciesId => {
    const { getSpeciesProbabilities } = await import('/barb/src/game/fish-encounters.js');
    const fishing = fixture.fishing;
    const update = () => fixture.fishingHUD.update(fishing, true, { timeOfDay: 'day', cycleProgress: 0 });
    update();
    window.imageRoll = 0;
    fishing.prepare({ x: 0, z: 30 }, 0); fishing.aim(0, 180); fishing.cast();
    for (let i = 0; i < 120 && fishing.state.phase === 'cast'; i++) fishing.step(1 / 60);
    const entries = getSpeciesProbabilities(fishing.state.lureId, fishing.getConditions());
    const index = entries.findIndex(entry => entry.speciesId === speciesId);
    window.imageRoll = entries.slice(0, index).reduce((sum, item) => sum + item.probability, 0) + entries[index].probability / 2;
    for (let i = 0; i < 1000 && fishing.state.phase === 'lure'; i++) fishing.step(1 / 60);
    const at = performance.now(); update();
    return { phase: fishing.state.phase, speciesId: fishing.state.encounter?.speciesId, at };
  }, speciesId);
}

export async function landFish(page) {
  return page.evaluate(() => {
    const fishing = fixture.fishing;
    fishing.hook();
    for (let i = 0; i < 1800 && fishing.state.phase === 'fight'; i++) {
      fishing.reel(fishing.state.tension < 0.65); fishing.step(1 / 60);
    }
    fishing.step(2);
    const at = performance.now();
    fixture.fishingHUD.update(fishing, true, { timeOfDay: 'day', cycleProgress: 0 });
    return { phase: fishing.state.phase, catchId: fishing.state.catch?.id, speciesId: fishing.state.catch?.speciesId, at };
  });
}

export async function updateFishHUD(page, active = true) {
  await page.evaluate(active => fixture.fishingHUD.update(fixture.fishing, active, { timeOfDay: 'day', cycleProgress: 0 }), active);
}
