import { equippedEffects, equippedSpeedRangeForGcd, equippedToughnessForMitigationPercent } from "./equipped-effects.ts";
import { findBestLoadoutExactMip } from "./loadout-finder-exact-mip.ts";
import type { ExactMipOptions } from "./loadout-finder-exact-mip.ts";
import type { HighsCallbackTrace, LinearMipProgress } from "./linear-mip.ts";
import type {
  SerializedBaselineOptions,
  SerializedBaselineResult,
} from "./parallel-baseline-executor.ts";
import type { Stats } from "../types.ts";
import type { EquipInfo, FoodInfo, ParamInfo } from "./types.ts";
import { markCanonicalEvaluatorCandidateUpperBound } from "./exact-mip-candidate-upper-bound.ts";

export type BaselineWorkerCallbacks = {
  onProgress?: (message: string) => void;
  onSolverProgress?: (progress: LinearMipProgress) => void;
  onSolverCallback?: (trace: HighsCallbackTrace) => void;
};

function assertOffsets(
  offsets: Uint32Array,
  entryCount: number,
  valueCount: number,
  label: string,
): void {
  if (offsets.length !== entryCount + 1 || offsets[0] !== 0 || offsets[offsets.length - 1] !== valueCount) {
    throw new Error(`基线工作线程的${label}索引列无效`);
  }
  for (let index = 1; index < offsets.length; index++) {
    if (offsets[index]! < offsets[index - 1]!) {
      throw new Error(`基线工作线程的${label}索引列无效`);
    }
  }
}

function decodeEquipmentColumns(
  columns: SerializedBaselineOptions["slots"],
): EquipInfo[][] {
  const candidateCount = columns.itemIds.length;
  const parameterCount = columns.parameterIds.length;
  if (columns.itemLevels.length !== candidateCount ||
    columns.parameterValues.length !== parameterCount ||
    columns.ringSlotKinds.length !== candidateCount ||
    columns.ringSlotIndexes.length !== candidateCount ||
    columns.uniqueKinds.length !== candidateCount) {
    throw new Error("基线工作线程的装备数值列长度不匹配");
  }
  assertOffsets(columns.slotOffsets, columns.slotOffsets.length - 1, candidateCount, "槽位");
  assertOffsets(columns.parameterOffsets, candidateCount, parameterCount, "装备属性");

  const candidates: EquipInfo[] = new Array(candidateCount);
  for (let candidateIndex = 0; candidateIndex < candidateCount; candidateIndex++) {
    const baseParams: ParamInfo[] = [];
    for (let parameterIndex = columns.parameterOffsets[candidateIndex]!;
      parameterIndex < columns.parameterOffsets[candidateIndex + 1]!;
      parameterIndex++) {
      baseParams.push({
        baseParamId: columns.parameterIds[parameterIndex]!,
        value: columns.parameterValues[parameterIndex]!,
      });
    }
    const equipment: EquipInfo = {
      itemId: columns.itemIds[candidateIndex]!,
      itemLevel: columns.itemLevels[candidateIndex]!,
      key: "",
      baseParams,
      PDMG: 0,
      MDMG: 0,
      DLY: 0,
    };
    const ringSlotKind = columns.ringSlotKinds[candidateIndex]!;
    if (ringSlotKind === 1) equipment.ringSlotIndex = columns.ringSlotIndexes[candidateIndex]! as 0 | 1;
    else if (ringSlotKind !== 0) equipment.ringSlotIndex = null as unknown as 0 | 1;
    const uniqueKind = columns.uniqueKinds[candidateIndex]!;
    if (uniqueKind === 1) equipment.isUnique = false;
    else if (uniqueKind === 2) equipment.isUnique = true;
    else if (uniqueKind !== 0) equipment.isUnique = null as unknown as boolean;
    candidates[candidateIndex] = equipment;
  }

  const slots: EquipInfo[][] = [];
  for (let slotIndex = 0; slotIndex + 1 < columns.slotOffsets.length; slotIndex++) {
    slots.push(candidates.slice(columns.slotOffsets[slotIndex]!, columns.slotOffsets[slotIndex + 1]!));
  }
  return slots;
}

function decodeFoodColumns(columns: SerializedBaselineOptions["foods"]): FoodInfo[] {
  const parameterCount = columns.parameterIds.length;
  if (columns.baseValues.length !== parameterCount || columns.hasBaseValues.length !== parameterCount ||
    columns.multipliers.length !== parameterCount || columns.maxValues.length !== parameterCount) {
    throw new Error("基线工作线程的食物数值列长度不匹配");
  }
  const foodCount = columns.offsets.length - 1;
  assertOffsets(columns.offsets, foodCount, parameterCount, "食物");
  const foods: FoodInfo[] = [];
  for (let foodIndex = 0; foodIndex < foodCount; foodIndex++) {
    const baseParams = [];
    for (let parameterIndex = columns.offsets[foodIndex]!;
      parameterIndex < columns.offsets[foodIndex + 1]!;
      parameterIndex++) {
      baseParams.push({
        baseParamId: columns.parameterIds[parameterIndex]!,
        ...(columns.hasBaseValues[parameterIndex] === 1
          ? { baseValue: columns.baseValues[parameterIndex]! }
          : {}),
        multiplier: columns.multipliers[parameterIndex]!,
        maxValue: columns.maxValues[parameterIndex]!,
      });
    }
    foods.push({ itemId: 0, itemLevel: 0, key: "", baseParams });
  }
  return foods;
}

export async function solveSerializedBaseline(
  request: SerializedBaselineOptions,
  callbacks: BaselineWorkerCallbacks,
): Promise<SerializedBaselineResult | undefined> {
  const statIndexes = new Map(request.statIndexes);
  const clanIndex = request.clanIndex;
  const slots = decodeEquipmentColumns(request.slots);
  const foods = decodeFoodColumns(request.foods);
  const exactOptions: ExactMipOptions = {
    job: request.job,
    jobLevel: request.jobLevel,
    clanIndex,
    attributeIds: request.attributeIds,
    statIndexes,
    slots,
    foods,
    ...(request.constraints === undefined ? {} : { constraints: request.constraints }),
    ...(request.speedAttributeId === undefined ? {} : { speedAttributeId: request.speedAttributeId }),
    ...(request.toughnessAttributeId === undefined ? {} : { toughnessAttributeId: request.toughnessAttributeId }),
    gcdToSpeedRange: (gcd) => equippedSpeedRangeForGcd(request.job, request.jobLevel, gcd, clanIndex),
    ...(request.toughnessAttributeId === undefined ? {} : {
      toughnessPercentToMinimum: (percent) =>
        equippedToughnessForMitigationPercent(request.job, request.jobLevel, percent, clanIndex),
    }),
    evaluationFunction: (attributes) => {
      const contributions: Stats = {};
      for (const [stat, index] of statIndexes) contributions[stat] = attributes[index] ?? 0;
      const effects = equippedEffects(request.job, request.jobLevel, contributions, clanIndex);
      return effects === undefined ? undefined : { damage: effects.damage, gcd: effects.gcd };
    },
    objective: request.objective,
    ...(request.candidateItemLevelRanges === undefined
      ? {}
      : { candidateItemLevelRanges: request.candidateItemLevelRanges }),
    ...(request.candidateResourceSupportProfile === undefined
      ? {}
      : { candidateResourceSupportProfile: request.candidateResourceSupportProfile }),
    ...(request.resourceBudgetCandidateProfile === undefined
      ? {}
      : { resourceBudgetCandidateProfile: request.resourceBudgetCandidateProfile }),
    ...(request.enableCanonicalEvaluatorCandidateUpperBound === true
      ? { enableCanonicalEvaluatorCandidateUpperBound: true as const }
      : {}),
    maxSearchMs: request.maxSearchMs,
    ...(callbacks.onProgress === undefined ? {} : { onProgress: callbacks.onProgress }),
    ...(callbacks.onSolverProgress === undefined ? {} : { onSolverProgress: callbacks.onSolverProgress }),
    ...(callbacks.onSolverCallback === undefined ? {} : { onSolverCallback: callbacks.onSolverCallback }),
  };
  if (request.enableCanonicalEvaluatorCandidateUpperBound === true) {
    markCanonicalEvaluatorCandidateUpperBound(exactOptions);
  }
  const result = await findBestLoadoutExactMip(exactOptions);
  if (result === undefined) return undefined;
  const selectionIndexes = result.selection.map((equipment, slotIndex) => {
    const candidateIndex = slots[slotIndex]?.indexOf(equipment) ?? -1;
    if (candidateIndex < 0) throw new Error(`基线求解结果不属于槽位候选：${slotIndex}`);
    return candidateIndex;
  });
  const foodIndex = result.food === undefined ? undefined : foods.indexOf(result.food);
  if (foodIndex !== undefined && foodIndex < 0) throw new Error("基线求解结果不属于食物候选");
  const { selection: _selection, food: _food, ...resultFields } = result;
  return { ...resultFields, selectionIndexes, foodIndex };
}
