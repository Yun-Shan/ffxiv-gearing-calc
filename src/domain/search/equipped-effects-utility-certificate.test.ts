import { expect, test } from "vitest";
import { gameData } from "../data.ts";
import { createIntegerDamageFactorEvaluator, integerDamageUtilityCertificate } from "./equipped-effects.ts";
import type { Stat } from "../types.ts";

const indexes = () => new Map<Stat, number>([["PDMG", 0], ["STR", 1], ["CRT", 2], ["DET", 3],
  ["DHT", 4], ["SKS", 5], ["TEN", 6], ["INT", 7], ["MDMG", 8], ["SPS", 9]]);

test("factory utility certificates bind copied coordinates and reject unregistered closures", () => {
  const original = indexes();
  const evaluator = createIntegerDamageFactorEvaluator("SAM", 100, original, 0);
  const values = [150, 3000, 600, 500, 400, 100, 0, 0, 0, 0];
  const factors = evaluator(values);
  const certificate = integerDamageUtilityCertificate(evaluator);
  expect(certificate).toBeDefined();
  original.set("STR", 0);
  expect(evaluator(values)).toEqual(factors);
  expect(integerDamageUtilityCertificate(evaluator)).toEqual(certificate);
  expect(integerDamageUtilityCertificate((attributes) => evaluator(attributes))).toBeUndefined();
  expect(integerDamageUtilityCertificate(createIntegerDamageFactorEvaluator("SAM", 100, original, 0))?.key).not.toBe(certificate!.key);
});

test("certificate keys reflect numerical formula dependencies and ignore trait constants", () => {
  const evaluator = createIntegerDamageFactorEvaluator("SAM", 100, indexes(), 0);
  const key = integerDamageUtilityCertificate(evaluator)!.key;
  expect(integerDamageUtilityCertificate(createIntegerDamageFactorEvaluator("SAM", 100, indexes(), 4))!.key).not.toBe(key);
  expect(integerDamageUtilityCertificate(createIntegerDamageFactorEvaluator("SAM", 90, indexes(), 0))!.key).not.toBe(key);
  expect(integerDamageUtilityCertificate(createIntegerDamageFactorEvaluator("BLU", 80, indexes(), 0))!.key).not.toBe(key);
  const level = gameData.jobLevelModifiers[100]!;
  for (const field of ["main", "sub", "div", "det", "detTrunc", "ap"] as const) {
    const previous = level[field];
    try {
      level[field] = previous + 1;
      expect(integerDamageUtilityCertificate(evaluator)!.key, field).not.toBe(key);
    } finally { level[field] = previous; }
  }
  const schema = gameData.jobSchemas.SAM!;
  const oldParty = schema.partyBonus;
  const oldTrait = schema.traitDamageMultiplier;
  const oldGcd = schema.statModifiers!.gcd;
  const oldStrength = schema.statModifiers!.STR;
  try {
    schema.partyBonus = 1.11;
    expect(integerDamageUtilityCertificate(evaluator)!.key).not.toBe(key);
    schema.partyBonus = oldParty;
    schema.statModifiers!.gcd = 90;
    expect(integerDamageUtilityCertificate(evaluator)!.key).not.toBe(key);
    schema.statModifiers!.gcd = oldGcd;
    schema.statModifiers!.STR = oldStrength! + 100;
    expect(integerDamageUtilityCertificate(evaluator)!.key).not.toBe(key);
    schema.statModifiers!.STR = oldStrength;
    schema.traitDamageMultiplier = oldTrait! + 1;
    expect(integerDamageUtilityCertificate(createIntegerDamageFactorEvaluator("SAM", 100, indexes(), 0))!.key).toBe(key);
  } finally {
    schema.partyBonus = oldParty; schema.traitDamageMultiplier = oldTrait;
    schema.statModifiers!.gcd = oldGcd; schema.statModifiers!.STR = oldStrength;
  }
});
