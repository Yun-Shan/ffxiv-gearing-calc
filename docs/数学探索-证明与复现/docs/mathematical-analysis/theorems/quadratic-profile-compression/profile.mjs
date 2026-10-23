// Research only. Exact BigInt comparisons; no production pruning is enabled.
import {DOCUMENTED_LEVEL_PARAMS as LP, gcd} from '../../verification/canonical-model.mjs';
const fd=(n,d)=>{let q=n/d;return n<0n&&n%d?q-1n:q;};
const clamp=(x,a,b)=>x<a?a:x>b?b:x;
export function parameters(level,blu=false){const p=LP[level];return {...p,offset:blu?4200:4000};}
export function value(p,h,d){return (BigInt(p.offset)+BigInt(Math.floor(550*h/p.div)))*BigInt(p.detTrunc*Math.floor((140*d+1000*p.det)/(p.det*p.detTrunc)));}
export function coefficients(p,h,d,S){const H=BigInt(p.offset*p.div+550*h), D=BigInt(1000*p.det+140*(d+S));return {a:77000n,b:550n*D-140n*H,c:H*D,den:BigInt(p.div*p.det)};}
export const polynomial=(q,x)=>q.c+q.b*BigInt(x)-q.a*BigInt(x)**2n;
export function vertex(q,lo,hi){const k=fd(q.b,2n*q.a);return [...new Set([Number(clamp(k,BigInt(lo),BigInt(hi))),Number(clamp(k+1n,BigInt(lo),BigInt(hi)))])];}
export function band(p,h,d,S,lo,hi,lower){
 const q=coefficients(p,h,d,S);const vs=vertex(q,lo,hi);const peak=vs.reduce((a,b)=>polynomial(q,a)>=polynomial(q,b)?a:b);const target=lower*q.den;
 if(polynomial(q,peak)<target)return null;
 let a=lo,b=peak;while(a<b){const m=Math.floor((a+b)/2);if(polynomial(q,m)>=target)b=m;else a=m+1;}const L=a;
 a=peak;b=hi;while(a<b){const m=Math.ceil((a+b)/2);if(polynomial(q,m)>=target)a=m;else b=m-1;}return [L,a];
}
export function keypoints(p,d,S,lo,hi){const out=[hi];let last=p.detTrunc*Math.floor((140*(d+S-hi)+1000*p.det)/(p.det*p.detTrunc));for(let x=hi-1;x>=lo;x--){const now=p.detTrunc*Math.floor((140*(d+S-x)+1000*p.det)/(p.det*p.detTrunc));if(now>last)out.push(x);last=now;}return out;}
// Threshold formula, not linear scanning.
export function keys(p,d,S,lo,hi){const out=[hi];const q=p.det*p.detTrunc;const t0=Math.floor((140*(d+S-hi)+1000*p.det)/q), t1=Math.floor((140*(d+S-lo)+1000*p.det)/q);for(let t=t0+1;t<=t1;t++){const g=Math.ceil((t*q-1000*p.det)/140);const x=d+S-g;if(x>=lo&&x<hi)out.push(x);}return [...new Set(out)];}
export function period(p){const ph=p.div/gcd(550,p.div),pd=p.det*p.detTrunc/gcd(140,p.det*p.detTrunc);return ph/gcd(ph,pd)*pd;}
export function residues(p,h,d,S,lo,hi){const P=period(p), a=BigInt(550*P/p.div),e=BigInt(140*P/p.det),out=[];for(let r=lo;r<=Math.min(hi,lo+P-1);r++){const H=BigInt(p.offset+Math.floor(550*(h+r)/p.div)),D=BigInt(p.detTrunc*Math.floor((140*(d+S-r)+1000*p.det)/(p.det*p.detTrunc)));const q={a:a*e,b:a*D-e*H,c:H*D};for(const k of vertex(q,0,Math.floor((hi-r)/P)))out.push(r+k*P);}return [...new Set(out)];}
export function solve(p,h,d,S,lo,hi,method='hybrid'){
 if(lo>hi)return null;const score=x=>value(p,h+x,d+S-x);let count=0,best=-1n,arg;
 const test=x=>{count++;const z=score(x);if(z>best){best=z;arg=x;}};
 if(method==='raw'){for(let x=lo;x<=hi;x++)test(x);return {best,arg,count,width:hi-lo+1};}
 if(method==='keys'){for(const x of keys(p,d,S,lo,hi))test(x);return {best,arg,count,width:hi-lo+1};}
 for(const x of new Set([lo,hi,...vertex(coefficients(p,h,d,S),lo,hi)]))test(x);
 const [L,U]=band(p,h,d,S,lo,hi,best);let points=keys(p,d,S,L,U);
 if(method==='residue'||2*Math.min(period(p),U-L+1)<points.length){points=residues(p,h,d,S,L,U);}
 for(const x of points)test(x);return {best,arg,count,width:U-L+1,lo:L,hi:U,period:period(p)};
}
export function continuousUpper(p,h,d,S,lo,hi){const q=coefficients(p,h,d,S);if(q.b<2n*q.a*BigInt(lo))return {n:polynomial(q,lo),d:q.den};if(q.b>2n*q.a*BigInt(hi))return {n:polynomial(q,hi),d:q.den};return {n:4n*q.a*q.c+q.b*q.b,d:4n*q.a*q.den};}
export function critical(p,c,blu=false){const t=BigInt(Math.floor(200*c/p.div)+(blu?250:50));return 1000000n+t*(t+(blu?150n:350n));}
export function crtKeys(p,cap){const out=[0];for(let t=1;t<=Math.floor(200*cap/p.div);t++)out.push(Math.ceil(t*p.div/200));return out;}
export function solve3(p,R,cCap,hCap,dCap,blu=false,screen=true){
 const cs=crtKeys(p,Math.min(cCap,R));let best=-1n,arg=null,hdCalls=0,evals=0,screened=0;
 const query=c=>{const S=Math.min(R-c,hCap+dCap),lo=Math.max(0,S-dCap),hi=Math.min(S,hCap);return {S,lo,hi};};
 const test=c=>{const {S,lo,hi}=query(c),z=solve(p,0,0,S,lo,hi,'keys'),f=critical(p,c,blu)*z.best;hdCalls++;evals+=z.count;if(f>best){best=f;arg=[c,z.arg,S-z.arg];}};
 // Bound ordering costs O(N log N), included in measurements. It is not a heuristic truncation.
 const entries=screen?cs.map(c=>{const {S,lo,hi}=query(c),u=continuousUpper(p,0,0,S,lo,hi);return {c,n:u.n*critical(p,c,blu),d:u.d};}):cs.map(c=>({c}));
 if(screen)entries.sort((a,b)=>a.n*b.d>b.n*a.d?-1:a.n*b.d<b.n*a.d?1:0);
 for(const e of entries){if(screen&&e.n<best*e.d){screened++;continue;}test(e.c);}
 return {best,arg,hdCalls,evals,screened,crtKeys:cs.length};
}
