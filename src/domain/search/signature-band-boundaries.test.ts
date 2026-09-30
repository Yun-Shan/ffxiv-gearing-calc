import assert from "node:assert/strict";
import { test } from "vitest";
import {
  hasStrictlyBetterFactorCombination,
  type SignatureBandFactorGroup,
  type SignatureBandIncumbent,
  type SignatureBandOptions,
} from "./signature-band.ts";

const damageNames = ["weapon", "main", "det", "ten", "crt", "dht"] as const;

function incumbent(values: Partial<SignatureBandIncumbent> = {}): SignatureBandIncumbent {
  return {
    weaponDamage: 1,
    mainStat: 1,
    determination: 1,
    tenacity: 1,
    critical: 1,
    directHit: 1,
    gcdCentiseconds: 1,
    ...values,
  };
}

function groupsFromQValues(
  qValues: readonly (readonly number[])[],
  valueFor?: (groupIndex: number, classIndex: number) => number,
): SignatureBandFactorGroup[] {
  return damageNames.map((name, groupIndex) => ({
    name,
    classes: (qValues[groupIndex] ?? [0]).map((q, classIndex) => ({
      q,
      value: valueFor?.(groupIndex, classIndex) ?? 1,
    })),
  }));
}

function options(
  groups: readonly SignatureBandFactorGroup[],
  overrides: Partial<SignatureBandOptions> = {},
): SignatureBandOptions {
  return {
    groups,
    objective: "damage",
    incumbent: incumbent(),
    qMinimum: 0,
    qMaximum: 0,
    ...overrides,
  };
}

test("malformed group entries conservatively request exact MIP fallback", () => {
  const groups = groupsFromQValues(damageNames.map(() => [0]));
  assert.equal(hasStrictlyBetterFactorCombination(options(
    [null, ...groups] as unknown as SignatureBandFactorGroup[],
  )), true);
});

test("safe q arithmetic falls back when total, partition, or band subtraction overflows", () => {
  const maximum = Number.MAX_SAFE_INTEGER;

  assert.equal(hasStrictlyBetterFactorCombination(options(
    groupsFromQValues(damageNames.map(() => [maximum])),
    { qMaximum: maximum },
  )), true, "the total q extrema exceed safe integer precision");

  assert.equal(hasStrictlyBetterFactorCombination(options(
    groupsFromQValues([[-maximum], [maximum], [maximum], [-maximum], [0], [0]]),
  )), true, "a partition can overflow even when the total extrema remain safe");

  assert.equal(hasStrictlyBetterFactorCombination(options(
    groupsFromQValues([
      [-3, -2, -1, 0],
      [-maximum + 3],
      [0, maximum - 3],
      [0, maximum - 3],
      [0],
      [0],
    ]),
  )), true, "a reverse suffix bound can overflow while both half extrema remain safe");

  assert.equal(hasStrictlyBetterFactorCombination(options(
    groupsFromQValues([[0], [1], [0], [0], [0], [0]]),
    { qMinimum: -maximum, qMaximum: maximum },
  )), true, "deriving a half-band can overflow despite safe input bounds");
});

test("an intersecting q envelope can still prove an empty half", () => {
  assert.equal(hasStrictlyBetterFactorCombination(options(
    groupsFromQValues([[0, 2], [0], [0], [0], [0], [0]]),
    { qMinimum: 1, qMaximum: 1 },
  )), false);

  assert.equal(hasStrictlyBetterFactorCombination(options(
    groupsFromQValues([[0, 60], [0], [0], [0, 100], [0], [0]]),
    { qMinimum: 65, qMaximum: 69 },
  )), false, "the left half can have states while the right half has none");
});

test("deadline stops enumeration on either half and catches a later callback error", () => {
  const values = Array.from({ length: 16 }, (_, q) => q);
  const groups = groupsFromQValues(damageNames.map(() => values));
  const band = { qMinimum: 0, qMaximum: 90 };

  let leftCalls = 0;
  assert.equal(hasStrictlyBetterFactorCombination(options(groups, {
    ...band,
    deadline: () => ++leftCalls === 2,
  })), true);

  let rightCalls = 0;
  assert.equal(hasStrictlyBetterFactorCombination(options(groups, {
    ...band,
    deadline: () => ++rightCalls === 3,
  })), true);

  let errorCalls = 0;
  assert.equal(hasStrictlyBetterFactorCombination(options(groupsFromQValues(damageNames.map(() => [0])), {
    deadline: () => {
      if (++errorCalls === 2) throw new Error("deadline check failed during pair scan");
      return false;
    },
  })), true);
});

test("deadline during merge sorting safely requests exact MIP fallback", () => {
  const values = Array.from({ length: 20 }, (_, q) => q);
  let calls = 0;
  assert.equal(hasStrictlyBetterFactorCombination(options(
    groupsFromQValues(damageNames.map(() => values)),
    {
      qMaximum: 120,
      deadline: () => ++calls === 6,
    },
  )), true);
  assert.equal(calls, 6, "the deadline is reached after both halves are enumerated");
});

test("deadline is checked during right-state and periodic pair scans", () => {
  const groups = groupsFromQValues(damageNames.map(() => [0]));
  let outerCalls = 0;
  assert.equal(hasStrictlyBetterFactorCombination(options(groups, {
    deadline: () => ++outerCalls === 2,
  })), true);

  const fourClasses = [0, 1, 2, 3];
  let pairCalls = 0;
  assert.equal(hasStrictlyBetterFactorCombination(options(
    groupsFromQValues(damageNames.map(() => fourClasses)),
    {
      qMaximum: 18,
      deadline: () => ++pairCalls === 18,
    },
  )), true);
  assert.equal(pairCalls, 18, "the deadline is reached at the 1,024th candidate pair");
});

test("enumeration work and state caps conservatively request exact MIP fallback", () => {
  const manyWeaponClasses = Array.from({ length: 20_001 }, (_, q) => q);
  assert.equal(hasStrictlyBetterFactorCombination(options(
    groupsFromQValues([[...manyWeaponClasses], [0], [0], [0], [0], [0]]),
    {
      qMinimum: 20_000,
      qMaximum: 20_000,
      maxHalfCombinations: 1,
    },
  )), true, "the node bound stops a sparse high-q search");

  const elevenClasses = Array.from({ length: 11 }, (_, q) => q);
  assert.equal(hasStrictlyBetterFactorCombination(options(
    groupsFromQValues(damageNames.map(() => elevenClasses)),
    { qMaximum: 60, maxHalfCombinations: 1_025 },
  )), true, "the 16-bit state buffer grows before the configured cap is reached");
});

test("32-bit choices retain factor index 65,536 and grow safely", () => {
  const wideClasses = Array.from({ length: 0x1_0001 }, (_, q) => ({
    q,
    value: q === 0x1_0000 ? 2 : 1,
  }));
  const groups = [
    { name: "weapon", classes: wideClasses },
    ...damageNames.slice(1).map((name) => ({ name, classes: [{ q: 0, value: 1 }] })),
  ] satisfies SignatureBandFactorGroup[];

  assert.equal(hasStrictlyBetterFactorCombination(options(groups, {
    qMinimum: 0x1_0000,
    qMaximum: 0x1_0000,
  })), true, "the high factor index resolves to its own exact value");

  assert.equal(hasStrictlyBetterFactorCombination(options(groups, {
    qMaximum: 0x1_0000,
    incumbent: incumbent({ weaponDamage: 2 }),
    maxHalfCombinations: 1_025,
  })), true, "the 32-bit choice buffer grows and the cap triggers fallback");
});
