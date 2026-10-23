import {writeFileSync,existsSync,readFileSync} from 'node:fs';
import {loadGameData,loadCanonicalEvaluator} from '../../verification/canonical-model.mjs';
const data=await loadGameData(),effects=await loadCanonicalEvaluator(),{runOptimizationLocally}=await import('../../../../src/domain/optimizer.ts'),ctx=await import('../../../../src/domain/optimizer/context.ts'),{calculateBaseStats}=await import('../../../../src/domain/rules.ts');
const file=new URL('./production-baselines.json',import.meta.url),results=existsSync(file)?JSON.parse(readFileSync(file)):[];
for(const [label,jobId,minItemLevel,maxItemLevel,syncLevel] of [['BLM 770–780','BLM',770,780],['BLM 735–780','BLM',735,780],['WAR 770–780','WAR',770,780],['WHM 同步 320','WHM',290,320,320]]){
 if(results.some(r=>r.label===label&&r.status==='complete'))continue;
 const config={jobId,minItemLevel,maxItemLevel,...(syncLevel?{syncLevel}:{}),objective:'damage',excludedSources:[],forcedGear:{},foodId:0,maxSearchMs:300000};const statuses=[];console.log('START',label);
 try{const result=await runOptimizationLocally(config,{onProgress:m=>{console.log(label,m);if(m.includes('状态='))statuses.push(m);}});if(!result)throw Error('No feasible result');const level=result.calculationLevel,base=calculateBaseStats(data.jobSchemas[jobId],level,0),v=Array(ctx.attributeIds.length).fill(0);for(const [stat,i] of ctx.attributeIndex)v[i]=(result.stats[stat]??0)-(base[stat]??0);const factors=effects.createIntegerDamageFactorEvaluator(jobId,level,ctx.attributeIndex)(v);let product=1n;for(const k of ['weaponDamage','mainStat','determination','tenacity','critical','directHit'])product*=BigInt(factors[k]);results.push({label,config,status:'complete',product:String(product),factors,contributions:v,result,statuses});console.log('DONE',label,result.durationMs,String(product));}
 catch(e){results.push({label,config,status:'failed',error:String(e),statuses});console.log('FAILED',label,String(e));}
 writeFileSync(file,JSON.stringify(results,null,2));
}
