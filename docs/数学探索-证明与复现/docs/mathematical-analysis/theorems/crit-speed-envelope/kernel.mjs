// Exact rational comparisons. This is a research query on a relaxed C+speed slice.
export const compare=(a,b)=>a.n*b.d<b.n*a.d?-1:a.n*b.d>b.n*a.d?1:0;
export function critical(div,c,blu=false){const t=200n*BigInt(c)/BigInt(div)+BigInt(blu?250:50);return 1000000n+t*(t+BigInt(blu?150:350));}
export function logConvexThrough(div,cmax,blu=false){const V=BigInt(div),t=BigInt(blu?250:50)*V+200n*BigInt(cmax),b=BigInt(blu?150:350);return (2000000n-b*b)*V*V-2n*t*t-2n*b*t*V>=0n;}
export function prepareSpeedHull(gcdValues,minSpeed=0){const hull=[],events=[minSpeed];for(let s=minSpeed;s<gcdValues.length;s++){const g=gcdValues[s];if(!Number.isSafeInteger(g)||g<=0)throw Error('Non-positive/invalid GCD domain');if(s>minSpeed&&g>gcdValues[s-1])throw Error('GCD is not non-increasing');if(s>minSpeed&&g<gcdValues[s-1])events.push(s);while(hull.length>=2){const a=hull.at(-2),b=hull.at(-1);if((b[1]-a[1])*(s-b[0])<(g-b[1])*(b[0]-a[0]))break;hull.pop();}hull.push([s,g]);}return {hull,events,gcdValues};}
export function query(prepared,div,K,lo,hi,blu=false,method='events'){
 if(lo>hi||lo<0||hi>=prepared.gcdValues.length||K<hi)throw Error('Invalid slice');const {hull,events,gcdValues}=prepared;const eligible=method==='upper'?[]:events.filter(s=>s>lo&&s<=hi);if(method!=='upper')eligible.unshift(lo);let best={n:0n,d:1n},arg=lo,evals=0,bounds=0;const done=new Set();
 function test(s){if(done.has(s))return;done.add(s);const f={n:critical(div,K-s,blu),d:BigInt(gcdValues[s])};evals++;if(compare(f,best)>0){best=f;arg=s;}}
 if(method==='events'||!logConvexThrough(div,K-lo,blu)){if(method==='upper'){eligible.push(lo,...events.filter(s=>s>lo&&s<=hi));}eligible.forEach(test);return {best,arg,evals,bounds,guard:method==='events'||logConvexThrough(div,K-lo,blu)};}
 if(lo===hi){test(lo);return {best,arg,evals,bounds,upper:best,guard:true};}
 const V=BigInt(div),offset=BigInt(blu?250:50),b=BigInt(blu?150:350),segments=[];let upper={n:0n,d:1n};
 function U(s,left,right){bounds++;const width=BigInt(right[0]-left[0]),gn=BigInt(left[1])*BigInt(right[0]-s)+BigInt(right[1])*BigInt(s-left[0]),t=offset*V+200n*BigInt(K-s),cn=1000000n*V*V+t*(t+b*V);return {n:cn*width,d:V*V*gn};}
 for(let i=1;i<hull.length;i++){const left=hull[i-1],right=hull[i],a=Math.max(lo,left[0]),z=Math.min(hi,right[0]);if(a>z)continue;const ua=U(a,left,right),uz=U(z,left,right);for(const x of [ua,uz])if(compare(x,upper)>0)upper=x;segments.push({left,right,a,z});}
 if(method==='upper')return {upper,evals,bounds,guard:true};
 for(const seg of segments){test(seg.a);test(seg.z);}
 function visit(xs,a,b,left,right){if(a>b)return;const u1=U(xs[a],left,right),u2=U(xs[b],left,right);if(compare(u1,best)<0&&compare(u2,best)<0)return;test(xs[a]);test(xs[b]);if(b-a<=1)return;const m=(a+b)>>1;visit(xs,a,m,left,right);visit(xs,m+1,b,left,right);}
 for(const seg of segments){const xs=eligible.filter(s=>s>=seg.a&&s<=seg.z);visit(xs,0,xs.length-1,seg.left,seg.right);}
 return {best,arg,evals,bounds,upper,guard:true};
}
