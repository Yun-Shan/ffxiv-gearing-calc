import assert from 'node:assert/strict';import {productPlane,R,add,mul,cmp,supportInInterval,prepareSupport} from './support.mjs';
let seed=20261023;const rand=n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n;};let ptests=0,stests=0;
for(let i=0;i<1000;i++){const n=2+rand(5),l=Array.from({length:n},()=>BigInt(1+rand(20))),u=l.map(x=>x+BigInt(rand(20))),x=l.map((v,k)=>v+BigInt(rand(Number(u[k]-v)+1))),order=Array.from({length:n},(_,j)=>j).sort(()=>rand(3)-1);const p=productPlane(l,u,order);let upper=p.intercept;for(let j=0;j<n;j++)upper=add(upper,mul(p.weights[j],R(x[j])));assert(cmp(upper,R(x.reduce((a,b)=>a*b,1n)))>=0);ptests++;}
for(let i=0;i<500;i++){const groups=Array.from({length:3},()=>Array.from({length:4},()=>[rand(15),BigInt(rand(100)-30)]));const lo=rand(25),hi=lo+rand(20);const upper=supportInInterval(groups,lo,hi),fast=prepareSupport(groups).query(lo,hi);assert.equal(upper===null,fast===null);if(upper)assert.equal(cmp(upper,fast),0);let best=null;for(const a of groups[0])for(const b of groups[1])for(const c of groups[2]){const cost=a[0]+b[0]+c[0];if(cost<lo||cost>hi)continue;const p=a[1]+b[1]+c[1];if(best===null||p>best)best=p;}if(best!==null)assert(upper&&cmp(upper,R(best))>=0);stests++;}
console.log({ptests,stests,status:'PASS'});
// Independent exact LP vertex enumeration: at most one group mixes two candidates
// when a single coupling resource bound is active. Checks equality, not only safety.
let lpChecks=0;
for(let z=0;z<120;z++){const groups=Array.from({length:3},()=>Array.from({length:4},()=>[rand(15),BigInt(rand(100)-30)])),lo=rand(25),hi=lo+rand(20);let best=null;const update=x=>{if(best===null||cmp(x,best)>0)best=x;};
for(const a of groups[0])for(const b of groups[1])for(const c of groups[2]){const cost=a[0]+b[0]+c[0];if(cost>=lo&&cost<=hi)update(R(a[1]+b[1]+c[1]));}
for(let g=0;g<3;g++){const other=[0,1,2].filter(i=>i!==g);for(const a of groups[other[0]])for(const b of groups[other[1]])for(let i=0;i<4;i++)for(let j=i+1;j<4;j++){let x=groups[g][i],y=groups[g][j];if(x[0]===y[0])continue;if(x[0]>y[0])[x,y]=[y,x];for(const total of [lo,hi]){const rem=total-a[0]-b[0];if(rem<x[0]||rem>y[0])continue;update(add(R(a[1]+b[1]+x[1]),R((y[1]-x[1])*BigInt(rem-x[0]),BigInt(y[0]-x[0]))));}}}
const actual=prepareSupport(groups).query(lo,hi);assert.equal(actual===null,best===null);if(best)assert.equal(cmp(actual,best),0);lpChecks++;}
console.log({lpChecks,exactEquality:'PASS'});
