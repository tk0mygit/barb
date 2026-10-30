import { readFileSync } from 'node:fs';
import { getFishSpecies } from '../../src/game/fish-species.js';
import { createQteOperationProvider } from '../../src/game/qte-operation-provider.js';

export async function openQteFixture(page, operation = 'tap') {
  const species = getFishSpecies('alligator-gar');
  let lengthCm;
  for (let n = 0; n < 100; n++) {
    const length = Number((species.maxLengthCm - n / 10).toFixed(1));
    if (createQteOperationProvider({ fightId: 1, speciesId: species.id, lengthCm: length }).getDescriptor(0).operation === operation) { lengthCm = length; break; }
  }
  if (!lengthCm) throw new Error(`No deterministic fixture for ${operation}`);
  await page.route('**/barb/src/**', route => {
    const path = new URL(route.request().url()).pathname.replace('/barb/', '../../');
    return route.fulfill({ body: readFileSync(new URL(path, import.meta.url)), contentType: path.endsWith('.css') ? 'text/css' : path.endsWith('.png') ? 'image/png' : 'text/javascript' });
  });
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')
    .replace('<script type="module" src="/src/main.js"></script>', `
      <link rel="stylesheet" href="./src/ui/style.css">
      <script type="module">
        import { createFishing } from './src/game/fishing.js';
        import { createCatchCollection } from './src/game/catch-collection.js';
        import { createQteOperationProvider } from './src/game/qte-operation-provider.js';
        import { createQteEvaluator } from './src/game/qte-operations.js';
        import { createQteClock } from './src/input/qte-clock.js';
        import { createQteDelivery } from './src/input/qte-delivery.js';
        import { createFishingInput } from './src/input/fishing.js';
        import { createControls } from './src/input/controls.js';
        import { createQteHUD } from './src/ui/qte-hud.js';
        import { createFishingHUD } from './src/ui/fishing-hud.js';
        import { createHUD } from './src/ui/hud.js';
        import { createCollectionMenu } from './src/ui/collection-menu.js';
        import { createAchievements } from './src/game/achievements.js';
        import { encounterModel, getRodEncounterModifiers } from './src/game/encounter-production.js';
        import { getFishSpecies } from './src/game/fish-species.js';
        import { getEquipmentLevel } from './src/game/equipment.js';
        import { getLure } from './src/game/lures.js';
        import { getFishingSpotStatus } from './src/game/fishing-spots.js';
        const species = getFishSpecies('alligator-gar'), lengthCm = ${lengthCm};
        const provider = createQteOperationProvider({fightId:1, speciesId:species.id, lengthCm});
        const collection = createCatchCollection({ initialData: { catches: [], wallet: {balance:0,lifetimeSales:0}, equipment:{rodLevel:10,reelLevel:10} } });
        const probabilities = encounterModel.getProbabilities('minnow', undefined, getRodEncounterModifiers(10));
        let total = 0, roll;
        for (const row of probabilities) { if(row.speciesId===species.id) roll=total+row.probability/2; total+=row.probability; }
        const startDistance=4.51, travel=(8-startDistance)/(.65*getEquipmentLevel('reel',10).reelSpeedMultiplier);
        const hit=getLure('minnow').hitMultiplier*getFishingSpotStatus({x:0,z:30}).hitMultiplier;
        const draws=[-Math.expm1(-Math.max(0,travel-3+.1)*hit/12),roll,Math.min(1-Number.EPSILON,(lengthCm-species.minLengthCm)/(species.maxLengthCm-species.minLengthCm))];
        const events=[];
        const fishing=createFishing({collection,random:()=>draws.length?draws.shift():.5,
          qte:{enabled:true,delivery:'finite',selectOperation:provider.selectOperation}, onFightEvent:e=>{events.push(e.type);if(events.length>40)events.shift();}});
        fishing.prepare({x:0,z:30},0);fishing.aim(0,0);fishing.cast();
        while(fishing.state.phase==='cast')fishing.step(1/60);
        fishing.reel(true);
        for(let i=0;fishing.state.distance-startDistance>1e-11&&i<2000;i++)fishing.step(Math.min(1/60,(fishing.state.distance-startDistance)/(.65*getEquipmentLevel('reel',10).reelSpeedMultiplier)));
        fishing.reel(false);
        for(let i=0;fishing.state.phase==='lure'&&i<10000;i++)fishing.step(1/60);
        const clock=createQteClock();
        let lastEvidence=null;
        const evaluate=createQteEvaluator(provider);
        const delivery=createQteDelivery({fishing,clock,evaluate:input=>{lastEvidence=input;return evaluate(input);}});
        const displayCalls=[];
        for(const method of ['prepareDisplay','presentDisplay']) {
          const original=delivery[method];
          delivery[method]=(...args)=>{const result=original(...args);displayCalls.push({method,result,snapshot:delivery.snapshot});if(displayCalls.length>8)displayCalls.shift();return result;};
        }
        const input=createFishingInput(fishing,undefined,{qteDelivery:delivery});
        const controls=createControls(document.querySelector('#scene'),document.querySelector('#joystick'),document.querySelector('#joystick-knob'),{input,canLook:()=>false});
        controls.setMode('fishing');
        const fishingHUD=createFishingHUD({onPrepare:()=>{},onCancel:()=>{},onClose:()=>{},onSell:()=>{},onSelectLure:()=>{}});
        const baseHUD=createHUD({onFish:()=>{},onReturn:()=>{}});
        const updateFishing=()=>{baseHUD.update({mode:'fishing',speed:0,heading:0});fishingHUD.update(fishing,true,{timeOfDay:'day',cycleProgress:0});};
        updateFishing();document.querySelector('#app').classList.add('fishing');
        document.querySelector('#fish-button').hidden=true;document.querySelector('#status').hidden=true;
        document.querySelector('#menu-button').disabled=false;
        const menu=createCollectionMenu({collection,achievements:createAchievements({collection}),canOpen:()=>true,canPurchase:()=>false,
          onOpenChange:open=>{input.setSuspended('menu',open,performance.now());controls.setEnabled(!open);}});
        const hud=createQteHUD({fishing,delivery,provider});
        const suspend=(reason,value)=>input.setSuspended(reason,value,performance.now());
        window.addEventListener('blur',()=>suspend('blur',true));window.addEventListener('focus',()=>suspend('blur',false));
        document.addEventListener('visibilitychange',()=>suspend('hidden',document.hidden));
        window.addEventListener('pagehide',()=>suspend('page',true));window.addEventListener('pageshow',()=>suspend('page',false));
        const start=()=>{
          if(!fishing.hook())throw new Error('fixture failed legal hook');
          fishing.reel(true);while(fishing.state.fight.mode==='normal')fishing.step(1/60);
          delivery.open(performance.now());updateFishing();
        };
        window.qteFixture={fishing,delivery,hud,provider,events,controls,input,menu,start,displayCalls,evidence:()=>lastEvidence};
        let frame=0;
        function render(){const raw=performance.now();controls.read(0,raw);hud.update(++frame,performance.now());requestAnimationFrame(render);}
        requestAnimationFrame(render);
      </script>`);
  await page.route('**/barb/qte-fixture.html', route => route.fulfill({ body: html, contentType: 'text/html' }));
  await page.goto('./qte-fixture.html');
  await page.waitForFunction(() => Boolean(window.qteFixture));
  // Navigation/image/module preparation completes before the legal HOOK and
  // warning anchor. Native input thereafter uses the unmodified real clock.
  await page.evaluate(() => window.qteFixture.start());
}
