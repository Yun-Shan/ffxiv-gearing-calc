import assert from 'node:assert/strict';import {readFileSync,writeFileSync} from 'node:fs';import {performance} from 'node:perf_hooks';
import {loadGameData,loadCanonicalEvaluator} from '../../verification/canonical-model.mjs';import {R,add,mul,sub,cmp,ceil,productPlane,combinePlane,supportInInterval,prepareSupport} from './support.mjs';
const data=await loadGameData(),effects=await loadCanonicalEvaluator(),{prepareSearch}=await import('../../../../src/domain/optimizer/search-preparation.ts'),ctx=await import('../../../../src/domain/optimizer/context.ts');
const baselines=JSON.parse(readFileSync(new URL('./production-baselines.json',import.meta.url)));
const source=JSON.parse(readFileSync(new URL('../quadratic-profile-compression/visual-data.json',import.meta.url))),C=ctx.attributeIndex.get('CRT'),out=[];
for(const [si,job,min,max,sync] of [[0,'BLM',770,780],[1,'BLM',735,780],[2,'WAR',770,780],[3,'WHM',290,320,320]]){
 const start=performance.now(),p=prepareSearch({jobId:job,minItemLevel:min,maxItemLevel:max,...(sync?{syncLevel:sync}:{}),objective:'damage',excludedSources:[],forcedGear:{},foodId:0},{}),ev=effects.createIntegerDamageFactorEvaluator(job,p.jobLevel,ctx.attributeIndex),schema=data.jobSchemas[job],level=data.jobLevelModifiers[p.jobLevel];
 const pools=p.slots.map(s=>s.candidates.map(c=>{if(c.resistanceWeaponAdjust)throw Error('variable custom weapon not supported by this measurement');const v=Array(ctx.attributeIds.length).fill(0);for(const b of c.baseParams)v[b.baseParamId]+=b.value;return v;}));
 const lo=Array(ctx.attributeIds.length).fill(0),hi=lo.slice();for(const pool of pools)for(let i=0;i<lo.length;i++){lo[i]+=Math.min(...pool.map(v=>v[i]));hi[i]+=Math.max(...pool.map(v=>v[i]));}
 const foodCaps=p.foods.map(f=>{const v=lo.map(()=>0);for(const b of f.baseParams)v[b.baseParamId]=b.maxValue;return v;});for(let i=0;i<hi.length;i++)hi[i]+=Math.max(...foodCaps.map(v=>v[i]));
 const attack=schema.mainStat==='VIT'?'STR':schema.mainStat,weapon=['INT','MND'].includes(schema.mainStat)?'MDMG':'PDMG',ap=schema.mainStat==='VIT'?level.apTank:level.ap,bonus=Math.round((schema.partyBonus??1.05)*100);assert(Math.abs(bonus/100-(schema.partyBonus??1.05))<1e-10);
 const basestat=Math.floor(level.main*(schema.statModifiers[attack]??100)/100)+(data.clanStats[attack]?.[0]??0);
 const factors=[{key:'weaponDamage',index:ctx.attributeIndex.get(weapon),a:R(1),b:R(Math.floor(level.main*schema.statModifiers[attack]/1000))},{key:'mainStat',index:ctx.attributeIndex.get(attack),a:R(ap*bonus,level.main*100),b:add(R(100-ap),R(ap*bonus*basestat,level.main*100))},{key:'determination',index:ctx.attributeIndex.get('DET'),a:R(140,level.det),b:R(1000)},{key:'tenacity',index:schema.stats.includes('TEN')?ctx.attributeIndex.get('TEN'):undefined,a:R(112,level.div),b:R(1000)},{key:'directHit',index:ctx.attributeIndex.get('DHT'),a:R(550,level.div),b:R(4000)}];
 const lowf=ev(lo),lower=factors.map(f=>BigInt(lowf[f.key])),upper=factors.map(f=>ceil(add(f.b,mul(f.a,R(f.index===undefined?0:hi[f.index])))));
 const samples=source.single[si].samples,sampleBest=samples.reduce((a,s)=>BigInt(s.product)>a?BigInt(s.product):a,0n),winner=samples.find(s=>BigInt(s.product)===sampleBest),baseline=baselines.find(b=>b.label===source.single[si].label&&b.status==='complete'),best=BigInt(baseline.product);assert(best>=sampleBest);
 // Reconstruct five reference factors from exact product and saved contributions.
 const refvec=lo.map(()=>0);refvec[C]=winner.v[0];refvec[ctx.attributeIndex.get('DHT')]=winner.v[1];refvec[ctx.attributeIndex.get('DET')]=winner.v[2];
 const ref=[BigInt(winner.v[3]),BigInt(winner.v[4]),BigInt(ev(refvec).determination),BigInt(winner.v[5]),BigInt(ev(refvec).directHit)];
 const order=factors.map((_,i)=>i).sort((a,b)=>{const da=upper[a]-lower[a],db=upper[b]-lower[b];if(!da)return 1;if(!db)return -1;return -cmp(R(ref[a]-lower[a],da),R(ref[b]-lower[b],db));});
 const permutations=xs=>xs.length?xs.flatMap((x,i)=>permutations(xs.filter((_,j)=>j!==i)).map(t=>[x,...t])):[[]];
 const active=factors.map((_,i)=>i).filter(i=>upper[i]>lower[i]),fixed=factors.map((_,i)=>i).filter(i=>upper[i]===lower[i]);
 const orders=permutations(active).map(o=>[...o,...fixed]);
 const tlo=Math.floor(200*lo[C]/level.div)+50,thi=Math.floor(200*hi[C]/level.div)+50,bins=[];
 for(let t=tlo;t<=thi;t++){const L=Math.max(lo[C],Math.ceil((t-50)*level.div/200)),U=Math.min(hi[C],Math.ceil((t+1-50)*level.div/200)-1);if(L<=U)bins.push({t,L,U});}
 let segments=0;
 for(const permutation of orders){const plane=productPlane(lower,upper,permutation),linear=combinePlane(plane,factors,lo.length);assert(linear.coef.every(a=>a>=0n));const score=v=>v.reduce((a,x,i)=>a+linear.coef[i]*BigInt(x),0n);
 const groups=pools.map(pool=>pool.map(v=>[v[C],score(v)]));groups.push(foodCaps.flatMap(v=>{const nonC=score(v)-linear.coef[C]*BigInt(v[C]);return [[0,nonC],[v[C],score(v)]];}));const support=prepareSupport(groups);segments+=support.segments;
 for(const bin of bins){const sup=support.query(bin.L,bin.U);if(!sup){bin.infeasible=true;continue;}const f=1000000n+BigInt(bin.t)*BigInt(bin.t+350),bound=mul(R(f,linear.den),add(R(linear.b),sup));assert(bound.n>0n);if(bin.n===undefined||cmp(bound,R(bin.n,bin.d))<0){Object.assign(bin,{n:String(bound.n),d:String(bound.d),kept:cmp(bound,R(best))>=0,ratio:Number(bound.n)/Number(bound.d)/Number(best)});}}
 }
 for(const s of samples){const bin=bins.find(b=>s.v[0]>=b.L&&s.v[0]<=b.U);assert(bin&&!bin.infeasible);assert(cmp(R(bin.n,bin.d),R(s.product))>=0);}
 const actualCRT=baseline.contributions[C],actualBin=bins.find(b=>actualCRT>=b.L&&actualCRT<=b.U);assert(actualBin.kept);
 const result={incumbentSource:'production exact baseline (solver-trust conditional)',sampleBest:String(sampleBest),actualCRT,actualBinUpperRatio:actualBin.ratio,permutations:orders.length,supportSegments:segments,label:source.single[si].label,job,level:p.jobLevel,slices:bins.length,kept:bins.filter(b=>b.kept).length,infeasible:bins.filter(b=>b.infeasible).length,ms:performance.now()-start,order:order.map(i=>factors[i].key),minRatio:Math.min(...bins.filter(b=>b.ratio).map(b=>b.ratio)),best:String(best),bins};out.push(result);console.log({...result,bins:undefined});
}
writeFileSync(new URL('./results.json',import.meta.url),JSON.stringify(out,null,2));
