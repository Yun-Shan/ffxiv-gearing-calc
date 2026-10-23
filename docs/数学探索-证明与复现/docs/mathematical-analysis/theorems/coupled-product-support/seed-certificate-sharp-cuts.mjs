import assert from 'node:assert/strict';
const ceil=(n,d)=>n/d+(n>0n&&n%d?1n:0n);
const isqrt=n=>{if(n<2n)return n;let x=1n<<BigInt(Math.ceil(n.toString(2).length/2));while(true){const y=(x+n/x)/2n;if(y>=x)return x;x=y;}};
export function certifiedRadius(etaN,den,dminN,scale,J){
 assert(etaN>=0n&&den>0n&&scale>0n&&J>=2n);let H=isqrt(etaN*scale*scale/den);if(H*H*den<etaN*scale*scale)H++;const initial=H;
 if(dminN>0n){const rational=ceil(J*etaN*scale,dminN);if(rational<H)H=rational;
  const f=h=>h*dminN*scale-(J-1n)*h*h*den,target=etaN*scale*scale;
  if(2n*(J-1n)*H*den<dminN*scale&&f(H)>=target){let lo=0n,hi=H;while(lo<hi){const mid=(lo+hi)/2n;if(f(mid)>=target)hi=mid;else lo=mid+1n;}H=lo;}
 }
 return {H,initial};
}
export function addSeedCertificateCuts({snapshot,preparedJobs,jobSurrogates,objective,maximumOffset,rows,addRows,ratioUpperBoundScale,ratioUpperBoundVariables,LOG_SCALE,groupCount,bounds,binaries,axisTubes}){
 assert.equal(snapshot.count,1,'Cached seed must be the first Q-optimal result, not a later sum-improving result');const fields={weapon:'weaponDamage',main:'mainStat',det:'determination',ten:'tenacity',crt:'critical',dht:'directHit',gcd:'gcdCentiseconds'};let Qmax=0,pn=1n,pd=1n;const points=[];
 preparedJobs.forEach(({job,prepared})=>{const x=snapshot.jobs.find(x=>x.id===job.id);assert(x);for(const k of Object.values(fields))assert.equal(x.baseline[k],job.baseline[k]);let Q=0;for(const g of prepared.groups){const c=g.classes.find(c=>c.value===x.factors[fields[g.name]]);assert(c,'Seed class not represented');Q+=c.q;}Qmax+=Q;pn*=BigInt(x.ratioNumerator);pd*=BigInt(x.ratioDenominator);points.push({Q,n:BigInt(x.ratioNumerator),d:BigInt(x.ratioDenominator)});});
 assert(Number.isSafeInteger(Qmax-maximumOffset));addRows(rows,'research_known_Q_max',objective,'<=',Qmax-maximumOffset);
 const J=BigInt(preparedJobs.length),m=14n;assert.equal(groupCount,Number(m));assert(LOG_SCALE>m);const den=pd*(LOG_SCALE-m),num=(J-1n)*den+pn*LOG_SCALE;let cap=ceil(num*ratioUpperBoundScale,den)+J-1n;if(cap>J*ratioUpperBoundScale)cap=J*ratioUpperBoundScale;assert(cap<=BigInt(Number.MAX_SAFE_INTEGER));addRows(rows,'research_known_ratio_sum_cap',new Map(ratioUpperBoundVariables.map(v=>[v,1])),'<=',Number(cap));
 const sumN=points.reduce((s,p)=>s+p.n*(pd/p.d),0n),etaN=num-sumN*(LOG_SCALE-m);assert(etaN>=0n);const radius=certifiedRadius(etaN,den,J*den-num,LOG_SCALE,J);const H=radius.H;const info={radiusKind:"certified-refined",initialH:String(radius.initial),Qmax,ratioCap:String(cap),etaNumerator:String(etaN),etaDenominator:String(den),hNumerator:String(H),hDenominator:String(LOG_SCALE),axisTubes:!!axisTubes};
 if(!axisTubes||H>=LOG_SCALE)return info;
 const loss=ceil(LOG_SCALE*H,LOG_SCALE-H),selectors=preparedJobs.map((_,i)=>`research_exception_${i}`);for(const name of selectors){bounds.push({name,min:0,max:1});binaries.push(name);}addRows(rows,'research_one_exception',new Map(selectors.map(x=>[x,1])),'=',1);
 let exception=0;for(let i=1;i<points.length;i++)if(points[i].n*points[exception].d<points[exception].n*points[i].d)exception=i;
 preparedJobs.forEach(({prepared},j)=>{const s=jobSurrogates[j],target=BigInt(s.baseline)-BigInt(s.offset)-BigInt(s.error)-loss,minimum=prepared.groups.reduce((q,g)=>q+BigInt(Math.min(...g.classes.map(c=>c.q)))-BigInt(Math.max(...g.classes.map(c=>c.q))),0n),M=target>minimum?target-minimum:0n;assert(M<=BigInt(Number.MAX_SAFE_INTEGER));assert(target>=BigInt(Number.MIN_SAFE_INTEGER)&&target<=BigInt(Number.MAX_SAFE_INTEGER));const terms=new Map(s.terms);terms.set(selectors[j],Number(M));addRows(rows,`research_near_solo_${j}`,terms,'>=',Number(target));assert(BigInt(points[j].Q-s.offset)+(j===exception?M:0n)>=target,'Known seed must lift to exception disjunction');});
 return {...info,lossQ:String(loss),addedBinaries:selectors.length};
}
