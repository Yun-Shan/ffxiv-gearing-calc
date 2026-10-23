import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
import {parameters,value,solve,coefficients,polynomial,band,residues,period,vertex,solve3,critical} from './profile.mjs';
import {loadGameData,loadCanonicalEvaluator} from '../../verification/canonical-model.mjs';
let seed=20261023;const rand=n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n;};
let cases=0,points=0;
for(const level of [50,60,70,80,90,100])for(const blu of [false,...(level<=80?[true]:[])]){
 const p=parameters(level,blu);
 for(let i=0;i<160;i++){
  const h=rand(5000),d=rand(5000),S=rand(800),lo=rand(S+1),hi=lo+rand(S-lo+1);
  const raw=solve(p,h,d,S,lo,hi,'raw');
  for(const method of ['keys','hybrid','residue'])assert.equal(solve(p,h,d,S,lo,hi,method).best,raw.best);
  const q=coefficients(p,h,d,S);
  for(let x=lo;x<=hi;x++){assert(polynomial(q,x)>=value(p,h+x,d+S-x)*q.den);points++;}
  // Exact threshold boundary and tie-safe survival checks.
  for(const L of [raw.best-1n,raw.best,raw.best+1n]){const b=band(p,h,d,S,lo,hi,L);for(let x=lo;x<=hi;x++)if(value(p,h+x,d+S-x)>=L)assert(b&&x>=b[0]&&x<=b[1]);}
  cases++;
 }
}
const data=await loadGameData();const canonical=await loadCanonicalEvaluator();
const prep=await import('../../../../src/domain/optimizer/search-preparation.ts');
const ctx=await import('../../../../src/domain/optimizer/context.ts');
const H=ctx.attributeIndex.get('DHT'),D=ctx.attributeIndex.get('DET'),C=ctx.attributeIndex.get('CRT');
const rows=[];
const configs=[];
for(const level of [50,60,70,80,90,100])for(const job of ['WAR','WHM','DRG','BLM']){
 const cap=level===100?data.gearMaxLevel:data.syncLevelOfJobLevels[level];
 configs.push({label:`L${level}-${job}`,jobId:job,minItemLevel:Math.max(1,cap-20),maxItemLevel:cap,...(level===100?{}:{syncLevel:cap})});
}
for(const job of ['PLD','WAR','DRK','GNB','WHM','SCH','AST','SGE','BLM','RDM','SMN','PCT'])configs.push({label:`770-780-${job}`,jobId:job,minItemLevel:770,maxItemLevel:780});
for(const job of ['WHM','BLM','BLU'])configs.push({label:`broad-sync80-${job}`,jobId:job,minItemLevel:1,maxItemLevel:data.gearMaxLevel,syncLevel:data.syncLevelOfJobLevels[80]});
function val(c,id){return (c.baseParams.find(p=>p.baseParamId===id)?.value??0);}
for(const cfg of configs){
 const prepared=prep.prepareSearch({...cfg,objective:'damage',excludedSources:[],forcedGear:{},foodId:0},{});
 let S=0,hCap=0,dCap=0,n=0,R=0,cCap=0;
 for(const slot of prepared.slots){let hs=0,ds=0,sum=0,cs=0,sum3=0;for(const c of slot.candidates){n++;let h=val(c,H),d=val(c,D);const r=c.resistanceWeaponAdjust;
 if(r){const mh=r.stats.includes('DHT')?(r.statMaximums?.DHT??r.maxEachStat):0,md=r.stats.includes('DET')?(r.statMaximums?.DET??r.maxEachStat):0;sum=Math.max(sum,h+d+Math.min(r.maxTotalStats,mh+md));h+=Math.min(r.maxTotalStats,mh);d+=Math.min(r.maxTotalStats,md);}else sum=Math.max(sum,h+d);
 const cval=val(c,C)+(r&&r.stats.includes('CRT')?Math.min(r.maxTotalStats,r.statMaximums?.CRT??r.maxEachStat):0);cs=Math.max(cs,cval);sum3=Math.max(sum3,h+d+cval);hs=Math.max(hs,h);ds=Math.max(ds,d);}
 S+=sum;hCap+=hs;dCap+=ds;R+=sum3;cCap+=cs;}
 // Food cap sum is deliberately optimistic; never claim the maximizers coexist.
 let hf=0,df=0,sf=0,cf=0,s3f=0;for(const f of prepared.foods){let hh=0,dd=0,cc=0;for(const p of f.baseParams){if(p.baseParamId===H)hh+=p.maxValue;if(p.baseParamId===D)dd+=p.maxValue;if(p.baseParamId===C)cc+=p.maxValue;}hf=Math.max(hf,hh);df=Math.max(df,dd);sf=Math.max(sf,hh+dd);cf=Math.max(cf,cc);s3f=Math.max(s3f,hh+dd+cc);}
 // Resolve actual food field below by assertion rather than silently omitting it.
 if(prepared.foods.some(f=>!Array.isArray(f.baseParams)))throw new Error('Unknown food fields '+JSON.stringify(prepared.foods[0]));
 S+=sf;hCap+=hf;dCap+=df;R+=s3f;cCap+=cf;
 const p=parameters(prepared.jobLevel,cfg.jobId==='BLU');const lo=Math.max(0,S-dCap),hi=Math.min(hCap,S);
 assert(lo<=hi);
 const times={},results={};for(const m of ['raw','keys','hybrid','residue']){let start=performance.now();let result;for(let i=0;i<5;i++)result=solve(p,0,0,S,lo,hi,m);times[m]=(performance.now()-start)/5;results[m]=result;}
 for(const m of ['keys','hybrid','residue'])assert.equal(results[m].best,results.raw.best);
 const idx=new Map([['DHT',0],['DET',1]]);const ev=canonical.createIntegerDamageFactorEvaluator(cfg.jobId,prepared.jobLevel,idx);
 for(const x of [lo,hi,results.hybrid.arg]){const f=ev([x,S-x]);assert.equal(BigInt(f.directHit)*BigInt(f.determination),value(p,x,S-x));}
 const profiles={};for(const screen of [false,true]){const start=performance.now();const z=solve3(p,R,cCap,hCap,dCap,cfg.jobId==='BLU',screen);profiles[screen?'screen':'base']={...z,best:String(z.best),ms:performance.now()-start};}assert.equal(profiles.base.best,profiles.screen.best);
 rows.push({R,cCap,profiles,label:cfg.label,level:prepared.jobLevel,candidates:n,S,hCap,dCap,lo,hi,period:period(p),raw:results.raw.count,keys:results.keys.count,hybrid:results.hybrid.count,residue:results.residue.count,band:results.hybrid.width,times});
}
// Joint common-transfer slices. Positive integer weights suffice after multiplying
// a rational normalized sum by a common positive denominator. These are algebraic
// fixtures, NOT measured independent job optima or actual shared-loadout searches.
let jointCases=0,jointPoints=0;
for(const level of [50,60,70,80,90,100])for(const jobs of [2,4])for(let trial=0;trial<30;trial++){
 const p=parameters(level),S=rand(2500), terms=Array.from({length:jobs},()=>({h:rand(2500),d:rand(2500),w:BigInt(1+rand(1000000))}));
 const score=x=>terms.reduce((s,t)=>s+t.w*value(p,t.h+x,t.d+S-x),0n);
 const P=period(p);let exact=-1n;for(let x=0;x<=S;x++){const f=score(x);if(f>exact)exact=f;jointPoints++;}
 let best=-1n;for(let r=0;r<=Math.min(S,P-1);r++){
  const a=BigInt(550*P/p.div),e=BigInt(140*P/p.det);let A=0n,B=0n,C=0n;
  for(const t of terms){const H=BigInt(p.offset+Math.floor(550*(t.h+r)/p.div)),D=BigInt(p.detTrunc*Math.floor((140*(t.d+S-r)+1000*p.det)/(p.det*p.detTrunc)));A+=t.w*a*e;B+=t.w*(a*D-e*H);C+=t.w*H*D;}
  for(const k of vertex({a:A,b:B,c:C},0,Math.floor((S-r)/P))){const f=score(r+k*P);if(f>best)best=f;}
 }
 assert.equal(best,exact);jointCases++;
}
const report={commit:'358a639e8d827dad7973fcb81a55d451c05ff438',cases,points,jointCases,jointPoints,rows,scope:'Formula-relaxation query benchmark from current candidate pools, not production search or feasible-loadout performance. Random joint weights are algebra fixtures, not independent-optimum baselines.'};
writeFileSync(new URL('./results.json',import.meta.url),JSON.stringify(report,null,2));
console.log(JSON.stringify({cases,points,jointCases,jointPoints,rows:rows.length,periods:[50,60,70,80,90,100].map(l=>[l,period(parameters(l))])}));
console.table(rows.map(r=>({case:r.label,raw:r.raw,keys:r.keys,hybrid:r.hybrid,band:r.band,msKeys:r.times.keys.toFixed(3),msHybrid:r.times.hybrid.toFixed(3)})));

console.table(rows.map(r=>({case:r.label,C:r.profiles.base.hdCalls,kept:r.profiles.screen.hdCalls,baseE:r.profiles.base.evals,newE:r.profiles.screen.evals,baseMs:r.profiles.base.ms.toFixed(3),newMs:r.profiles.screen.ms.toFixed(3)})));
