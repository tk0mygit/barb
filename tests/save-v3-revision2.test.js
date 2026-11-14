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
import { NORMAL_ACHIEVEMENTS } from '../src/game/achievements.js';

const at='2026-11-07T00:00:00.000Z',migrationTime=Date.parse('2026-11-08T00:00:00.000Z');
const save=game=>createSaveData(game,{savedAt:at});
const envelope=(generation,data)=>JSON.stringify({storageVersion:1,generation,data});
let dir,oldSave,oldStorage,sourceRevision1;
before(async()=>{
  dir=await mkdtemp(join(tmpdir(),'barb-save-revision1-'));
  const archive=execFileSync('git',['archive','--format=tar','4edd6c191ff9fd7d4cc8e93908d781106b72071a','src/game','src/world','package.json']);
  execFileSync('tar',['-xf','-','-C',dir],{input:archive});
  const load=name=>import(pathToFileURL(join(dir,`src/game/${name}.js`)).href);
  oldSave=await load('save-data');oldStorage=await load('save-storage');
  const {createGameplay:oldGame}=await load('gameplay'),{FISH_SPECIES:oldFish,calculateFishWeightKg:weight}=await load('fish-species');
  const game=oldGame({now:()=>1000});
  for(const [i,fish] of oldFish.entries()){
    const id=`revision1-${fish.id}`,lengthCm=fish.maxLengthCm;
    game.collection.register({schemaVersion:1,id,speciesId:fish.id,lengthCm,weightKg:weight(fish.id,lengthCm),qteSuccessCount:i%4,caughtAt:at,
      conditions:{lureId:'minnow',depthM:5,depthBand:'mid',timeOfDay:'day',cycleProgress:.1,lurePosition:{x:0,z:40}}});
    if(i%2)game.collection.store(id);else game.collection.sellUnassigned(id);
  }
  assert.ok(game.collection.purchaseUpgrade('rod',1));assert.ok(game.collection.purchaseUpgrade('reel',1));
  game.boat.x=10;game.boat.z=20;game.boat.heading=1;game.clock.step(190);
  sourceRevision1=oldSave.createSaveData(game,{savedAt:at});
});
after(async()=>{if(dir)await rm(dir,{recursive:true,force:true});});

function memory(raw=[]){
  const map=new Map(KEYS.flatMap((key,i)=>raw[i]==null?[]:[[key,raw[i]]])),writes=[];
  return {map,writes,getItem:key=>map.get(key)??null,setItem(key,value){writes.push(key);map.set(key,value);},
    removeItem(){throw Error('No deletion');},clear(){throw Error('No reset');}};
}
function currentSave(){
  const game=createGameplay({now:()=>migrationTime});
  for(const [i,fish] of FISH_SPECIES.entries()){
    game.collection.register({schemaVersion:1,id:fish.id,speciesId:fish.id,lengthCm:fish.minLengthCm,
      weightKg:calculateFishWeightKg(fish.id,fish.minLengthCm),qteSuccessCount:i%4,caughtAt:at});game.collection.store(fish.id);
  }
  return save(game);
}

test('actual revision1 source validates/parses as revision1, then explicitly migrates to revision3 without changing any player data',()=>{
  assert.equal(oldSave.SAVE_ROSTER_REVISION,1);assert.equal(sourceRevision1.achievements.contractVersion,3);
  assert.deepEqual(validateSaveData(sourceRevision1),sourceRevision1);assert.deepEqual(parseSaveData(JSON.stringify(sourceRevision1)),sourceRevision1);
  const sourceJSON=JSON.stringify(sourceRevision1),expected={...sourceRevision1,rosterRevision:3,
    achievements:{...sourceRevision1.achievements,contractVersion:6}};
  const state=restoreSaveData(sourceRevision1,{now:()=>{throw Error('No invented timestamps');}});
  assert.deepEqual(save(state),expected);assert.equal(state.achievements.entries.find(row=>row.id==='normal-species-24').progress.value,20);
  assert.equal(state.achievements.entries.find(row=>row.id==='normal-species-24').unlocked,false);
  const migrated=parseSaveData(serializeSaveData(sourceRevision1,{now:()=>migrationTime}));
  assert.deepEqual(migrated,expected);assert.equal(JSON.stringify(sourceRevision1),sourceJSON);
  assert.deepEqual(save(restoreSaveData(migrated,{now:()=>{throw Error('Idempotent');}})),migrated);
  assert.equal(serializeSaveData(migrated),serializeSaveData(parseSaveData(serializeSaveData(migrated))));
  assert.deepEqual(NORMAL_ACHIEVEMENTS.slice(0,15).map(row=>row.id),state.achievements.entries.slice(0,15).map(row=>row.id));
});

test('new 24-species award uses the fourth new distinct capture time after migration and preserves all prior unlock dates',()=>{
  let time=migrationTime;const game=restoreSaveData(sourceRevision1,{now:()=>time}),previous=game.achievements.snapshot.unlocked;
  for(const fish of FISH_SPECIES.slice(20,23))game.collection.register({schemaVersion:1,id:fish.id,speciesId:fish.id,lengthCm:fish.minLengthCm,
    weightKg:calculateFishWeightKg(fish.id,fish.minLengthCm),qteSuccessCount:0,caughtAt:at});
  const award=()=>game.achievements.entries.find(row=>row.id==='normal-species-24');assert.equal(award().unlocked,false);
  time+=12345;const fish=FISH_SPECIES[23];game.collection.register({schemaVersion:1,id:fish.id,speciesId:fish.id,lengthCm:fish.minLengthCm,
    weightKg:calculateFishWeightKg(fish.id,fish.minLengthCm),qteSuccessCount:3,caughtAt:at});
  assert.equal(award().unlockedAt,new Date(time).toISOString());
  for(const old of previous)assert.deepEqual(game.achievements.snapshot.unlocked.find(row=>row.id===old.id),old);
});

test('V1/V2 reject all later fish; revision1 rejects every later species ID before any migration',()=>{
  for(const version of [1,2,3])for(const fish of FISH_SPECIES.slice(version===3?20:12)){
    const bad=structuredClone(sourceRevision1);bad.saveVersion=version;
    if(version!==3){delete bad.rosterRevision;bad.achievements.contractVersion=2;bad.collection.catches=bad.collection.catches.slice(0,1);}
    bad.collection.catches[0].speciesId=fish.id;
    if(version===1)for(const record of bad.collection.catches)delete record.qteSuccessCount;
    for(const invoke of [d=>validateSaveData(d),d=>parseSaveData(JSON.stringify(d)),d=>serializeSaveData(d),d=>restoreSaveData(d)])
      assert.throws(()=>invoke(bad),e=>e.code==='invalid-data'&&e.path==='collection.catches[0].speciesId',`${version}/${fish.id}`);
  }
  const bad=structuredClone(sourceRevision1);bad.achievements.unlocked.push({id:'normal-species-24',unlockedAt:at});
  assert.throws(()=>validateSaveData(bad),e=>e.code==='invalid-data');
  for(const revision of [1,3]){
    const bad=structuredClone(revision===1?sourceRevision1:currentSave());bad.achievements.contractVersion=revision===1?4:3;
    assert.throws(()=>validateSaveData(bad),e=>e.code==='invalid-data'&&e.path==='achievements.contractVersion');
  }
});

test('revision1 load writes zero; next revision3 commit changes only the inactive slot and quota/conflict preserve both raw originals',()=>{
  for(const active of [0,1])for(const other of [null,'{broken',envelope(8,sourceRevision1)]){
    const raw=[other,other];raw[active]=envelope(9,sourceRevision1);
    const storage=memory(raw),manager=createSaveStorage({getStorage:()=>storage}),loaded=manager.load();
    assert.ok(loaded.state);assert.equal(loaded.status.canSave,true);assert.deepEqual(storage.writes,[]);
    const write=storage.setItem;storage.setItem=()=>{throw Object.assign(Error('full'),{name:'QuotaExceededError'});};
    assert.equal(manager.save(save(loaded.state)).ok,false);assert.equal(manager.status.code,'quota-exceeded');
    assert.deepEqual(KEYS.map(storage.getItem),raw);assert.equal(manager.status.generation,9);
    storage.setItem=write;assert.equal(manager.save(save(loaded.state)).ok,true);assert.deepEqual(storage.writes,[KEYS[1-active]]);
    assert.equal(storage.getItem(KEYS[active]),raw[active]);
    const committed=JSON.parse(storage.getItem(KEYS[1-active]));assert.equal(committed.storageVersion,1);assert.equal(committed.generation,10);
    assert.deepEqual([committed.data.saveVersion,committed.data.rosterRevision,committed.data.achievements.contractVersion],[3,3,6]);
    const stale=createSaveStorage({getStorage:()=>storage});stale.load();storage.map.set(KEYS[active],raw[active]+' ');const before=[...storage.map];
    assert.equal(stale.checkForExternalChanges(),true);assert.equal(stale.save(save(loaded.state)).ok,false);assert.deepEqual([...storage.map],before);
  }
});

test('all supported source pairings choose by generation; duplicate generations and constructor failure retain data',()=>{
  const current=currentSave();
  for(const sources of [[sourceRevision1,current],[current,sourceRevision1],[current,current],[sourceRevision1,sourceRevision1]]){
    const raw=sources.map((data,i)=>envelope(i+1,data)),storage=memory(raw),manager=createSaveStorage({getStorage:()=>storage}),loaded=manager.load();
    assert.ok(loaded.state);assert.equal(loaded.status.generation,2);assert.equal(loaded.status.canSave,true);assert.deepEqual(storage.writes,[]);
    for(const constructor of [undefined,()=>{throw Error('constructor');}]){
      const other=memory(sources.map(data=>envelope(7,data))),blocked=createSaveStorage({getStorage:()=>other,gameplayFactory:constructor});
      assert.equal(blocked.load().status.code,'duplicate-generation');assert.equal(blocked.save(current).ok,false);assert.deepEqual(other.writes,[]);
    }
    const failed=createSaveStorage({getStorage:()=>storage,gameplayFactory:()=>{throw Error('constructor');}});
    assert.equal(failed.load().status.code,'restore-failed');assert.equal(failed.save(current).ok,false);assert.deepEqual(KEYS.map(storage.getItem),raw);
  }
});

test('future revision4+, contract7+ and saveVersion4 protect all writers with valid, missing or corrupt companions',()=>{
  const current=currentSave();
  for(const mutate of [d=>{d.rosterRevision=4;d.future={};},d=>{d.rosterRevision=99;d.future=[];},
    d=>{d.achievements.contractVersion=7;d.achievements.future=[];d.collection.future={};},
    d=>{d.achievements.contractVersion=99;d.future={};},d=>{d.saveVersion=4;d.future={};}])
    for(const active of [0,1])for(const other of [envelope(1,sourceRevision1),envelope(1,current),null,'{broken']){
      const future=structuredClone(current);mutate(future);const raw=[other,other];raw[active]=envelope(99,future);
      const storage=memory(raw),manager=createSaveStorage({getStorage:()=>storage}),loaded=manager.load();
      assert.equal(loaded.status.code,'unsupported-version');assert.equal(loaded.status.canSave,false);
      assert.equal(manager.save(current).ok,false);assert.deepEqual(KEYS.map(storage.getItem),raw);assert.deepEqual(storage.writes,[]);
    }
});

test('actual revision1 client, stale tab, cache and rollback cannot overwrite revision3 with a readable revision1 backup',()=>{
  const current=save(restoreSaveData(sourceRevision1));
  for(const active of [0,1]){
    const raw=[envelope(1,sourceRevision1),envelope(1,sourceRevision1)];raw[active]=envelope(2,current);
    const storage=memory(raw),oldManager=oldStorage.createSaveStorage({getStorage:()=>storage}),loaded=oldManager.load();
    assert.equal(loaded.status.code,'unsupported-version');assert.equal(loaded.status.canSave,false);assert.ok(loaded.state);
    assert.equal(oldManager.save(sourceRevision1).ok,false);assert.deepEqual(storage.writes,[]);assert.deepEqual(KEYS.map(storage.getItem),raw);
    assert.throws(()=>oldSave.parseSaveData(JSON.stringify(current)),e=>e.code==='unsupported-version'&&e.path==='rosterRevision');
    const oldStorageLive=memory([envelope(1,sourceRevision1)]),tab=oldStorage.createSaveStorage({getStorage:()=>oldStorageLive});tab.load();
    oldStorageLive.map.set(KEYS[1],envelope(2,current));const checkpoint=[...oldStorageLive.map];
    assert.equal(tab.save(sourceRevision1).ok,false);assert.equal(tab.status.code,'external-change');assert.deepEqual([...oldStorageLive.map],checkpoint);
  }
});
