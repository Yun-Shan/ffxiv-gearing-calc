import type { ExactMipOptions } from "./types.ts";
import type { LinearMipRow } from "../linear-mip.ts";
import type { MateriaCountFamily, MateriaModelFamily } from "../core/materia-family-projection.ts";
import { validMateriaCountFamily } from "../core/materia-family-projection.ts";
import { throwIfCancelled } from "../cancellation.ts";
import type { Stat } from "../../types.ts";

export type MateriaFamilyCertificate = MateriaCountFamily & { slotIndex: number; itemId: number; memberIndexes: readonly number[] };
/** Numeric sidechannel only: never changes Worker variant keys or equipment identity. */
export type MateriaFamilyMetadata = { attributeIds: readonly number[]; families: readonly MateriaFamilyCertificate[] };
export type MateriaFamilyPreparation = { metadata: MateriaFamilyMetadata; points: number; rejectedGroups: number; elapsedMs: number; skipReason?: string };
type Limits = { maxPoints?: number; maxMs?: number };
class Abandon extends Error {}
const safeInteger = (value: number) => Number.isSafeInteger(value) && value >= 0;

function attributes(options: ExactMipOptions, check: () => void): number[][][] {
  const indexes = new Map(options.attributeIds.map((id, index) => [id, index]));
  return options.slots.map((slot) => slot.map((equipment) => {
    check();
    const values = new Array<number>(options.attributeIds.length).fill(0);
    for (const parameter of options.equipmentAttributeExtractor?.(equipment) ?? equipment.baseParams) {
      const index = indexes.get(parameter.baseParamId);
      if (index !== undefined) values[index] += parameter.value;
    }
    return values;
  }));
}

/** Certificates always describe the current complete prepared slot arrays. */
export function prepareMateriaFamilies(options: ExactMipOptions, limits: Limits = {}): MateriaFamilyPreparation {
  const started = performance.now();
  let points = 0;
  let rejectedGroups = 0;
  const empty = (skipReason?: string): MateriaFamilyPreparation => ({ metadata: { attributeIds: [...options.attributeIds], families: [] },
    points, rejectedGroups, elapsedMs: performance.now() - started, ...(skipReason === undefined ? {} : { skipReason }) });
  const check = () => {
    throwIfCancelled(options.isCancelled);
    if (++points > (limits.maxPoints ?? 200_000)) throw new Abandon("work-budget");
    if (performance.now() - started >= (limits.maxMs ?? 100)) throw new Abandon("time-budget");
  };
  try {
    check();
    const vectors = attributes(options, check);
    if (new Set(options.attributeIds).size !== options.attributeIds.length || vectors.some((slot) => slot.some((value) => !value.every(safeInteger)))) return empty("invalid-attributes");
    const families: MateriaFamilyCertificate[] = [];
    const used = new Set<string>();
    const retain = (family: MateriaFamilyCertificate) => {
      check();
      if (family === null || typeof family !== "object" || !safeInteger(family.slotIndex) || !Array.isArray(family.memberIndexes)) return false;
      const slot = options.slots[family.slotIndex];
      if (!slot || !safeInteger(family.itemId) || !validMateriaCountFamily(family, check) || family.memberIndexes.length !== family.counts.length ||
        new Set(family.memberIndexes).size !== family.memberIndexes.length || family.fixedAttributes.length !== options.attributeIds.length) return false;
      for (const [member, candidateIndex] of family.memberIndexes.entries()) {
        check();
        if (!safeInteger(candidateIndex) || used.has(`${family.slotIndex}:${candidateIndex}`)) return false;
        const candidate = slot[candidateIndex];
        if (!candidate || candidate.itemId !== family.itemId || candidate.resistanceWeaponAdjust !== undefined || candidate.resistanceAllocation !== undefined) return false;
        const actual = vectors[family.slotIndex]![candidateIndex]!;
        for (let attribute = 0; attribute < actual.length; attribute++) {
          let value = BigInt(family.fixedAttributes[attribute]!);
          family.coordinates.forEach((coordinate, axis) => { if (coordinate === attribute) value += BigInt(family.units[axis]!) * BigInt(family.counts[member]![axis]!); });
          if (BigInt(actual[attribute]!) !== value) return false;
        }
      }
      family.memberIndexes.forEach((index) => used.add(`${family.slotIndex}:${index}`)); families.push(family); return true;
    };
    if (options.materiaFamilyMetadata !== undefined) {
      if (options.materiaFamilyMetadata === null || typeof options.materiaFamilyMetadata !== "object" ||
        !Array.isArray(options.materiaFamilyMetadata.attributeIds) || !Array.isArray(options.materiaFamilyMetadata.families)) return empty("invalid-metadata");
      if (options.materiaFamilyMetadata.attributeIds.length !== options.attributeIds.length ||
        !options.attributeIds.every((id, index) => id === options.materiaFamilyMetadata!.attributeIds[index])) return empty("stale-attribute-schema");
      for (const family of options.materiaFamilyMetadata.families) if (!retain(family)) rejectedGroups++;
    } else for (let slotIndex = 0; slotIndex < options.slots.length; slotIndex++) {
      type Parsed = { index: number; counts: Map<number, number>; values: Map<number, number>; grade: number; m: number };
      const blocks = new Map<string, Parsed[]>();
      for (const [index, equipment] of options.slots[slotIndex]!.entries()) {
        check();
        if (equipment.resistanceWeaponAdjust !== undefined || equipment.resistanceAllocation !== undefined || equipment.variantKey === undefined) continue;
        let melds: unknown;
        try { melds = JSON.parse(equipment.variantKey); } catch { continue; }
        if (!Array.isArray(melds) || melds.length === 0) continue;
        const counts = new Map<number, number>();
        const values = new Map<number, number>();
        let grade: number | undefined;
        let valid = true;
        for (const meld of melds) {
          check();
          if (!Array.isArray(meld) || meld.length !== 3 || typeof meld[0] !== "string" || !safeInteger(meld[1]) || meld[1] === 0 ||
            !safeInteger(meld[2]) || meld[2] === 0 || (grade !== undefined && grade !== meld[2])) { valid = false; break; }
          grade = meld[2];
          const axis = options.statIndexes.get(meld[0] as Stat);
          if (axis === undefined || !safeInteger(axis) || axis >= options.attributeIds.length || (values.has(axis) && values.get(axis) !== meld[1])) { valid = false; break; }
          counts.set(axis, (counts.get(axis) ?? 0) + 1); values.set(axis, meld[1]);
        }
        if (!valid || grade === undefined) { rejectedGroups++; continue; }
        const key = `${equipment.itemId}:${grade}`;
        const block = blocks.get(key) ?? [];
        block.push({ index, counts, values, grade, m: melds.length }); blocks.set(key, block);
      }
      for (const block of blocks.values()) {
        check();
        // Derive the unit of an absent stat from this whole slot/item/grade
        // block, then fill its zero count. A per-candidate unit would split it.
        const unitMap = new Map<number, number>();
        let consistent = true;
        for (const candidate of block) for (const [axis, unit] of candidate.values) {
          if (unitMap.has(axis) && unitMap.get(axis) !== unit) consistent = false;
          unitMap.set(axis, unit);
        }
        if (!consistent) { rejectedGroups++; continue; }
        const coordinates = [...unitMap.keys()].sort((a, b) => a - b);
        const units = coordinates.map((axis) => unitMap.get(axis)!);
        const groups = new Map<string, { offset: bigint[]; m: number; candidates: { index: number; count: number[] }[] }>();
        for (const candidate of block) {
          check();
          const count = coordinates.map((axis) => candidate.counts.get(axis) ?? 0);
          const offset = vectors[slotIndex]![candidate.index]!.map(BigInt);
          coordinates.forEach((coordinate, axis) => { offset[coordinate] -= BigInt(units[axis]!) * BigInt(count[axis]!); });
          const key = `${candidate.m}:${offset.join(",")}`;
          const group = groups.get(key) ?? { offset, m: candidate.m, candidates: [] };
          group.candidates.push({ index: candidate.index, count }); groups.set(key, group);
        }
        for (const { offset, m, candidates } of groups.values()) {
          check();
          if (candidates.length < 2) { rejectedGroups++; continue; }
          const lower = coordinates.map((_, axis) => candidates.reduce((minimum, { count }) => Math.min(minimum, count[axis]!), Infinity));
          const capacities = coordinates.map((_, axis) => candidates.reduce((maximum, { count }) => Math.max(maximum, count[axis]!), 0) - lower[axis]!);
          const counts = candidates.map(({ count }) => count.map((amount, axis) => amount - lower[axis]!));
          const fixed = [...offset];
          coordinates.forEach((coordinate, axis) => { fixed[coordinate] += BigInt(units[axis]!) * BigInt(lower[axis]!); });
          const fixedAttributes = fixed.map(Number);
          if (!fixedAttributes.every(safeInteger)) { rejectedGroups++; continue; }
          const family: MateriaFamilyCertificate = { slotIndex, itemId: options.slots[slotIndex]![candidates[0]!.index]!.itemId,
            grade: block[0]!.grade, coordinates, units, fixedAttributes, capacities,
            remaining: m - lower.reduce((sum, value) => sum + value, 0),
            counts, memberIndexes: candidates.map(({ index }) => index) };
          if (!retain(family)) rejectedGroups++;
        }
      }
    }
    check();
    return { metadata: { attributeIds: [...options.attributeIds], families }, points, rejectedGroups, elapsedMs: performance.now() - started };
  } catch (error) { if (error instanceof Abandon) return empty(error.message); throw error; }
}

export function materiaModelFamilies(preparation: MateriaFamilyPreparation, model: {
  slotVariables: readonly (readonly string[])[]; rows: readonly LinearMipRow[];
}): MateriaModelFamily[] {
  const dimension = preparation.metadata.attributeIds.length;
  const rawRows = Array.from({ length: dimension }, (_, axis) => model.rows.find((row) => row.name === `raw_sum_${axis}`));
  if (rawRows.some((row) => row === undefined)) return [];
  return preparation.metadata.families.flatMap((family) => {
    const slotVariables = model.slotVariables[family.slotIndex];
    const oneHotRow = model.rows.find((row) => row.name === `slot_${family.slotIndex}`);
    const members = family.memberIndexes.map((index) => slotVariables?.[index]);
    if (!slotVariables || !oneHotRow || members.some((name) => name === undefined)) return [];
    return [{ ...family, members: members as string[], slotVariables, oneHotRow, rawRows: rawRows as LinearMipRow[] }];
  });
}
