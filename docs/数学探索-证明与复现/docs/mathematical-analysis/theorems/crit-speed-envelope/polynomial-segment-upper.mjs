import{R,add,sub,mul,div,cmp}from'../coupled-product-support/support.mjs';
const pow=(x,k)=>R(x.n**BigInt(k),x.d**BigInt(k));
// Exact rational certificate for max (A*x^2+B*x+D)*(a*x+b)^k.
// A,B,D > 0; x >= 0; positive affine factor over [lo,hi].
export function segmentUpper({A,B,D,a,b,k,lo,hi,iterations=20}){
 if(cmp(lo,R(0))<0||cmp(lo,hi)>0||!Number.isInteger(k)||k<1||[A,B,D].some(x=>x.n<=0n))throw Error('Unsupported domain');
 const q=x=>add(add(mul(A,mul(x,x)),mul(B,x)),D),h=x=>add(mul(a,x),b);if(h(lo).n<=0n||h(hi).n<=0n)throw Error('Nonpositive factor');
 const f=x=>mul(q(x),pow(h(x),k));let best=f(lo);const fhi=f(hi);if(cmp(fhi,best)>0)best=fhi;if(a.n>=0n)return {upper:fhi,rootBracket:null};
 const da=mul(R(k+2),mul(A,a)),db=add(mul(R(2),mul(A,b)),mul(R(k+1),mul(B,a))),dc=add(mul(B,b),mul(R(k),mul(D,a))),derivative=x=>add(add(mul(da,mul(x,x)),mul(db,x)),dc);
 // The quadratic derivative numerator is concave; only its right root can be a local maximum.
 if(derivative(hi).n>=0n)return {upper:best,rootBracket:null};
 let left=lo;if(derivative(left).n<=0n){const vertex=div(mul(R(-1),db),mul(R(2),da));if(cmp(vertex,lo)<=0||cmp(vertex,hi)>=0||derivative(vertex).n<=0n)return {upper:best,rootBracket:null};left=vertex;}
 let right=hi;for(let i=0;i<iterations;i++){const mid=div(add(left,right),R(2));if(derivative(mid).n>=0n)left=mid;else right=mid;}
 // q increases and h decreases: opposite ends give a safe upper on the whole root bracket.
 const rootUpper=mul(q(right),pow(h(left),k));if(cmp(rootUpper,best)>0)best=rootUpper;return {upper:best,rootBracket:{lo:left,hi:right}};
}
