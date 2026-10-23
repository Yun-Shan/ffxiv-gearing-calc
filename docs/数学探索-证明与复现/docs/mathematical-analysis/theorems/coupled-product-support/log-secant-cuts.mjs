import assert from 'node:assert/strict';
const ceilDiv=(n,d)=>n/d+(n>0n&&n%d?1n:0n);
export function addLogSecants({best,jobSurrogates,ratioUpperBoundVariables,ratioUpperBoundScale,LOG_SCALE,solveRows,addRows,jobCount}){
 if(!best)return {rows:0};const t=best.numerator-BigInt(jobCount-1)*best.denominator;if(t<=0n||t>best.denominator)return {rows:0};
 // Harmonic mean 2*tau/(1+tau), a rational LOWER bound on the logarithmic mean.
 // For r >= tau: r <= 1+a*ln(r). Upper-log quantization error is included.
 const a=2n*t,b=best.denominator+t,num=ratioUpperBoundScale*a,den=LOG_SCALE*b;
 const metadata=[];
 for(let j=0;j<jobSurrogates.length;j++){const s=jobSurrogates[j],delta=BigInt(s.offset)-BigInt(s.baseline)+BigInt(s.error),rhs=ratioUpperBoundScale+ceilDiv(num*delta,den),terms=new Map([[ratioUpperBoundVariables[j],1]]);assert(rhs>=BigInt(Number.MIN_SAFE_INTEGER)&&rhs<=BigInt(Number.MAX_SAFE_INTEGER));
 for(const [name,q]of s.terms){assert(Number.isSafeInteger(q));const c=ceilDiv(num*BigInt(q),den);assert(c>=BigInt(Number.MIN_SAFE_INTEGER)&&c<=BigInt(Number.MAX_SAFE_INTEGER));if(c)terms.set(name,-Number(c));}
 addRows(solveRows,`research_log_secant_${j}`,terms,'<=',Number(rhs));metadata.push({job:j,terms:terms.size,rhs:String(rhs)});}
 return {rows:metadata.length,tauNumerator:String(t),tauDenominator:String(best.denominator),metadata};
}
