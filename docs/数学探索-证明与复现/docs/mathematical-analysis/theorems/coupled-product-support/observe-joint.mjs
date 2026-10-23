// In-memory, observation-only module hook. No production file or decision is changed.
import {registerHooks} from 'node:module';import {writeFileSync} from 'node:fs';
const states=new Map();let count=0;
globalThis.__mathJobProbe=x=>states.set(x.id,x);
globalThis.__mathBestProbe=x=>{count++;writeFileSync(new URL('./joint-incumbent-snapshot.json',import.meta.url),JSON.stringify({status:'validated feasible incumbent, NOT a completed joint proof',count,at:new Date().toISOString(),...x,jobs:[...states.values()]},(_,v)=>typeof v==='bigint'?String(v):v,2));};
registerHooks({load(url,context,next){const r=next(url,context);if(url.endsWith('/src/domain/search/loadout-finder-exact-mip.ts')){let s=typeof r.source==='string'?r.source:Buffer.from(r.source).toString();const needle='if (ratioNumerator > ratioDenominator) throw new Error(`联合方案超过已证明单职业基线：${job.id}`);';if(s.split(needle).length!==2)throw Error('Probe location changed');s=s.replace(needle,needle+'\n globalThis.__mathJobProbe?.({id:job.id,baseline:job.baseline,factors,attributes,selection,food,ratioNumerator,ratioDenominator});');const marker='best = { numerator, denominator, results };';if(s.split(marker).length!==2)throw Error('Best probe location changed');s=s.replace(marker,marker+'\n globalThis.__mathBestProbe?.({numerator,denominator});');return {...r,source:s};}return r;}});
await import('./joint-baseline.mjs');
