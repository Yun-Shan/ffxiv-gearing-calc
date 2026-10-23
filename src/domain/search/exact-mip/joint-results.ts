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
import { foodForResult } from "./result-decoding.ts";

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
    for (let index = 0; index < preparedJobs.length; index++) {
      const jointJob = preparedJobs[index]!;
      const { job, prepared } = jointJob;
      const result = jointInitialResults[index]!;
      const modelSelection = internalRingSelection(jointJob, result.selection);
      if (
        modelSelection === undefined ||
        modelSelection.length !== job.options.slots.length ||
        modelSelection.some(
          (equipment, slot) =>
            !job.options.slots[slot]!.some((candidate) =>
              jointJob.ringSplit !== undefined &&
              (slot === jointJob.ringSplit.firstSlotIndex ||
                slot === jointJob.ringSplit.secondSlotIndex)
                ? ringChildStructuralKey(candidate) ===
                  ringChildStructuralKey(equipment)
                : options.equipmentIdentity(candidate) ===
                  options.equipmentIdentity(
                    equipment.resistanceAllocation === undefined
                      ? equipment
                      : { ...equipment, resistanceAllocation: undefined },
                  ),
            ),
        )
      ) {
        throw new Error("联合初始方案装备不属于模型候选");
      }
      if (hasUniqueRingConflict(modelSelection)) {
        throw new Error("联合初始方案重复使用唯一戒指");
      }
      if (
        result.food === undefined
          ? job.options.foods.length > 0
          : !job.options.foods.some(
              (food) =>
                options.foodIdentity(food) ===
                options.foodIdentity(result.food!),
            )
      ) {
        throw new Error("联合初始方案食物不属于模型候选");
      }
      const attributes = getAttributeVector(
        modelSelection,
        result.food,
        job.options.attributeIds,
        job.options.equipmentAttributeExtractor,
        job.options.statIndexes,
      );
      for (const [attribute, range] of prepared.model.ranges) {
        if (
          (range.min !== undefined && attributes[attribute]! < range.min) ||
          (range.max !== undefined && attributes[attribute]! > range.max)
        )
          throw new Error("联合初始方案不满足属性约束");
      }
      const factors = prepared.factorEvaluator(attributes);
      if (factors === undefined)
        throw new Error("联合初始方案无法计算整数因子");
      const constraints = job.options.constraints;
      if (
        constraints?.gcd !== undefined &&
        Math.round(constraints.gcd * 100) !== factors.gcdCentiseconds
      ) {
        throw new Error("联合初始方案不满足标量 GCD 约束");
      }
      if (
        constraints?.gcdChoices !== undefined &&
        !constraints.gcdChoices.some(
          (value) => Math.round(value * 100) === factors.gcdCentiseconds,
        )
      ) {
        throw new Error("联合初始方案不满足 GCD 集合");
      }
      for (const slot of options.commonSlots) {
        const currentIdentity = originalSelectionIdentity(
          result.selection,
          slot,
          index,
        );
        const firstIdentity = originalSelectionIdentity(
          jointInitialResults[0]!.selection,
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
      if (
        options.sharedFood &&
        (result.food === undefined
          ? "none"
          : options.foodIdentity(result.food)) !==
          (jointInitialResults[0]!.food === undefined
            ? "none"
            : options.foodIdentity(jointInitialResults[0]!.food!))
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
    }
    return { numerator, denominator, results: [...jointInitialResults] };
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
