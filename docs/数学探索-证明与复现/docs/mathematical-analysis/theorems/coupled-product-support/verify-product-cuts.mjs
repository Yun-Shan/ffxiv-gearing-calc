import assert from 'node:assert/strict';import {makeProductCuts} from './product-plane-cuts.mjs';
const groups=Array.from({length:4},(_,i)=>({name:'g'+i,classes:[1,2,4].map(value=>({value,variable:`g${i}_${value}`}))})),scale=1000000000n,base=147n,cuts=makeProductCuts(groups,base,scale),ceil=(n,d)=>n/d+(n%d?1n:0n);let checks=0;
for(let a=0;a<3;a++)for(let b=0;b<3;b++)for(let c=0;c<3;c++)for(let d=0;d<3;d++){const choice=[a,b,c,d],prod=choice.reduce((p,k,i)=>p*BigInt(groups[i].classes[k].value),1n);for(const row of cuts){const rhs=choice.reduce((p,k,i)=>p+row.coeffs[i][k],row.rhs);assert(rhs>=ceil(prod*scale,base));checks++;}}
console.log({cutCount:cuts.length,checks,status:'PASS including integer ceiling'});
