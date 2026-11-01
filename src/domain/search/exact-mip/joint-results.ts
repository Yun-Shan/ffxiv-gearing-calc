import type {
  JointPreparedJob,
  JointSearchOptions,
  ExactRatio,
} from "./joint-types.ts";
import type { prepareJointIdentity } from "./joint-identity.ts";
import type { ExactMipResult } from "./types.ts";
import { exactProduct } from "./factor-model.ts";
import { internalRingSelection } from "./ring-domain.ts";
import { ringChildStructuralKey } from "./ring-domain.ts";
import { hasUniqueRingConflict } from "./ring-domain.ts";
import { getAttributeVector } from "./attributes.ts";
import { gcd } from "../core/exact-arithmetic.ts";
import { getMemoryUsageSnapshot } from "../memory-usage.ts";
import { slotsForResultWithResistanceAllocations } from "./result-decoding.ts";
import { originalRingSelection } from "./ring-domain.ts";
import { assertRequestedGcd, foodForResult } from "./result-decoding.ts";
import type { EquipInfo } from "../types.ts";
import { assertUniqueFoodAttributes } from "../food-parameters.ts";

export type JointIncumbent = ExactRatio & { results: ExactMipResult[] };

export function validateJointInitialResults(
  options: Pick<
    JointSearchOptions,
    | "commonSlots"
    | "equipmentIdentity"
    | "foodIdentity"
    | "objective"
    | "sharedFood"
  >,
  preparedJobs: readonly JointPreparedJob[],
  jointInitialResults: readonly ExactMipResult[] | undefined,
  originalSelectionIdentity: ReturnType<
    typeof prepareJointIdentity
  >["originalSelectionIdentity"],
): JointIncumbent | undefined {
  if (jointInitialResults !== undefined) {
    if (jointInitialResults.length !== preparedJobs.length)
      throw new Error("联合初始方案职业数不匹配");
    let numerator = 0n;
    let denominator = 1n;
    const results: ExactMipResult[] = [];
    for (let index = 0; index < preparedJobs.length; index++) {
      const jointJob = preparedJobs[index]!;
      const { job, prepared } = jointJob;
      const result = jointInitialResults[index]!;
      if (result.food !== undefined) assertUniqueFoodAttributes(result.food);
      const suppliedSelection = internalRingSelection(jointJob, result.selection);
      if (
        result.selection.length !== jointJob.originalJob.options.slots.length ||
        suppliedSelection === undefined ||
        suppliedSelection.length !== job.options.slots.length
      ) {
        throw new Error("联合初始方案装备不属于模型候选");
      }
      const vector = (selection: readonly EquipInfo[], food: ExactMipResult["food"]) =>
        getAttributeVector(selection, food, job.options.attributeIds,
          job.options.equipmentAttributeExtractor, job.options.statIndexes);
      const sameVector = (left: readonly number[], right: readonly number[]) =>
        left.length === right.length && left.every((value, attribute) =>
          Number.isSafeInteger(value) && value === right[attribute]);
      // Physical identity alone does not certify another job/version's values.
      // Match the actual vector, then rebuild solely from this candidate domain.
      const rawAttributes = new Array<number>(job.options.attributeIds.length).fill(0);
      const modelSelection = suppliedSelection.map((equipment, slot) => {
        const isSplitRing = jointJob.ringSplit !== undefined &&
          (slot === jointJob.ringSplit.firstSlotIndex || slot === jointJob.ringSplit.secondSlotIndex);
        const unallocated = equipment.resistanceAllocation === undefined
          ? equipment : { ...equipment, resistanceAllocation: undefined };
        for (let candidateIndex = 0; candidateIndex < job.options.slots[slot]!.length; candidateIndex++) {
          const candidate = job.options.slots[slot]![candidateIndex]!;
          if (isSplitRing ? ringChildStructuralKey(candidate) !== ringChildStructuralKey(equipment)
            : options.equipmentIdentity(candidate) !== options.equipmentIdentity(unallocated)) continue;
          // Only the allocation values may come from a solved result. All caps,
          // stat mappings and base attributes come from this job's current model.
          const allocations = equipment.resistanceAllocation ?? [];
          const permitted = prepared.model.resistanceAllocationVariables.filter(entry =>
            entry.slotIndex === slot && entry.candidateIndex === candidateIndex);
          const fixed = prepared.model.fixedEquipmentAttributes[slot]?.[candidateIndex];
          if (fixed === undefined || fixed.length !== job.options.attributeIds.length)
            throw new Error("联合初始方案缺少模型候选固定属性");
          const linearAttributes = [...fixed];
          const seen = new Set<string>();
          let total = 0;
          const valid = allocations.every(allocation => {
            const entry = permitted.find(entry => entry.stat === allocation.stat && entry.baseParamId === allocation.baseParamId);
            if (entry === undefined || seen.has(allocation.stat) || !Number.isSafeInteger(allocation.value)
              || allocation.value <= 0 || allocation.value > entry.maxValue
              || prepared.model.idToIndex.get(allocation.baseParamId) !== entry.attributeIndex) return false;
            seen.add(allocation.stat);
            total += allocation.value;
            linearAttributes[entry.attributeIndex] += allocation.value;
            return Number.isSafeInteger(total) && total <= entry.maxTotalStats;
          });
          if (!valid) continue;
          const selected = allocations.length === 0 ? candidate : { ...candidate,
            resistanceAllocation: allocations.map(({ stat, baseParamId, value }) => ({ stat, baseParamId, value })) };
          const supplied = allocations.length === 0 ? equipment : { ...equipment,
            resistanceWeaponAdjust: selected.resistanceWeaponAdjust, resistanceAllocation: selected.resistanceAllocation };
          const selectedAttributes = vector([selected], undefined);
          // The native model extracts a bare candidate once, then adds only the
          // allocation coordinates. An allocation-sensitive extractor must not
          // manufacture extra attributes when decoding a solved weapon.
          if (sameVector(selectedAttributes, linearAttributes) &&
            sameVector(selectedAttributes, vector([supplied], undefined))) {
            linearAttributes.forEach((value, attribute) => { rawAttributes[attribute] += value; });
            return selected;
          }
        }
        throw new Error("联合初始方案装备不属于模型候选或属性向量不匹配");
      });
      if (hasUniqueRingConflict(modelSelection)) {
        throw new Error("联合初始方案重复使用唯一戒指");
      }
      const suppliedAttributes = vector(modelSelection, result.food);
      const food = result.food === undefined ? undefined : job.options.foods.find(candidate =>
        options.foodIdentity(candidate) === options.foodIdentity(result.food!) &&
        sameVector(vector(modelSelection, candidate), suppliedAttributes));
      if (result.food === undefined ? job.options.foods.length > 0 : food === undefined) {
        throw new Error("联合初始方案食物不属于模型候选");
      }
      const attributes = vector(modelSelection, food);
      const modeledAttributes = [...rawAttributes];
      const foodIndex = food === undefined ? -1 : job.options.foods.indexOf(food);
      for (const bonus of prepared.model.foodBonuses) {
        if (bonus.foodIndex !== foodIndex) continue;
        // The model stored its original food offset in maximumRaw when it emitted the floor rows.
        const base = bonus.maximumRaw - prepared.model.rawMaximums[bonus.attribute]!;
        const raw = rawAttributes[bonus.attribute]!;
        if (![base, bonus.numerator, bonus.cap, raw].every(value =>
          Number.isSafeInteger(value) && value >= 0) || !Number.isSafeInteger(bonus.denominator) || bonus.denominator <= 0) {
          throw new Error("联合初始方案食物整数模型参数无效");
        }
        const amount = ((BigInt(raw) + BigInt(base)) * BigInt(bonus.numerator)) / BigInt(bonus.denominator);
        modeledAttributes[bonus.attribute] = raw + Number(amount < BigInt(bonus.cap) ? amount : BigInt(bonus.cap));
      }
      if (!sameVector(attributes, modeledAttributes))
        throw new Error("联合初始方案食物属性与原整数模型不一致");
      const selection = originalRingSelection(jointJob, modelSelection);
      for (const [attribute, range] of prepared.model.ranges) {
        if (
          (range.min !== undefined && attributes[attribute]! < range.min) ||
          (range.max !== undefined && attributes[attribute]! > range.max)
        )
          throw new Error("联合初始方案不满足属性约束");
      }
      if (prepared.model.gcdChoiceRanges.length > 0) {
        const speedIndex = job.options.speedAttributeId === undefined ? undefined
          : prepared.model.idToIndex.get(job.options.speedAttributeId);
        if (speedIndex === undefined || !prepared.model.gcdChoiceRanges.some(range =>
          attributes[speedIndex] >= range.min && attributes[speedIndex] <= range.max)) {
          throw new Error("联合初始方案不满足 GCD 速度区间并集");
        }
      }
      const factors = prepared.factorEvaluator(attributes);
      if (factors === undefined)
        throw new Error("联合初始方案无法计算整数因子");
      const evaluation = job.options.evaluationFunction(attributes);
      if (evaluation === undefined || !Number.isFinite(evaluation.damage))
        throw new Error("联合初始方案无法计算伤害");
      assertRequestedGcd(factors.gcdCentiseconds, job.options.constraints, "联合初始方案");
      for (const slot of options.commonSlots) {
        const currentIdentity = originalSelectionIdentity(
          selection,
          slot,
          index,
        );
        const firstIdentity = originalSelectionIdentity(
          index === 0 ? selection : results[0]!.selection,
          slot,
          0,
        );
        if (
          currentIdentity === undefined ||
          firstIdentity === undefined ||
          currentIdentity !== firstIdentity
        ) {
          throw new Error("联合初始方案装备不共享");
        }
      }
      const firstFood = index === 0 ? food : results[0]!.food;
      if (
        options.sharedFood &&
        (food === undefined
          ? "none"
          : options.foodIdentity(food)) !==
          (firstFood === undefined
            ? "none"
            : options.foodIdentity(firstFood))
      ) {
        throw new Error("联合初始方案食物不共享");
      }
      const ratioNumerator =
        exactProduct(factors) *
        (options.objective === "dps"
          ? BigInt(job.baseline.gcdCentiseconds)
          : 1n);
      const ratioDenominator =
        exactProduct(job.baseline) *
        (options.objective === "dps" ? BigInt(factors.gcdCentiseconds) : 1n);
      if (ratioNumerator > ratioDenominator)
        throw new Error("联合初始方案超过单职业基线");
      numerator = numerator * ratioDenominator + ratioNumerator * denominator;
      denominator *= ratioDenominator;
      results.push({ selection, food, damage: evaluation.damage, statistics: result.statistics });
    }
    return { numerator, denominator, results };
  }
  return undefined;
}

export function decodeJointSolution(
  options: Pick<JointSearchOptions, "objective">,
  preparedJobs: readonly JointPreparedJob[],
  columns: Parameters<typeof foodForResult>[2],
  statistics: {
    startedAt: number;
    solverRuns: number;
    excludedSignatures: number;
    variables: number;
    constraints: number;
  },
) {
  const { startedAt, solverRuns } = statistics;
  const prefix = (index: number, name: string) => `j${index}_${name}`;
  const signature: string[] = [];
  const results: ExactMipResult[] = [];
  let numerator = 0n;
  let denominator = 1n;
  for (let index = 0; index < preparedJobs.length; index++) {
    const jointJob = preparedJobs[index]!;
    const { job, prepared } = jointJob;
    const jobColumns = Object.fromEntries(
      prepared.model.bounds.map(({ name }) => [
        name,
        columns[prefix(index, name)] ?? { Primal: 0 },
      ]),
    );
    const modelSelection = slotsForResultWithResistanceAllocations(
      job.options.slots,
      prepared.model.slotVariables,
      prepared.model.resistanceAllocationVariables,
      jobColumns,
    );
    const selection = originalRingSelection(jointJob, modelSelection);
    const food = foodForResult(
      job.options.foods,
      prepared.model.foodVariables,
      jobColumns,
    );
    const attributes = getAttributeVector(
      modelSelection,
      food,
      job.options.attributeIds,
      job.options.equipmentAttributeExtractor,
      job.options.statIndexes,
    );
    const factors = prepared.factorEvaluator(attributes);
    const evaluation = job.options.evaluationFunction(attributes);
    if (
      factors === undefined ||
      evaluation === undefined ||
      !Number.isFinite(evaluation.damage)
    ) {
      throw new Error(`联合因子 MIP 结果无法计算：${job.id}`);
    }
    assertRequestedGcd(factors.gcdCentiseconds, job.options.constraints, `联合因子 MIP ${job.id}`);
    const fields = {
      weapon: "weaponDamage",
      main: "mainStat",
      det: "determination",
      ten: "tenacity",
      crt: "critical",
      dht: "directHit",
      gcd: "gcdCentiseconds",
    } as const;
    for (const group of prepared.groups) {
      const chosen = group.classes.find(
        (entry) => (jobColumns[entry.variable]?.Primal ?? 0) > 0.5,
      );
      if (
        chosen === undefined ||
        factors[fields[group.name as keyof typeof fields]] !== chosen.value
      ) {
        throw new Error(`联合因子 MIP 因子重建不一致：${job.id}/${group.name}`);
      }
      signature.push(prefix(index, chosen.variable));
    }
    for (let attribute = 0; attribute < attributes.length; attribute++) {
      if (
        attributes[attribute] !==
        Math.round(
          jobColumns[prepared.model.finalVariables[attribute]!]!.Primal,
        )
      ) {
        throw new Error(
          `联合因子 MIP 最终属性重建不一致：${job.id}/${attribute}`,
        );
      }
    }
    const ratioNumerator =
      exactProduct(factors) *
      (options.objective === "dps" ? BigInt(job.baseline.gcdCentiseconds) : 1n);
    const ratioDenominator =
      exactProduct(job.baseline) *
      (options.objective === "dps" ? BigInt(factors.gcdCentiseconds) : 1n);
    if (ratioNumerator > ratioDenominator)
      throw new Error(`联合方案超过已证明单职业基线：${job.id}`);
    numerator = numerator * ratioDenominator + ratioNumerator * denominator;
    denominator *= ratioDenominator;
    results.push({
      selection,
      food,
      damage: evaluation.damage,
      statistics: {
        elapsedMs: performance.now() - startedAt,
        solverRuns,
        excludedSignatures: statistics.excludedSignatures,
        signatureBandChecks: 0,
        signatureBandElapsedMs: 0,
        signatureBandProof: false,
        variables: statistics.variables,
        constraints: statistics.constraints,
        maximumSurrogate: 0,
        nextSurrogate: undefined,
        memoryUsage: getMemoryUsageSnapshot(),
      },
    });
  }
  return { signature, results, numerator, denominator };
}
