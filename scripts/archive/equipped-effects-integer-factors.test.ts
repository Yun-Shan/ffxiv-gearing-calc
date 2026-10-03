import assert from "node:assert/strict";
import test from "node:test";
import type { Job } from "../../src/domain/search/equipped-effects.ts";
import type { Stat } from "../../src/domain/types.ts";
import {
  createDamageGcdVectorEvaluator,
  createIntegerDamageFactorEvaluator,
  equippedEffects,
} from "../../src/domain/search/equipped-effects.ts";

const names: Stat[] = ["PDMG", "MDMG", "STR", "INT", "VIT", "CRT", "DET", "DHT", "TEN", "SKS", "SPS"];
const indexes = new Map(names.map((name, index) => [name, index] as const));
const max = names.map(() => 20_000);

function vector(values: Partial<Record<Stat, number>>): number[] {
  return names.map((name) => values[name] ?? 0);
}

function reconstruct(factors: ReturnType<ReturnType<typeof createIntegerDamageFactorEvaluator>>): number {
  assert.ok(factors);
  return 0.01 * factors.weaponDamage * (factors.mainStat / 100) *
    (factors.determination / 1000) * (factors.tenacity / 1000) *
    factors.traitMultiplier * (factors.critical / 1_000_000) *
    (factors.directHit / 4000);
}

for (const job of ["RDM", "BLU"] as Job[]) {
  test(`${job} integer factors reconstruct exact evaluator damage incl. food contributions`, () => {
    const contributions = vector({
      PDMG: job === "BLU" ? 0 : 0,
      MDMG: 165,
      STR: 320,
      INT: 430,
      VIT: 510,
      CRT: 740,
      DET: 410,
      DHT: 255,
      TEN: 190,
      SPS: 210,
    });
    // Simulate food already applied by the caller (the evaluator's contract).
    contributions[indexes.get("CRT")!] += 125;
    contributions[indexes.get("INT")!] += 80;
    const factors = createIntegerDamageFactorEvaluator(job, 100, indexes)(contributions);
    const exact = equippedEffects(job, 100, Object.fromEntries(
      names.map((name, index) => [name, contributions[index]]),
    ));
    const optimized = createDamageGcdVectorEvaluator(job, 100, indexes, max)(contributions);
    assert.ok(factors && exact && optimized);
    assert.ok(Math.abs(reconstruct(factors) - exact.damage) < 1e-12);
    assert.equal(factors.gcdCentiseconds, Math.round(exact.gcd * 100));
    assert.ok(Math.abs(reconstruct(factors) - optimized.damage) < 1e-12);
  });
}

test("integer factors preserve damage ranking over known RDM vectors", () => {
  const evaluateFactors = createIntegerDamageFactorEvaluator("RDM", 100, indexes);
  const evaluateExact = (attributes: number[]) => equippedEffects(
    "RDM", 100, Object.fromEntries(names.map((name, index) => [name, attributes[index]])),
  )!.damage;
  const vectors = [
    vector({ MDMG: 160, INT: 700, CRT: 900, DET: 600, DHT: 300, SPS: 250 }),
    vector({ MDMG: 162, INT: 690, CRT: 920, DET: 610, DHT: 280, SPS: 270 }),
    vector({ MDMG: 155, INT: 720, CRT: 850, DET: 640, DHT: 340, SPS: 220 }),
  ];
  const order = (a: number, b: number) => Math.sign(a - b);
  for (let left = 0; left < vectors.length; left++) {
    for (let right = left + 1; right < vectors.length; right++) {
      const a = evaluateFactors(vectors[left]!);
      const b = evaluateFactors(vectors[right]!);
      assert.ok(a && b);
      assert.equal(order(reconstruct(a), reconstruct(b)), order(evaluateExact(vectors[left]!), evaluateExact(vectors[right]!)));
    }
  }
});
