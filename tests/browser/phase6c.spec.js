import { test, expect } from './diagnostics-fixture.js';
import { readFileSync } from 'node:fs';
import { createGameplay } from '../../src/game/gameplay.js';
import { createSaveData } from '../../src/game/save-data.js';
import { FISH_SPECIES, calculateFishWeightKg } from '../../src/game/fish-species.js';
import { calculateSalePrice } from '../../src/game/fish-sales.js';

const keys=['barb.save.v1.slotA','barb.save.v1.slotB'];
const approved=JSON.parse(readFileSync(new URL('../../docs/artwork/phase6/approved-6c.json',import.meta.url)));
const game=createGameplay({now:()=>1000});
for(const fish of FISH_SPECIES.slice(28)){
  game.collection.register({schemaVersion:1,id:fish.id,speciesId:fish.id,lengthCm:fish.minLengthCm,
    weightKg:calculateFishWeightKg(fish.id,fish.minLengthCm),qteSuccessCount:0,caughtAt:'2026-11-08T00:00:00.000Z'});
  game.collection.store(fish.id);
}
const data=createSaveData(game,{savedAt:'2026-11-08T00:00:00.000Z'});
const money=value=>`${value.toLocaleString('ja-JP')} Value`;

for(const touch of [false,true])test(`${touch?'touch':'desktop'}: Phase 6-C built PNGs, thirty-six slots, V3 sales and reload`,async({createContext},testInfo)=>{
  const context=await createContext({viewport:touch?{width:390,height:844}:{width:1000,height:700},hasTouch:touch,isMobile:touch,deviceScaleFactor:.5});
  const page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(({keys,data})=>{
    if(!sessionStorage.getItem('phase6c-seeded')){
      localStorage.setItem(keys[0],JSON.stringify({storageVersion:1,generation:1,data}));
      sessionStorage.setItem('phase6c-seeded','yes');
    }
  },{keys,data});
  const click=locator=>touch?locator.tap():locator.click();
  await page.goto('./');await expect(page.locator('#status')).toBeHidden();await expect(page.locator('#error')).toBeHidden();
  await click(page.locator('#menu-button'));await click(page.locator('[data-view="encyclopedia"]'));
  await expect(page.locator('.fish-card')).toHaveCount(36);await expect(page.locator('div.fish-card')).toHaveCount(28);
  await expect(page.locator('.collection-summary')).toHaveText('発見 8 / 36 種');
  const unknown=await page.locator('div.fish-card').evaluateAll(nodes=>nodes.map(node=>node.outerHTML).join(''));
  for(const fish of FISH_SPECIES.filter(fish=>!FISH_SPECIES.slice(28).includes(fish))){expect(unknown).not.toContain(fish.name);expect(unknown).not.toContain(fish.description);expect(unknown).not.toContain(`${fish.id}.png`);}
  const hashes=[];
  for(const [index,fish] of FISH_SPECIES.slice(28).entries()){
    const image=page.locator('button.fish-card img').nth(index);
    await image.scrollIntoViewIfNeeded();await expect(image).toBeVisible();
    await expect(image).toHaveAttribute('src',/.+/);
    const decoded=await image.evaluate(async image=>{
      await image.decode();const response=await fetch(image.currentSrc),bytes=await response.arrayBuffer();
      const hash=await crypto.subtle.digest('SHA-256',bytes);
      return {src:image.currentSrc,width:image.naturalWidth,height:image.naturalHeight,bytes:bytes.byteLength,
        sha256:[...new Uint8Array(hash)].map(value=>value.toString(16).padStart(2,'0')).join('')};
    });
    expect(new URL(decoded.src).pathname).toMatch(/^\/barb\/assets\/[\w-]+\.png$/);
    const row=approved.images[index];expect([decoded.width,decoded.height,decoded.bytes,decoded.sha256]).toEqual([1280,560,row.bytes,row.sha256]);hashes.push({id:fish.id,...decoded});
    await click(image.locator('..').locator('..'));await expect(page.locator('.fish-description')).toHaveText(fish.description);
    if(touch)for(const size of [{width:844,height:390},{width:390,height:844}]){
      await page.setViewportSize(size);await expect(page.locator('.fish-detail img')).toBeVisible();
      expect(await page.locator('.fish-detail img').evaluate(img=>{const b=img.getBoundingClientRect();return b.width>0&&b.left>=0&&b.right<=innerWidth;})).toBe(true);
    }
    await click(page.locator('#collection-back'));
  }
  await testInfo.attach('approved-built-pngs',{body:JSON.stringify(hashes,null,2),contentType:'application/json'});
  await click(page.locator('#collection-back'));await click(page.locator('[data-view="achievements"]'));
  await expect(page.locator('[data-achievement-id="normal-species-36"]')).toHaveAttribute('data-unlocked','false');
  await expect(page.locator('[data-achievement-id="normal-species-36"] .achievement-progress')).toHaveText('魚種発見：8 / 36種');
  await click(page.locator('#collection-back'));await click(page.locator('[data-view="storage"]'));
  await expect(page.locator('.stored-fish')).toHaveCount(8);
  for(const row of data.collection.catches)await expect(page.locator(`[data-catch-id="${row.id}"] .stored-price`)).toHaveText(`売却価格 ${money(calculateSalePrice(row))}`);
  const total=data.collection.catches.reduce((sum,row)=>sum+calculateSalePrice(row),0);
  await click(page.locator('#sell-all'));await expect(page.locator('.sale-confirm-summary')).toContainText(money(total));await click(page.locator('#confirm-sale'));
  await expect(page.locator('#wallet-balance')).toHaveText(money(total));
  await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));
  const saved=await page.evaluate(keys=>keys.map(key=>localStorage.getItem(key)).filter(Boolean).map(JSON.parse).sort((a,b)=>b.generation-a.generation)[0].data,keys);
  expect([saved.saveVersion,saved.rosterRevision,saved.achievements.contractVersion]).toEqual([3,3,6]);
  expect(saved.collection.wallet).toEqual({balance:total,lifetimeSales:total});expect(saved.collection.catches.every(row=>row.disposition==='sold')).toBe(true);
  await page.reload();await expect(page.locator('#status')).toBeHidden();await expect(page.locator('#wallet-balance')).toHaveText(money(total));
  await click(page.locator('#menu-button'));await click(page.locator('[data-view="encyclopedia"]'));await expect(page.locator('.collection-summary')).toHaveText('発見 8 / 36 種');
  expect(errors).toEqual([]);
});
