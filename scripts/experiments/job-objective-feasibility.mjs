// Research only: synthetic stats and action weights, never imported by production.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

const bytes = new Uint8Array(await readFile(new URL("../../src/data/generated-data.bin", import.meta.url)));
globalThis.__FFXIV_GENERATED_DATA_BINARY__ = bytes;
const [{ gameData }, { jobSchemas }, rules, effectsModule, factorModule, mip] = await Promise.all([
  import("../../src/domain/data.ts"), import("../../src/domain/jobs.ts"),
  import("../../src/domain/rules.ts"), import("../../src/domain/search/equipped-effects.ts"),
  import("../../src/domain/search/exact-mip/factor-model.ts"),
  import("../../src/domain/search/exact-mip/single-search.ts"),
]);
const { equippedEffects, createIntegerDamageFactorEvaluator } = effectsModule;
const names = ["PDMG", "STR", "CRT", "DET", "DHT", "SKS", "TEN"];
const indexes = new Map(names.map((name, i) => [name, i]));
const evaluateFactors = createIntegerDamageFactorEvaluator("MNK", 100, indexes);
const base = rules.calculateBaseStats(jobSchemas.MNK, 100);
const vectorOf = stats => names.map(name => stats[name] ?? 0);
function makeRow(stats) {
  const effects = equippedEffects("MNK", 100, stats);
  const factors = evaluateFactors(vectorOf(stats));
  assert.ok(effects && factors);
  return { stats, effects, factors };
}

// 100 synthetic eligible weaponskills: 75 normal, 25 forced crit, all 300 potency.
// Spender: synthetic 400 potency per 5 chakra, proc rate 1, infinite-window mean.
// No buffs, overflow, end remainder, autos, DoTs or animation lock in this model.
// All scores use a common denominator 15,000 * 1e6 for the critical factor.
function score(row, mode) {
  const f = row.factors;
  const c = BigInt(Math.round(row.effects.crtChance * 1000));
  const k = BigInt(Math.round(row.effects.crtDamage * 1000));
  const n = BigInt(f.critical);
  const common = BigInt(f.weaponDamage) * BigInt(f.mainStat) *
    BigInt(f.determination) * BigInt(f.tenacity) * BigInt(f.directHit);
  if (mode === "ordinary") return common * 15000n * n;
  const mixed = 15n * (750n * n + 250_000n * k);
  return common * (mixed + (mode === "chakra" ? (1000n + 3n * c) * n : 0n));
}
function floatingScore(row, mode) {
  const { crtChance: c, crtDamage: k, damage } = row.effects;
  const normal = 1 + c * (k - 1);
  const adjusted = mode === "ordinary" ? normal : .75 * normal + .25 * k +
    (mode === "chakra" ? ((1 + 3 * c) / 15) * normal : 0);
  return damage * adjusted / normal;
}
const modes = ["ordinary", "forcedCritical", "chakra"];
const rows = [];
for (let crit = 0; crit <= 4000; crit++) {
  const row = makeRow({ PDMG: 150, STR: 4000, CRT: crit, DET: 1500, DHT: 4000 - crit, SKS: 600 });
  const { effects, factors } = row;
  const display = rules.calculateEffects({ stats: rules.addStats(base, row.stats), job: jobSchemas.MNK, level: 100, weaponDamage: 150 });
  assert.ok(Math.abs(display.damage - effects.damage) < 1e-10);
  assert.equal(factorModule.exactProduct(factors) * 15000n, score(row, "ordinary"));
  // Independent direct sum vs collapsed critical factor.
  const unit = effects.damage / ((1 + effects.crtChance * (effects.crtDamage - 1)) * (1 + .25 * effects.dhtChance));
  const direct = 22500 * unit * (1 + effects.crtChance * (effects.crtDamage - 1)) * (1 + .25 * effects.dhtChance) +
    7500 * unit * effects.crtDamage * (1 + .25 * effects.dhtChance) +
    400 * ((25 + 75 * effects.crtChance) / 5) * effects.damage;
  assert.ok(Math.abs(direct / 30000 - floatingScore(row, "chakra")) < 1e-10);
  for (const mode of modes) {
    const reconstructed = Number(score(row, mode)) / 15000 / 1e6 / 4000 / 1000 / 1000 / 100 * .01 * factors.traitMultiplier;
    assert.ok(Math.abs(reconstructed - floatingScore(row, mode)) < 1e-10);
  }
  rows.push(row);
}
function best(mode) { return rows.reduce((a, b) => score(b, mode) > score(a, mode) ? b : a); }
function summarize(row) {
  return { contributions: row.stats, totalCRT: base.CRT + row.stats.CRT, totalDHT: base.DHT + row.stats.DHT,
    critChance: row.effects.crtChance, gcd: row.effects.gcd,
    scores: Object.fromEntries(modes.map(mode => [mode, floatingScore(row, mode)])) };
}
function witness(oldMode, newMode) {
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j <= Math.min(i + 100, rows.length - 1); j++) {
      const oldDifference = score(rows[i], oldMode) - score(rows[j], oldMode);
      const newDifference = score(rows[i], newMode) - score(rows[j], newMode);
      if (oldDifference * newDifference < 0n) {
        const [oldWinner, newWinner] = oldDifference > 0n ? [rows[i], rows[j]] : [rows[j], rows[i]];
        return { oldMode, newMode, oldWinner: summarize(oldWinner), newWinner: summarize(newWinner) };
      }
    }
  }
  throw new Error(`No reversal found: ${oldMode} -> ${newMode}`);
}

// Finite window: 5 certain chakra + Binomial(15, .25), instant spending, no overflow.
let distribution = [1n];
for (let i = 0; i < 15; i++) {
  const next = new Array(distribution.length + 1).fill(0n);
  distribution.forEach((v, k) => { next[k] += 3n * v; next[k + 1] += v; });
  distribution = next;
}
const denominator = 4n ** 15n;
assert.equal(distribution.reduce((a, b) => a + b, 0n), denominator);
const numerator = distribution.reduce((sum, p, k) => sum + p * BigInt(Math.floor((5 + k) / 5)), 0n);
const exactSpenders = Number(numerator) / Number(denominator);
const meanChakraDividedByFive = (5 + 15 * .25) / 5;
assert.ok(exactSpenders < meanChakraDividedByFive);

// Real current MIP with synthetic options: changing the callback alone is insufficient.
const vectors = [[160, 3000, 0, 1500, 500, 500, 0], [160, 3000, 50, 1450, 500, 500, 0]];
const options = vectors.map((vector, i) => ({ itemId: i + 1, itemLevel: 795, key: String(i),
  baseParams: vector.map((value, baseParamId) => ({ baseParamId, value })), PDMG: 160, MDMG: 0, DLY: 0 }));
const forcedDamage = vector => {
  const e = equippedEffects("MNK", 100, Object.fromEntries(names.map((name, i) => [name, vector[i]])));
  return { damage: e.damage * e.crtDamage / (1 + e.crtChance * (e.crtDamage - 1)), gcd: e.gcd };
};
const chosen = await mip.findBestLoadoutExactMip({ job: "MNK", jobLevel: 100,
  attributeIds: names.map((_, i) => i), statIndexes: indexes, slots: [options],
  foods: [{ itemId: 999, itemLevel: 0, key: "empty", baseParams: [] }], speedAttributeId: 5,
  objective: "damage", maxSearchMs: 10000, evaluationFunction: forcedDamage });
assert.ok(chosen?.statistics.signatureBandProof);
assert.equal(chosen.selection[0].itemId, 1);
assert.ok(forcedDamage(vectors[1]).damage > forcedDamage(vectors[0]).damage);
const ordinaryExact = vectors.map(v => factorModule.exactProduct(evaluateFactors(v)));
const forcedExact = vectors.map(v => {
  const f = evaluateFactors(v);
  const e = equippedEffects("MNK", 100, Object.fromEntries(names.map((name, i) => [name, v[i]])));
  return BigInt(f.weaponDamage) * BigInt(f.mainStat) * BigInt(f.determination) *
    BigInt(f.tenacity) * BigInt(f.directHit) * BigInt(Math.round(e.crtDamage * 1000));
});
assert.ok(ordinaryExact[0] > ordinaryExact[1] && forcedExact[0] < forcedExact[1]);

const speedRows = [42, 43].map(SKS => makeRow({ PDMG: 160, STR: 3000, CRT: 500, DET: 500, DHT: 500, SKS }));
assert.deepEqual(speedRows[0].factors, speedRows[1].factors);
assert.notEqual(speedRows[0].effects.ssDamage, speedRows[1].effects.ssDamage);
const criticalClasses = new Set(rows.map(row => row.factors.critical)).size;
const collapsedCriticalClasses = new Set(rows.map(row => {
  const f = row.factors;
  const common = BigInt(f.weaponDamage) * BigInt(f.mainStat) * BigInt(f.determination) *
    BigInt(f.tenacity) * BigInt(f.directHit);
  return String(score(row, "chakra") / common);
})).size;
const directHitClasses = new Set(rows.map(row => row.factors.directHit)).size;
assert.equal(criticalClasses, collapsedCriticalClasses);
console.log(JSON.stringify({
  scope: "Synthetic sensitivity experiments; no legal loadout, rotation accuracy, modified-MIP proof or performance claim",
  provenance: { runAt: new Date().toISOString(), node: process.version,
    repositoryCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    gameVersion: gameData.version, referenceCommit: gameData.provenance.commit,
    binarySha256: createHash("sha256").update(bytes).digest("hex") },
  cases: rows.length,
  syntheticProfile: { normalWeaponskills: 75, guaranteedCriticalWeaponskills: 25, weaponskillPotency: 300, chakraSpenderPotency: 400, chakraCost: 5, procRate: 1 },
  gridOptima: Object.fromEntries(modes.map(mode => [mode, summarize(best(mode))])),
  reversals: [witness("ordinary", "forcedCritical"), witness("forcedCritical", "chakra")],
  finiteWindow: { expectedSpenders: { numerator: String(numerator), denominator: String(denominator), approximate: exactSpenders }, meanChakraDividedByFive },
  callbackOnlyMip: { vectors, chosenItemId: chosen.selection[0].itemId,
    exhaustiveForcedCriticalWinner: 2, forcedCriticalScores: vectors.map(v => forcedDamage(v).damage),
    ordinaryExactNumerators: ordinaryExact.map(String), forcedExactNumerators: forcedExact.map(String),
    proofScope: "unchanged ordinary six-factor objective", signatureBandProof: chosen.statistics.signatureBandProof, solverRuns: chosen.statistics.solverRuns },
  signatureCollision: speedRows.map(row => ({ SKS: row.stats.SKS, gcd: row.effects.gcd, ssDamage: row.effects.ssDamage, factors: row.factors })),
  domainShape: { criticalClasses, collapsedCriticalClasses, directHitClasses,
    independentClassCount: criticalClasses + directHitClasses,
    naiveCartesianClassCount: criticalClasses * directHitClasses,
    caveat: "Cartesian size illustration only; most pairs need not be reachable under the fixed budget; no timing of a new model" },
}, null, 2));
