// Isolated finite-domain research oracle. No production search or profile is changed.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

const bytes = new Uint8Array(await readFile(new URL("../../src/data/generated-data.bin", import.meta.url)));
globalThis.__FFXIV_GENERATED_DATA_BINARY__ = bytes;
const [{ gameData }, effects] = await Promise.all([
  import("../../src/domain/data.ts"),
  import("../../src/domain/search/equipped-effects.ts"),
]);
const names = ["PDMG", "STR", "CRT", "DET", "DHT", "SKS", "TEN"];
const indexes = new Map(names.map((name, i) => [name, i]));
const factorAt = effects.createIntegerDamageFactorEvaluator("MNK", 100, indexes);
// Deliberately synthetic, not real rotations or production game data.
const profiles = [
  { gcd: 194, A: 12000, B: 4000, normalEvents: 40, forcedEvents: 13, duration: 120 },
  { gcd: 196, A: 11000, B: 4500, normalEvents: 36, forcedEvents: 15, duration: 120 },
  { gcd: 200, A: 10000, B: 5000, normalEvents: 33, forcedEvents: 17, duration: 120 },
];
const cmp = (a, b) => a.numerator * b.denominator - b.numerator * a.denominator;
const maximum = rows => rows.reduce((a, b) => cmp(b.score, a.score) > 0n ? b : a);
const fraction = (numerator, denominator) => ({ numerator, denominator });
const serialize = q => ({ numerator: String(q.numerator), denominator: String(q.denominator), approximate: Number(q.numerator) / Number(q.denominator) });
const rows = [];
for (const profile of profiles) {
  const speedRange = effects.equippedSpeedRangeForGcd("MNK", 100, profile.gcd / 100);
  assert.ok(speedRange);
  for (const crit of [0, 500, 1000, 1500, 2000]) {
    const stats = { PDMG: 150, STR: 4000, CRT: crit, DET: 1500, DHT: 5000 - crit - speedRange.min, SKS: speedRange.min, TEN: 0 };
    const e = effects.equippedEffects("MNK", 100, stats);
    const f = factorAt(names.map(name => stats[name]));
    assert.ok(e && f && stats.DHT >= 0);
    assert.equal(f.gcdCentiseconds, profile.gcd);
    assert.equal(Math.round(e.gcd * 100), profile.gcd);
    const c = BigInt(Math.round(e.crtChance * 1000));
    const k = BigInt(Math.round(e.crtDamage * 1000));
    const n = BigInt(f.critical);
    const a = BigInt(profile.A), b = BigInt(profile.B);
    // Resource cost 5 and spender potency 400 are synthetic fixture parameters.
    const criticalNumerator = (a * n + b * k * 1000n) * 5n * 1000n +
      400n * (BigInt(profile.forcedEvents) * 1000n + BigInt(profile.normalEvents) * c) * n;
    const criticalDenominator = 5n * 1000n * 1000000n * BigInt(profile.duration);
    const common = BigInt(f.weaponDamage) * BigInt(f.mainStat) * BigInt(f.determination) * BigInt(f.tenacity) * BigInt(f.directHit);
    assert.equal(f.traitMultiplier, 1);
    const score = fraction(common * criticalNumerator, 40000000000000n * criticalDenominator);
    const normal = 1 + e.crtChance * (e.crtDamage - 1);
    const explicit = e.damage / normal * (profile.A * normal + profile.B * e.crtDamage +
      400 / 5 * (profile.forcedEvents + profile.normalEvents * e.crtChance) * normal) / profile.duration;
    assert.ok(Math.abs(Number(score.numerator) / Number(score.denominator) - explicit) < 1e-9);
    rows.push({ id: `${profile.gcd}:${crit}`, gcd: profile.gcd, stats, score });
  }
}
const branches = profiles.map(p => maximum(rows.filter(row => row.gcd === p.gcd)));
const flatWinner = maximum(rows), branchWinner = maximum(branches);
assert.equal(cmp(flatWinner.score, branchWinner.score), 0n);
assert.equal(flatWinner.id, branchWinner.id);

// A 2x2 positive factor table is separable iff this determinant vanishes.
// Extreme ordinary/forced-critical rows are synthetic functions, not GCD recommendations.
const ordinary = [1020000n, 1195000n];
const forced = [1400000n, 1650000n];
const determinant = ordinary[0] * forced[1] - ordinary[1] * forced[0];
assert.notEqual(determinant, 0n);
const proportional = ordinary.map(value => 2n * value);
assert.equal(ordinary[0] * proportional[1] - ordinary[1] * proportional[0], 0n);

// Cross-GCD time denominators cannot be discarded.
assert.ok(400 > 300);
assert.ok(cmp(fraction(400n, 5n), fraction(300n, 3n)) < 0n);
// Wrong per-GCD normalization can reverse a two-job shared-choice ranking.
// Global optima are job1=110, job2=100. Shared A gives [90,100], B gives [108,90].
const globalA = fraction(90n * 100n + 100n * 110n, 110n * 100n);
const globalB = fraction(108n * 100n + 90n * 110n, 110n * 100n);
const perGcdA = fraction(90n * 100n + 100n * 90n, 90n * 100n);
const perGcdB = globalB;
assert.ok(cmp(globalB, globalA) > 0n);
assert.ok(cmp(perGcdA, perGcdB) > 0n);

console.log(JSON.stringify({
  scope: "Synthetic finite-domain algebra/oracle only; no real loadout, new MIP backend, combat accuracy or performance validation",
  provenance: { runAt: new Date().toISOString(), node: process.version,
    repositoryCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    gameVersion: gameData.version, binarySha256: createHash("sha256").update(bytes).digest("hex") },
  profiles, candidateCount: rows.length,
  branches: branches.map(row => ({ id: row.id, gcd: row.gcd, stats: row.stats, score: serialize(row.score) })),
  directEnumerationWinner: flatWinner.id, partitionWinner: branchWinner.id,
  nonseparableDeterminant: String(determinant),
  discardedTimeDenominatorCounterexample: { rawTotals: [400, 300], durations: [5, 3], rates: [80, 100] },
  jointNormalizationCounterexample: { globalA: serialize(globalA), globalB: serialize(globalB), wrongPerGcdA: serialize(perGcdA), wrongPerGcdB: serialize(perGcdB) },
}, null, 2));
