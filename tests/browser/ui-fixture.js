import { readFileSync } from 'node:fs';

// Exercise the production UI modules against the real document/domain APIs.
// Routes exist only in Playwright; the shipped game has no state-setting hooks.
export async function openUIFixture(page, saveData = null, { pngFishImage = false } = {}) {
  await page.route('**/barb/src/**', route => {
    const path = new URL(route.request().url()).pathname.replace('/barb/', '../../');
    const contentType = path.endsWith('.css') ? 'text/css' : path.endsWith('.svg') ? 'image/svg+xml' : path.endsWith('.png') ? 'image/png' : 'text/javascript';
    let body = readFileSync(new URL(path, import.meta.url));
    if (pngFishImage && path.endsWith('/game/fish-species.js')) body = body.toString('utf8')
      .replace("new URL('../assets/black-bass.svg', import.meta.url)", "new URL('../../fish-test.png', import.meta.url)");
    return route.fulfill({ body, contentType });
  });
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')
    .replace('<script type="module" src="/src/main.js"></script>', `
      <link rel="stylesheet" href="./src/ui/style.css">
      <script type="module">
        import { createCatchCollection } from './src/game/catch-collection.js';
        import { createFishing } from './src/game/fishing.js';
        import { createCollectionMenu } from './src/ui/collection-menu.js';
        import { createSalesHUD } from './src/ui/sales-hud.js';
        import { createAchievements } from './src/game/achievements.js';
        import { createAchievementNotice } from './src/ui/achievement-notice.js';
        import { restoreSaveData } from './src/game/save-data.js';
        import { createFishingHUD } from './src/ui/fishing-hud.js';
        const restored = ${saveData === null ? 'null' : `restoreSaveData(${JSON.stringify(saveData).replace(/</g, '\\u003c')})`};
        const collection = restored?.collection ?? createCatchCollection();
        const fishing = restored?.fishing ?? createFishing({ collection });
        const salesHUD = createSalesHUD(collection);
        const achievements = restored?.achievements ?? createAchievements({ collection });
        const achievementNotice = createAchievementNotice();
        achievements.subscribe(awards => achievementNotice.notify(awards));
        const fixture = window.fixture = { collection, fishing, salesHUD, achievements, achievementNotice, restored, allowed: true };
        fixture.fishingHUD = createFishingHUD({ onPrepare: () => {}, onCancel: () => {},
          onClose: () => fishing.closeResult(), onSell: () => fishing.sellResult(), onSelectLure: id => fishing.selectLure(id) });
        fixture.menu = createCollectionMenu({ collection, achievements, canOpen: () => true,
          canPurchase: () => fixture.allowed,
          onOpenChange: () => { fishing.cancelInput(); salesHUD.update(); },
          onSale: receipt => salesHUD.notify(receipt), onUpgrade: () => salesHUD.update() });
        fixture.fund = (amount, notify = false) => {
          const id = 'income-' + collection.catches.length;
          collection.register({ schemaVersion: 1, id, speciesId: 'black-bass', lengthCm: 50,
            weightKg: amount / 100, caughtAt: '2026-01-01T00:00:00Z' });
          const receipt = collection.sellUnassigned(id);
          if (notify) salesHUD.notify(receipt); else salesHUD.update();
          return receipt;
        };
        fixture.menu.update(); document.querySelector('#status').hidden = true;
      </script>`);
  await page.route('**/barb/ui-fixture.html', route => route.fulfill({ body: html, contentType: 'text/html' }));
  await page.goto('./ui-fixture.html');
  await page.waitForFunction(() => Boolean(window.fixture));
}
