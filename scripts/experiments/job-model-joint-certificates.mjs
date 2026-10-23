// Isolated finite-domain certificates. All assertions use exact BigInt rationals.
// Run: node scripts/experiments/job-model-joint-certificates.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { R, add, sub, mul, div, cmp, hull } from "../../docs/数学探索-证明与复现/docs/mathematical-analysis/theorems/coupled-product-support/support.mjs";
import { uniquePairOracle, uniquePairHull } from "../../docs/数学探索-证明与复现/docs/mathematical-analysis/theorems/unique-pair-support/unique-pair-hull.mjs";

const initialSeed = 0x6a09e667;
let seed = initialSeed;
const rand = n => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed % n;
};
let assertions = 0;
const check = (condition, message) => { assertions++; assert.ok(condition, message); };
const equal = (a, b, message) => check(cmp(a, b) === 0, message);
const sum = xs => xs.reduce(add, R(0));
const product = xs => xs.reduce(mul, R(1));
const max = xs => xs.reduce((a, b) => cmp(a, b) >= 0 ? a : b);
const min = (a, b) => cmp(a, b) <= 0 ? a : b;
const serial = q => ({ numerator: String(q.n), denominator: String(q.d) });
const cartesian = pools => pools.reduce((rows, pool) => rows.flatMap(row => pool.map(x => [...row, x])), [[]]);

// h fixes every shared identity. Private choices then form a Cartesian product.
// Each g has its own coefficients and cycle duration; scores use one common unit.
function makeDomain(index) {
  const jobs = 2 + index % 3;
  const sharedStates = 3 + rand(3);
  const gcds = 2 + index % 2;
  const profiles = Array.from({ length: jobs }, () => Array.from({ length: gcds }, (_, g) => ({
    g: 240 + g * 5, A: 100 + rand(80), B: 10 + rand(70), C: 1 + rand(9), duration: 90 + rand(61),
  })));
  const domains = Array.from({ length: sharedStates }, (_, h) => profiles.map((gs, j) => gs.flatMap((p, gi) =>
    Array.from({ length: 2 }, (_, privateId) => {
      const c = BigInt(80 + rand(260));
      const k = BigInt(1300 + rand(400));
      const N = R(1000000n + c * (k - 1000n), 1000000n);
      const K = R(k, 1000n);
      const score = div(mul(R(900 + rand(151)), add(add(mul(R(p.A), N), mul(R(p.B), K)), mul(R(p.C), mul(R(c, 1000), N)))), R(p.duration));
      return { h, job: j, g: p.g, privateId, score, admissible: gi === 0 || rand(5) !== 0 };
    }).filter(x => x.admissible))));
  return { jobs, sharedStates, gcds, profiles, domains };
}

// A rational upper rounding of sqrt(eta), with no floating-point root/log.
function sqrtUpper(q, scale = 1000000n) {
  check(q.n >= 0n, "nonnegative sqrt input");
  let lo = 0n, hi = scale;
  while (hi * hi * q.d < q.n * scale * scale) hi *= 2n;
  while (lo < hi) {
    const mid = (lo + hi) / 2n;
    if (mid * mid * q.d >= q.n * scale * scale) hi = mid;
    else lo = mid + 1n;
  }
  const h = R(lo, scale);
  check(cmp(mul(h, h), q) >= 0, "sqrt upper rounding");
  return h;
}

const domainRows = [];
let jointRows = 0, tubeChecks = 0, retainedRows = 0;
for (let index = 0; index < 96; index++) {
  const model = makeDomain(index);
  const { jobs, domains } = model;
  // Baseline spans ALL h and ALL allowed g for each job, before shared equality.
  const baselines = Array.from({ length: jobs }, (_, j) => max(domains.flatMap(h => h[j].map(x => x.score))));
  const rows = domains.flatMap((pools, h) => cartesian(pools).map(choices => {
    const ratios = choices.map((x, j) => div(x.score, baselines[j]));
    ratios.forEach(r => check(cmp(r, R(0)) > 0 && cmp(r, R(1)) <= 0, "global OPT ratio domain"));
    return { h, choices, ratios, S: sum(ratios), P: product(ratios) };
  }));
  jointRows += rows.length;
  const Smax = max(rows.map(x => x.S)), Pmax = max(rows.map(x => x.P));
  const decomposed = max(domains.map(pools => sum(pools.map((pool, j) => div(max(pool.map(x => x.score)), baselines[j])))));
  equal(Smax, decomposed, "fixed shared, per-job cross-GCD optimum equals full enumeration");
  const U = add(R(jobs - 1), Pmax);
  check(cmp(Smax, U) <= 0, "exact product oracle gives valid sum upper bound");
  // Both a weak seed and an exact product-optimum seed; neither uses a log oracle.
  const productSeed = rows.find(x => cmp(x.P, Pmax) === 0);
  const incumbents = [rows[0].S, productSeed.S];
  const localization = [];
  for (const S0 of incumbents) {
    const eta = sub(U, S0);
    check(eta.n >= 0n, "eta from certified Pmax is nonnegative");
    let width = sqrtUpper(eta);
    const dmin = sub(R(1), Pmax);
    if (dmin.n > 0n) width = min(width, div(mul(R(jobs), eta), dmin));
    let incumbentRetained = 0, tubeExcluded = 0;
    for (const row of rows) {
      const losses = row.ratios.map(r => sub(R(1), r));
      const E = sub(add(R(jobs - 1), row.P), row.S);
      check(E.n >= 0n, "sum <= J-1+product");
      for (let a = 0; a < jobs; a++) for (let b = a + 1; b < jobs; b++)
        check(cmp(mul(losses[a], losses[b]), E) <= 0, "every loss pair <= E");
      const outsideTube = losses.filter(l => cmp(l, width) > 0).length > 1;
      if (outsideTube) tubeExcluded++;
      if (cmp(row.S, S0) < 0) continue;
      retainedRows++;
      incumbentRetained++;
      check(cmp(E, eta) <= 0, "every tying/improving point has E <= eta");
      check(!outsideTube, "union of J sparse tubes covers every tying/improving point");
      tubeChecks++;
    }
    localization.push({ incumbentSum: serial(S0), eta: serial(eta), widthUpper: serial(width),
      tyingOrImproving: incumbentRetained, excludedByTube: tubeExcluded });
  }
  // Demonstrates a conservative rational weakening of an ALREADY exact Pmax.
  // It does NOT certify any rounded-log proxy or production MIP optimum.
  const L = 1000000n, m = BigInt(jobs * 7);
  const relaxedProduct = mul(Pmax, R(L, L - m));
  const relaxedU = min(R(jobs), add(R(jobs - 1), relaxedProduct));
  check(cmp(Smax, relaxedU) <= 0, "L/(L-m) rational weakening remains conservative");
  domainRows.push({ index, jobs, sharedStates: model.sharedStates, gcdsPerJob: model.gcds,
    jointRows: rows.length, localOptionCounts: domains.map(h => h.map(pool => pool.length)),
    globalBaselines: baselines.map(serial), Smax: serial(Smax), Pmax: serial(Pmax), U: serial(U),
    productSeedSum: serial(productSeed.S), eta: serial(sub(U, productSeed.S)), relaxedU: serial(relaxedU), localization });
}

// Exact equality/tie boundaries supplement the seeded domains.
for (const ratios of [[R(1), R(1), R(9, 10)], [R(1), R(1), R(1)]]) {
  const S = sum(ratios), P = product(ratios), eta = sub(add(R(ratios.length - 1), P), S);
  equal(eta, R(0), "at most one loss is the equality case");
  const width = sqrtUpper(eta);
  check(ratios.map(r => sub(R(1), r)).filter(l => cmp(l, width) > 0).length <= 1, "eta=0 still preserves ties");
}

// Old complete normalized functions coincide. New nonproportional coefficient
// rows read the same feature space but no longer define the same function.
const features = [{ N: 120n, K: 140n }, { N: 110n, K: 180n }];
const evaluate = (weights, z) => weights[0] * z.N + weights[1] * z.K;
function quotientComparison(weightRows) {
  const table = weightRows.map(w => features.map(z => R(evaluate(w, z))));
  const baselines = table.map(max);
  const ratios = table.map((row, j) => row.map(x => div(x, baselines[j])));
  const full = max(cartesian(ratios).map(sum));
  const forcedSameFeature = max(features.map((_, z) => sum(ratios.map(row => row[z]))));
  return { full, forcedSameFeature, ratios, weightRows };
}
const old = quotientComparison([[1n, 0n], [1n, 0n]]);
const identicalFull = quotientComparison([[10n, 1n], [10n, 1n]]);
const changed = quotientComparison([[10n, 1n], [1n, 10n]]);
equal(old.full, old.forcedSameFeature, "old target equivalence permits quotient");
equal(identicalFull.full, identicalFull.forcedSameFeature, "same COMPLETE new function preserves optimum");
check(cmp(changed.full, changed.forcedSameFeature) > 0, "nonproportional new coefficients invalidate old quotient");
check(10n * 10n - 1n * 1n !== 0n, "new coefficient rows are nonproportional");

// Metadata is consistent by physical item ID across both asymmetric slot pools.
// Meld variants can share ID. Unique exclusion is applied to the ID, not variant.
const compatible = (a, b) => a.id !== b.id || !a.unique;
const value = (p, price) => p.y * price.d - price.n * BigInt(p.x);
let pairDomains = 0, rawPairs = 0, legalPairs = 0, queries = 0, oracleCalls = 0;
let emptyDomains = 0, nonuniqueDuplicatePairs = 0, negativePriceQueries = 0;
function verifyPairs(A, B) {
  const metadata = new Map();
  for (const p of [...A, ...B]) {
    if (metadata.has(p.id)) check(metadata.get(p.id) === p.unique, "unique metadata consistent by ID");
    else metadata.set(p.id, p.unique);
  }
  const pairs = A.flatMap(a => B.filter(b => compatible(a, b)).map(b => {
    if (a.id === b.id) nonuniqueDuplicatePairs++;
    return { x: a.x + b.x, y: a.y + b.y, indices: [a.index, b.index] };
  }));
  pairDomains++; rawPairs += A.length * B.length; legalPairs += pairs.length;
  if (!pairs.length) emptyDomains++;
  const actualHull = uniquePairHull(A, B);
  oracleCalls += actualHull.oracleCalls;
  assertions++; assert.deepEqual(actualHull.points, hull(pairs.map(p => [p.x, p.y])));
  for (const price of [R(-10000), R(0), R(10000), ...Array.from({ length: 25 }, () => R(rand(401) - 200, 1 + rand(23)))]) {
    queries++; if (price.n < 0n) negativePriceQueries++;
    const answer = uniquePairOracle(A, B, price);
    check((answer === null) === (pairs.length === 0), "oracle infeasibility matches exhaustive legal pairs");
    if (!answer) continue;
    const best = pairs.reduce((a, b) => value(a, price) >= value(b, price) ? a : b);
    check(value(answer, price) === value(best, price), "rational price support equals full legal pairing");
    const a = A.find(p => p.index === answer.indices[0]), b = B.find(p => p.index === answer.indices[1]);
    check(Boolean(a && b && compatible(a, b)), "oracle indices restore a legal physical pair");
    check(answer.x === a.x + b.x && answer.y === a.y + b.y, "oracle reconstruction exact");
    const hullBest = actualHull.points.reduce((bestValue, [x, y]) => {
      const next = value({ x, y }, price);
      return bestValue === null || next > bestValue ? next : bestValue;
    }, null);
    check(hullBest === value(best, price), "hull support exact; interior is not a physical candidate");
  }
}
verifyPairs([], []);
verifyPairs([{ id: 1, unique: true, index: 0, x: 0, y: 1n }], [{ id: 1, unique: true, index: 0, x: 1, y: 2n }]);
verifyPairs([{ id: 1, unique: false, index: 0, x: 0, y: -1n }], [{ id: 1, unique: false, index: 0, x: 1, y: 2n }]);
for (let trial = 0; trial < 600; trial++) {
  const ids = Array.from({ length: 7 }, (_, id) => ({ id, unique: rand(3) !== 0 }));
  const make = () => Array.from({ length: 1 + rand(11) }, (_, index) => ({
    ...ids[rand(ids.length)], index, x: rand(70), y: BigInt(rand(601) - 300),
  }));
  verifyPairs(make(), make());
}
// A hull relaxation point may have no pair witness; never return it as a loadout.
const hullRelaxationWitness = { legalPoints: [[0, 0n], [2, 2n]], interpolatedPoint: [1, 1n] };
check(!hullRelaxationWitness.legalPoints.some(([x, y]) => x === 1 && y === 1n), "hull interior need not be reachable");

const sourcePaths = [
  "docs/数学探索-证明与复现/docs/mathematical-analysis/theorems/product-proxy-localization/README.md",
  "docs/数学探索-证明与复现/docs/mathematical-analysis/theorems/equivalent-job-quotient/README.md",
  "docs/数学探索-证明与复现/docs/mathematical-analysis/theorems/unique-pair-support/unique-pair-hull.mjs",
  "docs/数学探索-证明与复现/docs/mathematical-analysis/theorems/coupled-product-support/support.mjs",
  "docs/research/职业循环建模/04-多职业联合搜索.md",
  "scripts/experiments/job-model-joint-certificates.mjs",
];
const root = new URL("../../", import.meta.url);
const sources = sourcePaths.map(path => ({ path, sha256: createHash("sha256").update(readFileSync(new URL(path, root))).digest("hex") }));
const result = {
  status: "pass", seed: initialSeed, finalSeed: seed, assertions,
  provenance: { node: process.version, currentCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(), sources },
  scope: {
    domains: "Deterministic synthetic finite domains; all joint points enumerated. Coefficients, private choices and GCD labels are illustrative, not real rotation or legal game gear data.",
    arithmetic: "Exact reduced BigInt fractions; no floating-point log, exp or sqrt used as evidence. Imported archive oracle/hull primitives are pure mathematics.",
    productOracle: "Pmax is certified by exhaustive enumeration of this finite domain, not by a new or existing production MIP backend. L/(L-m) only weakens this exact bound; it does not establish a rounded-log error premise.",
    limits: "No production backend, real rotation coefficients, real equipment search, solver speedup, or performance acceptance is implemented or claimed. Hull vertices provide support; interpolated hull points are not physical candidates.",
  },
  decompositionAndLocalization: { domains: domainRows.length, jointRows, tubeChecks, retainedRows, rows: domainRows },
  quotient: { features, old, identicalFull, changed, gap: sub(changed.full, changed.forcedSameFeature) },
  uniquePairs: { domains: pairDomains, rawPairs, legalPairs, queries, oracleCalls, emptyDomains, nonuniqueDuplicatePairs, negativePriceQueries, hullRelaxationWitness },
};
console.log(JSON.stringify(result, (_, v) => typeof v === "bigint" ? String(v) : v, 2));
