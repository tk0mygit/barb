import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { FISH_SPECIES, calculateFishWeightKg } from '../src/game/fish-species.js';
import { ORIGINAL_FISH_SPECIES_IDS } from '../src/game/fish-roster.js';
import { FISH_RARITY } from '../src/game/fish-rarity.js';
import { APPEARANCE_WEIGHTS } from '../src/game/fish-encounters.js';
import { LURES } from '../src/game/lures.js';
import { FISH_ENVIRONMENT_AFFINITIES, LURE_DEPTH_AFFINITIES } from '../src/game/encounter-affinities.js';
import { createEncounterModel } from '../src/game/encounter-model.js';
import { encounterModel, getRodEncounterModifiers } from '../src/game/encounter-production.js';
import { calculateSalePrice } from '../src/game/fish-sales.js';
import { createCatchCollection } from '../src/game/catch-collection.js';
import { createAchievements, NORMAL_ACHIEVEMENTS } from '../src/game/achievements.js';
import { createSaveData, validateSaveData, restoreSaveData } from '../src/game/save-data.js';
import { createGameplay } from '../src/game/gameplay.js';
import { hookedFight } from './helpers/fight-replay.js';
import { PHASE } from '../src/game/fishing.js';
import { getQteDifficulty } from '../src/game/fight-qte.js';
import { assertArtworkAlpha, measureArtworkAlpha } from '../scripts/lib/fish-artwork-alpha.js';

const baseline = JSON.parse(readFileSync(new URL('./fixtures/phase6-legacy-baseline.json', import.meta.url)));
const approved = JSON.parse(readFileSync(new URL('../docs/artwork/phase6/approved-6a.json', import.meta.url)));
// Independent approved numeric matrix: id, min/max, reference cm/kg, B/S/A/F,
// unit price, appearance, lure, depth, time, Tier.
const additions = [
  ['common-carp',25,90,50,3,.87,150,.14,1.5,25,7,'worm','shallow','day','Common'],
  ['tench',20,55,35,.8,.68,130,.10,1.8,50,6,'worm','shallow','night','Common'],
  ['pumpkinseed',10,30,20,.18,.55,120,.12,3.9,50,8,'worm','shallow','day','Common'],
  ['black-crappie',15,45,30,.55,.72,130,.15,3.4,60,7,'minnow','mid','night','Common'],
  ['rock-bass',12,35,25,.3,.79,120,.17,3.2,65,7,'crankbait','mid','day','Common'],
  ['freshwater-drum',25,95,50,1.6,.96,170,.14,2.3,35,5,'worm','deep','night','Common'],
  ['white-bass',18,45,30,.45,.82,120,.21,3.3,60,5,'minnow','mid','day','Common'],
  ['brook-trout',20,65,40,.75,.95,140,.22,3.4,95,3.5,'minnow','mid','day','Uncommon'],
];
const at = '2026-11-07T00:00:00.000Z';
const capture = (fish, index = fish.id, count = 0) => ({ schemaVersion: 1, id: String(index), speciesId: fish.id,
  lengthCm: fish.minLengthCm, weightKg: calculateFishWeightKg(fish.id, fish.minLengthCm), caughtAt: at, qteSuccessCount: count });

test('base-SHA original twelve definitions, PNG bytes and every encounter coefficient are unchanged', () => {
  assert.deepEqual(FISH_SPECIES.slice(0, 12).map(({ image, ...fish }) => ({ ...fish,
    imageSha256: createHash('sha256').update(readFileSync(new URL(image))).digest('hex') })), baseline.species);
  assert.deepEqual(ORIGINAL_FISH_SPECIES_IDS, baseline.species.map(fish => fish.id));
  for (const id of ORIGINAL_FISH_SPECIES_IDS) {
    assert.equal(APPEARANCE_WEIGHTS[id], baseline.baseWeights[id]);
    assert.equal(FISH_RARITY[id], baseline.tiers[id]);
    assert.deepEqual(FISH_ENVIRONMENT_AFFINITIES[id], baseline.environmentAffinities[id]);
    for (const lure of LURES) assert.equal(lure.affinities[id], baseline.lures.find(row => row.id === lure.id).affinities[id]);
  }
  assert.deepEqual(LURE_DEPTH_AFFINITIES, baseline.lureDepthExponents);
  assert.deepEqual(LURES.map(({ affinities, ...row }) => row), baseline.lures.map(({ affinities, ...row }) => row));
});

test('exact 13–20 order, approved image SHA/bytes, numeric definitions and complete positive tables', () => {
  assert.deepEqual(FISH_SPECIES.slice(12,20).map(fish => fish.id), additions.map(row => row[0]));
  assert.deepEqual(approved.images.map(row => row.order), [13,14,15,16,17,18,19,20]);
  const ids = FISH_SPECIES.map(fish => fish.id);
  for (const table of [APPEARANCE_WEIGHTS, FISH_RARITY, FISH_ENVIRONMENT_AFFINITIES, ...LURES.map(lure => lure.affinities)]) assert.deepEqual(Object.keys(table), ids);
  for (const [id,min,max,cm,kg,b,s,a,f,price,weight,lureId,depth,time,tier] of additions) {
    const fish = FISH_SPECIES.find(fish => fish.id === id), row = approved.images.find(row => row.speciesId === id);
    const bytes = readFileSync(new URL(fish.image));
    assert.equal(bytes.length, row.bytes); assert.equal(createHash('sha256').update(bytes).digest('hex'), row.sha256);
    assert.deepEqual([fish.minLengthCm,fish.maxLengthCm,fish.weight.referenceLengthCm,fish.weight.referenceWeightKg,
      fish.fight.baseResistance,fish.fight.lengthScaleCm,fish.fight.surgeAmplitude,fish.fight.surgeFrequency,fish.basePricePerKg], [min,max,cm,kg,b,s,a,f,price]);
    assert.equal(fish.weight.exponent, 3); assert.equal(APPEARANCE_WEIGHTS[id], weight); assert.equal(FISH_RARITY[id], tier);
    for (const lure of LURES) assert.equal(lure.affinities[id], lure.id === lureId ? 1.60 : .85);
    for (const band of ['shallow','mid','deep']) assert.equal(FISH_ENVIRONMENT_AFFINITIES[id].depth[band], band === depth ? 1.40 : .90);
    for (const period of ['day','night']) assert.equal(FISH_ENVIRONMENT_AFFINITIES[id].time[period], period === time ? 1.25 : .90);
  }
  // Strict production must reject each possible omission, without a default 1.
  for (const [id] of additions) for (const key of ['baseWeights','tiers','environmentAffinities','lures']) {
    const d = encounterModel.definitions;
    const config = structuredClone({ registry: { species: FISH_SPECIES }, baseWeights: d.baseWeights, tiers: d.tiers,
      environmentAffinities: d.environmentAffinities, lures: d.lures, lureDepthExponents: d.lureDepthExponents });
    if (key === 'lures') delete config.lures[0].affinities[id]; else delete config[key][id];
    assert.throws(() => createEncounterModel(config), error => error instanceof TypeError && error.message.endsWith(`${id}: required`));
  }
});

test('24 conditions × Lv.1/5/10 preserve original pairwise ratios and change only the normalization denominator', () => {
  const old = createEncounterModel({ registry: { species: FISH_SPECIES.slice(0,12) }, ...{
    baseWeights: baseline.baseWeights, lures: baseline.lures, environmentAffinities: baseline.environmentAffinities,
    lureDepthExponents: baseline.lureDepthExponents, tiers: baseline.tiers } });
  let cases = 0;
  for (const lure of LURES) for (const depthM of [1,5,12]) for (const timeOfDay of ['day','night']) for (const level of [1,5,10]) {
    const conditions = { depthM, timeOfDay }, modifiers = getRodEncounterModifiers(level);
    const previous = old.audit(lure.id, conditions, Object.fromEntries(ORIGINAL_FISH_SPECIES_IDS.map(id => [id,modifiers[id]])));
    const current = encounterModel.audit(lure.id, conditions, modifiers);
    assert.ok(Math.abs(current.entries.reduce((sum,row) => sum+row.probability,0)-1)<1e-12);
    for (const row of current.entries) assert.ok(row.weight>0 && row.probability>0);
    for (let i=0;i<12;i++) {
      assert.equal(current.entries[i].weight, previous.entries[i].weight);
      assert.ok(Math.abs(current.entries[i].probability / previous.entries[i].probability - previous.totalWeight/current.totalWeight)<1e-12);
      for(let j=0;j<12;j++) assert.ok(Math.abs(current.entries[i].probability/current.entries[j].probability
        - previous.entries[i].probability/previous.entries[j].probability)<1e-12);
    }
    cases++;
  }
  assert.equal(cases,72);
});

test('all twenty-eight fish sample both length endpoints with only the existing three encounter RNG draws', () => {
  for (const fish of FISH_SPECIES) for (const [size,length] of [[0,fish.minLengthCm],[1-Number.EPSILON,fish.maxLengthCm]]) {
    const {f,calls} = hookedFight({speciesId:fish.id,lengthCm:length,size});
    assert.equal(calls(),3);
    assert.equal(f.state.encounter.weightKg, Math.round(fish.weight.referenceWeightKg*(length/fish.weight.referenceLengthCm)**3*100)/100);
  }
});

test('every Uncommon minimum is 50 before QTE 0–3; Common and Rare retain their original rounding rule', () => {
  for (const fish of FISH_SPECIES) {
    const base = Math.round(calculateFishWeightKg(fish.id,fish.minLengthCm)*fish.basePricePerKg);
    for(let count=0;count<=3;count++) {
      const basic = FISH_RARITY[fish.id] === 'Uncommon' ? Math.max(50,base) : base;
      const bonus = basic>0 && count>0 ? Math.max(1,Math.floor((basic*count*10+50)/100)) : 0;
      assert.equal(calculateSalePrice(capture(fish,fish.id,count)),basic+bonus);
    }
    if(FISH_RARITY[fish.id] === 'Uncommon') assert.equal(calculateSalePrice(capture(fish)),50);
  }
  for(const route of ['bulk','individual']) {
    const c=createCatchCollection({now:()=>1000});
    for(const fish of FISH_SPECIES) {c.register(capture(fish));c.store(fish.id);}
    const expected=c.catches.reduce((sum,row)=>sum+calculateSalePrice(row),0);
    if(route==='bulk') assert.equal(c.sellStored(c.quoteStored().ids).total,expected);
    else for(const fish of FISH_SPECIES) assert.ok(c.sellStored([fish.id]));
    assert.equal(c.wallet.balance,expected);assert.equal(c.sellStored([FISH_SPECIES[0].id]),null);
  }
});

test('arbitrary twelve including all eight additions cannot unlock original-twelve award, including strict save restore', () => {
  const game=createGameplay({now:()=>1000}),c=game.collection;
  for(const fish of [...FISH_SPECIES.slice(12,20),...FISH_SPECIES.slice(0,4)]) c.register(capture(fish));
  const award=()=>game.achievements.entries.find(row=>row.id==='normal-species-12');
  assert.equal(award().unlocked,false);assert.equal(award().progress.value,4);
  assert.equal(game.achievements.entries.find(row=>row.id==='normal-species-5').unlocked,true);
  const data=createSaveData(game,{savedAt:at}), bad=structuredClone(data);
  bad.achievements.unlocked.push({id:'normal-species-12',unlockedAt:at});
  assert.throws(()=>validateSaveData(bad),e=>e.path==='achievements.normal-species-12');
  assert.equal(restoreSaveData(data).achievements.entries.find(row=>row.id==='normal-species-12').unlocked,false);
  for(const fish of FISH_SPECIES.slice(4,12)) c.register(capture(fish));
  assert.equal(award().unlocked,true);assert.equal(award().unlockedAt,'1970-01-01T00:00:01.000Z');
  assert.deepEqual(NORMAL_ACHIEVEMENTS.filter(row=>['species','original-species'].includes(row.metric)).map(row=>row.target),[5,12,24,36]);
});

test('new alpha contract rejects faded bodies, sparse cores, hard-only edges and any margin contamination', () => {
  const width=1280,height=560,pixels=new Uint8Array(width*height*4);
  for(let y=50;y<450;y++)for(let x=100;x<1000;x++)pixels[(y*width+x)*4+3]=(x===100||y===50)?128:254;
  const measure=()=>measureArtworkAlpha(pixels,width,height),validate=()=>assertArtworkAlpha(measure(),{legacy:false,id:'test'});
  validate();
  const good=measure();
  for(const change of [{nearOpaquePixels:100},{nearOpaquePixels:good.nearOpaquePixels*.8},{softEdgePixels:0},{nontransparentBorderPixels:1}]) {
    assert.throws(()=>assertArtworkAlpha({...good,...change},{legacy:false,id:'test'}));
  }
  for(let i=3;i<pixels.length;i+=4)if(pixels[i]>=250)pixels[i]=249;
  assert.throws(validate,/dense near-opaque/);
  assert.throws(()=>assertArtworkAlpha(good,{legacy:true,id:'old'}),/original opaque/);
});

test('all eight new max-size fish finish across their existing QTE counts; high-resistance drum/trout cover successes 0–3', () => {
  for (const fish of FISH_SPECIES.slice(12,20)) for (let successes = 0; successes <= getQteDifficulty(fish, fish.maxLengthCm).count; successes++) {
    const speciesId = fish.id;
    let f,index=0;
    ({f}=hookedFight({speciesId,size:'max',rod:10,reel:10,startDistance:4.51},{
      qte:{enabled:true,selectOperation:()=>'tap'},onFightEvent(event){
        if(event.type==='qte-warning')assert.equal(f.submitQteResult(event.fight.qte.token,index++<successes,event.fight.qte.deadlineSeconds),true);
      },
    }));
    for(let i=0;i<7200&&f.state.phase===PHASE.FIGHT;i++){f.reel(f.state.tension<.65);f.step(1/60);}
    assert.equal(f.state.phase,PHASE.LANDING,`${speciesId} QTE=${successes}`);
    assert.equal(index,getQteDifficulty(fish,fish.maxLengthCm).count);
    f.step(2);assert.equal(f.state.phase,PHASE.RESULT);assert.equal(f.state.catch.qteSuccessCount,successes);
  }
});
