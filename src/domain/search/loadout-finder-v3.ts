import {
  createIntegerDamageFactorEvaluator,
  type IntegerDamageFactors,
} from "./equipped-effects.ts";
import {
  findBestLoadoutExactMip,
  findBestJointFactorMip,
  type ExactMipOptions,
  type ExactMipResult,
} from "./loadout-finder-exact-mip.ts";
import {
  hasCanonicalEvaluatorCandidateUpperBound,
  inheritCanonicalEvaluatorCandidateUpperBound,
} from "./exact-mip-candidate-upper-bound.ts";
import {
  hasSharedAccessoryPairDominancePath,
  markSharedAccessoryPairDominancePath,
} from "./shared-accessory-pair-dominance-policy.ts";
import { gameData } from "../data.ts";
import type { EquipInfo, FoodInfo, SharedSlotProjection } from "./types.ts";
import { equipmentIdentity } from "./equipment-identity.ts";
import { paretoRingCandidates } from "./candidate-pareto.ts";
import type { Stat } from "../types.ts";
import { getMemoryUsageSnapshot } from "./memory-usage.ts";
import { throwIfCancelled } from "./cancellation.ts";
import type { HighsCallbackTrace, LinearMipProgress } from "./linear-mip.ts";
import type { BaselineExecutor } from "./parallel-baseline-executor.ts";
import { baselineWorkerLimit } from "./baseline-worker-policy.ts";
import {
  candidateResourceSupportProfile as chooseCandidateResourceSupportProfile,
  shouldUseMainStatResourceSupportForBaseline,
  shouldUseMainStatResourceSupportForBaselineJob,
  shouldUsePrimaryResourceSupportsForBaseline,
  shouldUseSharedMateriaCompensation,
} from "./candidate-resource-support-policy.ts";

export type JointLoadoutJobV3 = {
  id: string;
  /** 槽位名称与 options.slots 对齐，从而允许不同职业使用不同槽位索引。 */
  slotNames: readonly string[];
  options: ExactMipOptions;
};

export type JointLoadoutV3Options = {
  jobs: readonly JointLoadoutJobV3[];
  /** 各职业之间共享的槽位名称或投影装备身份。 */
  commonSlots: readonly string[];
  /** 仍由单个完整求解候选提供支持的投影虚拟槽位。 */
  commonSlotProjections?: readonly SharedSlotProjection[];
  /** 优化器内部路径：将完整且未强制指定的共享戒指对拆分为两个槽位。 */
  factorizedSharedRingPair?: boolean;
  /** 精确模型的内部调优选项；省略时沿用默认的比值配对剪枝。 */
  ratioUpperPairPolicy?: "default" | "disabled";
  /** 对严格劣于其他共享首饰对的候选执行范围有限且不损害证明能力的内部剪枝。 */
  sharedAccessoryPairDominance?: boolean;
  foodStrategy: "shared" | "independent";
  /** 默认为原始伤害；DPS 使用精确的乘积与 GCD 分数。 */
  objective?: "damage" | "dps";
  /** 可选的墙钟时间预算，供测试和验收运行使用，最多为 235 秒。 */
  maxSearchMs?: number;
  /** 为受限内部 MIP 结果提供先进先出缓存，默认最多 2048 项。 */
  cacheLimit?: number;
  onProgress?: (message: string) => void;
  onSolverCallback?: (event: HighsCallbackTrace) => void;
  /** 可选的隔离工作线程执行器；直接调用方省略时沿用本地顺序执行路径。 */
  baselineExecutor?: BaselineExecutor;
  /** 在求解器调用之间及外层搜索节点处检查取消状态。 */
  isCancelled?: () => boolean;
};

export type JointLoadoutV3Result = {
  /** 各职业伤害除以该职业无共享约束最优值后的精确总和。 */
  value: { numerator: string; denominator: string; approximate: number };
  commonEquipments: Record<string, EquipInfo>;
  /** 每份选择都与对应职业原始 options.slots 中的槽位顺序一致。 */
  jobResults: Record<string, JointLoadoutJobResultV3>;
  optima: Record<string, JointLoadoutJobResultV3>;
  statistics: JointLoadoutV3Statistics;
  proof: {
    complete: true;
    objective: "damage" | "dps";
    optimalityScope: string;
    outerBound: string;
    innerSolverStatus: "Optimal" | "DualBound";
    formalCertificate: false;
    numericalLimitation: string;
    terminationReason: string;
  };
};

export type JointLoadoutJobResultV3 = ExactMipResult & {
  gcd: number;
  damagePerSecond: number;
};

export type JointLoadoutV3Statistics = {
  elapsedMs: number;
  timeLimitMs?: number;
  outerNodes: number;
  completeNodes: number;
  upperBoundPrunes: number;
  relaxedOptimaAttained: number;
  innerSolves: number;
  parentResultReuses: number;
  cacheHits: number;
  cacheMisses: number;
  cacheEntries: number;
  cacheLimit: number;
  rssBytes?: number;
  heapUsedBytes?: number;
};

type Rational = { numerator: bigint; denominator: bigint };
type CommonChoice = {
  key: string;
  equipments: Map<string, EquipInfo>;
};
type FoodChoice = {
  key: string;
  foods: Map<string, FoodInfo | undefined>;
};
type JobContext = {
  job: JointLoadoutJobV3;
  solverSlots: readonly (readonly EquipInfo[])[];
  indexByName: Map<string, number>;
  factorEvaluator: ReturnType<typeof createIntegerDamageFactorEvaluator>;
  attributeIndexes: Map<number, number>;
  equipAttributes: WeakMap<EquipInfo, readonly number[]>;
  optimum: ExactMipResult;
  optimumProduct: bigint;
  optimumGcd: number;
  active: boolean;
  constraints: ExactMipOptions["constraints"];
};
type MutableStatistics = Omit<JointLoadoutV3Statistics, "elapsedMs" | "timeLimitMs" | "rssBytes" | "heapUsedBytes" | "cacheLimit">;

const MAX_ACCEPTANCE_SEARCH_MS = 235_000;
const RSS_LIMIT_BYTES = 3.5 * 1024 * 1024 * 1024;

function minimumTimeLimit(...limits: (number | undefined)[]): number | undefined {
  const definedLimits = limits.filter((limit): limit is number => limit !== undefined);
  return definedLimits.length === 0 ? undefined : Math.min(...definedLimits);
}

function bigintGcd(a: bigint, b: bigint): bigint {
  let left = a < 0n ? -a : a;
  let right = b < 0n ? -b : b;
  while (right !== 0n) [left, right] = [right, left % right];
  return left;
}

function rational(numerator: bigint, denominator: bigint): Rational {
  if (denominator === 0n) throw new RangeError("联合配装评分分母不能为零");
  if (denominator < 0n) return rational(-numerator, -denominator);
  if (numerator === 0n) return { numerator: 0n, denominator: 1n };
  const divisor = bigintGcd(numerator, denominator);
  return { numerator: numerator / divisor, denominator: denominator / divisor };
}

function addRational(left: Rational, right: Rational): Rational {
  const common = bigintGcd(left.denominator, right.denominator);
  const leftScale = right.denominator / common;
  const rightScale = left.denominator / common;
  return rational(
    left.numerator * leftScale + right.numerator * rightScale,
    left.denominator * leftScale,
  );
}

function compareRational(left: Rational, right: Rational): number {
  const a = left.numerator * right.denominator;
  const b = right.numerator * left.denominator;
  return a < b ? -1 : a > b ? 1 : 0;
}

function integerDamageProduct(factors: IntegerDamageFactors): bigint {
  const values = [
    factors.weaponDamage,
    factors.mainStat,
    factors.determination,
    factors.tenacity,
    factors.critical,
    factors.directHit,
  ];
  if (values.some((value) => !Number.isSafeInteger(value) || value < 1)) {
    throw new RangeError(`伤害因子不是正安全整数：${values.join(",")}`);
  }
  return values.reduce((product, value) => product * BigInt(value), 1n);
}

type RingPairInfo = EquipInfo & { ringEquips: readonly [EquipInfo, EquipInfo] };

function projectEquipment(
  equipment: EquipInfo,
  projection: SharedSlotProjection | undefined,
): EquipInfo {
  if (projection === undefined) return equipment;
  const pair = equipment as Partial<RingPairInfo>;
  const projected = pair.ringEquips?.[projection.ringIndex];
  if (projected === undefined) {
    throw new Error(`共享槽位 ${projection.commonSlot} 的完整候选缺少对应戒指`);
  }
  return projected;
}

function projectionMap(
  commonSlots: readonly string[],
  projections: readonly SharedSlotProjection[] = [],
): Map<string, SharedSlotProjection> {
  const result = new Map<string, SharedSlotProjection>();
  const projectedSlots = new Set<string>();
  for (const projection of projections) {
    if (!commonSlots.includes(projection.commonSlot)) {
      throw new RangeError(`共享槽位投影 ${projection.commonSlot} 不在 commonSlots 中`);
    }
    if (!projection.slotName || (projection.ringIndex !== 0 && projection.ringIndex !== 1)) {
      throw new RangeError(`共享槽位投影 ${projection.commonSlot} 无效`);
    }
    if (result.has(projection.commonSlot)) {
      throw new RangeError(`共享槽位 ${projection.commonSlot} 有重复投影`);
    }
    if (commonSlots.includes(projection.slotName)) {
      throw new RangeError(`完整槽位 ${projection.slotName} 与其共享投影不能同时选择`);
    }
    const projectedKey = `${projection.slotName}:${projection.ringIndex}`;
    if (projectedSlots.has(projectedKey)) {
      throw new RangeError(`共享槽位投影重复指向 ${projectedKey}`);
    }
    projectedSlots.add(projectedKey);
    result.set(projection.commonSlot, projection);
  }
  return result;
}

function commonSlotIndex(
  context: Pick<JobContext, "indexByName" | "job">,
  commonSlot: string,
  projections: ReadonlyMap<string, SharedSlotProjection>,
): number {
  const slotName = projections.get(commonSlot)?.slotName ?? commonSlot;
  const index = context.indexByName.get(slotName);
  if (index === undefined) throw new RangeError(`通用槽位 ${commonSlot} 在职业 ${context.job.id} 中不存在`);
  return index;
}

function equipmentForCommonSlot(
  context: Pick<JobContext, "indexByName" | "job">,
  selection: readonly EquipInfo[],
  commonSlot: string,
  projections: ReadonlyMap<string, SharedSlotProjection>,
): EquipInfo {
  const equipment = selection[commonSlotIndex(context, commonSlot, projections)];
  if (equipment === undefined) throw new Error(`通用槽位 ${commonSlot} 缺少装备候选`);
  return projectEquipment(equipment, projections.get(commonSlot));
}

function commonSlotIdentity(
  context: Pick<JobContext, "indexByName" | "job">,
  selection: readonly EquipInfo[],
  commonSlot: string,
  projections: ReadonlyMap<string, SharedSlotProjection>,
): string {
  return equipmentIdentity(equipmentForCommonSlot(context, selection, commonSlot, projections));
}

function foodIdentity(food: FoodInfo): string {
  if (food.physicalKey !== undefined) return food.physicalKey;
  return JSON.stringify({
    itemId: food.itemId,
    itemLevel: food.itemLevel,
    baseParams: food.baseParams
      .map(({ baseParamId, multiplier, maxValue }) => [baseParamId, multiplier, maxValue] as const)
      .sort((left, right) => left[0] - right[0] || left[1] - right[1] || left[2] - right[2]),
  });
}

function applyFood(attributes: readonly number[], food: FoodInfo | undefined, indexes: ReadonlyMap<number, number>): number[] {
  const final = [...attributes];
  if (food === undefined) return final;
  for (const param of food.baseParams) {
    const index = indexes.get(param.baseParamId);
    if (index === undefined) continue;
    final[index] += Math.min(
      param.maxValue,
      Math.trunc((final[index]! + (param.baseValue ?? 0)) * (param.multiplier - 1) + 1e-7),
    );
  }
  return final;
}

function buildRawAttributes(context: JobContext, selection: readonly EquipInfo[]): number[] {
  const attributes = new Array<number>(context.job.options.attributeIds.length).fill(0);
  for (const equipment of selection) {
    let values = context.equipAttributes.get(equipment);
    if (values === undefined) {
      const next = new Array<number>(attributes.length).fill(0);
      const params = context.job.options.equipmentAttributeExtractor?.(equipment) ?? equipment.baseParams;
      for (const param of params) {
        const index = context.attributeIndexes.get(param.baseParamId);
        if (index !== undefined) next[index] += param.value;
      }
      for (const allocation of equipment.resistanceAllocation ?? []) {
        const index = context.attributeIndexes.get(allocation.baseParamId);
        if (index !== undefined) next[index] += allocation.value;
      }
      if (next.some((value) => !Number.isSafeInteger(value))) {
        throw new RangeError(`装备 ${equipment.itemId} 的属性不是安全整数`);
      }
      values = next;
      context.equipAttributes.set(equipment, values);
    }
    for (let index = 0; index < attributes.length; index++) attributes[index] += values[index]!;
  }
  return attributes;
}

function attributeVectorKey(values: readonly number[]): string {
  return values.join(",");
}

/**
 * 投影共享装备后，重新平衡至多两个私有的同物品魔晶石变体。
 * 匹配成功会恢复完整的单职业原始属性向量，因此也会恢复所有规范因子和约束输入，
 * 不需要根据加权得分推断属性。
 */
function findSameItemAttributeCompensation(
  context: JobContext,
  selection: readonly EquipInfo[],
  targetRawAttributes: readonly number[],
  commonSlotIndexes: ReadonlySet<number>,
  checkBudget: () => void,
): readonly { slotIndex: number; equipment: EquipInfo }[] | undefined {
  const currentRawAttributes = buildRawAttributes(context, selection);
  if (currentRawAttributes.length !== targetRawAttributes.length) return undefined;
  const needed = targetRawAttributes.map((value, index) => value - currentRawAttributes[index]!);
  if (needed.some((value) => !Number.isSafeInteger(value))) return undefined;
  if (needed.every((value) => value === 0)) return [];
  const neededKey = attributeVectorKey(needed);
  const alternativesBySlot: {
    slotIndex: number;
    alternatives: { equipment: EquipInfo; delta: number[]; key: string }[];
  }[] = [];
  const maxAlternativesPerSlot = 128;
  let scannedCandidates = 0;
  const maxScannedCandidates = 50_000;

  for (let slotIndex = 0; slotIndex < context.solverSlots.length; slotIndex++) {
    if (commonSlotIndexes.has(slotIndex)) continue;
    const current = selection[slotIndex];
    if (current === undefined || current.ringSlotIndex !== undefined ||
      current.resistanceWeaponAdjust !== undefined ||
      (current as EquipInfo & { ringEquips?: readonly EquipInfo[] }).ringEquips !== undefined) continue;
    const currentIdentity = equipmentIdentity(current);
    const sameItemCandidates: EquipInfo[] = [];
    let exceededSlotLimit = false;
    for (const candidate of context.solverSlots[slotIndex]!) {
      if ((scannedCandidates++ & 255) === 0) checkBudget();
      if (scannedCandidates > maxScannedCandidates) return undefined;
      if (candidate.itemId !== current.itemId || candidate.ringSlotIndex !== undefined ||
        candidate.resistanceWeaponAdjust !== undefined ||
        (candidate as EquipInfo & { ringEquips?: readonly EquipInfo[] }).ringEquips !== undefined ||
        equipmentIdentity(candidate) === currentIdentity) continue;
      sameItemCandidates.push(candidate);
      if (sameItemCandidates.length > maxAlternativesPerSlot) {
        exceededSlotLimit = true;
        break;
      }
    }
    if (sameItemCandidates.length === 0 || exceededSlotLimit) continue;
    const currentVector = buildRawAttributes(context, [current]);
    const alternatives = sameItemCandidates.map((equipment) => {
      const candidateVector = buildRawAttributes(context, [equipment]);
      const delta = candidateVector.map((value, index) => value - currentVector[index]!);
      return { equipment, delta, key: attributeVectorKey(delta) };
    });
    alternativesBySlot.push({ slotIndex, alternatives });
  }

  for (const group of alternativesBySlot) {
    const match = group.alternatives.find(({ key }) => key === neededKey);
    if (match !== undefined) return [{ slotIndex: group.slotIndex, equipment: match.equipment }];
  }

  let checkedPairs = 0;
  const maxPairChecks = 100_000;
  for (let leftIndex = 0; leftIndex < alternativesBySlot.length; leftIndex++) {
    const left = alternativesBySlot[leftIndex]!;
    const byDelta = new Map<string, EquipInfo>();
    for (const candidate of left.alternatives) {
      if (!byDelta.has(candidate.key)) byDelta.set(candidate.key, candidate.equipment);
    }
    for (let rightIndex = leftIndex + 1; rightIndex < alternativesBySlot.length; rightIndex++) {
      const right = alternativesBySlot[rightIndex]!;
      for (const candidate of right.alternatives) {
        if ((checkedPairs++ & 255) === 0) checkBudget();
        if (checkedPairs > maxPairChecks) return undefined;
        const complement = needed.map((value, index) => value - candidate.delta[index]!);
        if (complement.some((value) => !Number.isSafeInteger(value))) return undefined;
        const equipment = byDelta.get(attributeVectorKey(complement));
        if (equipment !== undefined) {
          return [
            { slotIndex: left.slotIndex, equipment },
            { slotIndex: right.slotIndex, equipment: candidate.equipment },
          ];
        }
      }
    }
  }
  return undefined;
}

function pruneInnerSlots(
  context: JobContext,
  preserveSlotIndexes: ReadonlySet<number> = new Set(),
  sourceSlots: readonly (readonly EquipInfo[])[] = context.job.options.slots,
  workBudget?: {
    maxDominanceChecks: number;
    maxDurationMs: number;
    dominanceAttributeIndexes?: ReadonlySet<number>;
  },
): readonly (readonly EquipInfo[])[] {
  const constraints = context.constraints ?? {};
  const mustKeepSpeedEqual = constraints.gcd !== undefined ||
    (constraints.gcdChoices?.length ?? 0) > 0 || constraints.speedMax !== undefined;
  const speedIndex = context.job.options.speedAttributeId === undefined
    ? undefined
    : context.attributeIndexes.get(context.job.options.speedAttributeId);
  const ringSlotIndexes = new Map<0 | 1, number>();
  const uniqueByItemId = new Map<number, boolean>();
  let completeRingMetadata = true;
  sourceSlots.forEach((slot, slotIndex) => {
    const marked = slot.filter((equipment) => equipment.ringSlotIndex !== undefined);
    if (marked.length === 0) return;
    const ringSlotIndex = marked[0]!.ringSlotIndex;
    if ((ringSlotIndex !== 0 && ringSlotIndex !== 1) || marked.length !== slot.length ||
      marked.some((equipment) => equipment.ringSlotIndex !== ringSlotIndex) ||
      ringSlotIndexes.has(ringSlotIndex)) {
      completeRingMetadata = false;
      return;
    }
    ringSlotIndexes.set(ringSlotIndex, slotIndex);
    for (const equipment of marked) {
      if (!Number.isSafeInteger(equipment.itemId) || typeof equipment.isUnique !== "boolean") {
        completeRingMetadata = false;
        continue;
      }
      const known = uniqueByItemId.get(equipment.itemId);
      if (known !== undefined && known !== equipment.isUnique) completeRingMetadata = false;
      uniqueByItemId.set(equipment.itemId, equipment.isUnique);
    }
  });
  if (ringSlotIndexes.size !== 2) completeRingMetadata = false;

  const conflictGroupByItemId = new Map<number, string>();
  if (completeRingMetadata) {
    for (const ringSlotIndex of [0, 1] as const) {
      const slotIndex = ringSlotIndexes.get(ringSlotIndex)!;
      const oppositeSlot = sourceSlots[ringSlotIndexes.get(ringSlotIndex === 0 ? 1 : 0)!]!;
      const oppositeUniqueIds = new Set(oppositeSlot
        .filter((equipment) => equipment.isUnique === true)
        .map((equipment) => equipment.itemId));
      for (const equipment of sourceSlots[slotIndex]!) {
        if (equipment.isUnique === true && oppositeUniqueIds.has(equipment.itemId)) {
          conflictGroupByItemId.set(equipment.itemId, `conflict:${equipment.itemId}`);
        }
      }
    }
  }

  return sourceSlots.map((slot, slotIndex) => {
    if (preserveSlotIndexes.has(slotIndex)) return slot;
    // 零分配基础向量不能支配可调属性候选。
    // 若槽位中存在这类候选，则保留完整候选域。
    if (slot.some((equipment) => equipment.resistanceWeaponAdjust !== undefined)) return slot;
    if (slot.length < 2) return slot;
    const candidates = slot.map((equipment, inputOrder) => ({
      equipment,
      inputOrder,
      attributes: buildRawAttributes(context, [equipment]),
    }));
    const dominates = (left: readonly number[], right: readonly number[]) => {
      let strict = false;
      for (let index = 0; index < left.length; index++) {
        if (workBudget?.dominanceAttributeIndexes !== undefined &&
          !workBudget.dominanceAttributeIndexes.has(index)) continue;
        if (mustKeepSpeedEqual && index === speedIndex && left[index] !== right[index]) return false;
        if (left[index]! < right[index]!) return false;
        if (left[index]! > right[index]!) strict = true;
      }
      return strict || workBudget?.dominanceAttributeIndexes !== undefined ||
        left.every((value, index) => value === right[index]);
    };
    const budgetExceeded = Symbol("baseline Pareto budget exceeded");
    const startedAt = performance.now();
    let dominanceChecks = 0;
    const checkBudget = () => {
      if (workBudget === undefined) return;
      dominanceChecks++;
      if (dominanceChecks > workBudget.maxDominanceChecks ||
        ((dominanceChecks & 0x3ff) === 0 && performance.now() - startedAt > workBudget.maxDurationMs)) {
        throw budgetExceeded;
      }
    };
    const paretoFrontier = (domain: typeof candidates) => {
      const frontier: typeof candidates = [];
      const ordered = [...domain].sort((left, right) => {
        const leftSum = left.attributes.reduce((total, value) => total + value, 0);
        const rightSum = right.attributes.reduce((total, value) => total + value, 0);
        return rightSum - leftSum || left.inputOrder - right.inputOrder;
      });
      if (workBudget !== undefined && performance.now() - startedAt > workBudget.maxDurationMs) {
        throw budgetExceeded;
      }
      for (const candidate of ordered) {
        let isDominated = false;
        for (const kept of frontier) {
          checkBudget();
          if (dominates(kept.attributes, candidate.attributes)) {
            isDominated = true;
            break;
          }
        }
        if (isDominated) continue;
        for (let index = frontier.length - 1; index >= 0; index--) {
          checkBudget();
          if (dominates(candidate.attributes, frontier[index]!.attributes)) frontier.splice(index, 1);
        }
        frontier.push(candidate);
      }
      return frontier;
    };
    if (candidates.some(({ equipment }) => equipment.ringSlotIndex !== undefined)) {
      // 候选能否与另一槽位配对，只取决于与其唯一物品 ID 冲突的候选。
      // 没有冲突对象的候选共用一个前沿；存在冲突的 ID 则分别维护前沿。
      // 元数据缺失或相互矛盾时，退回按物品分别划分的方式。
      const groups = new Map<string, typeof candidates>();
      for (const candidate of candidates) {
        const groupKey = completeRingMetadata
          ? conflictGroupByItemId.get(candidate.equipment.itemId) ?? "no-conflicts"
          : `item:${candidate.equipment.itemId}`;
        const domain = groups.get(groupKey) ?? [];
        domain.push(candidate);
        groups.set(groupKey, domain);
      }
      try {
        return [...groups.values()]
          .flatMap(paretoFrontier)
          .sort((left, right) => left.inputOrder - right.inputOrder)
          .map(({ equipment }) => equipment);
      } catch (error) {
        if (error === budgetExceeded) return slot;
        throw error;
      }
    }
    try {
      return paretoFrontier(candidates).map(({ equipment }) => equipment);
    } catch (error) {
      if (error === budgetExceeded) return slot;
      throw error;
    }
  });
}

function canonicalBaselineDamageAttributes(context: JobContext): ReadonlySet<number> | undefined {
  if (!hasCanonicalEvaluatorCandidateUpperBound(context.job.options) ||
    context.job.options.equipmentAttributeExtractor !== undefined) return undefined;
  const schema = gameData.jobSchemas[context.job.options.job];
  if (schema?.mainStat === undefined) return undefined;
  const attackStat: Stat = schema.mainStat === "VIT" ? "STR" : schema.mainStat;
  const weaponStat: Stat = schema.mainStat === "INT" || schema.mainStat === "MND" ? "MDMG" : "PDMG";
  const speedStat: Stat = schema.stats.includes("SKS") ? "SKS" : "SPS";
  const relevantStats: readonly Stat[] = [attackStat, weaponStat, "DET", "TEN", "CRT", "DHT", speedStat];
  const result = new Set<number>();
  for (const stat of relevantStats) {
    const vectorIndex = context.job.options.statIndexes.get(stat);
    const attributeId = vectorIndex === undefined ? undefined : context.job.options.attributeIds[vectorIndex];
    const attributeIndex = attributeId === undefined ? undefined : context.attributeIndexes.get(attributeId);
    if (attributeIndex === undefined) return undefined;
    result.add(attributeIndex);
  }
  for (const attributeId of [
    context.job.options.speedAttributeId,
    context.job.options.toughnessAttributeId,
  ]) {
    if (attributeId === undefined) continue;
    const attributeIndex = context.attributeIndexes.get(attributeId);
    if (attributeIndex === undefined) return undefined;
    result.add(attributeIndex);
  }
  return result;
}

function dedupeEquivalentBaselineRingCandidates(
  context: JobContext,
  sourceSlots: readonly (readonly EquipInfo[])[],
): readonly (readonly EquipInfo[])[] {
  if (context.job.options.equipmentAttributeExtractor !== undefined ||
    !hasCanonicalEvaluatorCandidateUpperBound(context.job.options)) return sourceSlots;
  const ringSlotIndexes = new Map<0 | 1, number>();
  for (let slotIndex = 0; slotIndex < sourceSlots.length; slotIndex++) {
    const slot = sourceSlots[slotIndex]!;
    const marked = slot.filter((equipment) => equipment.ringSlotIndex !== undefined);
    if (marked.length === 0) continue;
    const ringSlotIndex = marked[0]!.ringSlotIndex;
    if ((ringSlotIndex !== 0 && ringSlotIndex !== 1) || marked.length !== slot.length ||
      marked.some((equipment) => equipment.ringSlotIndex !== ringSlotIndex) ||
      ringSlotIndexes.has(ringSlotIndex) || marked.some((equipment) =>
        !Number.isSafeInteger(equipment.itemId) || typeof equipment.isUnique !== "boolean")) return sourceSlots;
    ringSlotIndexes.set(ringSlotIndex, slotIndex);
  }
  if (ringSlotIndexes.size !== 2) return sourceSlots;

  const reduced = [...sourceSlots];
  for (const ringSlotIndex of [0, 1] as const) {
    const slotIndex = ringSlotIndexes.get(ringSlotIndex)!;
    const firstByEquivalentValue = new Map<string, EquipInfo>();
    for (const equipment of sourceSlots[slotIndex]!) {
      const attributes = buildRawAttributes(context, [equipment]);
      const conflictClass = equipment.isUnique === true ? `unique:${equipment.itemId}` : "repeatable";
      const key = JSON.stringify([
        conflictClass,
        attributes,
        equipment.PDMG,
        equipment.MDMG,
        equipment.DLY,
      ]);
      if (!firstByEquivalentValue.has(key)) firstByEquivalentValue.set(key, equipment);
    }
    reduced[slotIndex] = [...firstByEquivalentValue.values()];
  }
  return reduced;
}

function speedMustRemainEqual(context: JobContext): boolean {
  const constraints = context.constraints ?? {};
  return constraints.gcd !== undefined ||
    (constraints.gcdChoices?.length ?? 0) > 0 ||
    constraints.speedMax !== undefined;
}

function commonChoiceMetrics(
  choice: CommonChoice,
  contexts: readonly JobContext[],
): readonly (readonly number[])[] {
  return contexts.map((context) => {
    const equipment = choice.equipments.get(context.job.id)!;
    return [...buildRawAttributes(context, [equipment]), equipment.PDMG, equipment.MDMG];
  });
}

function pruneCommonChoices(
  slotName: string,
  choices: readonly CommonChoice[],
  contexts: readonly JobContext[],
  projections: ReadonlyMap<string, SharedSlotProjection>,
  checkBudget: () => void,
): CommonChoice[] {
  // 投影戒指的合法配对取决于其实体身份和完整戒指对的另一半。
  // 因此，仅按属性判断支配或等价可能会删掉唯一合法的联合唯一装备配对。
  if (projections.has(slotName) || choices.length < 2 ||
    choices.some((choice) => [...choice.equipments.values()].some((equipment) =>
      equipment.resistanceWeaponAdjust !== undefined))) return [...choices];
  const metrics = choices.map((choice) => commonChoiceMetrics(choice, contexts));
  const baselineMatches = choices.map((choice) => contexts.reduce((count, context) => {
    return count + Number(choice.key === commonSlotIdentity(
      context, context.optimum.selection, slotName, projections,
    ));
  }, 0));
  const dominates = (leftIndex: number, rightIndex: number): boolean => {
    let strict = false;
    for (let jobIndex = 0; jobIndex < contexts.length; jobIndex++) {
      const context = contexts[jobIndex]!;
      const left = metrics[leftIndex]![jobIndex]!;
      const right = metrics[rightIndex]![jobIndex]!;
      const speedIndex = context.job.options.speedAttributeId === undefined
        ? undefined
        : context.attributeIndexes.get(context.job.options.speedAttributeId);
      for (let attribute = 0; attribute < left.length; attribute++) {
        if (speedMustRemainEqual(context) && attribute === speedIndex && left[attribute] !== right[attribute]) {
          return false;
        }
        if (left[attribute]! < right[attribute]!) return false;
        if (left[attribute]! > right[attribute]!) strict = true;
      }
    }
    return strict;
  };
  const keep = choices.map((_, candidateIndex) => {
    if ((candidateIndex & 15) === 0) checkBudget();
    for (let otherIndex = 0; otherIndex < choices.length; otherIndex++) {
      if (candidateIndex === otherIndex) continue;
      if (dominates(otherIndex, candidateIndex)) return false;
      const equalMetrics = metrics[otherIndex]!.every((values, jobIndex) =>
        values.every((value, attribute) => value === metrics[candidateIndex]![jobIndex]![attribute]));
      if (
        equalMetrics &&
        (baselineMatches[otherIndex]! > baselineMatches[candidateIndex]! ||
          (baselineMatches[otherIndex] === baselineMatches[candidateIndex] && otherIndex < candidateIndex))
      ) return false;
    }
    return true;
  });
  return choices.filter((_, index) => keep[index]);
}

function pruneCommonRingChoices(
  choices: readonly CommonChoice[],
  oppositeChoices: readonly CommonChoice[],
  contexts: readonly JobContext[],
  checkBudget: () => void,
): CommonChoice[] {
  if (choices.length < 2 || oppositeChoices.length === 0) return [...choices];
  const metadataFor = (choice: CommonChoice) => {
    let itemId: number | undefined;
    let isUnique: boolean | undefined;
    for (const context of contexts) {
      const equipment = choice.equipments.get(context.job.id);
      if (equipment === undefined || !Number.isSafeInteger(equipment.itemId) ||
        typeof equipment.isUnique !== "boolean") return undefined;
      if (itemId !== undefined && itemId !== equipment.itemId) return undefined;
      if (isUnique !== undefined && isUnique !== equipment.isUnique) return undefined;
      itemId = equipment.itemId;
      isUnique = equipment.isUnique;
    }
    return itemId === undefined || isUnique === undefined
      ? undefined
      : { itemId, isUnique };
  };
  const choiceMetadata = choices.map(metadataFor);
  const oppositeMetadata = oppositeChoices.map(metadataFor);
  if (choiceMetadata.some((metadata) => metadata === undefined) ||
    oppositeMetadata.some((metadata) => metadata === undefined)) return [...choices];

  const uniqueByItemId = new Map<number, boolean>();
  for (const metadata of [...choiceMetadata, ...oppositeMetadata]) {
    if (metadata === undefined) return [...choices];
    const previous = uniqueByItemId.get(metadata.itemId);
    if (previous !== undefined && previous !== metadata.isUnique) return [...choices];
    uniqueByItemId.set(metadata.itemId, metadata.isUnique);
  }

  const equalCoordinates: number[] = [];
  let coordinateOffset = 0;
  for (const context of contexts) {
    const width = context.attributeIndexes.size + 2;
    if (speedMustRemainEqual(context)) {
      const speedCoordinate = context.attributeIndexes.get(context.job.options.speedAttributeId!);
      if (speedCoordinate === undefined || speedCoordinate >= context.attributeIndexes.size) {
        return [...choices];
      }
      equalCoordinates.push(coordinateOffset + speedCoordinate);
    }
    coordinateOffset += width;
  }

  const toParetoCandidates = (values: readonly CommonChoice[], metadata: readonly ({
    itemId: number;
    isUnique: boolean;
  } | undefined)[]) => values.map((choice, order) => {
    if ((order & 15) === 0) checkBudget();
    const attributes = commonChoiceMetrics(choice, contexts).flat();
    return {
      value: choice,
      itemId: metadata[order]!.itemId,
      isUnique: metadata[order]!.isUnique,
      attributes,
      order,
    };
  });

  const candidates = toParetoCandidates(choices, choiceMetadata);
  const oppositeCandidates = toParetoCandidates(oppositeChoices, oppositeMetadata);
  if ([...candidates, ...oppositeCandidates].some(({ attributes }) =>
    attributes.some((value) => !Number.isSafeInteger(value) || value < 0))) return [...choices];
  return paretoRingCandidates(candidates, oppositeCandidates, equalCoordinates)
    .map(({ value }) => value);
}

function rawAttributeUpperBound(context: JobContext, equipment: EquipInfo): number[] {
  const attributes = buildRawAttributes(context, [equipment]);
  const adjustment = equipment.resistanceWeaponAdjust;
  if (adjustment === undefined) return attributes;
  for (const stat of adjustment.stats) {
    const vectorIndex = context.job.options.statIndexes.get(stat);
    const attributeId = vectorIndex === undefined
      ? undefined
      : context.job.options.attributeIds[vectorIndex];
    const attribute = attributeId === undefined
      ? undefined
      : context.attributeIndexes.get(attributeId);
    if (attribute === undefined) continue;
    const maxValue = Math.min(
      adjustment.maxTotalStats,
      adjustment.maxEachStat,
      adjustment.statMaximums?.[stat] ?? adjustment.maxEachStat,
    );
    attributes[attribute] += maxValue;
  }
  return attributes;
}

function rawAttributeMaximums(context: JobContext, checkBudget: () => void): number[] {
  const maximums = new Array<number>(context.job.options.attributeIds.length).fill(0);
  for (const slot of context.job.options.slots) {
    checkBudget();
    for (let attribute = 0; attribute < maximums.length; attribute++) {
      const maximum = Math.max(0, ...slot.map((equipment) =>
        rawAttributeUpperBound(context, equipment)[attribute]!));
      maximums[attribute] += maximum;
    }
  }
  return maximums;
}

function foodBonus(food: FoodInfo | undefined, attributeId: number, raw: number): number {
  const param = food?.baseParams.find((entry) => entry.baseParamId === attributeId);
  if (param === undefined) return 0;
  return Math.min(param.maxValue, Math.trunc((raw + (param.baseValue ?? 0)) * (param.multiplier - 1) + 1e-7));
}

function sharedFoodDominates(
  left: FoodChoice,
  right: FoodChoice,
  contexts: readonly JobContext[],
  rawMaximums: ReadonlyMap<string, readonly number[]>,
  checkBudget: () => void,
): boolean {
  let strict = false;
  for (const context of contexts) {
    const leftFood = left.foods.get(context.job.id);
    const rightFood = right.foods.get(context.job.id);
    const speedId = context.job.options.speedAttributeId;
    const maximums = rawMaximums.get(context.job.id)!;
    const attributeIds = new Set([
      ...(leftFood?.baseParams.map((param) => param.baseParamId) ?? []),
      ...(rightFood?.baseParams.map((param) => param.baseParamId) ?? []),
    ]);
    for (const attributeId of attributeIds) {
      const attribute = context.attributeIndexes.get(attributeId);
      if (attribute === undefined) continue;
      const maximum = maximums[attribute]!;
      for (let raw = 0; raw <= maximum; raw++) {
        if ((raw & 2047) === 0) checkBudget();
        const leftBonus = foodBonus(leftFood, attributeId, raw);
        const rightBonus = foodBonus(rightFood, attributeId, raw);
        if (speedMustRemainEqual(context) && attributeId === speedId && leftBonus !== rightBonus) {
          return false;
        }
        if (leftBonus < rightBonus) return false;
        if (leftBonus > rightBonus) strict = true;
      }
    }
  }
  return strict;
}

function sharedFoodsEquivalent(
  left: FoodChoice,
  right: FoodChoice,
  contexts: readonly JobContext[],
  rawMaximums: ReadonlyMap<string, readonly number[]>,
  checkBudget: () => void,
): boolean {
  for (const context of contexts) {
    const leftFood = left.foods.get(context.job.id);
    const rightFood = right.foods.get(context.job.id);
    const maximums = rawMaximums.get(context.job.id)!;
    const attributeIds = new Set([
      ...(leftFood?.baseParams.map((param) => param.baseParamId) ?? []),
      ...(rightFood?.baseParams.map((param) => param.baseParamId) ?? []),
    ]);
    for (const attributeId of attributeIds) {
      const attribute = context.attributeIndexes.get(attributeId);
      if (attribute === undefined) continue;
      for (let raw = 0; raw <= maximums[attribute]!; raw++) {
        if ((raw & 2047) === 0) checkBudget();
        if (foodBonus(leftFood, attributeId, raw) !== foodBonus(rightFood, attributeId, raw)) {
          return false;
        }
      }
    }
  }
  return true;
}

function pruneSharedFoods(
  choices: readonly FoodChoice[],
  contexts: readonly JobContext[],
  checkBudget: () => void,
): FoodChoice[] {
  if (choices.length < 2) return [...choices];
  const rawMaximums = new Map(contexts.map((context) => [
    context.job.id,
    rawAttributeMaximums(context, checkBudget),
  ]));
  const baselineMatches = choices.map((choice) => contexts.reduce((count, context) =>
    count + Number(choice.key === foodIdentityForOptional(context.optimum.food)), 0));
  return choices.filter((candidate, candidateIndex) => {
    if ((candidateIndex & 3) === 0) checkBudget();
    for (let otherIndex = 0; otherIndex < choices.length; otherIndex++) {
      if (candidateIndex === otherIndex) continue;
      if (sharedFoodDominates(choices[otherIndex]!, candidate, contexts, rawMaximums, checkBudget)) return false;
      const equalEffects = sharedFoodsEquivalent(choices[otherIndex]!, candidate, contexts, rawMaximums, checkBudget);
      if (
        equalEffects &&
        (baselineMatches[otherIndex]! > baselineMatches[candidateIndex]! ||
          (baselineMatches[otherIndex] === baselineMatches[candidateIndex] && otherIndex < candidateIndex))
      ) return false;
    }
    return true;
  });
}

function factorsForResult(context: JobContext, result: ExactMipResult): IntegerDamageFactors {
  const raw = buildRawAttributes(context, result.selection);
  const final = applyFood(raw, result.food, context.attributeIndexes);
  const factors = context.factorEvaluator(final);
  if (factors === undefined) throw new Error(`职业 ${context.job.id} 的正式伤害因子无法计算`);
  return factors;
}

function makeJobOptions(
  context: JobContext,
  fixed: ReadonlyMap<string, CommonChoice>,
  projections: ReadonlyMap<string, SharedSlotProjection>,
  foodChoice: FoodChoice | undefined,
  maxSearchMs: number | undefined,
  objective: "damage" | "dps",
  isCancelled?: () => boolean,
): ExactMipOptions {
  const slots = [...context.solverSlots];
  for (const [name, choice] of fixed) {
    const slotIndex = commonSlotIndex(context, name, projections);
    const available = slots[slotIndex]!;
    slots[slotIndex] = available.filter((equipment) =>
      equipmentIdentity(projectEquipment(equipment, projections.get(name))) === choice.key);
  }

  let foods: readonly FoodInfo[] = context.job.options.foods;
  if (foodChoice !== undefined) {
    const fixedFood = foodChoice.foods.get(context.job.id);
    foods = fixedFood === undefined ? [] : [fixedFood];
  }

  const originalConstraints = context.constraints ?? {};
  let constraints = originalConstraints;
  if (originalConstraints.maxToughnessMode === true) {
    const maximumToughness = context.optimum.maximumToughness;
    if (maximumToughness === undefined) {
      throw new Error(`职业 ${context.job.id} 的最高坚韧基线没有返回最大值`);
    }
    constraints = {
      ...originalConstraints,
      maxToughnessMode: false,
      toughMin: Math.max(originalConstraints.toughMin ?? Number.NEGATIVE_INFINITY, maximumToughness),
    };
  }

  const effectiveTimeLimit = minimumTimeLimit(maxSearchMs, context.job.options.maxSearchMs);
  return inheritCanonicalEvaluatorCandidateUpperBound(context.job.options, {
    ...context.job.options,
    slots,
    foods,
    constraints,
    objective,
    ...(effectiveTimeLimit === undefined ? {} : { maxSearchMs: effectiveTimeLimit }),
    ...(isCancelled === undefined ? {} : { isCancelled }),
  });
}

function statisticsSnapshot(
  mutable: MutableStatistics,
  startedAt: number,
  timeLimitMs: number | undefined,
  cacheLimit: number,
  cacheEntries: number,
): JointLoadoutV3Statistics {
  return {
    ...mutable,
    elapsedMs: performance.now() - startedAt,
    ...(timeLimitMs === undefined ? {} : { timeLimitMs }),
    cacheLimit,
    cacheEntries,
    ...getMemoryUsageSnapshot(),
  };
}

/** 对给定的各职业候选执行精确联合搜索；超时时抛出错误，不返回未经证明的部分结果。 */
export async function findBestJointLoadoutV3(
  options: JointLoadoutV3Options,
): Promise<JointLoadoutV3Result | undefined> {
  const inputCandidateCount = options.jobs.reduce((total, job) => total +
    job.options.slots.reduce((slotTotal, slot) => slotTotal + slot.length, 0), 0);
  const candidateSupportProfile = chooseCandidateResourceSupportProfile(options.jobs.length, inputCandidateCount);
  const sharedAccessoryPairDominanceTrusted = hasSharedAccessoryPairDominancePath(options);
  // V3 领域自行持有职业包装对象，以便精确剪枝能释放完整候选数组，
  // 同时不修改调用方提供的对象。
  const ownedOptions: JointLoadoutV3Options = {
    ...options,
    jobs: options.jobs.map((job) => ({
      ...job,
      options: inheritCanonicalEvaluatorCandidateUpperBound(job.options, {
        ...job.options,
        candidateResourceSupportProfile: job.options.candidateResourceSupportProfile ?? candidateSupportProfile,
      }),
    })),
  };
  options = sharedAccessoryPairDominanceTrusted
    ? markSharedAccessoryPairDominancePath(ownedOptions)
    : ownedOptions;
  const startedAt = performance.now();
  const requestedMs = options.maxSearchMs;
  if (requestedMs !== undefined && (!Number.isFinite(requestedMs) || requestedMs <= 0)) {
    throw new RangeError("V3 maxSearchMs 必须是正有限数");
  }
  const timeLimitMs = requestedMs === undefined
    ? undefined
    : requestedMs === Number.MAX_SAFE_INTEGER
      ? requestedMs
      : Math.min(requestedMs, MAX_ACCEPTANCE_SEARCH_MS);
  const deadline = timeLimitMs === undefined ? Number.POSITIVE_INFINITY : startedAt + timeLimitMs;
  const remainingTimeLimit = () =>
    timeLimitMs === undefined ? undefined : Math.floor(deadline - performance.now());
  const remainingWorkerTimeLimit = () => remainingTimeLimit() ?? Number.MAX_SAFE_INTEGER;
  const objective = options.objective ?? "damage";
  if (objective !== "damage" && objective !== "dps") {
    throw new RangeError("V3 objective 必须是 damage 或 dps");
  }
  const usePrimaryResourceSupportBaselinePolicy = shouldUsePrimaryResourceSupportsForBaseline(
    options.jobs.map(({ id, options: jobOptions }) => ({
      jobId: id,
      candidateItemLevelRanges: jobOptions.candidateItemLevelRanges,
    })),
    options.commonSlots,
    objective,
    options.foodStrategy,
  );
  const addMainStatResourceSupportToBaselines = shouldUseMainStatResourceSupportForBaseline(
    options.jobs.map(({ id }) => id),
    options.commonSlots,
    objective,
    options.foodStrategy,
    options.factorizedSharedRingPair,
  ) && !usePrimaryResourceSupportBaselinePolicy;
  const enableSharedMateriaCompensation = shouldUseSharedMateriaCompensation(
    options.jobs.map(({ id }) => id),
    options.commonSlots,
    objective,
    options.foodStrategy,
    options.factorizedSharedRingPair,
  );
  if (options.foodStrategy !== "shared" && options.foodStrategy !== "independent") {
    throw new RangeError("V3 foodStrategy 必须是 shared 或 independent");
  }
  const cacheLimit = options.cacheLimit ?? 2048;
  if (!Number.isSafeInteger(cacheLimit) || cacheLimit < 0 || cacheLimit > 50_000) {
    throw new RangeError("V3 cacheLimit 必须是 0 到 50000 之间的整数");
  }
  if (options.jobs.length === 0) throw new RangeError("V3 至少需要一个职业");
  const baselineConcurrency = baselineWorkerLimit(options.jobs.length, inputCandidateCount);
  const cancellationRequested = () => options.isCancelled?.() === true ||
    options.jobs.some((job) => job.options.isCancelled?.() === true);

  const mutable: MutableStatistics = {
    outerNodes: 0,
    completeNodes: 0,
    upperBoundPrunes: 0,
    relaxedOptimaAttained: 0,
    innerSolves: 0,
    parentResultReuses: 0,
    cacheHits: 0,
    cacheMisses: 0,
    cacheEntries: 0,
  };
  const assertWithinBudget = (stage: string) => {
    throwIfCancelled(cancellationRequested);
    if (timeLimitMs !== undefined && performance.now() >= deadline) {
      throw new Error(`V3 搜索超过 ${timeLimitMs}ms，未完成最优性证明（${stage}）；未返回近似结果`);
    }
    const memory = getMemoryUsageSnapshot();
    if (memory.rssBytes !== undefined && memory.rssBytes > RSS_LIMIT_BYTES) {
      throw new Error(`V3 RSS 达到 3.5 GiB 限制（${stage}）；未返回近似结果`);
    }
  };

  const jobIds = new Set<string>();
  const contexts: JobContext[] = [];
  for (const job of options.jobs) {
    assertWithinBudget("输入校验");
    if (job.id.length === 0 || jobIds.has(job.id)) throw new RangeError(`V3 职业 id 为空或重复：${job.id}`);
    jobIds.add(job.id);
    if (job.slotNames.length !== job.options.slots.length) {
      throw new RangeError(`职业 ${job.id} 的 slotNames 与 slots 长度不一致`);
    }
    const indexByName = new Map<string, number>();
    job.slotNames.forEach((name, index) => {
      if (name.length === 0 || indexByName.has(name)) throw new RangeError(`职业 ${job.id} 有空或重复槽位名：${name}`);
      indexByName.set(name, index);
    });
    if (job.options.slots.some((slot) => slot.length === 0)) return undefined;
    const attributeIndexes = new Map(job.options.attributeIds.map((id, index) => [id, index]));
    if (attributeIndexes.size !== job.options.attributeIds.length) {
      throw new RangeError(`职业 ${job.id} 的 attributeIds 包含重复项`);
    }
    contexts.push({
      job,
      solverSlots: job.options.slots,
      indexByName,
      factorEvaluator: createIntegerDamageFactorEvaluator(job.options.job, job.options.jobLevel, job.options.statIndexes, job.options.clanIndex ?? 0),
      attributeIndexes,
      equipAttributes: new WeakMap(),
      optimum: undefined as unknown as ExactMipResult,
      optimumProduct: 0n,
      optimumGcd: 0,
      active: true,
      constraints: job.options.constraints,
    });
  }

  const commonSlotProjections = projectionMap(options.commonSlots, options.commonSlotProjections);
  const preserveCommonSlotIndexes = new Map<JobContext, Set<number>>();
  for (const context of contexts) {
    const indexes = new Set<number>();
    for (const name of options.commonSlots) {
      indexes.add(commonSlotIndex(context, name, commonSlotProjections));
    }
    preserveCommonSlotIndexes.set(context, indexes);
  }

  for (const context of contexts) {
    assertWithinBudget("单职业候选等价剪枝");
    context.solverSlots = pruneInnerSlots(context, preserveCommonSlotIndexes.get(context));
    context.job.options.slots = context.solverSlots;
  }
  if (new Set(options.commonSlots).size !== options.commonSlots.length) {
    throw new RangeError("V3 commonSlots 包含重复槽位名");
  }
  for (const name of options.commonSlots) {
    for (const context of contexts) commonSlotIndex(context, name, commonSlotProjections);
  }

  const commonChoicesByName = new Map<string, CommonChoice[]>();
  for (const name of options.commonSlots) {
    assertWithinBudget("通用装备匹配");
    const first = contexts[0]!;
    const firstSlot = first.job.options.slots[commonSlotIndex(first, name, commonSlotProjections)]!;
    const candidates = new Map<string, CommonChoice>();
    for (const equipment of firstSlot) {
      const projected = projectEquipment(equipment, commonSlotProjections.get(name));
      const key = equipmentIdentity(projected);
      if (!candidates.has(key)) candidates.set(key, { key, equipments: new Map([[first.job.id, projected]]) });
    }
    for (let index = 1; index < contexts.length; index++) {
      const context = contexts[index]!;
      const slot = context.job.options.slots[commonSlotIndex(context, name, commonSlotProjections)]!;
      const available = new Map<string, EquipInfo>();
      for (const equipment of slot) {
        const projected = projectEquipment(equipment, commonSlotProjections.get(name));
        const key = equipmentIdentity(projected);
        if (!available.has(key)) available.set(key, projected);
      }
      for (const [key, choice] of candidates) {
        const equipment = available.get(key);
        if (equipment === undefined) candidates.delete(key);
        else choice.equipments.set(context.job.id, equipment);
      }
    }
    if (candidates.size === 0) return undefined;
    commonChoicesByName.set(name, [...candidates.values()]);
  }

  const foodChoices: FoodChoice[] = [];
  if (options.foodStrategy === "shared") {
    if (contexts.every((context) => context.job.options.foods.length === 0)) {
      foodChoices.push({ key: "no-food", foods: new Map(contexts.map((context) => [context.job.id, undefined])) });
    } else {
      const firstFoods = contexts[0]!.job.options.foods;
      const candidates = new Map<string, FoodChoice>();
      for (const food of firstFoods) {
        const key = foodIdentity(food);
        if (!candidates.has(key)) candidates.set(key, { key, foods: new Map([[contexts[0]!.job.id, food]]) });
      }
      for (let index = 1; index < contexts.length; index++) {
        const context = contexts[index]!;
        const available = new Map<string, FoodInfo>();
        for (const food of context.job.options.foods) {
          const key = foodIdentity(food);
          if (!available.has(key)) available.set(key, food);
        }
        for (const [key, choice] of candidates) {
          const food = available.get(key);
          if (food === undefined) candidates.delete(key);
          else choice.foods.set(context.job.id, food);
        }
      }
      foodChoices.push(...candidates.values());
    }
    if (foodChoices.length === 0) return undefined;
  } else {
    foodChoices.push({ key: "independent-food", foods: new Map() });
  }

  assertWithinBudget("单职业最优基线");
  const baselineTasks: ExactMipOptions[] = [];
  const canParallelizeBaselines = options.baselineExecutor !== undefined &&
    contexts.every((context) => context.job.options.equipmentAttributeExtractor === undefined);
  const assignBaseline = (context: JobContext, optimum: ExactMipResult | undefined): boolean => {
    assertWithinBudget("单职业最优基线");
    if (optimum === undefined) return false;
    context.optimum = optimum;
    const optimumFactors = factorsForResult(context, optimum);
    context.optimumProduct = integerDamageProduct(optimumFactors);
    context.optimumGcd = optimumFactors.gcdCentiseconds;
    context.active = optimum.damage > 0;
    if (context.optimumProduct <= 0n || context.optimumGcd <= 0) {
      throw new Error(`职业 ${context.job.id} 的伤害基线无效`);
    }
    return true;
  };
  for (const context of contexts) {
    const remainingMs = remainingTimeLimit();
    if (remainingMs !== undefined && remainingMs <= 0) {
      throw new Error(`V3 搜索超过 ${timeLimitMs}ms，未完成最优性证明（单职业最优基线）；未返回近似结果`);
    }
    mutable.innerSolves++;
    mutable.cacheMisses++;
    options.onProgress?.(`V3：正在计算 ${context.job.id} 的单职业最优伤害基线`);
    const onSolverCallback = options.onSolverCallback ?? context.job.options.onSolverCallback;
    // solverSlots 中的非共享槽位已经具有精确的帕累托前沿。
    // 直接复用它，只剪枝共享槽位；这些槽位的身份为联合交集而保留，
    // 但可能已被单职业基线剪掉。
    const commonIndexes = preserveCommonSlotIndexes.get(context)!;
    const preserveBaselineIndexes = new Set(context.solverSlots.flatMap((_, index) =>
      !commonIndexes.has(index) ? [index] : []));
    let baselineSlots = context.solverSlots;
    if (options.factorizedSharedRingPair) {
      baselineSlots = dedupeEquivalentBaselineRingCandidates(context, baselineSlots);
    }
    if (commonIndexes.size > 0) {
      baselineSlots = pruneInnerSlots(context, preserveBaselineIndexes, baselineSlots,
        options.factorizedSharedRingPair
          ? {
              maxDominanceChecks: 2_000_000,
              maxDurationMs: 500,
              ...(canonicalBaselineDamageAttributes(context) === undefined ? {} : {
                dominanceAttributeIndexes: canonicalBaselineDamageAttributes(context)!,
              }),
            }
          : undefined);
    }
    assertWithinBudget("单职业基线候选剪枝");
    const remainingAfterPruningMs = remainingTimeLimit();
    if (remainingAfterPruningMs !== undefined && remainingAfterPruningMs <= 0) {
      throw new Error(`V3 搜索超过 ${timeLimitMs}ms，未完成最优性证明（单职业最优基线）；未返回近似结果`);
    }
    const exactMipTimeLimit = minimumTimeLimit(remainingAfterPruningMs, context.job.options.maxSearchMs);
    const baselineTaskTimeLimit = exactMipTimeLimit ??
      (canParallelizeBaselines ? Number.MAX_SAFE_INTEGER : undefined);
    const baselineOptions = inheritCanonicalEvaluatorCandidateUpperBound(context.job.options, {
      ...context.job.options,
      slots: baselineSlots,
      objective,
      // 为 MCH 保留经测量的支撑约束行；VPR 的基线保持精简，
      // 以减少并行模型的工作量，同时不改变候选集合。
      ...(context.job.id === "MCH" && usePrimaryResourceSupportBaselinePolicy
        ? { primaryResourceSupports: true }
        : {}),
      ...(addMainStatResourceSupportToBaselines && shouldUseMainStatResourceSupportForBaselineJob(
        options.jobs.map(({ id }) => id),
        context.job.id,
        options.commonSlots,
        objective,
        options.foodStrategy,
        options.factorizedSharedRingPair,
      ) ? { mainStatResourceSupport: true } : {}),
      ...(baselineTaskTimeLimit === undefined ? {} : { maxSearchMs: baselineTaskTimeLimit }),
      isCancelled: cancellationRequested,
      onProgress: options.onProgress === undefined
        ? context.job.options.onProgress
        : (message) => options.onProgress?.(`${context.job.id}: ${message}`),
      ...(context.job.options.onSolverProgress === undefined ? {} : {
        onSolverProgress: (event) => context.job.options.onSolverProgress?.({
          ...event,
          model: `${context.job.id}:${event.model}`,
        }),
      }),
      ...(onSolverCallback === undefined ? {} : {
        onSolverCallback: (event) => onSolverCallback({
          ...event,
          model: `${context.job.id}:${event.model}`,
        }),
      }),
    } satisfies ExactMipOptions);
    if (!canParallelizeBaselines) {
      const optimum = await findBestLoadoutExactMip(baselineOptions);
      if (!assignBaseline(context, optimum)) return undefined;
    } else {
      baselineTasks.push(baselineOptions);
    }
  }
  if (canParallelizeBaselines) {
    const baselineResults = await options.baselineExecutor!(baselineTasks, {
      remainingMs: remainingWorkerTimeLimit,
      isCancelled: cancellationRequested,
      maxConcurrency: Math.min(baselineConcurrency, contexts.length),
    });
    assertWithinBudget("单职业最优基线");
    if (baselineResults === undefined) return undefined;
    if (baselineResults.length !== contexts.length) {
      throw new Error("并发基线工作线程返回的职业数量不匹配");
    }
    for (let index = 0; index < contexts.length; index++) {
      if (!assignBaseline(contexts[index]!, baselineResults[index])) return undefined;
    }
  }

  if (options.factorizedSharedRingPair) {
    const ringChoices = commonChoicesByName.get("ring");
    const ring2Choices = commonChoicesByName.get("ring2");
    if (ringChoices !== undefined && ring2Choices !== undefined) {
      const prunedRingChoices = pruneCommonRingChoices(
        ringChoices,
        ring2Choices,
        contexts,
        () => assertWithinBudget("共享戒指 Pareto 剪枝"),
      );
      const prunedRing2Choices = pruneCommonRingChoices(
        ring2Choices,
        ringChoices,
        contexts,
        () => assertWithinBudget("共享戒指 Pareto 剪枝"),
      );
      commonChoicesByName.set("ring", prunedRingChoices);
      commonChoicesByName.set("ring2", prunedRing2Choices);
      const candidateCountBefore = ringChoices.length + ring2Choices.length;
      const candidateCountAfter = prunedRingChoices.length + prunedRing2Choices.length;
      if (candidateCountAfter < candidateCountBefore) {
        options.onProgress?.(
          `V3：共享戒指 Pareto 剪枝 ${candidateCountBefore}→${candidateCountAfter} 个槽位候选`,
        );
      }
    }
  }
  for (const [name, choices] of commonChoicesByName) {
    if (options.factorizedSharedRingPair && (name === "ring" || name === "ring2")) continue;
    commonChoicesByName.set(name, pruneCommonChoices(
      name,
      choices,
      contexts,
      commonSlotProjections,
      () => assertWithinBudget("通用装备等价剪枝"),
    ));
  }
  if (options.foodStrategy === "shared") {
    foodChoices.splice(0, foodChoices.length, ...pruneSharedFoods(
      foodChoices,
      contexts,
      () => assertWithinBudget("通用食物等价剪枝"),
    ));
    const matchingBaselineCount = (choice: FoodChoice) => contexts.reduce((count, context) =>
      count + Number(choice.key === foodIdentityForOptional(context.optimum.food)), 0);
    foodChoices.sort((left, right) => matchingBaselineCount(right) - matchingBaselineCount(left));
  }

  const slotOrder = [...options.commonSlots].sort((left, right) =>
    commonChoicesByName.get(left)!.length - commonChoicesByName.get(right)!.length ||
    options.commonSlots.indexOf(left) - options.commonSlots.indexOf(right));
  const slotOrderIndex = new Map(slotOrder.map((name, index) => [name, index]));
  for (const name of options.commonSlots) {
    const choices = commonChoicesByName.get(name)!;
    const baselineKeys = contexts.map((context) => commonSlotIdentity(
      context, context.optimum.selection, name, commonSlotProjections,
    ));
    choices.sort((left, right) => {
      const leftMatches = baselineKeys.reduce((count, key) => count + Number(left.key === key), 0);
      const rightMatches = baselineKeys.reduce((count, key) => count + Number(right.key === key), 0);
      return rightMatches - leftMatches;
    });
  }

  const cache = new Map<string, ExactMipResult | null>();
  let best: {
    score: Rational;
    commonEquipments: Record<string, EquipInfo>;
    jobResults: Record<string, ExactMipResult>;
  } | undefined;
  let stopAtProvenCeiling = false;

  const nodeCacheKey = (
    context: JobContext,
    fixed: ReadonlyMap<string, CommonChoice>,
    foodChoice: FoodChoice | undefined,
  ) => {
    const foodKey = foodChoice?.key ?? "independent-food";
    const fixedKey = [...fixed]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, choice]) => `${name}=${choice.key}`)
      .join(";");
    return `${context.job.id}|${foodKey}|${fixedKey}`;
  };

  const rememberNode = (key: string, result: ExactMipResult | null): void => {
    if (cacheLimit === 0) return;
    cache.set(key, result);
    while (cache.size > cacheLimit) cache.delete(cache.keys().next().value!);
    mutable.cacheEntries = cache.size;
  };

  const makeRestrictedMipOptions = (
    context: JobContext,
    fixed: ReadonlyMap<string, CommonChoice>,
    foodChoice: FoodChoice | undefined,
  ): ExactMipOptions => {
    assertWithinBudget("受限单职业求解");
    const remainingMs = remainingTimeLimit();
    if (remainingMs !== undefined && remainingMs <= 0) {
      throw new Error(`V3 搜索超过 ${timeLimitMs}ms，未完成最优性证明（受限单职业求解）；未返回近似结果`);
    }
    const mipOptions = makeJobOptions(
      context,
      fixed,
      commonSlotProjections,
      foodChoice,
      remainingMs ?? (options.baselineExecutor === undefined ? undefined : Number.MAX_SAFE_INTEGER),
      objective,
      cancellationRequested,
    );
    if (options.jobs.length === 2) {
      // 每个槽位只加一条隐含的资源阈值约束，可缩小受限双职业模型，
      // 同时保留相同的候选集合和精确证明义务。
      mipOptions.candidateResourceSupportProfile = "compact";
    }
    if (options.onProgress !== undefined) {
      mipOptions.onProgress = (message) => options.onProgress?.(`${context.job.id}: ${message}`);
    }
    if (context.job.options.onSolverProgress !== undefined) {
      mipOptions.onSolverProgress = (event) => context.job.options.onSolverProgress?.({
        ...event,
        model: `${context.job.id}:${event.model}`,
      });
    }
    const onSolverCallback = options.onSolverCallback ?? context.job.options.onSolverCallback;
    if (onSolverCallback !== undefined) {
      mipOptions.onSolverCallback = (event) => onSolverCallback({
        ...event,
        model: `${context.job.id}:${event.model}`,
      });
    }
    return mipOptions;
  };

  const resultForNode = async (
    context: JobContext,
    fixed: ReadonlyMap<string, CommonChoice>,
    foodChoice: FoodChoice | undefined,
    parentResult: ExactMipResult | undefined,
  ): Promise<ExactMipResult | undefined> => {
    const key = nodeCacheKey(context, fixed, foodChoice);
    const cached = cache.get(key);
    if (cached !== undefined || cache.has(key)) {
      mutable.cacheHits++;
      cache.delete(key);
      cache.set(key, cached ?? null);
      return cached ?? undefined;
    }

    if (parentResult !== undefined) {
      const satisfiesFixed = [...fixed].every(([name, choice]) =>
        commonSlotIdentity(context, parentResult.selection, name, commonSlotProjections) === choice.key);
      const chosenFood = foodChoice?.foods.get(context.job.id);
      const satisfiesFood = foodChoice === undefined ||
        foodIdentityForOptional(parentResult.food) === foodIdentityForOptional(chosenFood);
      if (satisfiesFixed && satisfiesFood) {
        mutable.parentResultReuses++;
        rememberNode(key, parentResult);
        return parentResult;
      }
    }

    for (const [name, choice] of fixed) {
      if (commonSlotIdentity(context, context.optimum.selection, name, commonSlotProjections) !== choice.key) {
        return solveAndRemember();
      }
    }
    if (foodChoice !== undefined) {
      const chosenFood = foodChoice.foods.get(context.job.id);
      if (foodIdentityForOptional(context.optimum.food) !== foodIdentityForOptional(chosenFood)) return solveAndRemember();
    }
    rememberNode(key, context.optimum);
    return context.optimum;

    async function solveAndRemember(): Promise<ExactMipResult | undefined> {
      const mipOptions = makeRestrictedMipOptions(context, fixed, foodChoice);
      mutable.innerSolves++;
      mutable.cacheMisses++;
      const result = await findBestLoadoutExactMip(mipOptions);
      assertWithinBudget("受限单职业求解");
      rememberNode(key, result ?? null);
      return result;
    }
  };

  type SeedRefinementRequest = {
    initialResults: readonly (ExactMipResult | undefined)[] | undefined;
    fixed: ReadonlyMap<string, CommonChoice>;
    foodChoice: FoodChoice | undefined;
    jobIndexes: readonly number[];
    parentResults?: readonly (ExactMipResult | undefined)[];
  };
  const refineSeedCandidates = async (
    requests: readonly SeedRefinementRequest[],
  ): Promise<(ExactMipResult | undefined)[][]> => {
    const resultsByRequest = requests.map(({ initialResults }) => initialResults === undefined
      ? new Array<ExactMipResult | undefined>(contexts.length).fill(undefined)
      : [...initialResults]);
    const pending: {
      requestIndex: number;
      index: number;
      key: string;
      task: ExactMipOptions;
      estimateMs: number;
    }[] = [];
    const remainingTasksByRequest = requests.map(() => 0);
    const completedTaskIndexes = new Set<number>();
    const recordCompletedTask = (taskIndex: number) => {
      if (completedTaskIndexes.has(taskIndex)) return;
      completedTaskIndexes.add(taskIndex);
      mutable.innerSolves++;
      mutable.cacheMisses++;
    };
    for (let requestIndex = 0; requestIndex < requests.length; requestIndex++) {
      const request = requests[requestIndex]!;
      const results = resultsByRequest[requestIndex]!;
      for (const index of request.jobIndexes) {
        const context = contexts[index]!;
        const key = nodeCacheKey(context, request.fixed, request.foodChoice);
        const cached = cache.get(key);
        if (cached !== undefined || cache.has(key)) {
          mutable.cacheHits++;
          cache.delete(key);
          cache.set(key, cached ?? null);
          results[index] = cached ?? undefined;
          continue;
        }
        const parentResult = request.parentResults?.[index];
        if (parentResult !== undefined) {
          const satisfiesFixed = [...request.fixed].every(([name, choice]) =>
            commonSlotIdentity(context, parentResult.selection, name, commonSlotProjections) === choice.key);
          const chosenFood = request.foodChoice?.foods.get(context.job.id);
          const satisfiesFood = request.foodChoice === undefined ||
            foodIdentityForOptional(parentResult.food) === foodIdentityForOptional(chosenFood);
          if (satisfiesFixed && satisfiesFood) {
            mutable.parentResultReuses++;
            rememberNode(key, parentResult);
            results[index] = parentResult;
            continue;
          }
        }
        const satisfiesFixed = [...request.fixed].every(([name, choice]) =>
          commonSlotIdentity(context, context.optimum.selection, name, commonSlotProjections) === choice.key);
        const chosenFood = request.foodChoice?.foods.get(context.job.id);
        const satisfiesFood = request.foodChoice === undefined ||
          foodIdentityForOptional(context.optimum.food) === foodIdentityForOptional(chosenFood);
        if (satisfiesFixed && satisfiesFood) {
          rememberNode(key, context.optimum);
          results[index] = context.optimum;
          continue;
        }
        if (options.baselineExecutor === undefined) {
          const result = await resultForNode(context, request.fixed, request.foodChoice, parentResult);
          results[index] = result;
          continue;
        }
        pending.push({
          requestIndex,
          index,
          key,
          task: makeRestrictedMipOptions(context, request.fixed, request.foodChoice),
          estimateMs: context.optimum.statistics.elapsedMs,
        });
        remainingTasksByRequest[requestIndex] = remainingTasksByRequest[requestIndex]! + 1;
      }
    }
    if (pending.length === 0) return resultsByRequest;

    const scoreCompletedRequest = (requestIndex: number) => {
      if (remainingTasksByRequest[requestIndex] !== 0) return;
      if (requests[requestIndex]!.fixed.size !== options.commonSlots.length) return;
      const results = resultsByRequest[requestIndex]!;
      if (results.every((result): result is ExactMipResult => result !== undefined)) {
        updateBest(exactScore(results), results);
      }
    };

    for (let requestIndex = 0; requestIndex < requests.length; requestIndex++) {
      scoreCompletedRequest(requestIndex);
    }
    if (stopAtProvenCeiling) return resultsByRequest;

    // 将种子分组，使每批先同时启动同一装备分配下的独立职业任务；
    // 每个种子内部则优先启动历史上耗时较长的职业。
    pending.sort((left, right) => left.requestIndex - right.requestIndex ||
      right.estimateMs - left.estimateMs || left.index - right.index);
    const solved = await options.baselineExecutor!(pending.map((entry) => entry.task), {
      remainingMs: remainingWorkerTimeLimit,
      isCancelled: cancellationRequested,
      maxConcurrency: Math.min(baselineConcurrency, contexts.length),
      onTaskComplete: (taskIndex, result) => {
        const entry = pending[taskIndex];
        if (entry === undefined) throw new Error("并发受限单职业工作线程返回了未知任务索引");
        if (completedTaskIndexes.has(taskIndex)) throw new Error("并发受限单职业工作线程重复完成任务");
        recordCompletedTask(taskIndex);
        rememberNode(entry.key, result ?? null);
        resultsByRequest[entry.requestIndex]![entry.index] = result;
        remainingTasksByRequest[entry.requestIndex] = remainingTasksByRequest[entry.requestIndex]! - 1;
        scoreCompletedRequest(entry.requestIndex);
        return stopAtProvenCeiling;
      },
    });
    if (stopAtProvenCeiling) throwIfCancelled(cancellationRequested);
    else assertWithinBudget("并发受限单职业求解");
    if (solved === undefined || solved.length !== pending.length) {
      throw new Error("并发受限单职业工作线程未返回完整结果集");
    }
    for (let taskIndex = 0; taskIndex < pending.length; taskIndex++) {
      if (completedTaskIndexes.has(taskIndex)) continue;
      if (stopAtProvenCeiling) continue;
      const entry = pending[taskIndex]!;
      const result = solved[taskIndex];
      // 注入的执行器可能不实现完成回调；生产工作线程会在结果到达时立即上报，
      // 这样一旦证明达到上限，就能停止其他种子，而不必等待其余求解结束。
      rememberNode(entry.key, result ?? null);
      resultsByRequest[entry.requestIndex]![entry.index] = result;
      remainingTasksByRequest[entry.requestIndex] = remainingTasksByRequest[entry.requestIndex]! - 1;
      recordCompletedTask(taskIndex);
      scoreCompletedRequest(entry.requestIndex);
    }
    return resultsByRequest;
  };
  const refineSeedJobs = async (
    initialResults: readonly (ExactMipResult | undefined)[] | undefined,
    fixed: ReadonlyMap<string, CommonChoice>,
    foodChoice: FoodChoice | undefined,
    jobIndexes: readonly number[],
    parentResults?: readonly (ExactMipResult | undefined)[],
  ): Promise<(ExactMipResult | undefined)[]> => {
    const [results] = await refineSeedCandidates([{
      initialResults,
      fixed,
      foodChoice,
      jobIndexes,
      ...(parentResults === undefined ? {} : { parentResults }),
    }]);
    return results!;
  };

  const exactScore = (results: readonly ExactMipResult[]): Rational => {
    let total = rational(0n, 1n);
    for (let index = 0; index < contexts.length; index++) {
      const context = contexts[index]!;
      if (!context.active) continue;
      const factors = factorsForResult(context, results[index]!);
      const product = integerDamageProduct(factors);
      const normalized = objective === "dps"
        ? rational(
            product * BigInt(context.optimumGcd),
            BigInt(factors.gcdCentiseconds) * context.optimumProduct,
          )
        : rational(product, context.optimumProduct);
      total = addRational(total, normalized);
    }
    return total;
  };

  const updateBest = (
    score: Rational,
    results: readonly ExactMipResult[],
  ) => {
    if (best !== undefined && compareRational(score, best.score) <= 0) return;
    const commonEquipments: Record<string, EquipInfo> = {};
    for (const name of options.commonSlots) {
      const firstContext = contexts[0]!;
      const selected = equipmentForCommonSlot(firstContext, results[0]!.selection, name, commonSlotProjections);
      const selectedKey = equipmentIdentity(selected);
      for (let index = 1; index < contexts.length; index++) {
        const context = contexts[index]!;
        const other = equipmentForCommonSlot(context, results[index]!.selection, name, commonSlotProjections);
        if (equipmentIdentity(other) !== selectedKey) {
          throw new Error(`内部错误：共享槽位 ${name} 在候选结果中不一致`);
        }
      }
      commonEquipments[name] = selected;
    }
    best = {
      score,
      commonEquipments,
      jobResults: Object.fromEntries(contexts.map((context, index) => [context.job.id, results[index]!])),
    };
    const activeCount = contexts.reduce((count, context) => count + Number(context.active), 0);
    const ceiling = rational(BigInt(activeCount), 1n);
    if (options.onProgress !== undefined) {
      const approximate = Number(score.numerator) / Number(score.denominator);
      const scoreLabel = Number.isFinite(approximate)
        ? approximate.toPrecision(10)
        : `${score.numerator}/${score.denominator}`;
      options.onProgress(
        `V3 incumbent 更新：归一化目标=${scoreLabel}；外层节点=${mutable.outerNodes}；内层 MIP=${mutable.innerSolves}；耗时=${Math.round(performance.now() - startedAt)}ms`,
      );
    }
    if (compareRational(score, ceiling) === 0) stopAtProvenCeiling = true;
  };

  const seedResultsFor = (
    fixed: ReadonlyMap<string, CommonChoice>,
    foodChoice: FoodChoice | undefined,
    allowMateriaCompensation = false,
  ): ExactMipResult[] | undefined => {
    const patchedResults: ExactMipResult[] = [];
    for (const context of contexts) {
      const selection = [...context.optimum.selection];
      const projectedRingKeys = new Map<number, Map<number, string>>();
      for (const [name, choice] of fixed) {
        const projection = commonSlotProjections.get(name);
        const slotIndex = commonSlotIndex(context, name, commonSlotProjections);
        if (projection === undefined) {
          const candidate = context.job.options.slots[slotIndex]!.find((equipment) =>
            equipmentIdentity(equipment) === choice.key);
          if (candidate === undefined) return undefined;
          selection[slotIndex] = candidate;
          continue;
        }
        const ringKeys = projectedRingKeys.get(slotIndex) ?? new Map<number, string>();
        ringKeys.set(projection.ringIndex, choice.key);
        projectedRingKeys.set(slotIndex, ringKeys);
      }
      for (const [slotIndex, ringKeys] of projectedRingKeys) {
        const currentPair = selection[slotIndex] as RingPairInfo | undefined;
        if (currentPair?.ringEquips === undefined) return undefined;
        const desired = [
          ringKeys.get(0) ?? equipmentIdentity(currentPair.ringEquips[0]),
          ringKeys.get(1) ?? equipmentIdentity(currentPair.ringEquips[1]),
        ];
        const pair = context.job.options.slots[slotIndex]!.find((equipment) => {
          const children = (equipment as Partial<RingPairInfo>).ringEquips;
          return children !== undefined &&
            equipmentIdentity(children[0]) === desired[0] &&
            equipmentIdentity(children[1]) === desired[1];
        });
        if (pair === undefined) return undefined;
        selection[slotIndex] = pair;
      }
      if (options.factorizedSharedRingPair) {
        const firstIndex = context.indexByName.get("ring");
        const secondIndex = context.indexByName.get("ring2");
        const first = firstIndex === undefined ? undefined : selection[firstIndex];
        const second = secondIndex === undefined ? undefined : selection[secondIndex];
        if (first === undefined || second === undefined ||
          (first.itemId === second.itemId && (first.isUnique === true || second.isUnique === true))) {
          return undefined;
        }
      }
      const selectedFood = foodChoice === undefined
        ? context.optimum.food
        : foodChoice.foods.get(context.job.id);
      let rawAttributes = buildRawAttributes(context, selection);
      let attributes = applyFood(rawAttributes, selectedFood, context.attributeIndexes);
      let factors = context.factorEvaluator(attributes);
      if (factors !== undefined) {
        const product = integerDamageProduct(factors);
        const reachesSoloOptimum = objective === "dps"
          ? product * BigInt(context.optimumGcd) ===
            context.optimumProduct * BigInt(factors.gcdCentiseconds)
          : product === context.optimumProduct;
        if (allowMateriaCompensation && enableSharedMateriaCompensation && !reachesSoloOptimum &&
          foodIdentityForOptional(selectedFood) === foodIdentityForOptional(context.optimum.food)) {
          const targetRawAttributes = buildRawAttributes(context, context.optimum.selection);
          const commonSlotIndexes = new Set(options.commonSlots.map((name) =>
            commonSlotIndex(context, name, commonSlotProjections)));
          const compensation = findSameItemAttributeCompensation(
            context,
            selection,
            targetRawAttributes,
            commonSlotIndexes,
            () => assertWithinBudget("共享种子魔晶石属性补偿"),
          );
          if (compensation !== undefined) {
            const compensatedSelection = [...selection];
            for (const { slotIndex, equipment } of compensation) compensatedSelection[slotIndex] = equipment;
            const compensatedRawAttributes = buildRawAttributes(context, compensatedSelection);
            if (compensatedRawAttributes.every((value, index) => value === targetRawAttributes[index])) {
              for (const { slotIndex, equipment } of compensation) selection[slotIndex] = equipment;
              rawAttributes = compensatedRawAttributes;
              attributes = applyFood(rawAttributes, selectedFood, context.attributeIndexes);
              factors = context.factorEvaluator(attributes);
            }
          }
        }
      }
      if (factors === undefined) return undefined;
      const constraints = context.constraints ?? {};
      if (constraints.gcd !== undefined &&
        Math.round(constraints.gcd * 100) !== factors.gcdCentiseconds) return undefined;
      if (constraints.gcdChoices !== undefined && !constraints.gcdChoices.some((gcd) =>
        Math.round(gcd * 100) === factors.gcdCentiseconds)) return undefined;
      if (context.job.options.speedAttributeId !== undefined) {
        const speedIndex = context.attributeIndexes.get(context.job.options.speedAttributeId);
        if (speedIndex === undefined) return undefined;
        const speed = attributes[speedIndex]!;
        if ((constraints.speedMin !== undefined && speed < constraints.speedMin) ||
          (constraints.speedMax !== undefined && speed > constraints.speedMax)) return undefined;
      } else if (constraints.speedMin !== undefined || constraints.speedMax !== undefined) {
        return undefined;
      }
      if (constraints.toughMin !== undefined || constraints.toughnessMinPercent !== undefined ||
        constraints.maxToughnessMode === true) {
        const toughnessAttributeId = context.job.options.toughnessAttributeId;
        if (toughnessAttributeId === undefined) return undefined;
        const toughnessIndex = context.attributeIndexes.get(toughnessAttributeId);
        if (toughnessIndex === undefined) return undefined;
        let minimum = constraints.toughMin ?? Number.NEGATIVE_INFINITY;
        if (constraints.toughnessMinPercent !== undefined) {
          const convert = context.job.options.toughnessPercentToMinimum;
          if (convert === undefined) return undefined;
          minimum = Math.max(minimum, convert(constraints.toughnessMinPercent));
        }
        if (constraints.maxToughnessMode === true) {
          if (context.optimum.maximumToughness === undefined) return undefined;
          minimum = Math.max(minimum, context.optimum.maximumToughness);
        }
        if (attributes[toughnessIndex]! < minimum) return undefined;
      }
      const evaluation = context.job.options.evaluationFunction(attributes);
      if (evaluation === undefined || !Number.isFinite(evaluation.damage) || !Number.isFinite(evaluation.gcd)) {
        return undefined;
      }
      patchedResults.push({
        ...context.optimum,
        selection,
        food: selectedFood,
        damage: evaluation.damage,
      });
    }
    return patchedResults;
  };
  const scoreSeed = (
    fixed: ReadonlyMap<string, CommonChoice>,
    foodChoice: FoodChoice | undefined,
  ): Rational | undefined => {
    const results = seedResultsFor(fixed, foodChoice);
    return results === undefined ? undefined : exactScore(results);
  };

  let jointFactorProof = false;
  let jointInnerSolverStatus: "Optimal" | "DualBound" = "Optimal";
  let exactSharedDomainProof = false;
  const hasOnlyOneCommonAssignment = options.commonSlots.length > 0 &&
    options.commonSlots.every((name) => commonChoicesByName.get(name)!.length === 1);
  if (contexts.every((context) => context.active) && options.commonSlots.length > 0 &&
    !hasOnlyOneCommonAssignment) {
    const seedCandidates: {
      key: string;
      fixed: Map<string, CommonChoice>;
      foodChoice: FoodChoice | undefined;
      score: Rational | undefined;
      anchorId: string;
    }[] = [];
    const seedCandidateKeys = new Set<string>();
    const addSeedCandidate = (
      fixed: Map<string, CommonChoice>,
      foodChoice: FoodChoice | undefined,
      anchorId: string,
    ) => {
      const key = `${[...fixed].map(([name, choice]) => `${name}=${choice.key}`).join(";")}` +
        `|food=${foodChoice?.key ?? "independent"}`;
      if (seedCandidateKeys.has(key)) return;
      seedCandidateKeys.add(key);
      seedCandidates.push({ key, fixed, foodChoice, score: scoreSeed(fixed, foodChoice), anchorId });
    };
    for (const anchor of contexts) {
      assertWithinBudget("联合热启动评分");
      const initialFixed = new Map<string, CommonChoice>();
      for (const name of options.commonSlots) {
        const key = commonSlotIdentity(anchor, anchor.optimum.selection, name, commonSlotProjections);
        const choices = commonChoicesByName.get(name)!;
        initialFixed.set(name, choices.find((choice) => choice.key === key) ?? choices[0]!);
      }
      const initialFood = foodChoices.find((choice) =>
        choice.key === foodIdentityForOptional(anchor.optimum.food)) ?? foodChoices[0];
      const foodChoice = options.foodStrategy === "shared" ? initialFood : undefined;
      addSeedCandidate(initialFixed, foodChoice, anchor.job.id);
    }
    const fullSeedCandidateCount = options.commonSlots.reduce((product, name) =>
      product * BigInt(commonChoicesByName.get(name)!.length), 1n) *
      BigInt(options.foodStrategy === "shared" ? foodChoices.length : 1);
    const fullSeedCandidateLimit = 5_000n;
    if (fullSeedCandidateCount <= fullSeedCandidateLimit) {
      const current = new Map<string, CommonChoice>();
      let visited = 0;
      const visitSharedChoices = (slotIndex: number) => {
        if ((visited++ & 255) === 0) assertWithinBudget("联合热启动枚举");
        if (slotIndex === options.commonSlots.length) {
          const foods = options.foodStrategy === "shared" ? foodChoices : [undefined];
          for (const foodChoice of foods) addSeedCandidate(currentCopy(), foodChoice, "shared-choice-enumeration");
          return;
        }
        const name = options.commonSlots[slotIndex]!;
        for (const choice of commonChoicesByName.get(name)!) {
          current.set(name, choice);
          visitSharedChoices(slotIndex + 1);
        }
        current.delete(name);
      };
      const currentCopy = () => new Map(current);
      visitSharedChoices(0);
    }
    seedCandidates.sort((left, right) => {
      if (left.score !== undefined && right.score === undefined) return -1;
      if (left.score === undefined && right.score !== undefined) return 1;
      if (left.score !== undefined && right.score !== undefined) {
        const comparison = compareRational(right.score, left.score);
        if (comparison !== 0) return comparison;
      }
      return left.anchorId.localeCompare(right.anchorId);
    });
    const exactSharedAssignmentLimit = 8n;
    const canProveBySharedEnumeration = fullSeedCandidateCount <= exactSharedAssignmentLimit &&
      BigInt(seedCandidates.length) === fullSeedCandidateCount;
    const seedLimit = canProveBySharedEnumeration
      ? seedCandidates.length
      : Math.min(seedCandidates.length, 2);
    options.onProgress?.(
      `V3：共享候选组合估分 ${fullSeedCandidateCount.toString()} 个（枚举上限 ${fullSeedCandidateLimit}）；` +
      `热启动候选 ${seedCandidates.length} 个，精确尝试 ${seedLimit} 个` +
      (canProveBySharedEnumeration ? "；组合数较少，逐个精确求解并完成外层证明" : ""),
    );
    if (canProveBySharedEnumeration) {
      for (const seed of seedCandidates) {
        if (stopAtProvenCeiling) break;
        mutable.outerNodes++;
        const directResults = seedResultsFor(seed.fixed, seed.foodChoice, true);
        if (directResults !== undefined) updateBest(exactScore(directResults), directResults);
        if (!stopAtProvenCeiling) {
          const candidateResults = await refineSeedJobs(
            directResults,
            seed.fixed,
            seed.foodChoice,
            contexts.map((_, index) => index),
          );
          if (directResults !== undefined && candidateResults.some((result) => result === undefined)) {
            throw new Error("共享热启动与受限精确子问题的可行性不一致");
          }
          mutable.completeNodes++;
          if (candidateResults.every((result): result is ExactMipResult => result !== undefined)) {
            updateBest(exactScore(candidateResults), candidateResults);
          }
        }
      }
      exactSharedDomainProof = true;
    } else {
      const useDirectJointWarmStart = contexts.length >= 4;
      if (useDirectJointWarmStart) {
        for (const seed of seedCandidates.slice(0, seedLimit)) {
          const directResults = seedResultsFor(seed.fixed, seed.foodChoice, true);
          if (directResults !== undefined) {
            updateBest(exactScore(directResults), directResults);
            const weakestJobs = contexts.map((context, index) => {
              const factors = factorsForResult(context, directResults[index]!);
              const product = integerDamageProduct(factors);
              const ratio = objective === "dps"
                ? rational(product * BigInt(context.optimumGcd),
                    BigInt(factors.gcdCentiseconds) * context.optimumProduct)
                : rational(product, context.optimumProduct);
              return { context, index, ratio };
            }).sort((left, right) => compareRational(left.ratio, right.ratio));
            const refineCount = Math.min(4, contexts.length);
            if (!stopAtProvenCeiling) {
              const refinedResults = await refineSeedJobs(
                directResults,
                seed.fixed,
                seed.foodChoice,
                weakestJobs.slice(0, refineCount).map(({ index }) => index),
              );
              if (refinedResults.every((result): result is ExactMipResult => result !== undefined)) {
                updateBest(exactScore(refinedResults), refinedResults);
              }
            }
            continue;
          }
          const candidateResults = await refineSeedJobs(
            undefined,
            seed.fixed,
            seed.foodChoice,
            contexts.map((_, index) => index),
          );
          if (candidateResults.every((result): result is ExactMipResult => result !== undefined)) {
            updateBest(exactScore(candidateResults), candidateResults);
          }
          if (stopAtProvenCeiling) break;
        }
      } else {
        const seedsToRefine: {
          seed: (typeof seedCandidates)[number];
          directResults: ExactMipResult[] | undefined;
        }[] = [];
        for (const seed of seedCandidates.slice(0, seedLimit)) {
          const directResults = seedResultsFor(seed.fixed, seed.foodChoice, true);
          if (directResults !== undefined) updateBest(exactScore(directResults), directResults);
          seedsToRefine.push({ seed, directResults });
          if (stopAtProvenCeiling) break;
        }
        if (!stopAtProvenCeiling && seedsToRefine.length > 0) {
          const refinedBySeed = await refineSeedCandidates(seedsToRefine.map(({ seed, directResults }) => ({
            initialResults: directResults,
            fixed: seed.fixed,
            foodChoice: seed.foodChoice,
            jobIndexes: contexts.map((_, index) => index),
          })));
          for (const refinedResults of refinedBySeed) {
            if (refinedResults.every((result): result is ExactMipResult => result !== undefined)) {
              updateBest(exactScore(refinedResults), refinedResults);
            }
          }
        }
      }
    }
    const initialResults = best === undefined ? [] : contexts.map((context) => best!.jobResults[context.job.id]!);
    const remainingMs = remainingTimeLimit();
    const onSolverProgress = contexts[0]!.job.options.onSolverProgress;
    const onSolverCallback = options.onSolverCallback ?? contexts[0]!.job.options.onSolverCallback;
    const jointOptions = {
      jobs: contexts.map((context) => {
        const jobOptions = makeJobOptions(
          context, new Map(), commonSlotProjections, undefined, remainingMs, objective, cancellationRequested,
        );
        const slots = [...jobOptions.slots];
        for (const name of options.commonSlots) {
          const slotIndex = commonSlotIndex(context, name, commonSlotProjections);
          const slotCandidates = slots[slotIndex]!;
          const completeRingPairSlot = commonSlotProjections.get(name) === undefined &&
            slotCandidates.length > 0 &&
            slotCandidates.every((equipment) =>
              Array.isArray((equipment as EquipInfo & { ringEquips?: readonly EquipInfo[] }).ringEquips));
          // 联合 MIP 可以将完整戒指对笛卡尔候选域拆分为两个单选槽位。
          // 保留完整输入域，使验证能先确认候选完整，再添加唯一物品约束行。
          if (completeRingPairSlot) continue;
          const allowedKeys = new Set(commonChoicesByName.get(name)!.map((choice) => choice.key));
          slots[slotIndex] = slotCandidates.filter((equipment) =>
            allowedKeys.has(equipmentIdentity(projectEquipment(equipment, commonSlotProjections.get(name)))));
        }
        const jointJobOptions = inheritCanonicalEvaluatorCandidateUpperBound(jobOptions, {
          ...jobOptions,
          slots,
          foods: options.foodStrategy === "shared"
            ? foodChoices.map((choice) => choice.foods.get(context.job.id)).filter((food): food is FoodInfo => food !== undefined)
            : jobOptions.foods,
        });
        return {
          id: context.job.id,
          slotNames: context.job.slotNames,
          baseline: factorsForResult(context, context.optimum),
          options: jointJobOptions,
        };
      }),
      commonSlots: options.commonSlots,
      ...(options.commonSlotProjections === undefined
        ? {}
        : { commonSlotProjections: options.commonSlotProjections }),
      sharedFood: options.foodStrategy === "shared",
      equipmentIdentity,
      foodIdentity,
      objective,
      ...(options.factorizedSharedRingPair ? { canonicalSharedRingPair: true } : {}),
      ...(options.ratioUpperPairPolicy === undefined
        ? {}
        : { ratioUpperPairPolicy: options.ratioUpperPairPolicy }),
      ...(options.sharedAccessoryPairDominance === true
        ? { sharedAccessoryPairDominance: true }
        : {}),
      ...(initialResults.length === contexts.length ? { initialResults } : {}),
      maxSearchMs: remainingMs,
      ...(onSolverProgress === undefined ? {} : {
        onSolverProgress: (event: LinearMipProgress) => onSolverProgress({ ...event, model: `joint:${event.model}` }),
      }),
      ...(onSolverCallback === undefined ? {} : {
        onSolverCallback: (event: HighsCallbackTrace) => onSolverCallback({ ...event, model: `joint:${event.model}` }),
      }),
      ...(options.onProgress === undefined ? {} : { onProgress: options.onProgress }),
      isCancelled: cancellationRequested,
    };
    if (options.sharedAccessoryPairDominance === true &&
      hasSharedAccessoryPairDominancePath(options)) {
      markSharedAccessoryPairDominancePath(jointOptions);
    }
    const joint = stopAtProvenCeiling || exactSharedDomainProof
      ? undefined
      : await findBestJointFactorMip(jointOptions);
    assertWithinBudget("联合因子模型复核");
    if (joint !== undefined) {
      jointInnerSolverStatus = joint.innerSolverStatus;
      mutable.innerSolves += joint.solverRuns;
      mutable.completeNodes++;
      const results = joint.results.map((result, index) => ({ ...result,
        ...(contexts[index]!.optimum.maximumToughness === undefined ? {} : {
          maximumToughness: contexts[index]!.optimum.maximumToughness,
        }),
      }));
      updateBest(exactScore(results), results);
    }
    jointFactorProof = !exactSharedDomainProof;
  } else {
    for (const foodChoice of foodChoices) {
      if (stopAtProvenCeiling) break;
      const fixed = hasOnlyOneCommonAssignment
        ? new Map(options.commonSlots.map((name) => [name, commonChoicesByName.get(name)![0]!]))
        : new Map<string, CommonChoice>();
      await visit(fixed, foodChoice);
    }
  }

  assertWithinBudget("结果整理");
  if (best === undefined) return undefined;
  const stats = statisticsSnapshot(mutable, startedAt, timeLimitMs, cacheLimit, cache.size);
  const withMetrics = (context: JobContext, result: ExactMipResult): JointLoadoutJobResultV3 => {
    const factors = factorsForResult(context, result);
    const gcd = factors.gcdCentiseconds / 100;
    return {
      ...result,
      gcd,
      damagePerSecond: gcd > 0 ? result.damage / gcd : 0,
    };
  };
  return {
    value: {
      numerator: best.score.numerator.toString(),
      denominator: best.score.denominator.toString(),
      approximate: Number(best.score.numerator) / Number(best.score.denominator),
    },
    commonEquipments: best.commonEquipments,
    jobResults: Object.fromEntries(contexts.map((context) => [
      context.job.id,
      withMetrics(context, best!.jobResults[context.job.id]!),
    ])),
    optima: Object.fromEntries(contexts.map((context) => [context.job.id, withMetrics(context, context.optimum)])),
    statistics: stats,
    proof: {
      complete: true,
      objective,
      optimalityScope: "传入的每职业槽位候选（含两个独立戒指槽及跨槽 unique 约束）、完整装备身份交集、食物列表和约束范围",
      outerBound: jointFactorProof
        ? "单职业最优基线归一化后，每职业比例不超过 1；总和不超过职业数减 1 加比例乘积，乘积仅筛选可能改进的因子签名；最终总和使用 BigInt 有理数比较"
        : objective === "dps"
        ? "每个外层节点以各职业在已固定通用装备下独立重优化的 DPS 上界求和；product/GCD 归一化分数用 BigInt 有理数比较"
        : "每个外层节点以各职业在已固定通用装备下独立重优化的伤害上界求和；归一化分数用 BigInt 有理数比较",
      innerSolverStatus: jointInnerSolverStatus,
      formalCertificate: false,
      numericalLimitation: "HiGHS 报告 Optimal，或经保守取整的 MIP 对偶上界已不高于精确 BigInt incumbent；模型行与属性重建均已复核，但这些求解器结果不是独立形式化证书",
      terminationReason: stopAtProvenCeiling
        ? "已达到各职业单独最优基线之和这一全局上界"
        : jointFactorProof && jointInnerSolverStatus === "DualBound"
        ? "HiGHS MIP 对偶上界不高于当前精确 BigInt incumbent，已证明不存在严格改进解"
        : jointFactorProof
        ? "完整共享模型已穷尽归一化总和可能改进的因子签名；乘积仅用于必要条件筛选，最终比较精确有理数总和"
        : exactSharedDomainProof
        ? "已穷尽全部共享装备/食物组合，并对每个组合精确求得各职业条件最优；结果以 BigInt 有理数比较"
        : "所有未剪枝通用装备分支均已完成，剩余分支由精确有理数上界剪除",
    },
  };

  async function visit(
    fixed: Map<string, CommonChoice>,
    foodChoice: FoodChoice,
    parentResults?: readonly ExactMipResult[],
  ): Promise<void> {
    if (stopAtProvenCeiling) return;
    assertWithinBudget("外层分支定界");
    mutable.outerNodes++;
    if ((mutable.outerNodes & 31) === 0) {
      assertWithinBudget("外层分支定界");
      mutable.cacheEntries = cache.size;
      if (options.onProgress !== undefined) {
        const score = best === undefined
          ? "无 incumbent"
          : (() => {
              const approximate = Number(best.score.numerator) / Number(best.score.denominator);
              return Number.isFinite(approximate)
                ? approximate.toPrecision(10)
                : `${best.score.numerator}/${best.score.denominator}`;
            })();
        options.onProgress(
          `V3 搜索进度：外层节点=${mutable.outerNodes}；完成=${mutable.completeNodes}；上界剪枝=${mutable.upperBoundPrunes}；内层 MIP=${mutable.innerSolves}；父结果复用=${mutable.parentResultReuses}；incumbent=${score}；耗时=${Math.round(performance.now() - startedAt)}ms`,
        );
      }
    }

    const results = await refineSeedJobs(
      undefined,
      fixed,
      options.foodStrategy === "shared" ? foodChoice : undefined,
      contexts.map((_, index) => index),
      parentResults,
    );
    if (results.some((result) => result === undefined)) return;
    const completeResults = results as ExactMipResult[];
    const upperBound = exactScore(completeResults);
    if (best !== undefined && compareRational(upperBound, best.score) <= 0) {
      mutable.upperBoundPrunes++;
      return;
    }

    let allSharedChoicesAgree = true;
    for (const name of options.commonSlots) {
      const firstContext = contexts[0]!;
      const firstKey = commonSlotIdentity(firstContext, completeResults[0]!.selection, name, commonSlotProjections);
      for (let index = 1; index < contexts.length; index++) {
        const context = contexts[index]!;
        if (commonSlotIdentity(context, completeResults[index]!.selection, name, commonSlotProjections) !== firstKey) {
          allSharedChoicesAgree = false;
          break;
        }
      }
      if (!allSharedChoicesAgree) break;
    }
    if (allSharedChoicesAgree) {
      mutable.completeNodes++;
      mutable.relaxedOptimaAttained++;
      updateBest(upperBound, completeResults);
      return;
    }

    const relaxedKeysBySlot = new Map<string, string[]>();
    for (const name of options.commonSlots) {
      if (fixed.has(name)) continue;
      relaxedKeysBySlot.set(name, contexts.map((context, index) =>
        commonSlotIdentity(context, completeResults[index]!.selection, name, commonSlotProjections),
      ));
    }
    const disagreeingSlots = [...relaxedKeysBySlot.entries()]
      .filter(([, keys]) => keys.some((key) => key !== keys[0]))
      .sort(([left], [right]) =>
        commonChoicesByName.get(left)!.length - commonChoicesByName.get(right)!.length ||
        slotOrderIndex.get(left)! - slotOrderIndex.get(right)!);
    const branchSlot = disagreeingSlots[0]?.[0];
    if (branchSlot === undefined) {
      throw new Error("内部错误：松弛最优装备不一致，但没有可分支的通用槽位");
    }
    const relaxedKeys = relaxedKeysBySlot.get(branchSlot)!;
    const branchChoices = commonChoicesByName.get(branchSlot)!
      .map((choice, index) => ({
        choice,
        index,
        matches: relaxedKeys.reduce((count, key) => count + Number(choice.key === key), 0),
      }))
      .sort((left, right) => right.matches - left.matches || left.index - right.index);
    for (const { choice } of branchChoices) {
      fixed.set(branchSlot, choice);
      await visit(fixed, foodChoice, completeResults);
      fixed.delete(branchSlot);
      if (stopAtProvenCeiling) return;
    }
  }
}

function foodIdentityForOptional(food: FoodInfo | undefined): string {
  return food === undefined ? "no-food" : foodIdentity(food);
}
