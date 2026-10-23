import assert from 'node:assert/strict';
const permutations=xs=>xs.length?xs.flatMap((x,i)=>permutations(xs.filter((_,j)=>j!==i)).map(t=>[x,...t])):[[]];
const ceilDiv=(n,d)=>n/d+(n%d?1n:0n);
export function makeProductCuts(groups,baseline,scale){
 const lows=groups.map(g=>BigInt(Math.min(...g.classes.map(c=>c.value)))),highs=groups.map(g=>BigInt(Math.max(...g.classes.map(c=>c.value))));assert(lows.every(x=>x>0n));const lowerProduct=lows.reduce((a,x)=>a*x,1n),active=lows.map((_,i)=>i).filter(i=>lows[i]!==highs[i]);const cuts=[];
 for(const order of permutations(active)){let product=lowerProduct;const weights=lows.map(()=>0n);for(const i of order){weights[i]=product/lows[i];product=weights[i]*highs[i];}const rhs=ceilDiv(lowerProduct*scale,baseline),coeffs=groups.map((g,i)=>g.classes.map(c=>ceilDiv(weights[i]*(BigInt(c.value)-lows[i])*scale,baseline)));
 // All rectangle corners checked independently for each emitted cut.
 for(let mask=0;mask<2**active.length;mask++){const fs=lows.slice();active.forEach((i,k)=>{if(mask>>k&1)fs[i]=highs[i];});const exact=fs.reduce((a,x)=>a*x,1n);let upper=rhs;for(let i=0;i<fs.length;i++)upper+=ceilDiv(weights[i]*(fs[i]-lows[i])*scale,baseline);assert(upper>=ceilDiv(exact*scale,baseline));}
 cuts.push({order,rhs,coeffs});}
 return cuts;
}
export function addProductPlanes({preparedJobs,ratioUpperBoundVariables,ratioUpperBoundScale,prefix,addRows,rows,objective}){
 assert.equal(objective,'damage');let total=0,nonzeros=0;const details=[];
 preparedJobs.forEach(({job,prepared},j)=>{const groups=prepared.groups.filter(g=>g.name!=='gcd'),baseline=['weaponDamage','mainStat','determination','tenacity','critical','directHit'].reduce((p,k)=>p*BigInt(job.baseline[k]),1n);const cuts=makeProductCuts(groups,baseline,ratioUpperBoundScale);
 cuts.forEach((cut,k)=>{const terms=new Map([[ratioUpperBoundVariables[j],1]]);groups.forEach((g,i)=>g.classes.forEach((c,n)=>{const x=cut.coeffs[i][n];assert(x<=BigInt(Number.MAX_SAFE_INTEGER));if(x)terms.set(prefix(j,c.variable),-Number(x));}));assert(cut.rhs<=BigInt(Number.MAX_SAFE_INTEGER));addRows(rows,`research_product_plane_${j}_${k}`,terms,'<=',Number(cut.rhs));total++;nonzeros+=terms.size;});details.push({job:job.id,planes:cuts.length,groups:groups.map(g=>({name:g.name,classes:g.classes.length,min:Math.min(...g.classes.map(c=>c.value)),max:Math.max(...g.classes.map(c=>c.value))}))});});
 return {total,nonzeros,details};
}
