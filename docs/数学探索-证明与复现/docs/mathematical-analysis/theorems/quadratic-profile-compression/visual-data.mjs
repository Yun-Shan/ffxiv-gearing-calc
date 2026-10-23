import {writeFileSync} from 'node:fs';
import {loadGameData,loadCanonicalEvaluator} from '../../verification/canonical-model.mjs';
import {parameters,solve,crtKeys,critical,continuousUpper,value} from './profile.mjs';
const data=await loadGameData();const effects=await loadCanonicalEvaluator();const {prepareSearch}=await import('../../../../src/domain/optimizer/search-preparation.ts');const ctx=await import('../../../../src/domain/optimizer/context.ts');
let seed=20261023;const rand=n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n;};
const identity=c=>c.itemId+':'+c.variantKey;
const prepare=(job,min,max,sync)=>prepareSearch({jobId:job,minItemLevel:min,maxItemLevel:max,...(sync?{syncLevel:sync}:{}),objective:'damage',excludedSources:[],forcedGear:{},foodId:0},{});
function evaluate(p,choices,food){const v=Array(ctx.attributeIds.length).fill(0);for(const c of choices)for(const b of c.baseParams)v[b.baseParamId]+=b.value;for(const b of food.baseParams)v[b.baseParamId]+=Math.min(b.maxValue,Math.trunc((v[b.baseParamId]+b.baseValue)*(b.multiplier-1)+1e-7));const f=effects.createIntegerDamageFactorEvaluator(p.jobId,p.jobLevel,ctx.attributeIndex)(v);let prod=1n;for(const k of ['weaponDamage','mainStat','determination','tenacity','critical','directHit'])prod*=BigInt(f[k]);const sub=BigInt(f.determination)*BigInt(f.critical)*BigInt(f.directHit);return {v:[v[ctx.attributeIndex.get('CRT')],v[ctx.attributeIndex.get('DHT')],v[ctx.attributeIndex.get('DET')],f.weaponDamage,f.mainStat,f.tenacity,f.gcdCentiseconds],product:String(prod),sub:String(sub),items:choices.map(c=>[c.itemId,c.variantKey]),food:food.itemId};}
function ringOK(choices){const r=choices.filter(c=>c.ringSlotIndex!==undefined);return r.length!==2||r[0].itemId!==r[1].itemId||!r.some(c=>c.isUnique);}
const single=[];
for(const [label,job,min,max,sync] of [['BLM 770–780','BLM',770,780],['BLM 735–780','BLM',735,780],['WAR 770–780','WAR',770,780],['WHM 同步 320','WHM',290,320,320]]){
 const p=prepare(job,min,max,sync),pools=p.slots.map(s=>s.candidates.filter(c=>!c.resistanceWeaponAdjust)),samples=[];
 for(let i=0;i<1600;i++){const c=pools.map(a=>a[rand(a.length)]);if(!ringOK(c))continue;samples.push(evaluate(p,c,p.foods[rand(p.foods.length)]));}
 // Find a strict rank reversal, retaining the full witness. No optimization claim.
 const sorted=[...samples].sort((a,b)=>BigInt(a.sub)<BigInt(b.sub)?-1:1);let highest=sorted[0],witness=null;
 for(const x of sorted){if(BigInt(x.sub)>BigInt(highest.sub)&&BigInt(x.product)<BigInt(highest.product)){witness={higherSub:x,higherFull:highest};break;}if(BigInt(x.product)>BigInt(highest.product))highest=x;}
 single.push({label,job,level:p.jobLevel,samples,witness});
}
const joint=[];
for(const jobs of [['BLM','RDM'],['WAR','PLD']]){
 const ps=jobs.map(j=>prepare(j,770,780));const shared=ps[0].slots.filter(s=>!['weapon','offHand','shield'].includes(s.name));
 const maps=ps.map(p=>new Map(p.slots.map(s=>[s.name,new Map(s.candidates.filter(c=>!c.resistanceWeaponAdjust).map(c=>[identity(c),c]))])));
 const sharedPools=shared.map(s=>({name:s.name,keys:[...maps[0].get(s.name).keys()].filter(k=>maps.every(m=>m.get(s.name)?.has(k)))}));
 if(sharedPools.some(s=>!s.keys.length))throw new Error('No common candidate');
 const foodMaps=ps.map(p=>new Map(p.foods.map(f=>[f.physicalKey,f]))),foods=[...foodMaps[0].keys()].filter(k=>foodMaps.every(m=>m.has(k)));const samples=[];
 for(let i=0;i<1600;i++){const chosen=new Map(sharedPools.map(s=>[s.name,s.keys[rand(s.keys.length)]]));const food=foods[rand(foods.length)];const vectors=[];let valid=true;
 for(let j=0;j<ps.length;j++){const p=ps[j],cs=p.slots.map(s=>chosen.has(s.name)?maps[j].get(s.name).get(chosen.get(s.name)):s.candidates[rand(s.candidates.length)]);if(!ringOK(cs)){valid=false;break;}vectors.push(evaluate(p,cs,foodMaps[j].get(food)));}if(valid)samples.push(vectors);}
 joint.push({jobs,samples});
}
// Continuous vs exact projected profile for a selected real-pool relaxation.
const results=JSON.parse((await import('node:fs')).readFileSync(new URL('./results.json',import.meta.url)));const projections=[];
for(const label of ['L50-WAR','770-780-BLM','770-780-WAR','broad-sync80-BLU']){const r=results.rows.find(x=>x.label===label),p=parameters(r.level,label.includes('BLU')),arr=[];for(const c of crtKeys(p,Math.min(r.cCap,r.R))){const S=Math.min(r.R-c,r.hCap+r.dCap),lo=Math.max(0,S-r.dCap),hi=Math.min(S,r.hCap),z=solve(p,0,0,S,lo,hi,'keys'),u=continuousUpper(p,0,0,S,lo,hi),cf=critical(p,c,label.includes('BLU'));arr.push([c,Number(cf*z.best),Number(u.n*cf)/Number(u.d),z.arg,S-z.arg]);}projections.push({label,arr,best:r.profiles.screen.best});}
const output={single,joint,projections,scope:'Sampled complete legal equipment identities, unique rings and shared physical food/gear respected; custom allocation weapons excluded. No fixed GCD target. Sampling is not global optimization. Joint plot normalizes by best value within this same sample only, NOT the production independent optimum.'};writeFileSync(new URL('./visual-data.json',import.meta.url),JSON.stringify(output));console.log(JSON.stringify({single:single.map(s=>[s.label,s.samples.length,!!s.witness]),joint:joint.map(s=>[s.jobs,s.samples.length])}));
