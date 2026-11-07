import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { FISH_SPECIES, calculateFishWeightKg, getFishSpecies } from '../src/game/fish-species.js';
import { APPEARANCE_WEIGHTS } from '../src/game/fish-encounters.js';
import { FISH_RARITY } from '../src/game/fish-rarity.js';
import { LURES } from '../src/game/lures.js';
import { FISH_ENVIRONMENT_AFFINITIES, LURE_DEPTH_AFFINITIES } from '../src/game/encounter-affinities.js';
import { createEncounterModel } from '../src/game/encounter-model.js';
import { encounterModel, getRodEncounterModifiers } from '../src/game/encounter-production.js';
import { PHASE6A_FISH_SPECIES_IDS } from '../src/game/fish-roster.js';
import { calculateSalePrice } from '../src/game/fish-sales.js';
import { fishResistance } from '../src/game/fish-fight.js';
import { createCatchCollection } from '../src/game/catch-collection.js';
import { createGameplay } from '../src/game/gameplay.js';
import { createSaveData, restoreSaveData, validateSaveData } from '../src/game/save-data.js';
import { hookedFight } from './helpers/fight-replay.js';
import { getQteDifficulty } from '../src/game/fight-qte.js';
import { createFishing, PHASE } from '../src/game/fishing.js';

const baseline=JSON.parse(readFileSync(new URL('./fixtures/phase6a-baseline.json',import.meta.url)));
const approved=JSON.parse(readFileSync(new URL('../docs/artwork/phase6/approved-6b.json',import.meta.url)));
const rows=[
  ['striped-bass','ストライプドバス',35,130,70,3.5,1.17,180,.24,2.4,45,3.5,'minnow','deep','day'],
  ['burbot','バーボット',30,110,65,2.5,1.12,190,.11,1.3,55,3,'worm','deep','night'],
  ['grayling','グレイリング',20,65,40,.65,.92,140,.23,3.4,105,3,'minnow','shallow','day'],
  ['lake-trout','レイクトラウト',30,125,70,3.8,1.15,190,.20,2,45,3,'crankbait','deep','day'],
  ['arctic-char','アークティックチャー',25,90,50,1.1,1.05,160,.21,3,85,3,'minnow','deep','night'],
  ['bowfin','ボウフィン',30,95,55,1.7,1.14,160,.19,2.4,70,3.5,'spinnerbait','shallow','night'],
  ['murray-cod','マーレーコッド',40,150,80,9,1.26,210,.22,1.7,30,2.5,'crankbait','mid','night'],
  ['golden-dorado','ゴールデンドラード',30,115,65,4,1.20,150,.29,3.5,40,3,'spinnerbait','mid','day'],
];
const at='2026-11-07T00:00:00.000Z';
const capture=(fish,id=fish.id,count=0,length=fish.minLengthCm)=>({schemaVersion:1,id,speciesId:fish.id,
  lengthCm:length,weightKg:calculateFishWeightKg(fish.id,length),caughtAt:at,qteSuccessCount:count});

test('base main twenty species, PNGs, all encounter coefficients and rod modifiers stay unchanged',()=>{
  assert.equal(baseline.baseSha,'4edd6c191ff9fd7d4cc8e93908d781106b72071a');
  assert.deepEqual(FISH_SPECIES.slice(0,20).map(({image,...fish})=>({...fish,
    imageSha256:createHash('sha256').update(readFileSync(new URL(image))).digest('hex')})),baseline.species);
  assert.deepEqual(PHASE6A_FISH_SPECIES_IDS,baseline.species.map(fish=>fish.id));
  for(const id of PHASE6A_FISH_SPECIES_IDS){
    assert.equal(APPEARANCE_WEIGHTS[id],baseline.baseWeights[id]);assert.equal(FISH_RARITY[id],baseline.tiers[id]);
    assert.deepEqual(FISH_ENVIRONMENT_AFFINITIES[id],baseline.environmentAffinities[id]);
    for(const lure of LURES)assert.equal(lure.affinities[id],baseline.lures.find(row=>row.id===lure.id).affinities[id]);
    for(const level of [1,5,10])assert.equal(getRodEncounterModifiers(level)[id],baseline.rodModifiers[level][id]);
  }
  assert.deepEqual(LURE_DEPTH_AFFINITIES,baseline.lureDepthExponents);
  assert.deepEqual(LURES.map(({affinities,...row})=>row),baseline.lures.map(({affinities,...row})=>row));
});

test('exact 21–28 order, single grayling identity, approved PNG SHA/bytes and immutable numeric tables',()=>{
  assert.equal(FISH_SPECIES.length,36);assert.deepEqual(FISH_SPECIES.slice(20,28).map(fish=>fish.id),rows.map(row=>row[0]));
  assert.deepEqual(approved.images.map(row=>row.order),[21,22,23,24,25,26,27,28]);
  assert.equal(approved.images.reduce((n,row)=>n+row.bytes,0),4775452);
  const ids=FISH_SPECIES.map(fish=>fish.id);
  for(const table of [APPEARANCE_WEIGHTS,FISH_RARITY,FISH_ENVIRONMENT_AFFINITIES,...LURES.map(lure=>lure.affinities)])assert.deepEqual(Object.keys(table),ids);
  for(const [id,name,min,max,cm,kg,b,s,a,f,price,weight,lureId,depth,time] of rows){
    const fish=getFishSpecies(id),row=approved.images.find(row=>row.speciesId===id),bytes=readFileSync(new URL(fish.image));
    assert.equal(bytes.length,row.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),row.sha256);
    assert.deepEqual([fish.name,fish.minLengthCm,fish.maxLengthCm,fish.weight.referenceLengthCm,fish.weight.referenceWeightKg,
      fish.fight.baseResistance,fish.fight.lengthScaleCm,fish.fight.surgeAmplitude,fish.fight.surgeFrequency,fish.basePricePerKg],
    [name,min,max,cm,kg,b,s,a,f,price]);
    assert.equal(fish.weight.exponent,3);assert.equal(APPEARANCE_WEIGHTS[id],weight);assert.equal(FISH_RARITY[id],'Uncommon');
    for(const lure of LURES)assert.equal(lure.affinities[id],lure.id===lureId?1.60:.85);
    for(const band of ['shallow','mid','deep'])assert.equal(FISH_ENVIRONMENT_AFFINITIES[id].depth[band],band===depth?1.40:.90);
    for(const period of ['day','night'])assert.equal(FISH_ENVIRONMENT_AFFINITIES[id].time[period],period===time?1.25:.90);
  }
  assert.match(getFishSpecies('grayling').description,/帆.*Thymallus arcticus/);
  assert.equal(new Set(FISH_SPECIES.map(fish=>fish.image)).size,36);
});

test('strict production rejects every new key omission, including each of the four lures and environment subkeys',()=>{
  for(const [id] of rows)for(const key of ['baseWeights','tiers','environmentAffinities',...LURES.map(lure=>lure.id),'shallow','mid','deep','day','night']){
    const d=encounterModel.definitions,config=structuredClone({registry:{species:FISH_SPECIES},baseWeights:d.baseWeights,tiers:d.tiers,
      environmentAffinities:d.environmentAffinities,lures:d.lures,lureDepthExponents:d.lureDepthExponents});
    if(LURES.some(lure=>lure.id===key))delete config.lures.find(lure=>lure.id===key).affinities[id];
    else if(['shallow','mid','deep'].includes(key))delete config.environmentAffinities[id].depth[key];
    else if(['day','night'].includes(key))delete config.environmentAffinities[id].time[key];
    else delete config[key][id];
    assert.throws(()=>createEncounterModel(config),TypeError,`${id}/${key}`);
  }
});

test('72 conditions preserve positive normalized probabilities and every original-twelve relative probability',()=>{
  const old=createEncounterModel({registry:{species:FISH_SPECIES.slice(0,20)},baseWeights:baseline.baseWeights,tiers:baseline.tiers,
    lures:baseline.lures,environmentAffinities:baseline.environmentAffinities,lureDepthExponents:baseline.lureDepthExponents});
  let cases=0;
  for(const lure of LURES)for(const depthM of [1,5,12])for(const timeOfDay of ['day','night'])for(const level of [1,5,10]){
    const previous=old.audit(lure.id,{depthM,timeOfDay},baseline.rodModifiers[level]),current=encounterModel.audit(lure.id,{depthM,timeOfDay},getRodEncounterModifiers(level));
    assert.ok(Math.abs(current.entries.reduce((n,row)=>n+row.probability,0)-1)<1e-12);
    for(const entry of current.entries)assert.ok(entry.weight>0&&entry.probability>0);
    for(let i=0;i<20;i++){
      assert.equal(current.entries[i].weight,previous.entries[i].weight);
      assert.ok(Math.abs(current.entries[i].probability/previous.entries[i].probability-previous.totalWeight/current.totalWeight)<1e-12);
      if(i<12)for(let j=0;j<12;j++)assert.ok(Math.abs(current.entries[i].probability/current.entries[j].probability
        -previous.entries[i].probability/previous.entries[j].probability)<1e-12);
    }
    cases++;
  }
  assert.equal(cases,72);
});

test('new fish length draws are uniform with 0.1cm rounding; weight, resistance and RNG order follow the existing formulas',()=>{
  for(const fish of FISH_SPECIES.slice(20,28))for(const roll of [0,.12345,.5,1-Number.EPSILON]){
    const length=Math.round((fish.minLengthCm+roll*(fish.maxLengthCm-fish.minLengthCm))*10)/10;
    const entries=encounterModel.getProbabilities('minnow',undefined,getRodEncounterModifiers(1));
    const i=entries.findIndex(row=>row.speciesId===fish.id),start=entries.slice(0,i).reduce((n,row)=>n+row.probability,0);
    const draws=[0,start+entries[i].probability/2,roll],consumed=[];
    const f=createFishing({random:()=>{const value=draws.shift();consumed.push(value);return value;}});
    assert.equal(f.prepare({x:0,z:30},0),true);f.aim(0,0);f.cast();assert.equal(f.state.phase,PHASE.CAST);
    for(let n=0;n<1000&&f.state.phase!==PHASE.BITE;n++)f.step(1/60);
    assert.equal(f.state.phase,PHASE.BITE);assert.deepEqual(consumed,[0,start+entries[i].probability/2,roll]);assert.deepEqual(draws,[]);
    assert.equal(f.state.encounter.speciesId,fish.id);assert.equal(f.state.encounter.lengthCm,length);
    assert.equal(f.state.encounter.weightKg,Math.round(fish.weight.referenceWeightKg*(length/fish.weight.referenceLengthCm)**3*100)/100);
    for(const seconds of [0,.5,2,10])assert.equal(fishResistance(fish,length,seconds),fish.fight.baseResistance
      +(length-fish.minLengthCm)/fish.fight.lengthScaleCm+fish.fight.surgeAmplitude*Math.sin(seconds*fish.fight.surgeFrequency));
  }
});

test('eight Uncommon price endpoints, half-up boundaries, minimum and noncompound QTE 0–3 agree across sale routes',()=>{
  for(const fish of FISH_SPECIES.slice(20,28))for(const length of [fish.minLengthCm,fish.weight.referenceLengthCm,fish.maxLengthCm])for(let count=0;count<=3;count++){
    const record=capture(fish,fish.id,count,length),base=Math.max(50,Math.floor(record.weightKg*fish.basePricePerKg+.5));
    assert.equal(calculateSalePrice(record),base+Math.floor((base*count+5)/10));
  }
  for(const [id,weight,base] of [['striped-bass',1.1,50],['striped-bass',1.3,59],['burbot',1.3,72],['grayling',1.1,116],['murray-cod',1.75,53]])for(let count=0;count<=3;count++){
    assert.equal(calculateSalePrice({speciesId:id,weightKg:weight,qteSuccessCount:count}),base+Math.floor((base*count+5)/10));
  }
  const balances=[];
  for(const route of ['bulk','individual']){
    const c=createCatchCollection({now:()=>1000});
    for(const fish of FISH_SPECIES.slice(20,28))for(let count=0;count<=3;count++){
      const record=capture(fish,`${fish.id}-${count}`,count,fish.maxLengthCm);c.register(record);c.store(record.id);
    }
    const expected=c.catches.reduce((n,row)=>n+calculateSalePrice(row),0);
    if(route==='bulk')assert.equal(c.sellStored(c.quoteStored().ids).total,expected);
    else for(const record of c.catches)assert.equal(c.sellStored([record.id]).total,calculateSalePrice(record));
    assert.equal(c.wallet.balance,expected);assert.equal(c.wallet.lifetimeSales,expected);balances.push(c.wallet);
  }
  assert.deepEqual(balances[0],balances[1]);
});

test('24 distinct captures unlock once at capture time; duplicate/storage/sale never count again and all dates survive restore',()=>{
  let now=1000;const game=createGameplay({now:()=>now}),c=game.collection,batches=[];
  game.achievements.subscribe(awards=>batches.push(awards));
  const award=()=>game.achievements.entries.find(row=>row.id==='normal-species-24');
  for(const fish of FISH_SPECIES.slice(0,23))c.register(capture(fish));
  assert.equal(award().unlocked,false);assert.equal(award().progress.value,23);
  c.register(capture(FISH_SPECIES[0],'repeat'));assert.equal(award().progress.value,23);
  now=2000;c.register(capture(FISH_SPECIES[23]));assert.equal(award().unlockedAt,'1970-01-01T00:00:02.000Z');
  const snapshot=game.achievements.snapshot;
  now=3000;c.store(FISH_SPECIES[23].id);c.sellStored([FISH_SPECIES[23].id]);c.register(capture(FISH_SPECIES[23]));game.achievements.evaluate();
  assert.deepEqual(game.achievements.snapshot,snapshot);assert.equal(batches.flat().filter(row=>row.id==='normal-species-24').length,1);
  const data=createSaveData(game,{savedAt:at});
  assert.deepEqual(restoreSaveData(data,{now:()=>{throw Error('No new date');}}).achievements.snapshot,snapshot);
  for(const mutate of [d=>{d.achievements.unlocked=d.achievements.unlocked.filter(row=>row.id!=='normal-species-24');},
    d=>{d.achievements.unlocked.push(d.achievements.unlocked.find(row=>row.id==='normal-species-24'));},
    d=>{d.achievements.unlocked.find(row=>row.id==='normal-species-24').unlockedAt='2026-02-30T00:00:00Z';}]){
    const bad=structuredClone(data);mutate(bad);assert.throws(()=>validateSaveData(bad));
  }
  const incomplete=createGameplay();for(const fish of FISH_SPECIES.slice(0,23))incomplete.collection.register(capture(fish));
  const bad=structuredClone(createSaveData(incomplete,{savedAt:at}));bad.achievements.unlocked.push({id:'normal-species-24',unlockedAt:at});
  assert.throws(()=>validateSaveData(bad),e=>e.path==='achievements.normal-species-24');
  assert.equal(game.achievements.entries.length,17);assert.equal(game.achievements.entries.find(row=>row.id==='normal-species-36').unlocked,false);
});

test('all eight new maximum-size fish land with every available QTE success count',()=>{
  for(const fish of FISH_SPECIES.slice(20,28))for(let successes=0;successes<=getQteDifficulty(fish,fish.maxLengthCm).count;successes++){
    let f,index=0;
    ({f}=hookedFight({speciesId:fish.id,size:'max',rod:10,reel:10,startDistance:4.51},{qte:{enabled:true,selectOperation:()=>'tap'},onFightEvent(event){
      if(event.type==='qte-warning')assert.equal(f.submitQteResult(event.fight.qte.token,index++<successes,event.fight.qte.deadlineSeconds),true);
    }}));
    for(let i=0;i<7200&&f.state.phase===PHASE.FIGHT;i++){f.reel(f.state.tension<.65);f.step(1/60);}
    assert.equal(f.state.phase,PHASE.LANDING,`${fish.id} QTE=${successes}`);assert.equal(index,getQteDifficulty(fish,fish.maxLengthCm).count);
    f.step(2);assert.equal(f.state.phase,PHASE.RESULT);assert.equal(f.state.catch.qteSuccessCount,successes);
  }
});
