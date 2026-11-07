import test from 'node:test';
import assert from 'node:assert/strict';
import { mobileFishingRandomValue } from '../scripts/lib/mobile-capture-rng.js';
import { createFishing } from '../src/game/fishing.js';
import { readMobileFightSource } from '../scripts/lib/mobile-fight-replay.js';
import { compareMobileCapturePair } from '../scripts/compare-mobile-performance.mjs';
import { mobileGateFixture } from './helpers/mobile-gate-fixture.js';

test('only the two documented capture RNG inputs are accepted, including legacy evidence default',()=>{
  assert.equal(mobileFishingRandomValue({metrics:{}}),.5);
  assert.equal(mobileFishingRandomValue({metrics:{fishingRandomValue:.01}}),.01);
  for(const value of [undefined,null,0,1,.1,'0.01',NaN,Infinity])assert.throws(()=>mobileFishingRandomValue({metrics:{fishingRandomValue:value}}));
});

test('actual base and current fishing sources reproduce the same black-bass fight with the 6-A capture input',async()=>{
  const base=await readMobileFightSource('4a9255054565310f857e74dc52f77c0b885c762b');
  function play(factory){
    let calls=0;const fishing=factory({random:()=>{calls++;return .01;},now:()=>1000,getEnvironment:()=>({depthM:12,timeOfDay:'day'})});
    fishing.prepare({x:10,z:20},0);fishing.aim(0,150);fishing.cast();
    for(let n=0;n<480&&fishing.state.phase!=='bite';n++)fishing.step(.25);
    assert.equal(fishing.state.encounter.speciesId,'black-bass');assert.equal(calls,3);fishing.hook();
    const history=[];for(let n=0;n<5;n++){fishing.reel(n<2);fishing.step(.25);history.push(structuredClone(fishing.state));}
    return history;
  }
  assert.deepEqual(play(createFishing),play(base.createFishing));
});

test('the shared comparison path used by capture and ci-required rejects mismatched RNG inputs',async()=>{
  const {before,after,metadata}=await mobileGateFixture();
  const a=structuredClone(before.find(row=>row.id==='pc-day-tps'));
  const b=structuredClone(after.find(row=>row.id===a.id));
  a.metrics.fishingRandomValue=.01;b.metrics.fishingRandomValue=.5;
  assert.throws(()=>compareMobileCapturePair(a,b,metadata),/fishingRandomValue differs/);
});
