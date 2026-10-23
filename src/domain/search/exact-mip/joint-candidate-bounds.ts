import { ringPairCandidate } from "./ring-domain.ts";
import { ringPairSharedIdentity } from "./ring-domain.ts";
import { throwIfCancelled } from "../cancellation.ts";
import type { ModelRow } from "../core/model-types.ts";
import { extractedAttributeMap } from "./ring-domain.ts";
import { exactProduct } from "./factor-model.ts";
import type { ResourceBudgetCandidateQuery } from "./candidate-bounds.ts";
import { prepareResourceBudgetCandidateBounds } from "./candidate-bounds.ts";
import { factorObjectiveLogScore } from "./factor-model.ts";
import type { FactorGroup } from "./types.ts";
import { gcd } from "../core/exact-arithmetic.ts";

import type {
  JointPreparedJob,
  JointSearchOptions,
  ExactRatio,
} from "./joint-types.ts";
import type { JointModel } from "./joint-model.ts";
import type { prepareJointIdentity } from "./joint-identity.ts";

export type FixedSharedChoice =
  | { kind: "equipment"; commonSlot: string; key: string }
  | { kind: "food"; key: string };
export type FixedEquipmentChoice = Extract<
  FixedSharedChoice,
  { kind: "equipment" }
>;
export type SharedKeyDomain = {
  kind: FixedSharedChoice["kind"];
  name: string;
  selectors: Map<string, string>;
};

export type CandidateSpecificUpperBound = {
  variable: string;
  rowName: string;
  ratio: ExactRatio;
};

export type ResourceBudgetCandidateUpperBound = {
  jobIndex: number;
  variable: string;
  rowName: string;
  scoreUpper: bigint;
  baselineScore: bigint;
  roundingSlack: bigint;
};

export type FactorClassUpperBound = {
  jobIndex: number;
  groupName: string;
  variable: string;
  rowName: string;
  ratio: ExactRatio;
};

export function prepareJointCandidateBounds(
  options: Pick<
    JointSearchOptions,
    "equipmentIdentity" | "foodIdentity" | "objective"
  >,
  preparedJobs: readonly JointPreparedJob[],
  model: Pick<
    JointModel,
    | "sharedEquipmentDomains"
    | "sharedEquipmentSelectors"
    | "sharedFoodSelectors"
    | "prefix"
  >,
  identity: ReturnType<typeof prepareJointIdentity>,
  timing: {
    jointPreprocessingBudgetBaseMs: number;
    isCancelled: () => boolean;
    jointTimeLimitReached: () => boolean;
  },
) {
  const {
    sharedEquipmentDomains,
    sharedEquipmentSelectors,
    sharedFoodSelectors,
    prefix,
  } = model;
  const { actualSlotName, commonEquipmentIdentity } = identity;
  const { jointPreprocessingBudgetBaseMs, isCancelled, jointTimeLimitReached } =
    timing;
  const sharedKeyDomains: SharedKeyDomain[] = [
    ...sharedEquipmentDomains.map((domain) => ({
      kind: "equipment" as const,
      name: domain.slot,
      selectors: sharedEquipmentSelectors.get(domain.slot)!,
    })),
    ...(sharedFoodSelectors === undefined
      ? []
      : [
          {
            kind: "food" as const,
            name: "food",
            selectors: sharedFoodSelectors,
          },
        ]),
  ];
  const sharedBoundPreprocessingStartedAt = performance.now();
  const gearSlotMaximums = preparedJobs.map(({ job, prepared }) =>
    job.options.slots.map((slot, slotIndex) => {
      const maximums = new Array<number>(job.options.attributeIds.length).fill(
        0,
      );
      for (
        let candidateIndex = 0;
        candidateIndex < slot.length;
        candidateIndex++
      ) {
        for (let attribute = 0; attribute < maximums.length; attribute++) {
          maximums[attribute] = Math.max(
            maximums[attribute]!,
            prepared.model.equipmentAttributes[slotIndex]![candidateIndex]![
              attribute
            ]!,
          );
        }
      }
      return maximums;
    }),
  );
  const gearKeySlotMaximums = new Map<string, Map<string, number[]>[]>();
  for (const domain of sharedEquipmentDomains) {
    const selectorKeys = new Set(
      sharedEquipmentSelectors.get(domain.slot)!.keys(),
    );
    const perJob = preparedJobs.map(
      ({ job, originalJob, ringSplit, prepared }, jobIndex) => {
        const maximumsByKey = new Map(
          [...selectorKeys].map((key) => [
            key,
            new Array<number>(job.options.attributeIds.length).fill(0),
          ]),
        );
        if (domain.splitPair) {
          if (ringSplit === undefined) return maximumsByKey;
          for (const candidate of originalJob.options.slots[
            ringSplit.originalSlotIndex
          ]!) {
            const pair = ringPairCandidate(candidate);
            if (pair === undefined) continue;
            const key = ringPairSharedIdentity(pair, options.equipmentIdentity);
            const maximums = maximumsByKey.get(key);
            if (maximums === undefined) continue;
            const attributes = extractedAttributeMap(job.options, pair);
            for (let attribute = 0; attribute < maximums.length; attribute++) {
              const attributeId = job.options.attributeIds[attribute]!;
              maximums[attribute] = Math.max(
                maximums[attribute]!,
                attributes.get(attributeId) ?? 0,
              );
            }
          }
          return maximumsByKey;
        }
        const slotIndex = job.slotNames.indexOf(
          actualSlotName(domain.slot, jobIndex),
        );
        if (slotIndex < 0) return maximumsByKey;
        const slot = job.options.slots[slotIndex]!;
        for (
          let candidateIndex = 0;
          candidateIndex < slot.length;
          candidateIndex++
        ) {
          const key = commonEquipmentIdentity(
            slot[candidateIndex]!,
            domain.slot,
            jobIndex,
          );
          const maximums = maximumsByKey.get(key);
          if (maximums === undefined) continue;
          for (let attribute = 0; attribute < maximums.length; attribute++) {
            maximums[attribute] = Math.max(
              maximums[attribute]!,
              prepared.model.equipmentAttributes[slotIndex]![candidateIndex]![
                attribute
              ]!,
            );
          }
        }
        return maximumsByKey;
      },
    );
    gearKeySlotMaximums.set(domain.slot, perJob);
  }
  const coordinateUpperAttributes = (
    jobIndex: number,
    fixedChoices: readonly FixedSharedChoice[],
  ): number[] | undefined => {
    const { job, prepared } = preparedJobs[jobIndex]!;
    const rawUpper = new Array<number>(job.options.attributeIds.length).fill(0);
    const fixedEquipmentBySlot = new Map<number, FixedEquipmentChoice[]>();
    const fixedPairChoices: FixedEquipmentChoice[] = [];
    let fixedFoodKey: string | undefined;
    for (const choice of fixedChoices) {
      if (choice.kind === "food") {
        if (fixedFoodKey !== undefined) return undefined;
        fixedFoodKey = choice.key;
        continue;
      }
      const pairDomain = sharedEquipmentDomains.find(
        (domain) => domain.slot === choice.commonSlot && domain.splitPair,
      );
      if (pairDomain !== undefined) {
        fixedPairChoices.push(choice);
        continue;
      }
      const slotIndex = job.slotNames.indexOf(
        actualSlotName(choice.commonSlot, jobIndex),
      );
      if (slotIndex < 0) return undefined;
      const restrictions = fixedEquipmentBySlot.get(slotIndex) ?? [];
      restrictions.push(choice);
      fixedEquipmentBySlot.set(slotIndex, restrictions);
    }
    for (let slotIndex = 0; slotIndex < job.options.slots.length; slotIndex++) {
      const candidates = job.options.slots[slotIndex]!;
      const ringSplit = preparedJobs[jobIndex]!.ringSplit;
      const fixedPair = fixedPairChoices[0];
      if (
        ringSplit !== undefined &&
        fixedPair !== undefined &&
        (slotIndex === ringSplit.firstSlotIndex ||
          slotIndex === ringSplit.secondSlotIndex)
      ) {
        if (slotIndex === ringSplit.firstSlotIndex) {
          const maximums = gearKeySlotMaximums
            .get(fixedPair.commonSlot)
            ?.[jobIndex]?.get(fixedPair.key);
          if (maximums === undefined) return undefined;
          for (let attribute = 0; attribute < rawUpper.length; attribute++) {
            rawUpper[attribute] += maximums[attribute]!;
          }
        }
        continue;
      }
      const restrictions = fixedEquipmentBySlot.get(slotIndex);
      if (restrictions === undefined) {
        for (let attribute = 0; attribute < rawUpper.length; attribute++) {
          rawUpper[attribute] +=
            gearSlotMaximums[jobIndex]![slotIndex]![attribute]!;
        }
        continue;
      }
      if (restrictions.length === 1) {
        const restriction = restrictions[0]!;
        const maximums = gearKeySlotMaximums
          .get(restriction.commonSlot)
          ?.[jobIndex]?.get(restriction.key);
        if (maximums === undefined) return undefined;
        for (let attribute = 0; attribute < rawUpper.length; attribute++)
          rawUpper[attribute] += maximums[attribute]!;
        continue;
      }
      // 两个投影可能指向同一完整的戒指对。计算配对属性和前，
      // 先将两个身份都与合法戒指对候选求交集。
      const coordinateMaximums = new Array<number>(rawUpper.length).fill(0);
      let foundCandidate = false;
      for (
        let candidateIndex = 0;
        candidateIndex < candidates.length;
        candidateIndex++
      ) {
        const equipment = candidates[candidateIndex]!;
        if (
          restrictions.some(
            (restriction) =>
              commonEquipmentIdentity(
                equipment,
                restriction.commonSlot,
                jobIndex,
              ) !== restriction.key,
          )
        )
          continue;
        foundCandidate = true;
        for (let attribute = 0; attribute < rawUpper.length; attribute++) {
          coordinateMaximums[attribute] = Math.max(
            coordinateMaximums[attribute]!,
            prepared.model.equipmentAttributes[slotIndex]![candidateIndex]![
              attribute
            ]!,
          );
        }
      }
      if (!foundCandidate) return undefined;
      for (let attribute = 0; attribute < rawUpper.length; attribute++)
        rawUpper[attribute] += coordinateMaximums[attribute]!;
    }

    // 只能选择一种食物。对每个坐标分别保留固定食物键允许的食物中，
    // 经精确封顶后的最大加成。
    const foodBonuses = new Array<number>(rawUpper.length).fill(0);
    for (const bonus of prepared.model.foodBonuses) {
      const food = job.options.foods[bonus.foodIndex];
      if (
        food === undefined ||
        (fixedFoodKey !== undefined &&
          options.foodIdentity(food) !== fixedFoodKey)
      )
        continue;
      const param = food.baseParams.find(
        (entry) =>
          entry.baseParamId === job.options.attributeIds[bonus.attribute],
      );
      if (
        param === undefined ||
        !Number.isSafeInteger(param.baseValue ?? 0) ||
        !Number.isSafeInteger(bonus.numerator) ||
        !Number.isSafeInteger(bonus.denominator)
      )
        return undefined;
      const rawWithBase =
        BigInt(rawUpper[bonus.attribute]!) + BigInt(param.baseValue ?? 0);
      if (rawWithBase < 0n) return undefined;
      const uncapped =
        (BigInt(bonus.numerator) * rawWithBase) / BigInt(bonus.denominator);
      const capped =
        uncapped >= BigInt(bonus.cap) ? bonus.cap : Number(uncapped);
      foodBonuses[bonus.attribute] = Math.max(
        foodBonuses[bonus.attribute]!,
        capped,
      );
    }
    return rawUpper.map((value, attribute) => value + foodBonuses[attribute]!);
  };
  const resourceBudgetScoreUpperForAttributes = (
    jobIndex: number,
    attributes: readonly number[],
  ): bigint | undefined => {
    const budgets = factorResourceBudgetByJob[jobIndex];
    if (budgets === undefined) return undefined;
    let bestUpper: bigint | undefined;
    for (const weighted of budgets) {
      if (weighted.weights.length !== weighted.attributes.length)
        return undefined;
      let totalResource = 0;
      for (let index = 0; index < weighted.attributes.length; index++) {
        const value = attributes[weighted.attributes[index]!];
        const contribution = value! * weighted.weights[index]!;
        if (
          !Number.isSafeInteger(value) ||
          value! < 0 ||
          !Number.isSafeInteger(contribution) ||
          !Number.isSafeInteger(totalResource + contribution)
        ) {
          return undefined;
        }
        totalResource += contribution;
      }
      // `coordinateUpperAttributes` 分别最大化各资源轴，
      // 因而每个加权和都能约束此共享前缀的所有补全方案。
      const upper = weighted.budget.query(totalResource);
      if (upper !== undefined && (bestUpper === undefined || upper < bestUpper))
        bestUpper = upper;
    }
    return bestUpper;
  };
  const exactUpperRatio = (
    jobIndex: number,
    attributes: readonly number[],
  ): ExactRatio | undefined => {
    const { job, prepared } = preparedJobs[jobIndex]!;
    const factors = prepared.factorEvaluator(attributes);
    if (
      factors === undefined ||
      ![
        factors.weaponDamage,
        factors.mainStat,
        factors.determination,
        factors.tenacity,
        factors.critical,
        factors.directHit,
        factors.gcdCentiseconds,
      ].every((value) => Number.isSafeInteger(value) && value > 0)
    )
      return undefined;
    return {
      numerator:
        exactProduct(factors) *
        (options.objective === "dps"
          ? BigInt(job.baseline.gcdCentiseconds)
          : 1n),
      denominator:
        exactProduct(job.baseline) *
        (options.objective === "dps" ? BigInt(factors.gcdCentiseconds) : 1n),
    };
  };
  const candidateSpecificUpperBounds: CandidateSpecificUpperBound[] = [];
  let candidateSpecificUpperBoundPreparationMs = 0;
  let candidateSpecificUpperBoundSkippedJobs = 0;
  const candidateSpecificUpperBoundPreparationStartedAt = performance.now();
  const candidateSpecificUpperBoundPreparationBudgetMs = Math.min(
    500,
    Math.max(10, jointPreprocessingBudgetBaseMs * 0.02),
  );
  for (let jobIndex = 0; jobIndex < preparedJobs.length; jobIndex++) {
    const { job, prepared } = preparedJobs[jobIndex]!;
    if (
      job.options.equipmentAttributeExtractor !== undefined ||
      job.options.constraints?.maxToughnessMode === true ||
      job.options.job === "BLU"
    ) {
      candidateSpecificUpperBoundSkippedJobs++;
      continue;
    }
    if (
      ![
        job.baseline.weaponDamage,
        job.baseline.mainStat,
        job.baseline.determination,
        job.baseline.tenacity,
        job.baseline.critical,
        job.baseline.directHit,
        job.baseline.gcdCentiseconds,
      ].every((value) => Number.isSafeInteger(value) && value > 0)
    ) {
      candidateSpecificUpperBoundSkippedJobs++;
      continue;
    }
    const equipmentAttributes = prepared.model.equipmentAttributes;
    if (
      equipmentAttributes.some((slot) =>
        slot.some(
          (attributes) =>
            attributes.length !== job.options.attributeIds.length ||
            attributes.some((value) => !Number.isSafeInteger(value)),
        ),
      ) ||
      prepared.model.rawMaximums.some((value) => !Number.isSafeInteger(value))
    ) {
      candidateSpecificUpperBoundSkippedJobs++;
      continue;
    }
    type FoodBonusBound = {
      attribute: number;
      numerator: number;
      denominator: number;
      cap: number;
      baseValue: number;
    };
    const foodBonusBoundsByFood = new Map<
      number,
      Map<number, FoodBonusBound[]>
    >();
    let validFoodBounds = true;
    for (const food of job.options.foods) {
      const seenAttributes = new Set<number>();
      for (const param of food.baseParams) {
        if (seenAttributes.has(param.baseParamId)) {
          validFoodBounds = false;
          break;
        }
        seenAttributes.add(param.baseParamId);
      }
      if (!validFoodBounds) break;
    }
    for (const bonus of prepared.model.foodBonuses) {
      if (!validFoodBounds) break;
      const food = job.options.foods[bonus.foodIndex];
      const attributeId = job.options.attributeIds[bonus.attribute];
      const param = food?.baseParams.find(
        (entry) => entry.baseParamId === attributeId,
      );
      if (
        food === undefined ||
        attributeId === undefined ||
        param === undefined ||
        !Number.isSafeInteger(param.baseValue ?? 0) ||
        !Number.isSafeInteger(bonus.numerator) ||
        bonus.numerator < 0 ||
        !Number.isSafeInteger(bonus.denominator) ||
        bonus.denominator <= 0 ||
        !Number.isSafeInteger(bonus.cap) ||
        bonus.cap < 0
      ) {
        validFoodBounds = false;
        break;
      }
      const byAttribute =
        foodBonusBoundsByFood.get(bonus.foodIndex) ??
        new Map<number, FoodBonusBound[]>();
      const boundsForAttribute = byAttribute.get(bonus.attribute) ?? [];
      if (boundsForAttribute.length > 0) {
        // 规范求值器会针对逐步更新后的属性累加重复食物约束行。
        // 跳过这个可选上界，避免根据单个原始坐标计算出过低的估计值。
        validFoodBounds = false;
        break;
      }
      boundsForAttribute.push({
        attribute: bonus.attribute,
        numerator: bonus.numerator,
        denominator: bonus.denominator,
        cap: bonus.cap,
        baseValue: param.baseValue ?? 0,
      });
      byAttribute.set(bonus.attribute, boundsForAttribute);
      foodBonusBoundsByFood.set(bonus.foodIndex, byAttribute);
    }
    if (!validFoodBounds) {
      candidateSpecificUpperBoundSkippedJobs++;
      continue;
    }
    let jobPreprocessingComplete = true;
    for (
      let slotIndex = 0;
      slotIndex < job.options.slots.length && jobPreprocessingComplete;
      slotIndex++
    ) {
      const candidates = job.options.slots[slotIndex]!;
      for (
        let candidateIndex = 0;
        candidateIndex < candidates.length;
        candidateIndex++
      ) {
        if ((candidateIndex & 255) === 0) {
          throwIfCancelled(isCancelled);
          if (
            performance.now() -
              candidateSpecificUpperBoundPreparationStartedAt >=
              candidateSpecificUpperBoundPreparationBudgetMs ||
            jointTimeLimitReached()
          ) {
            jobPreprocessingComplete = false;
            break;
          }
        }
        const rawUpper = [...equipmentAttributes[slotIndex]![candidateIndex]!];
        for (
          let otherSlot = 0;
          otherSlot < job.options.slots.length;
          otherSlot++
        ) {
          if (otherSlot === slotIndex) continue;
          for (let attribute = 0; attribute < rawUpper.length; attribute++) {
            rawUpper[attribute] +=
              gearSlotMaximums[jobIndex]![otherSlot]![attribute]!;
          }
        }
        if (rawUpper.some((value) => !Number.isSafeInteger(value))) continue;

        // 食物必须整体选择。对不同食物分别取各坐标最大值，
        // 这样会放宽食物间的耦合，同时保留每项精确的向下取整和上限规则。
        const foodBonusUpper = new Array<number>(rawUpper.length).fill(0);
        let validCandidateFoodUpper = true;
        for (const byAttribute of foodBonusBoundsByFood.values()) {
          for (const [attribute, boundsForAttribute] of byAttribute) {
            const bonus = boundsForAttribute[0]!;
            const rawWithBase =
              BigInt(rawUpper[attribute]!) + BigInt(bonus.baseValue);
            if (rawWithBase < 0n) {
              validCandidateFoodUpper = false;
              break;
            }
            const uncapped =
              (BigInt(bonus.numerator) * rawWithBase) /
              BigInt(bonus.denominator);
            const foodBonus =
              uncapped >= BigInt(bonus.cap) ? BigInt(bonus.cap) : uncapped;
            foodBonusUpper[attribute] = Math.max(
              foodBonusUpper[attribute]!,
              Number(foodBonus),
            );
          }
          if (!validCandidateFoodUpper) break;
        }
        if (!validCandidateFoodUpper) continue;
        const attributes = rawUpper.map(
          (value, attribute) => value + foodBonusUpper[attribute]!,
        );
        if (attributes.some((value) => !Number.isSafeInteger(value))) continue;
        const ratio = exactUpperRatio(jobIndex, attributes);
        if (ratio === undefined || ratio.denominator <= 0n) continue;
        candidateSpecificUpperBounds.push({
          variable: prefix(
            jobIndex,
            prepared.model.slotVariables[slotIndex]![candidateIndex]!,
          ),
          rowName:
            "joint_candidate_upper_" +
            jobIndex +
            "_" +
            slotIndex +
            "_" +
            candidateIndex,
          ratio,
        });
      }
    }
    if (!jobPreprocessingComplete) candidateSpecificUpperBoundSkippedJobs++;
  }
  const resourceBudgetCandidateUpperBounds: ResourceBudgetCandidateUpperBound[] =
    [];
  const factorResourceBudgetByJob: (
    readonly ResourceBudgetCandidateQuery[] | undefined
  )[] = new Array(preparedJobs.length).fill(undefined);
  let resourceBudgetCandidateUpperBoundSkippedJobs = 0;
  let resourceBudgetCandidateUpperBoundPreparationMs = 0;
  const resourceBudgetCandidateUpperBoundPreparationStartedAt =
    performance.now();
  const resourceBudgetCandidateUpperBoundProofRows = new Map<
    string,
    ModelRow
  >();
  for (let jobIndex = 0; jobIndex < preparedJobs.length; jobIndex++) {
    // 在四职业和五职业档位中，逐候选资源查询没有产生剪枝，
    // 反而显著降低了共享前缀预处理的效率。
    if (preparedJobs.length >= 4) {
      resourceBudgetCandidateUpperBoundSkippedJobs++;
      continue;
    }
    const { job, prepared } = preparedJobs[jobIndex]!;
    const resourceBudgetProfile =
      job.options.resourceBudgetCandidateProfile ?? "default";
    if (resourceBudgetProfile === "disabled") {
      resourceBudgetCandidateUpperBoundSkippedJobs++;
      continue;
    }
    if (
      job.options.equipmentAttributeExtractor !== undefined ||
      job.options.constraints?.maxToughnessMode === true ||
      job.options.job === "BLU"
    ) {
      resourceBudgetCandidateUpperBoundSkippedJobs++;
      continue;
    }
    const remainingPreparationMs =
      candidateSpecificUpperBoundPreparationBudgetMs -
      (performance.now() - candidateSpecificUpperBoundPreparationStartedAt);
    if (remainingPreparationMs <= 0) {
      resourceBudgetCandidateUpperBoundSkippedJobs++;
      continue;
    }
    const resourceBudgetDeadline = Math.min(
      candidateSpecificUpperBoundPreparationStartedAt +
        candidateSpecificUpperBoundPreparationBudgetMs,
      performance.now() +
        Math.min(
          150,
          remainingPreparationMs / Math.max(1, preparedJobs.length - jobIndex),
        ),
    );
    const resourceBounds = prepareResourceBudgetCandidateBounds(
      job.options,
      prepared.model,
      prepared.groups,
      new Map([
        ["main", prepared.mainAttribute],
        ["weapon", prepared.weaponAttribute],
        ["det", prepared.detAttribute],
        ["ten", prepared.tenAttribute],
        ["crt", prepared.crtAttribute],
        ["dht", prepared.dhtAttribute],
        ["gcd", prepared.speedAttribute],
      ]),
      resourceBudgetDeadline,
      () => isCancelled(),
      true,
    );
    if (
      resourceBounds === undefined ||
      resourceBounds.bySlot.length !== job.options.slots.length ||
      resourceBounds.bySlot.some(
        (slot, slotIndex) =>
          job.options.slots[slotIndex]!.length !==
            prepared.model.slotVariables[slotIndex]!.length || slot.size === 0,
      )
    ) {
      resourceBudgetCandidateUpperBoundSkippedJobs++;
      continue;
    }
    factorResourceBudgetByJob[jobIndex] =
      resourceBudgetProfile === "weighted"
        ? resourceBounds.queryBudgets
        : resourceBounds.queryBudgets.slice(0, 1);
    const baselineScore = BigInt(
      factorObjectiveLogScore(job.baseline, prepared.useDps),
    );
    const roundingSlack = BigInt(prepared.groups.length);
    for (let slotIndex = 0; slotIndex < job.options.slots.length; slotIndex++) {
      const candidates = job.options.slots[slotIndex]!;
      for (
        let candidateIndex = 0;
        candidateIndex < candidates.length;
        candidateIndex++
      ) {
        const scoreUpper = resourceBounds.bySlot[slotIndex]!.get(
          candidates[candidateIndex]!,
        );
        if (scoreUpper === undefined) continue;
        resourceBudgetCandidateUpperBounds.push({
          jobIndex,
          variable: prefix(
            jobIndex,
            prepared.model.slotVariables[slotIndex]![candidateIndex]!,
          ),
          rowName: `joint_candidate_resource_upper_${jobIndex}_${slotIndex}_${candidateIndex}`,
          scoreUpper,
          baselineScore,
          roundingSlack,
        });
      }
    }
  }
  resourceBudgetCandidateUpperBoundPreparationMs =
    performance.now() - resourceBudgetCandidateUpperBoundPreparationStartedAt;
  candidateSpecificUpperBoundPreparationMs =
    performance.now() - candidateSpecificUpperBoundPreparationStartedAt;
  const useResourceBudgetSharedPrefixBounds =
    preparedJobs.length < 4 &&
    factorResourceBudgetByJob.some((budget) => budget !== undefined);
  const factorClassUpperBounds: FactorClassUpperBound[] = [];
  for (let jobIndex = 0; jobIndex < preparedJobs.length; jobIndex++) {
    const { job, prepared } = preparedJobs[jobIndex]!;
    const damageGroups = prepared.groups.filter(
      (group) => group.name !== "gcd",
    );
    const gcdGroup = prepared.groups.find((group) => group.name === "gcd");
    const maximumByGroup = new Map<FactorGroup, bigint>();
    let validDomain =
      damageGroups.length > 0 && exactProduct(job.baseline) > 0n;
    for (const group of damageGroups) {
      if (
        group.classes.length === 0 ||
        group.classes.some(
          (factorClass) =>
            !Number.isSafeInteger(factorClass.value) || factorClass.value <= 0,
        )
      ) {
        validDomain = false;
        break;
      }
      maximumByGroup.set(
        group,
        BigInt(
          Math.max(...group.classes.map((factorClass) => factorClass.value)),
        ),
      );
    }
    let minimumGcd: bigint | undefined;
    if (options.objective === "dps") {
      if (
        gcdGroup === undefined ||
        gcdGroup.classes.length === 0 ||
        gcdGroup.classes.some(
          (factorClass) =>
            !Number.isSafeInteger(factorClass.value) || factorClass.value <= 0,
        ) ||
        !Number.isSafeInteger(job.baseline.gcdCentiseconds) ||
        job.baseline.gcdCentiseconds <= 0
      ) {
        validDomain = false;
      } else {
        minimumGcd = BigInt(
          Math.min(...gcdGroup.classes.map((factorClass) => factorClass.value)),
        );
      }
    }
    if (!validDomain) continue;
    const baselineProduct = exactProduct(job.baseline);
    const baselineGcd =
      options.objective === "dps" ? BigInt(job.baseline.gcdCentiseconds) : 1n;
    for (const group of damageGroups) {
      for (
        let classIndex = 0;
        classIndex < group.classes.length;
        classIndex++
      ) {
        const factorClass = group.classes[classIndex]!;
        const otherMaximumProduct = damageGroups.reduce(
          (product, otherGroup) =>
            otherGroup === group
              ? product
              : product * maximumByGroup.get(otherGroup)!,
          1n,
        );
        const ratio: ExactRatio = {
          numerator:
            otherMaximumProduct * BigInt(factorClass.value) * baselineGcd,
          denominator: baselineProduct * (minimumGcd ?? 1n),
        };
        factorClassUpperBounds.push({
          jobIndex,
          groupName: group.name,
          variable: factorClass.variable,
          rowName: `joint_necessary_class_${jobIndex}_${group.name}_${classIndex}`,
          ratio,
        });
      }
    }
    if (options.objective === "dps" && gcdGroup !== undefined) {
      const maximumDamageProduct = damageGroups.reduce(
        (product, group) => product * maximumByGroup.get(group)!,
        1n,
      );
      for (
        let classIndex = 0;
        classIndex < gcdGroup.classes.length;
        classIndex++
      ) {
        const factorClass = gcdGroup.classes[classIndex]!;
        factorClassUpperBounds.push({
          jobIndex,
          groupName: gcdGroup.name,
          variable: factorClass.variable,
          rowName: `joint_necessary_class_${jobIndex}_gcd_${classIndex}`,
          ratio: {
            numerator: maximumDamageProduct * baselineGcd,
            denominator: baselineProduct * BigInt(factorClass.value),
          },
        });
      }
    }
  }
  const compareExactRatios = (left: ExactRatio, right: ExactRatio) => {
    const comparison =
      left.numerator * right.denominator - right.numerator * left.denominator;
    return comparison < 0n ? -1 : comparison > 0n ? 1 : 0;
  };
  const factorClassUpperBoundsByJobAndGroup = preparedJobs.map(
    ({ prepared }, jobIndex) => {
      const groups = new Map(
        prepared.groups.map(
          (group) => [group.name, [] as FactorClassUpperBound[]] as const,
        ),
      );
      for (const bound of factorClassUpperBounds) {
        if (bound.jobIndex === jobIndex)
          groups.get(bound.groupName)?.push(bound);
      }
      for (const boundsForGroup of groups.values()) {
        boundsForGroup.sort(
          (left, right) =>
            compareExactRatios(left.ratio, right.ratio) ||
            left.variable.localeCompare(right.variable),
        );
      }
      return groups;
    },
  );
  return {
    get sharedKeyDomains() {
      return sharedKeyDomains;
    },
    get sharedBoundPreprocessingStartedAt() {
      return sharedBoundPreprocessingStartedAt;
    },
    get coordinateUpperAttributes() {
      return coordinateUpperAttributes;
    },
    get resourceBudgetScoreUpperForAttributes() {
      return resourceBudgetScoreUpperForAttributes;
    },
    get exactUpperRatio() {
      return exactUpperRatio;
    },
    get candidateSpecificUpperBounds() {
      return candidateSpecificUpperBounds;
    },
    get candidateSpecificUpperBoundPreparationMs() {
      return candidateSpecificUpperBoundPreparationMs;
    },
    get candidateSpecificUpperBoundSkippedJobs() {
      return candidateSpecificUpperBoundSkippedJobs;
    },
    get resourceBudgetCandidateUpperBounds() {
      return resourceBudgetCandidateUpperBounds;
    },
    get resourceBudgetCandidateUpperBoundSkippedJobs() {
      return resourceBudgetCandidateUpperBoundSkippedJobs;
    },
    get resourceBudgetCandidateUpperBoundPreparationMs() {
      return resourceBudgetCandidateUpperBoundPreparationMs;
    },
    get resourceBudgetCandidateUpperBoundProofRows() {
      return resourceBudgetCandidateUpperBoundProofRows;
    },
    get useResourceBudgetSharedPrefixBounds() {
      return useResourceBudgetSharedPrefixBounds;
    },
    get factorClassUpperBounds() {
      return factorClassUpperBounds;
    },
    get compareExactRatios() {
      return compareExactRatios;
    },
    get factorClassUpperBoundsByJobAndGroup() {
      return factorClassUpperBoundsByJobAndGroup;
    },
  };
}

export type JointCandidateBounds = ReturnType<
  typeof prepareJointCandidateBounds
>;
