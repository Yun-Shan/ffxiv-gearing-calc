import assert from 'node:assert/strict';import {certifiedRadius} from './seed-certificate-sharp-cuts.mjs';
let seed=20261023;const rand=n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n;};let checked=0;
for(let J=2;J<=6;J++)for(let t=0;t<2000;t++){
 const loss=Array.from({length:J},()=>BigInt(rand(1000))),base=1000n,den=base**BigInt(J),product=loss.reduce((p,l)=>p*(base-l),1n),sumN=loss.reduce((a,l)=>a+l,0n)*(den/base),E=product-den+sumN;
 const eta=E+BigInt(rand(100)),dmin=sumN-BigInt(rand(100));const {H}=certifiedRadius(eta,den,dmin,1000000000000n,BigInt(J));const second=[...loss].sort((a,b)=>a>b?-1:a<b?1:0)[1];assert(second*1000000000000n<=H*base);checked++;
}
// Tiny-domain boundary: losses close to the actual saturated seed.
for(let t=0;t<2000;t++){const den=10n**24n,L=1000000000000n,l1=BigInt(rand(500000000)),l2=BigInt(rand(100000)),eta=l1*l2+1n,dmin=(l1+l2)*L;const {H}=certifiedRadius(eta,den,dmin,L,2n);assert(H>=(l1<l2?l1:l2));checked++;}
console.log({checked,status:'PASS: radius never excludes the second-largest certified loss'});
