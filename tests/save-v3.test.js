import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createSaveData, serializeSaveData, parseSaveData, restoreSaveData, validateSaveData } from '../src/game/save-data.js';
import { createSaveStorage, SAVE_STORAGE_KEYS as KEYS } from '../src/game/save-storage.js';
import { createGameplay } from '../src/game/gameplay.js';
import { FISH_SPECIES, calculateFishWeightKg } from '../src/game/fish-species.js';
import { calculateSalePrice } from '../src/game/fish-sales.js';

const at='2026-11-07T00:00:00.000Z';
const envelope=(generation,data)=>JSON.stringify({storageVersion:1,generation,data});
const save=game=>createSaveData(game,{savedAt:at});
let dir, oldSave, oldStorage, sourceV2;
before(async()=>{
  dir=await mkdtemp(join(tmpdir(),'barb-save-pre-v3-'));
  const archive=execFileSync('git',['archive','--format=tar','4a9255054565310f857e74dc52f77c0b885c762b','src/game','src/world','package.json']);
  execFileSync('tar',['-xf','-','-C',dir],{input:archive});
  const load=name=>import(pathToFileURL(join(dir,`src/game/${name}.js`)).href);
  oldSave=await load('save-data');oldStorage=await load('save-storage');
  const {createGameplay:oldGame}=await load('gameplay'),game=oldGame({now:()=>1000});
  game.collection.register({schemaVersion:1,id:'historical-iwana',speciesId:'iwana',lengthCm:15,weightKg:.04,caughtAt:at,qteSuccessCount:0});
  assert.equal(game.collection.sellUnassigned('historical-iwana').total,6);
  game.collection.register({schemaVersion:1,id:'unsold-brown',speciesId:'brown-trout',lengthCm:20,weightKg:.11,caughtAt:at,qteSuccessCount:2});
  game.collection.store('unsold-brown');
  sourceV2=oldSave.createSaveData(game,{savedAt:at});
});
after(async()=>{if(dir)await rm(dir,{recursive:true,force:true});});
function memory(raw=[]){
  const map=new Map(KEYS.flatMap((key,i)=>raw[i]==null?[]:[[key,raw[i]]])),writes=[];
  return {map,writes,getItem:key=>map.get(key)??null,setItem(key,value){writes.push(key);map.set(key,value);},
    removeItem(){throw Error('No deletion');},clear(){throw Error('No reset');}};
}

test('real V2 validates before migrating; unsold price follows the new floor, sold price/dates/wallet/awards never change',()=>{
  assert.equal(oldSave.SAVE_VERSION,2);assert.deepEqual(validateSaveData(sourceV2),sourceV2);
  const original=JSON.stringify(sourceV2),state=restoreSaveData(sourceV2,{now:()=>{throw Error('No invented award date');}});
  assert.deepEqual(state.collection.catches,sourceV2.collection.catches);
  assert.deepEqual(state.collection.wallet,{balance:6,lifetimeSales:6});
  assert.deepEqual(state.achievements.snapshot.unlocked,sourceV2.achievements.unlocked);
  assert.equal(calculateSalePrice(state.collection.stored[0]),60); // max(50, round(.11*140))*1.20
  assert.equal(state.collection.catches[0].salePrice,6);
  const data=save(state);assert.equal(data.saveVersion,3);assert.equal(data.rosterRevision,1);assert.equal(data.achievements.contractVersion,3);
  assert.equal(serializeSaveData(parseSaveData(serializeSaveData(data))),serializeSaveData(data));
  assert.deepEqual(save(restoreSaveData(data)),data);assert.equal(JSON.stringify(sourceV2),original);
});

test('every V3 species persists with strict original-twelve achievements and roundtrips without changing prices or dates',()=>{
  const game=createGameplay({now:()=>1000});
  for(const fish of FISH_SPECIES){game.collection.register({schemaVersion:1,id:fish.id,speciesId:fish.id,lengthCm:fish.minLengthCm,
    weightKg:calculateFishWeightKg(fish.id,fish.minLengthCm),qteSuccessCount:3,caughtAt:at});game.collection.store(fish.id);}
  const data=save(game);assert.equal(data.collection.catches.length,20);
  assert.deepEqual(save(restoreSaveData(data,{now:()=>{throw Error('No new award');}})),data);
  for(const version of [1,2]){
    const relabelled=structuredClone(data);relabelled.saveVersion=version;delete relabelled.rosterRevision;relabelled.achievements.contractVersion=2;
    if(version===1)for(const row of relabelled.collection.catches)delete row.qteSuccessCount;
    assert.throws(()=>validateSaveData(relabelled),e=>e.path==='collection.catches[12].speciesId');
  }
});

test('first V3 commit preserves the chosen V1/V2 original; quota and external-change failures preserve both slots',()=>{
  const sourceV1=structuredClone(sourceV2);sourceV1.saveVersion=1;for(const row of sourceV1.collection.catches)delete row.qteSuccessCount;
  for(const source of [sourceV1,sourceV2])for(const active of [0,1]){
    const raw=active===0?[envelope(9,source),envelope(8,source)]:[envelope(8,source),envelope(9,source)];
    const storage=memory(raw),manager=createSaveStorage({getStorage:()=>storage}),loaded=manager.load();
    assert.deepEqual(storage.writes,[]);assert.ok(loaded.state);assert.equal(loaded.status.canSave,true);
    const write=storage.setItem;storage.setItem=()=>{throw Object.assign(Error('full'),{name:'QuotaExceededError'});};
    assert.equal(manager.save(save(loaded.state)).ok,false);assert.deepEqual(KEYS.map(storage.getItem),raw);assert.equal(manager.status.generation,9);
    storage.setItem=write;assert.equal(manager.save(save(loaded.state)).ok,true);
    assert.deepEqual(storage.writes,[KEYS[1-active]]);assert.equal(storage.getItem(KEYS[active]),raw[active]);
    assert.equal(JSON.parse(storage.getItem(KEYS[1-active])).data.saveVersion,3);
    const other=createSaveStorage({getStorage:()=>storage});other.load();
    storage.map.set(KEYS[active],raw[active]+' ');const before=[...storage.map];
    assert.equal(other.checkForExternalChanges(),true);assert.equal(other.save(save(loaded.state)).ok,false);assert.deepEqual([...storage.map],before);
  }
});

test('actual pre-V3 build protects V3 in either slot, even with an older readable backup',()=>{
  const v3=save(restoreSaveData(sourceV2));
  for(const raw of [[envelope(1,sourceV2),envelope(2,v3)],[envelope(2,v3),envelope(1,sourceV2)],[envelope(2,v3),null]]){
    const storage=memory(raw),manager=oldStorage.createSaveStorage({getStorage:()=>storage}),loaded=manager.load(),before=[...storage.map];
    assert.equal(loaded.status.code,'unsupported-version');assert.equal(loaded.status.canSave,false);
    assert.equal(manager.save(sourceV2).ok,false);assert.deepEqual([...storage.map],before);assert.deepEqual(storage.writes,[]);
    assert.throws(()=>oldSave.parseSaveData(serializeSaveData(v3)),e=>e.code==='unsupported-version');
  }
});

test('future V3 roster revisions, achievement contracts and envelope versions protect backups before unknown fields are traversed',()=>{
  const v3=save(restoreSaveData(sourceV2));
  for(const mutate of [d=>{d.rosterRevision=2;d.future=[];},d=>{d.rosterRevision=3;d.collection.catches[0].speciesId='future-fish';},
    d=>{d.achievements.contractVersion=4;d.achievements.future={};d.collection.future={};},d=>{d.saveVersion=4;d.future={};}])for(const active of [0,1]){
    const future=structuredClone(v3);mutate(future);const raw=[envelope(99,future),envelope(99,future)];raw[active]=envelope(1,sourceV2);
    const storage=memory(raw),manager=createSaveStorage({getStorage:()=>storage}),loaded=manager.load();
    assert.equal(loaded.status.code,'unsupported-version');assert.equal(loaded.status.canSave,false);assert.ok(loaded.state);
    const before=[...storage.map];assert.equal(manager.save(save(loaded.state)).ok,false);assert.deepEqual([...storage.map],before);assert.deepEqual(storage.writes,[]);
  }
  for(const value of [0,-1,1.5,'1',null,undefined]){
    const bad=structuredClone(v3);bad.rosterRevision=value;
    assert.throws(()=>validateSaveData(bad),e=>e.code==='invalid-data'&&e.path==='rosterRevision');
  }
  const getter=structuredClone(v3);let reads=0;Object.defineProperty(getter,'rosterRevision',{get(){reads++;throw Error('Must not read');}});
  assert.throws(()=>validateSaveData(getter));assert.equal(reads,0);
});
