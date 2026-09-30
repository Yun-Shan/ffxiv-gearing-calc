import assert from "node:assert/strict";
import test from "node:test";
import {
  hasStrictlyBetterFactorCombination,
  type SignatureBandFactorGroup,
  type SignatureBandIncumbent,
} from "./signature-band.ts";

const damageNames = ["weapon", "main", "det", "ten", "crt", "dht"] as const;
const allNames = [...damageNames, "gcd"] as const;

function incumbent(values: Partial<SignatureBandIncumbent> = {}): SignatureBandIncumbent {
  return {
    weaponDamage: 3,
    mainStat: 11,
    determination: 7,
    tenacity: 5,
    critical: 13,
    directHit: 17,
    gcdCentiseconds: 250,
    ...values,
  };
}

function exactBetter(
  groups: readonly SignatureBandFactorGroup[],
  objective: "damage" | "dps",
  baseline: SignatureBandIncumbent,
  qMinimum: number,
  qMaximum: number,
): boolean {
  const relevant = objective === "dps"
    ? groups
    : groups.filter((group) => group.name !== "gcd");
  let better = false;
  const walk = (index: number, q: number, product: bigint, gcd: bigint): void => {
    if (better) return;
    if (index === relevant.length) {
      if (q < qMinimum || q > qMaximum) return;
      const baselineProduct = BigInt(baseline.weaponDamage) * BigInt(baseline.mainStat) *
        BigInt(baseline.determination) * BigInt(baseline.tenacity) *
        BigInt(baseline.critical) * BigInt(baseline.directHit);
      better = objective === "dps"
        ? product * BigInt(baseline.gcdCentiseconds) > baselineProduct * gcd
        : product > baselineProduct;
      return;
    }
    const group = relevant[index]!;
    for (const factorClass of group.classes) {
      walk(
        index + 1,
        q + factorClass.q,
        group.name === "gcd" ? product : product * BigInt(factorClass.value),
        group.name === "gcd" ? BigInt(factorClass.value) : gcd,
      );
    }
  };
  walk(0, 0, 1n, BigInt(baseline.gcdCentiseconds));
  return better;
}

test("signature band compares exact DPS fractions, including strict ties", () => {
  const baseline = incumbent({ weaponDamage: 2, mainStat: 1, determination: 1, tenacity: 1, critical: 1, directHit: 1, gcdCentiseconds: 2 });
  const groups: SignatureBandFactorGroup[] = [
    { name: "weapon", classes: [{ q: 0, value: 2 }, { q: 0, value: 3 }] },
    ...damageNames.slice(1).map((name) => ({ name, classes: [{ q: 0, value: 1 }] })),
    { name: "gcd", classes: [{ q: 0, value: 2 }] },
  ];
  // The q=0 product-3 / GCD-2 candidate is strictly above 2 / 2.
  assert.equal(hasStrictlyBetterFactorCombination({
    groups,
    objective: "dps",
    incumbent: baseline,
    qMinimum: 0,
    qMaximum: 0,
  }), true);

  const tied: SignatureBandFactorGroup[] = [
    { name: "weapon", classes: [{ q: 0, value: 3 }] },
    ...damageNames.slice(1).map((name) => ({ name, classes: [{ q: 0, value: 1 }] })),
    { name: "gcd", classes: [{ q: 0, value: 3 }] },
  ];
  // Product 3 / GCD 3 ties the incumbent's 2 / GCD 2 and is not better.
  assert.equal(hasStrictlyBetterFactorCombination({
    groups: tied,
    objective: "dps",
    incumbent: baseline,
    qMinimum: 0,
    qMaximum: 0,
  }), false);
});

test("damage mode ignores the GCD factor and uses strict exact products", () => {
  const baseline = incumbent({ weaponDamage: 2, mainStat: 1, determination: 1, tenacity: 1, critical: 1, directHit: 1 });
  const groups: SignatureBandFactorGroup[] = [
    { name: "weapon", classes: [{ q: 0, value: 2 }, { q: 0, value: 3 }] },
    ...damageNames.slice(1).map((name) => ({ name, classes: [{ q: 0, value: 1 }] })),
    { name: "gcd", classes: [{ q: 500, value: 1 }, { q: -500, value: 1000 }] },
  ];
  assert.equal(hasStrictlyBetterFactorCombination({
    groups,
    objective: "damage",
    incumbent: baseline,
    qMinimum: 0,
    qMaximum: 0,
  }), true);
  assert.equal(hasStrictlyBetterFactorCombination({
    groups: groups.map((group) => group.name === "weapon"
      ? { ...group, classes: [{ q: 0, value: 2 }] }
      : group),
    objective: "damage",
    incumbent: baseline,
    qMinimum: 0,
    qMaximum: 0,
  }), false);
});

test("tiny Cartesian signatures match a brute-force BigInt oracle", () => {
  let seed = 0x51a7;
  const random = (maximum: number): number => {
    seed = (seed * 1_103_515_245 + 12_345) & 0x7fffffff;
    return seed % maximum;
  };
  for (const objective of ["damage", "dps"] as const) {
    for (let trial = 0; trial < 60; trial++) {
      const names = objective === "dps" ? allNames : damageNames;
      const groups: SignatureBandFactorGroup[] = names.map((name) => ({
        name,
        classes: Array.from({ length: 2 }, () => ({
          q: random(7) - 3,
          value: name === "gcd" ? 1 + random(8) : 1 + random(20),
        })),
      }));
      const baseline = incumbent({
        weaponDamage: 1 + random(15),
        mainStat: 1 + random(15),
        determination: 1 + random(15),
        tenacity: 1 + random(15),
        critical: 1 + random(15),
        directHit: 1 + random(15),
        gcdCentiseconds: 1 + random(8),
      });
      const qMinimum = random(11) - 8;
      const qMaximum = qMinimum + random(8);
      assert.equal(
        hasStrictlyBetterFactorCombination({ groups, objective, incumbent: baseline, qMinimum, qMaximum }),
        exactBetter(groups, objective, baseline, qMinimum, qMaximum),
        `${objective} brute-force mismatch on trial ${trial}`,
      );
    }
  }
});

test("cap and expired deadline conservatively request exact MIP fallback", () => {
  const groups: SignatureBandFactorGroup[] = damageNames.map((name) => ({
    name,
    classes: [{ q: 0, value: 1 }, { q: 1, value: 1 }],
  }));
  const baseline = incumbent({ weaponDamage: 100 });
  assert.equal(hasStrictlyBetterFactorCombination({
    groups,
    objective: "damage",
    incumbent: baseline,
    qMinimum: -10,
    qMaximum: 10,
    maxHalfCombinations: 1,
  }), true);
  assert.equal(hasStrictlyBetterFactorCombination({
    groups,
    objective: "damage",
    incumbent: baseline,
    qMinimum: -10,
    qMaximum: 10,
    deadline: () => true,
  }), true);
});

test("feasibility callback filters only exact better tuples conservatively", () => {
  const groups: SignatureBandFactorGroup[] = [
    { name: "weapon", classes: [{ q: 0, value: 2 }, { q: 0, value: 3 }] },
    ...damageNames.slice(1).map((name) => ({ name, classes: [{ q: 0, value: 1 }] })),
  ];
  const baseline = incumbent({ weaponDamage: 2, mainStat: 1, determination: 1, tenacity: 1, critical: 1, directHit: 1 });
  let rejectedSignatures = 0;
  assert.equal(hasStrictlyBetterFactorCombination({
    groups,
    objective: "damage",
    incumbent: baseline,
    qMinimum: 0,
    qMaximum: 0,
    isPossiblyFeasible: (signature) => {
      rejectedSignatures++;
      assert.equal(signature.length, damageNames.length);
      assert.ok(signature.some((factor) => factor.name === "weapon" && factor.q === 0 && factor.value === 3));
      return false;
    },
  }), false);
  assert.ok(rejectedSignatures > 0);

  assert.equal(hasStrictlyBetterFactorCombination({
    groups,
    objective: "damage",
    incumbent: baseline,
    qMinimum: 0,
    qMaximum: 0,
    isPossiblyFeasible: () => true,
  }), true);
  assert.equal(hasStrictlyBetterFactorCombination({
    groups,
    objective: "damage",
    incumbent: baseline,
    qMinimum: 0,
    qMaximum: 0,
    isPossiblyFeasible: () => { throw new Error("unavailable proof"); },
  }), true);
});
