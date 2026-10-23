// Research certificate primitives; exact rational arithmetic.
export const gcd=(a,b)=>{a=a<0n?-a:a;b=b<0n?-b:b;while(b)[a,b]=[b,a%b];return a;};
export const R=(n,d=1n)=>{n=BigInt(n);d=BigInt(d);if(d<0n){n=-n;d=-d;}if(!d)throw Error('zero denominator');const g=gcd(n,d);return {n:n/g,d:d/g};};
export const add=(a,b)=>R(a.n*b.d+b.n*a.d,a.d*b.d),mul=(a,b)=>R(a.n*b.n,a.d*b.d),sub=(a,b)=>add(a,R(-b.n,b.d)),div=(a,b)=>R(a.n*b.d,a.d*b.n);
export const cmp=(a,b)=>a.n*b.d<b.n*a.d?-1:a.n*b.d>b.n*a.d?1:0;
export const ceil=a=>a.n/a.d+(a.n>0n&&a.n%a.d?1n:0n);
export function productPlane(lower,upper,order){
 let current=lower.reduce((p,x)=>p*x,1n),intercept=R(current);const weights=lower.map(()=>R(0));const point=lower.slice();
 for(const i of order){if(upper[i]===lower[i])continue;const next=current/point[i]*upper[i];const w=R(next-current,upper[i]-lower[i]);weights[i]=w;intercept=sub(intercept,mul(w,R(lower[i])));point[i]=upper[i];current=next;}
 return {intercept,weights};
}
export function combinePlane(plane,factors,nstats){let b=plane.intercept,coef=Array.from({length:nstats},()=>R(0));for(let i=0;i<factors.length;i++){b=add(b,mul(plane.weights[i],factors[i].b));if(factors[i].index!==undefined)coef[factors[i].index]=add(coef[factors[i].index],mul(plane.weights[i],factors[i].a));}
 let den=b.d;for(const q of coef)den=den/gcd(den,q.d)*q.d;return {b:b.n*(den/b.d),coef:coef.map(q=>q.n*(den/q.d)),den};}
export function hull(points){const byCost=new Map();for(const [x,y] of points){const v=byCost.get(x);if(v===undefined||y>v)byCost.set(x,y);}const h=[];for(const [x,y] of [...byCost].sort((a,b)=>a[0]-b[0])){while(h.length>=2){const [a,b]=h.slice(-2);if((b[1]-a[1])*BigInt(x-b[0])>(y-b[1])*BigInt(b[0]-a[0]))break;h.pop();}h.push([x,y]);}return h;}
// Exact continuous relaxation of a separable sum of concave piecewise-linear hulls,
// constrained only by total resource interval. Negative slopes retained.
export function supportInInterval(groups,lo,hi){let cost=0,profit=0n,maxcost=0,positiveCost=0;const segments=[];
 for(const g of groups){const h=hull(g);if(!h.length)return null;cost+=h[0][0];profit+=h[0][1];maxcost+=h.at(-1)[0];for(let i=1;i<h.length;i++){const width=h[i][0]-h[i-1][0],gain=h[i][1]-h[i-1][1];segments.push({width,gain});if(gain>0n)positiveCost+=width;}}
 lo=Math.max(lo,cost);hi=Math.min(hi,maxcost);if(lo>hi)return null;const target=Math.min(hi,Math.max(lo,cost+positiveCost));segments.sort((a,b)=>a.gain*BigInt(b.width)>b.gain*BigInt(a.width)?-1:a.gain*BigInt(b.width)<b.gain*BigInt(a.width)?1:0);
 let remaining=target-cost;let result=R(profit);for(const s of segments){if(remaining<=0)break;const take=Math.min(remaining,s.width);result=add(result,R(s.gain*BigInt(take),BigInt(s.width)));remaining-=take;}return result;
}
export function prepareSupport(groups){let minCost=0,base=0n,positive=0;const segments=[];for(const group of groups){const h=hull(group);if(!h.length)return null;minCost+=h[0][0];base+=h[0][1];for(let i=1;i<h.length;i++){const width=h[i][0]-h[i-1][0],gain=h[i][1]-h[i-1][1];segments.push({width,gain});if(gain>0n)positive+=width;}}
segments.sort((a,b)=>a.gain*BigInt(b.width)>b.gain*BigInt(a.width)?-1:a.gain*BigInt(b.width)<b.gain*BigInt(a.width)?1:0);const costs=[minCost],values=[base];for(const s of segments){costs.push(costs.at(-1)+s.width);values.push(values.at(-1)+s.gain);}return {segments:segments.length,minCost,maxCost:costs.at(-1),query(lo,hi){lo=Math.max(lo,minCost);hi=Math.min(hi,costs.at(-1));if(lo>hi)return null;const target=Math.min(hi,Math.max(lo,minCost+positive));let a=0,b=costs.length-1;while(a<b){const m=Math.ceil((a+b)/2);if(costs[m]<=target)a=m;else b=m-1;}if(costs[a]===target)return R(values[a]);const seg=segments[a];return add(R(values[a]),R(seg.gain*BigInt(target-costs[a]),BigInt(seg.width)));}};
}
