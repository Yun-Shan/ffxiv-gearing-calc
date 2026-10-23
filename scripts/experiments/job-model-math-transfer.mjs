// Isolated mathematical migration experiment. Synthetic profiles and candidate pools only.
// Reads current formulas and archived pure rational support; never modifies production or archive files.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { R, add, mul, div, cmp, supportInInterval } from "../../docs/数学探索-证明与复现/docs/mathematical-analysis/theorems/coupled-product-support/support.mjs";

const bytes = new Uint8Array(await readFile(new URL("../../src/data/generated-data.bin", import.meta.url)));
globalThis.__FFXIV_GENERATED_DATA_BINARY__ = bytes;
const [{ gameData }, effects] = await Promise.all([
  import("../../src/domain/data.ts"), import("../../src/domain/search/equipped-effects.ts"),
]);
const initialSeed = 831245;
let seed = initialSeed;
const random = n => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) % n);
const levels = [50, 60, 70, 80, 90, 100];
// alpha=A+80*forcedEvents, beta=B, gamma=80*normalEvents; illustrative mean-resource coefficients.
const profiles = [
  { gcd: 194, alpha: 13040n, beta: 4000n, gamma: 3200n },
  { gcd: 196, alpha: 12200n, beta: 4500n, gamma: 2880n },
  { gcd: 200, alpha: 11360n, beta: 5000n, gamma: 2640n },
];
const polynomial = (p, x) => p.reduceRight((v, a) => v * x + a, 0n);
const polynomialR = (p, x) => p.reduceRight((v, a) => add(mul(v, x), R(a)), R(0));
const derivative = p => p.slice(1).map((a, i) => a * BigInt(i + 1));
const product = (a, b) => {
  const out = Array(a.length + b.length - 1).fill(0n);
  for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) out[i + j] += a[i] * b[j];
  return out;
};
function coefficients({ alpha: a, beta: b, gamma: g }) {
  return [1020000000n * a + 1400000000n * b + 51000000n * g,
    450000n * a + 1000000n * b + 1042500n * g, 1000n * a + 500n * g, g];
}
function curvature(q, k) {
  const [a0, a1, a2, a3] = q, n = BigInt(k);
  const result = [2n * n * a0 * a2 - (n + 1n) * a1 * a1,
    6n * n * a0 * a3 - (2n * n + 4n) * a1 * a2,
    -6n * a1 * a3 - (2n * n + 4n) * a2 * a2,
    -(4n * n + 12n) * a2 * a3, -(3n * n + 9n) * a3 * a3];
  const qq2 = product(q, derivative(derivative(q))), q12 = product(derivative(q), derivative(q));
  assert.deepEqual(result, result.map((_, i) => n * (qq2[i] ?? 0n) - (n + 1n) * (q12[i] ?? 0n)));
  assert.ok(result.slice(2).every(x => x <= 0n));
  return result;
}
const crtTier = (p, c) => BigInt(Math.floor(200 * c / p.div));
const hd = (p, h, d) => BigInt(4000 + Math.floor(550 * h / p.div)) *
  BigInt(p.detTrunc * Math.floor((140 * d + 1000 * p.det) / (p.det * p.detTrunc)));
const gcd = (a, b) => b ? gcd(b, a % b) : a;
const floorDiv = (a, b) => a / b - (a < 0n && a % b ? 1n : 0n);
const clamp = (x, lo, hi) => x < lo ? lo : x > hi ? hi : x;
function residueMaximum(p, budget, hCap, dCap) {
  const lo = Math.max(0, budget - dCap), hi = Math.min(budget, hCap);
  if (lo > hi) return null;
  const ph = p.div / gcd(550, p.div), pd = p.det * p.detTrunc / gcd(140, p.det * p.detTrunc);
  const period = ph / gcd(ph, pd) * pd;
  const a = BigInt(550 * period / p.div), b = BigInt(140 * period / p.det);
  let best = -1n, evaluated = 0;
  for (let r = lo; r <= Math.min(hi, lo + period - 1); r++) {
    const h = BigInt(4000 + Math.floor(550 * r / p.div));
    const d = BigInt(p.detTrunc * Math.floor((140 * (budget - r) + 1000 * p.det) / (p.det * p.detTrunc)));
    const top = BigInt(Math.floor((hi - r) / period));
    const v = floorDiv(a * d - b * h, 2n * a * b);
    for (const z of new Set([clamp(v, 0n, top), clamp(v + 1n, 0n, top)])) {
      const value = (h + a * z) * (d - b * z);
      if (value > best) best = value;
      evaluated++;
    }
  }
  return { best, evaluated, period };
}
function rootFloor(n, k) {
  assert.ok(n >= 0n && k > 0);
  let lo = 0n, hi = 1n;
  while (hi ** BigInt(k) <= n) hi *= 2n;
  while (hi - lo > 1n) { const mid = (lo + hi) / 2n; if (mid ** BigInt(k) <= n) lo = mid; else hi = mid; }
  return lo;
}

// 1. Exact shared CRT tiers, expanded cubic, and continuous monotone upper envelope.
const names = ["PDMG", "STR", "CRT", "DET", "DHT", "SKS", "TEN"];
const indexes = new Map(names.map((name, i) => [name, i]));
let formulaPoints = 0;
const levelDomains = [];
for (const level of levels) {
  const p = gameData.jobLevelModifiers[level], factor = effects.createIntegerDamageFactorEvaluator("MNK", level, indexes);
  const cap = Math.min(8000, Math.floor(950 * p.div / 200)); // stay within natural critical probability <= 1
  levelDomains.push({ level, cap, div: p.div });
  for (let c = 0; c <= cap; c++) {
    const w = crtTier(p, c), n = w * w + 450n * w + 1020000n;
    assert.equal(BigInt(factor([100, 2000, c, 0, 0, 0, 0]).critical), n);
    assert.equal(BigInt(effects.equippedAttributeTier("MNK", level, "CRT", c)), w + 50n);
    for (const profile of profiles) {
      const q = coefficients(profile), exact = polynomial(q, w);
      const direct = 1000n * profile.alpha * n + 1000000n * profile.beta * (w + 1400n) +
        profile.gamma * (w + 50n) * n;
      assert.equal(exact, direct);
      assert.ok(cmp(polynomialR(q, R(200 * c, p.div)), R(exact)) >= 0);
      formulaPoints++;
    }
  }
}

// 2. A new analytic certificate: curvature polynomial is concave, so both endpoints suffice.
let curvaturePoints = 0, certifiedIntervals = 0;
const curvatureCases = [];
for (let t = 0; t < 180; t++) {
  const q = t < 3 ? coefficients(profiles[t]) : [BigInt(1 + random(100000)), BigInt(random(1000)), BigInt(random(100)), BigInt(random(15))];
  const k = 1 + random(6), lo = random(20), hi = lo + 1 + random(600), r = curvature(q, k);
  const endpointMinimum = polynomial(r, BigInt(lo)) < polynomial(r, BigInt(hi)) ? polynomial(r, BigInt(lo)) : polynomial(r, BigInt(hi));
  const certified = endpointMinimum >= 0n;
  if (certified) certifiedIntervals++;
  for (let x = lo; x <= hi; x++) {
    assert.ok(polynomial(r, BigInt(x)) >= endpointMinimum);
    if (certified) assert.ok(polynomial(r, BigInt(x)) >= 0n);
    curvaturePoints++;
  }
}
for (const profile of profiles) for (const k of [2, 4, 5]) {
  const q = coefficients(profile), r = curvature(q, k);
  curvatureCases.push({ gcd: profile.gcd, k, tierRange: [0, 575],
    low: polynomial(r, 0n), high: polynomial(r, 575n), certified: polynomial(r, 0n) >= 0n && polynomial(r, 575n) >= 0n });
}
const sampleCurvature = curvature(coefficients(profiles[0]), 4);
const curvatureAtContribution = c => polynomialR(sampleCurvature, R(200 * c, gameData.jobLevelModifiers[100].div));
assert.ok(curvatureAtContribution(0).n > 0n);
assert.ok(curvatureAtContribution(8046).n < 0n);
let lastSafe = 0, firstUnsafe = 8046;
while (firstUnsafe - lastSafe > 1) {
  const mid = Math.floor((firstUnsafe + lastSafe) / 2);
  if (curvatureAtContribution(mid).n >= 0n) lastSafe = mid; else firstUnsafe = mid;
}
assert.equal(lastSafe, 7092);
// Pure forced-critical linear q has negative curvature for every k; old concave chords fail.
const linear = [1n, 1n, 0n, 0n], lr = curvature(linear, 2);
assert.ok(polynomial(lr, 1n) < 0n);
// T(x)=(1+x)^(-1/2), chord endpoints (0,1),(3,1/2). At x=1, L=3/4 is feasible but below chord 5/6.
assert.ok(cmp(mul(R(2), R(9, 16)), R(1)) >= 0);
assert.ok(cmp(R(3, 4), R(5, 6)) < 0);

// Exact downward-root chords on certified MNK ranges. No floating roots decide exclusion.
let chordPoints = 0;
const chordCases = [];
for (const profile of profiles) for (const k of [4, 5]) {
  const q = coefficients(profile), r = curvature(q, k), lo = 0n, hi = 200n;
  if (polynomial(r, lo) < 0n || polynomial(r, hi) < 0n) { chordCases.push({ gcd: profile.gcd, k, supported: false }); continue; }
  const target = polynomial(q, 100n), scale = 100000000n;
  const left = rootFloor(target * scale ** BigInt(k) / polynomial(q, lo), k);
  const right = rootFloor(target * scale ** BigInt(k) / polynomial(q, hi), k);
  for (let x = lo; x <= hi; x++) {
    const line = R(left * (hi - x) + right * (x - lo), scale * (hi - lo));
    assert.ok(polynomial(q, x) * line.n ** BigInt(k) <= target * line.d ** BigInt(k));
    chordPoints++;
  }
  chordCases.push({ gcd: profile.gcd, k, supported: true, tierRange: [0, 200], left: R(left, scale), right: R(right, scale) });
}

// Common cheap multi-GCD relaxation: min of concave thresholds stays concave.
// Same remaining-factor reference and full CRT domain are required. Durations here are synthetic.
const durations = [612n, 606n, 600n], multiScale = 100000000n, multiK = 4, multiHi = 200n;
const multiTarget = R(polynomial(coefficients(profiles[0]), 100n), durations[0]);
const thresholdFloors = profiles.map((profile, i) => {
  const q = coefficients(profile), r = curvature(q, multiK);
  assert.ok(polynomial(r, 0n) >= 0n && polynomial(r, multiHi) >= 0n);
  return [0n, multiHi].map(x => rootFloor(multiTarget.n * durations[i] * multiScale ** 4n / (multiTarget.d * polynomial(q, x)), 4));
});
const multiLeft = thresholdFloors.reduce((a, x) => a < x[0] ? a : x[0], thresholdFloors[0][0]);
const multiRight = thresholdFloors.reduce((a, x) => a < x[1] ? a : x[1], thresholdFloors[0][1]);
const maximizingRows = new Set();
let multiChordPoints = 0;
for (let x = 0n; x <= multiHi; x++) {
  const line = R(multiLeft * (multiHi - x) + multiRight * x, multiScale * multiHi);
  const scores = profiles.map((profile, i) => R(polynomial(coefficients(profile), x), durations[i]));
  maximizingRows.add(scores.reduce((best, value, i) => cmp(value, scores[best]) > 0 ? i : best, 0));
  for (const score of scores) { assert.ok(cmp(mul(score, R(line.n ** 4n, line.d ** 4n)), multiTarget) <= 0); multiChordPoints++; }
}
assert.ok(maximizingRows.size >= 2);

// General positive cubic is NOT covered by the archived quadratic one-maximum theorem.
const genericQ = [769n, 3496n, 1600n, 48000n];
const genericDerivative = derivative(genericQ).map((v, i) => v - BigInt(i + 4) * genericQ[i]);
genericDerivative.push(-7n * genericQ[3]);
assert.deepEqual(genericDerivative, [420n, -14280n, 134400n, -336000n]);
for (const root of [R(1, 20), R(1, 10), R(1, 4)]) assert.equal(polynomialR(genericDerivative, root).n, 0n);
assert.ok(polynomialR(genericDerivative, R(4, 100)).n > 0n);
assert.ok(polynomialR(genericDerivative, R(7, 100)).n < 0n);
assert.ok(polynomialR(genericDerivative, R(15, 100)).n > 0n);
assert.ok(polynomialR(genericDerivative, R(30, 100)).n < 0n);

// Stronger counterexample within the nonnegative MNK polynomial family, in natural crit probability c.
// alpha=1, beta=1/4, gamma=23/20; 400*q=535+700*c+561*c^2+460*c^3.
// h=76487/25000-c, k=4. This is an algebraic support segment, not a claimed real rotation/item hull.
const mnkQ = [535n, 700n, 561n, 460n];
const mnkDerivative = [20450n, -840793n, 10701030n, -40250000n];
for (let i = 0; i < 4; i++) {
  const term = add(mul(R(derivative(mnkQ)[i] ?? 0n), R(76487, 25000)), R(-BigInt(i + 4) * mnkQ[i]));
  assert.equal(cmp(mul(R(12500), term), R(mnkDerivative[i])), 0);
}
const mnkSignPoints = [R(1, 20), R(3, 50), R(7, 100), R(4, 25)];
const mnkSigns = mnkSignPoints.map(x => polynomialR(mnkDerivative, x));
assert.deepEqual(mnkSigns.map(x => x.n > 0n ? 1 : -1), [1, -1, 1, -1]);

// 3. DHT/DET residue-class elimination survives an independent fixed-CRT profile multiplier.
let residueCases = 0, residueBrutePoints = 0, residueEvaluations = 0, cappedResidueCases = 0, infeasibleResidueCases = 0;
for (const level of levels) for (let t = 0; t < 30; t++) {
  const p = gameData.jobLevelModifiers[level], budget = 100 + random(2400);
  const hCap = t % 3 ? random(budget + 1) : budget, dCap = t % 3 ? random(budget + 1) : budget;
  if (t % 3) cappedResidueCases++;
  const result = residueMaximum(p, budget, hCap, dCap);
  let best = null;
  for (let h = Math.max(0, budget - dCap); h <= Math.min(budget, hCap); h++) { const value = hd(p, h, budget - h); if (best === null || value > best) best = value; residueBrutePoints++; }
  assert.equal(result?.best ?? null, best);
  if (!result) infeasibleResidueCases++;
  residueCases++; residueEvaluations += result?.evaluated ?? 0;
}
let budgetCases = 0, budgetBrutePoints = 0, profileQueries = 0;
for (const level of levels) for (const profile of profiles) for (const budget of [32, 55]) {
  const p = gameData.jobLevelModifiers[level], q = coefficients(profile);
  const caps = budget === 32 ? [budget, budget, budget] : [random(budget + 1), random(budget + 1), random(budget + 1)];
  let brute = -1n;
  for (let c = 0; c <= Math.min(budget, caps[0]); c++) for (let h = 0; h <= Math.min(budget - c, caps[1]); h++) for (let d = 0; d <= Math.min(budget - c - h, caps[2]); d++) {
    const value = polynomial(q, crtTier(p, c)) * hd(p, h, d); if (value > brute) brute = value; budgetBrutePoints++;
  }
  let compressed = -1n, last = -1n;
  for (let c = 0; c <= Math.min(budget, caps[0]); c++) {
    const tier = crtTier(p, c); if (tier === last) continue; last = tier;
    const value = polynomial(q, tier) * residueMaximum(p, Math.min(budget - c, caps[1] + caps[2]), caps[1], caps[2]).best;
    if (value > compressed) compressed = value; profileQueries++;
  }
  assert.equal(compressed, brute); budgetCases++;
}

// 4. Full q*DHT*DET AM-GM certificate on correlated synthetic item pools.
// Fixed W/AP/TEN/time are factored out. This is a fixed-GCD algebraic domain, not real gear or speed validation.
let candidateDomains = 0, candidateConfigurations = 0, candidateChecks = 0, certifiedDeletions = 0, supportQueries = 0;
for (const profile of profiles) for (let trial = 0; trial < 8; trial++) {
  const p = gameData.jobLevelModifiers[100], q = coefficients(profile);
  const pools = Array.from({ length: 3 }, () => [
    { c: 400 + random(200), h: 600 + random(200), d: 600 + random(200) },
    { c: 0, h: 0, d: 0 },
    ...Array.from({ length: 3 }, () => ({ c: random(1000), h: random(1000), d: random(1000) })),
  ]);
  const total = picks => picks.reduce((a, b) => ({ c: a.c + b.c, h: a.h + b.h, d: a.d + b.d }), { c: 0, h: 0, d: 0 });
  const score = s => polynomial(q, crtTier(p, s.c)) * hd(p, s.h, s.d);
  const initial = total(pools.map(pool => pool[0])), incumbent = score(initial);
  const rH = BigInt(4000 + Math.floor(550 * initial.h / p.div));
  const rD = BigInt(p.detTrunc * Math.floor((140 * initial.d + 1000 * p.det) / (p.det * p.detTrunc)));
  const den = rH * rD * BigInt(p.div * p.det), wH = 550n * BigInt(p.det) * rD, wD = 140n * BigInt(p.div) * rH;
  const intercept = (4000n * rD + 1000n * rH) * BigInt(p.div * p.det);
  const all = [];
  for (let a = 0; a < 5; a++) for (let b = 0; b < 5; b++) for (let c = 0; c < 5; c++) all.push({ ids: [a, b, c], score: score(total([pools[0][a], pools[1][b], pools[2][c]])) });
  candidateConfigurations += all.length;
  for (let slot = 0; slot < 3; slot++) for (let item = 0; item < 5; item++) {
    const groups = pools.map((pool, i) => (i === slot ? [pool[item]] : pool).map(s => [s.c, wH * BigInt(s.h) + wD * BigInt(s.d)]));
    const lo = groups.reduce((a, g) => a + Math.min(...g.map(x => x[0])), 0), hi = groups.reduce((a, g) => a + Math.max(...g.map(x => x[0])), 0);
    function excludes(left, right) {
      supportQueries++;
      const support = supportInInterval(groups, left, right);
      if (!support) return true;
      const sum = div(add(R(intercept), support), R(den));
      const upper = mul(R(polynomial(q, crtTier(p, right)) * rH * rD), mul(div(sum, R(2)), div(sum, R(2))));
      if (cmp(upper, R(incumbent)) < 0) return true;
      if (crtTier(p, left) === crtTier(p, right)) return false;
      const mid = Math.floor((left + right) / 2);
      return excludes(left, mid) && excludes(mid + 1, right);
    }
    const removed = excludes(lo, hi);
    if (removed) { certifiedDeletions++; assert.ok(all.filter(x => x.ids[slot] === item).every(x => x.score < incumbent)); }
    candidateChecks++;
  }
  candidateDomains++;
}
assert.ok(certifiedDeletions > 0);

const sourcePaths = ["src/domain/search/equipped-effects.ts", "scripts/experiments/job-model-math-transfer.mjs",
  "docs/数学探索-证明与复现/docs/mathematical-analysis/theorems/coupled-product-support/support.mjs"];
const sourceHashes = Object.fromEntries(await Promise.all(sourcePaths.map(async path => [path, createHash("sha256").update(await readFile(new URL(`../../${path}`, import.meta.url))).digest("hex")])));
console.log(JSON.stringify({
  status: "pass", scope: "Exact algebra, current formula grids and synthetic finite domains only; no real loadout, new MIP backend or performance certification",
  provenance: { runAt: new Date().toISOString(), node: process.version, repositoryCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), gameVersion: gameData.version, binarySha256: createHash("sha256").update(bytes).digest("hex"), initialSeed, sourceHashes },
  profiles, levelDomains, formulaPoints,
  curvature: { randomAndProfileIntervals: 180, certifiedIntervals, integerPoints: curvaturePoints, profileChecks: curvatureCases, chordCases, chordPoints,
    oldOrdinaryLimitCounterexample: { gcd: 194, level: 100, k: 4, oldLimit: 8046, oldLimitCurvature: curvatureAtContribution(8046), lastCertifiedIntegerContribution: lastSafe, firstFailingIntegerContribution: firstUnsafe, lastSafeCurvature: curvatureAtContribution(lastSafe), firstUnsafeCurvature: curvatureAtContribution(firstUnsafe), scope: "Synthetic profile; exact continuous-curvature certificate range, not actual game build support" },
    commonMultiGcdChord: { durations, k: multiK, tierRange: [0, 200], checkedRowPoints: multiChordPoints, maximizingRows: [...maximizingRows].map(i => profiles[i].gcd), left: R(multiLeft, multiScale), right: R(multiRight, multiScale), scope: "Common-domain upper relaxation only; actual GCD still selects one row" } },
  counterexamples: { invalidConcaveChord: { q: "1+x", k: 2, interval: [0, 3], x: 1, feasibleLinearValue: "3/4", unsafeChord: "5/6" }, generalCubic: { q: genericQ, k: 4, h: "1-x", stationaryPoints: ["1/20", "1/10", "1/4"], scope: "General positive cubic, not asserted representable by MNK coefficients" }, mnkTwoMaxima: { alpha: "1", beta: "1/4", gamma: "23/20", polynomial400q: mnkQ, h: "76487/25000-c", k: 4, derivativeTimes12500: mnkDerivative, sampleCoordinates: mnkSignPoints, exactDerivativeSamples: mnkSigns, signs: [1, -1, 1, -1], scope: "Valid nonnegative MNK polynomial family and positive affine segment; not an observed real gear hull or validated rotation" } },
  residueElimination: { cases: residueCases, cappedCases: cappedResidueCases, infeasibleCases: infeasibleResidueCases, brutePoints: residueBrutePoints, evaluations: residueEvaluations },
  budgetProfiles: { cases: budgetCases, brutePoints: budgetBrutePoints, profileQueries },
  fullProductSupport: { domains: candidateDomains, configurations: candidateConfigurations, candidateChecks, certifiedDeletions, supportQueries, incumbent: "First full configuration, never oracle optimum", exclusions: "Every deleted candidate checked against every completion; strict inequality preserves ties" },
}, (_, value) => typeof value === "bigint" ? value.toString() : value, 2));
