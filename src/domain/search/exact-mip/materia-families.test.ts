import { expect, test, vi } from "vitest";
import type { Stat } from "../../types.ts";
import type { ExactMipOptions } from "./types.ts";
import type { EquipInfo } from "../types.ts";
import { boundedMateriaCounts, prepareMateriaFamilyProjection } from "../core/materia-family-projection.ts";
import { prepareMateriaFamilies, materiaModelFamilies } from "./materia-families.ts";
import { prepareExactMipModel } from "./model-preparation.ts";
import { createDamageGcdVectorEvaluator, createIntegerDamageFactorEvaluator } from "../equipped-effects.ts";
import { findBestLoadoutExactMip } from "./single-search.ts";

const stats: Stat[] = ["PDMG", "STR", "CRT", "DET", "DHT", "SKS", "TEN"];
const units = [36, 54, 36];
const axes = [2, 3, 4];
function slot(itemId: number, lower = [0, 0, 0]): EquipInfo[] {
  return boundedMateriaCounts([2, 2, 2], 2).map((count) => {
    const amounts = count.map((value, axis) => value + lower[axis]!);
    const values = [75, 1500, 200, 200, 200, 100, 0];
    axes.forEach((coordinate, axis) => { values[coordinate] += amounts[axis]! * units[axis]!; });
    const melds = amounts.flatMap((amount, axis) => Array.from({ length: amount }, () => [stats[axes[axis]!]!, units[axis]!, 12]));
    return { itemId, itemLevel: 795, key: "", variantKey: JSON.stringify(melds),
      baseParams: values.map((value, index) => ({ baseParamId: index + 1, value })), PDMG: 75, MDMG: 0, DLY: 3 };
  });
}
function optionsFor(slots: EquipInfo[][] = [slot(1), slot(2)]): ExactMipOptions {
  const statIndexes = new Map(stats.map((stat, index) => [stat, index]));
  return { job: "WAR", jobLevel: 100, clanIndex: 0, objective: "damage", attributeIds: [1, 2, 3, 4, 5, 6, 7], statIndexes,
    slots, foods: [], speedAttributeId: 6, toughnessAttributeId: 7,
    evaluationFunction: createDamageGcdVectorEvaluator("WAR", 100, statIndexes), maxSearchMs: 10_000 };
}

test("the slot/item/grade union supplies absent-stat units and certifies every actual count/attribute point", () => {
  const options = optionsFor();
  const prepared = prepareMateriaFamilies(options, { maxMs: Infinity });
  expect(prepared.metadata.families).toHaveLength(2);
  expect(prepared.metadata.families.map(({ counts }) => counts.length)).toEqual([6, 6]);
  expect(prepared.metadata.families[0]).toMatchObject({ coordinates: axes, units, remaining: 2, capacities: [2, 2, 2] });
  expect(new Set(prepared.metadata.families[0]!.counts.map((count) => count.join(","))).size).toBe(6);
  const shifted = prepareMateriaFamilies(optionsFor([slot(1, [1, 0, 0])]), { maxMs: Infinity }).metadata.families[0]!;
  expect(shifted.fixedAttributes[2]).toBe(236);
  expect(shifted.remaining).toBe(2);
  expect(shifted.counts).toEqual(prepared.metadata.families[0]!.counts);
});

test("a partial last-materia cap is a separate fixed-offset mode, never rounded to a full unit", () => {
  const candidates = slot(1);
  for (const candidate of candidates) candidate.baseParams[2]!.value = Math.min(candidate.baseParams[2]!.value, 254);
  const prepared = prepareMateriaFamilies(optionsFor([candidates]), { maxMs: Infinity });
  expect(prepared.metadata.families).toHaveLength(1);
  expect(prepared.metadata.families[0]!.counts).toHaveLength(5);
  expect(prepared.metadata.families[0]!.capacities).toEqual([1, 2, 2]);
  const uncovered = candidates.flatMap((candidate, index) => prepared.metadata.families[0]!.memberIndexes.includes(index) ? [] : [candidate]);
  expect(uncovered).toHaveLength(1);
  expect(uncovered[0]!.baseParams[2]!.value).toBe(254);
});

test.each(["missing", "duplicate", "mixed-grade", "unknown-stat", "conflicting-unit", "dynamic", "singleton", "unsafe"] as const)(
  "uncertified candidate groups retain the original choices: %s", (kind) => {
    let candidates = slot(1);
    if (kind === "missing") candidates = candidates.filter((_, index) => index !== 1);
    if (kind === "duplicate") candidates = [...candidates, structuredClone(candidates[0]!)];
    if (kind === "mixed-grade") for (const candidate of candidates) {
      const melds = JSON.parse(candidate.variantKey!); melds[0][2] = 10; candidate.variantKey = JSON.stringify(melds);
    }
    if (kind === "unknown-stat") for (const candidate of candidates) candidate.variantKey = '[["UNKNOWN",36,12],["UNKNOWN",36,12]]';
    if (kind === "conflicting-unit") {
      const melds = JSON.parse(candidates[0]!.variantKey!); for (const meld of melds) meld[1]++; candidates[0]!.variantKey = JSON.stringify(melds);
    }
    if (kind === "dynamic") for (const candidate of candidates) candidate.resistanceAllocation = [];
    if (kind === "singleton") candidates = [candidates[0]!];
    if (kind === "unsafe") candidates[0]!.baseParams[2]!.value = Number.MAX_SAFE_INTEGER + 1;
    expect(prepareMateriaFamilies(optionsFor([candidates]), { maxMs: Infinity }).metadata.families).toEqual([]);
  });

test("numeric Worker certificates are recertified after transport and never trusted across candidate/schema changes", () => {
  const options = optionsFor();
  const metadata = prepareMateriaFamilies(options, { maxMs: Infinity }).metadata;
  const transported = structuredClone(options.slots) as EquipInfo[][];
  for (const candidate of transported.flat()) delete candidate.variantKey;
  const decoded = { ...options, slots: transported, materiaFamilyMetadata: structuredClone(metadata) };
  expect(prepareMateriaFamilies(decoded, { maxMs: Infinity }).metadata.families).toHaveLength(2);
  transported[0]!.reverse();
  expect(prepareMateriaFamilies(decoded, { maxMs: Infinity }).metadata.families).toHaveLength(1);
  const differentSchema = { ...decoded, attributeIds: [...decoded.attributeIds].reverse() };
  expect(prepareMateriaFamilies(differentSchema, { maxMs: Infinity }).metadata.families).toEqual([]);
  const missing = { ...options, slots: [options.slots[0]!.slice(1), options.slots[1]!], materiaFamilyMetadata: metadata };
  expect(prepareMateriaFamilies(missing, { maxMs: Infinity }).metadata.families).toHaveLength(1);
});

test("family preparation budget/cancellation discards every partial certificate", () => {
  const options = optionsFor();
  expect(prepareMateriaFamilies(options, { maxPoints: 1 }).metadata.families).toEqual([]);
  expect(prepareMateriaFamilies(options, { maxMs: 0 }).metadata.families).toEqual([]);
  let checks = 0;
  const cancelled = { ...options, isCancelled: () => ++checks > 20 };
  expect(() => prepareMateriaFamilies(cancelled, { maxMs: Infinity })).toThrow("搜索已取消");
});

test.each([null, {}, { attributeIds: null, families: [] }, { attributeIds: [1, 2, 3, 4, 5, 6, 7], families: [null, {}, { counts: [null] }] }])(
  "malformed Worker metadata safely retains the original model: %j", (metadata) => {
    const options = { ...optionsFor(), materiaFamilyMetadata: metadata as unknown as ExactMipOptions["materiaFamilyMetadata"] };
    expect(prepareMateriaFamilies(options, { maxMs: Infinity }).metadata.families).toEqual([]);
  });

test.each(["damage", "dps"] as const)("actual prepared WAR model and complete exact search preserve independent full Cartesian %s optimum", async (objective) => {
  const options = optionsFor();
  options.objective = objective;
  options.foods = [{ itemId: 40, itemLevel: 795, key: "40", baseParams: [{ baseParamId: 3, baseValue: 73, multiplier: 1.1, maxValue: 27 }] },
    { itemId: 41, itemLevel: 795, key: "41", baseParams: [{ baseParamId: 4, baseValue: 19, multiplier: 1.25, maxValue: 39 }] }];
  const preparation = await prepareExactMipModel(options);
  expect(preparation).toBeDefined();
  const families = materiaModelFamilies(prepareMateriaFamilies(options, { maxMs: Infinity }), preparation!.model);
  expect(families).toHaveLength(2);
  const request = { name: "prepared-WAR", variables: preparation!.model.bounds, rows: preparation!.model.rows,
    binaryVariables: preparation!.model.binaryVars, integerVariables: preparation!.model.generalVars, objective: new Map(), materiaFamilies: families };
  const projected = prepareMateriaFamilyProjection(request, { maxMs: Infinity });
  expect(projected?.statistics.variablesRemoved).toBe(7);
  const factor = createIntegerDamageFactorEvaluator("WAR", 100, options.statIndexes);
  let best = { product: 0n, gcd: 1 };
  for (const first of options.slots[0]!) for (const second of options.slots[1]!) for (let food = 0; food < 2; food++) {
    const attributes = options.attributeIds.map((id) => [...first.baseParams, ...second.baseParams].filter(({ baseParamId }) => baseParamId === id).reduce((sum, parameter) => sum + parameter.value, 0));
    if (food === 0) attributes[2] += Math.min(27, Number((BigInt(attributes[2]!) + 73n) / 10n));
    else attributes[3] += Math.min(39, Number((BigInt(attributes[3]!) + 19n) / 4n));
    const value = factor(attributes)!;
    const product = [value.weaponDamage, value.mainStat, value.determination, value.tenacity, value.critical, value.directHit].reduce((total, term) => total * BigInt(term), 1n);
    if (product * BigInt(best.gcd) > best.product * BigInt(objective === "dps" ? value.gcdCentiseconds : 1)) best = { product, gcd: objective === "dps" ? value.gcdCentiseconds : 1 };
  }
  vi.stubEnv("FFXIV_PROFILE_TIMING", "1");
  const profiles: Record<string, unknown>[] = [];
  options.onSolverProgress = (event) => { if (event.message?.startsWith("PROFILE ")) profiles.push(JSON.parse(event.message.slice(8))); };
  try {
    const result = await findBestLoadoutExactMip(options);
    expect(result?.statistics.signatureBandProof).toBe(true);
    expect(result!.statistics.materiaFamilies!.requests.some(({ variablesRemoved }) => variablesRemoved > 0)).toBe(true);
    const attributes = options.attributeIds.map((id) => result!.selection.flatMap(({ baseParams }) => baseParams).filter(({ baseParamId }) => baseParamId === id).reduce((sum, parameter) => sum + parameter.value, 0));
    const foodIndex = options.foods.indexOf(result!.food!);
    if (foodIndex === 0) attributes[2] += Math.min(27, Number((BigInt(attributes[2]!) + 73n) / 10n));
    else attributes[3] += Math.min(39, Number((BigInt(attributes[3]!) + 19n) / 4n));
    const actual = factor(attributes)!;
    const product = [actual.weaponDamage, actual.mainStat, actual.determination, actual.tenacity, actual.critical, actual.directHit].reduce((total, term) => total * BigInt(term), 1n);
    expect(product * BigInt(best.gcd)).toBe(best.product * BigInt(objective === "dps" ? actual.gcdCentiseconds : 1));
    result!.selection.forEach((candidate, index) => expect(options.slots[index]).toContain(candidate));
    expect(profiles.some((profile) => profile.phase === "materia-family-projection" && Number(profile.variablesRemoved) > 0)).toBe(true);
  } finally { vi.unstubAllEnvs(); }
});
