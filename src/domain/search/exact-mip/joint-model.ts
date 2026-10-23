import type { EquipInfo } from "../types.ts";
import { ringPairCandidate } from "./ring-domain.ts";
import { ringPairSharedIdentity } from "./ring-domain.ts";
import type { ModelRow } from "../core/model-types.ts";
import type { VariableBounds } from "../core/model-types.ts";
import { addTerm } from "../core/model-builder.ts";
import { addRows } from "../core/model-builder.ts";
import { roundedLog } from "../core/exact-arithmetic.ts";

import type { JointPreparedJob, JointSearchOptions } from "./joint-types.ts";
import type { prepareJointIdentity } from "./joint-identity.ts";

export type SharedEquipmentEntry = {
  equipment: EquipInfo;
  variables: string[];
  attributes?: readonly number[];
  childIdentityCounts?: Map<string, number>;
};
export type SharedEquipmentDomain = {
  slot: string;
  choices: Map<string, SharedEquipmentEntry>[];
  keys: Set<string>;
  splitPair?: boolean;
};

export function assembleJointModel(
  options: Pick<
    JointSearchOptions,
    | "canonicalSharedRingPair"
    | "commonSlots"
    | "equipmentIdentity"
    | "foodIdentity"
    | "objective"
    | "sharedFood"
  >,
  preparedJobs: readonly JointPreparedJob[],
  identity: ReturnType<typeof prepareJointIdentity>,
  canonical: {
    canonicalRingRanks: Map<string, number>;
    canonicalRingSlotIndexes: {
      firstSlotIndex: number;
      secondSlotIndex: number;
    }[];
  },
) {
  const { projections, actualSlotName, projectedEquipment } = identity;
  const { canonicalRingRanks, canonicalRingSlotIndexes } = canonical;
  const rows: ModelRow[] = [];
  const bounds: VariableBounds[] = [];
  const binaries: string[] = [];
  const generals: string[] = [];
  const objective = new Map<string, number>();
  const jobSurrogates: {
    terms: Map<string, number>;
    offset: number;
    baseline: number;
    error: number;
  }[] = [];
  let maximumOffset = 0;
  let baselineQ = 0;
  const prefix = (index: number, name: string) => `j${index}_${name}`;
  for (let index = 0; index < preparedJobs.length; index++) {
    const { job, ringSplit, prepared } = preparedJobs[index]!;
    const { model, groups, qByVariable } = prepared;
    for (const row of model.rows)
      rows.push({
        ...row,
        name: prefix(index, row.name),
        terms: new Map(
          [...row.terms].map(([name, value]) => [prefix(index, name), value]),
        ),
      });
    if (ringSplit !== undefined) {
      for (const itemId of ringSplit.uniqueItemIds) {
        const terms = new Map<string, number>();
        for (const slotIndex of [
          ringSplit.firstSlotIndex,
          ringSplit.secondSlotIndex,
        ]) {
          job.options.slots[slotIndex]!.forEach((candidate, candidateIndex) => {
            if (candidate.itemId === itemId) {
              addTerm(
                terms,
                prefix(index, model.slotVariables[slotIndex]![candidateIndex]!),
                1,
              );
            }
          });
        }
        addRows(rows, prefix(index, `ring_unique_${itemId}`), terms, "<=", 1);
      }
    }
    for (const bound of model.bounds)
      bounds.push({ ...bound, name: prefix(index, bound.name) });
    binaries.push(...model.binaryVars.map((name) => prefix(index, name)));
    generals.push(...model.generalVars.map((name) => prefix(index, name)));
    const terms = new Map(
      [...qByVariable].map(([name, value]) => [prefix(index, name), value]),
    );
    for (const [name, value] of terms) objective.set(name, value);
    const offset = groups.reduce(
      (sum, group) => sum + Math.max(...group.classes.map((entry) => entry.q)),
      0,
    );
    maximumOffset += offset;
    const factors = job.baseline;
    let individualBaselineQ = [
      factors.weaponDamage,
      factors.mainStat,
      factors.determination,
      factors.tenacity,
      factors.critical,
      factors.directHit,
    ].reduce((sum, value) => sum + roundedLog(value), 0);
    if (options.objective === "dps")
      individualBaselineQ -= roundedLog(factors.gcdCentiseconds);
    baselineQ += individualBaselineQ;
    jobSurrogates.push({
      terms,
      offset,
      baseline: individualBaselineQ,
      error: groups.length,
    });
    // 每个联合可行职业的结果都受其独立证明的最优值约束。
    // 显式添加上界还能防止 LP 松弛用不可能的超最优职业结果，抵消其他职业的次优结果。
    addRows(
      rows,
      `solo_bound_${index}`,
      terms,
      "<=",
      individualBaselineQ + groups.length - offset,
    );
  }
  if (options.canonicalSharedRingPair) {
    for (let jobIndex = 0; jobIndex < preparedJobs.length; jobIndex++) {
      const { job, prepared } = preparedJobs[jobIndex]!;
      const { firstSlotIndex, secondSlotIndex } =
        canonicalRingSlotIndexes[jobIndex]!;
      const terms = new Map<string, number>();
      for (const [slotIndex, direction] of [
        [firstSlotIndex, 1],
        [secondSlotIndex, -1],
      ] as const) {
        job.options.slots[slotIndex]!.forEach((equipment, candidateIndex) => {
          const rank = canonicalRingRanks.get(
            options.equipmentIdentity(equipment),
          );
          if (rank === undefined)
            throw new Error(`共享戒指身份缺少规范排序：${job.id}`);
          if (rank !== 0)
            addTerm(
              terms,
              prefix(
                jobIndex,
                prepared.model.slotVariables[slotIndex]![candidateIndex]!,
              ),
              rank * direction,
            );
        });
      }
      addRows(
        rows,
        prefix(jobIndex, "canonical_shared_ring_pair"),
        terms,
        "<=",
        0,
      );
    }
  }
  if (
    !Number.isSafeInteger(maximumOffset) ||
    !Number.isSafeInteger(baselineQ)
  ) {
    throw new Error("联合固定点目标超出安全整数范围");
  }
  const linkChoices = (
    name: string,
    choices: readonly ReadonlyMap<string, readonly string[]>[],
  ) => {
    const keys = [...choices[0]!.keys()].filter((key) =>
      choices.every((choice) => choice.has(key)),
    );
    if (keys.length === 0) return undefined;
    const selectors = new Map<string, string>();
    for (let choiceIndex = 0; choiceIndex < keys.length; choiceIndex++) {
      const key = keys[choiceIndex]!;
      const selector = `shared_${name}_${choiceIndex}`;
      bounds.push({ name: selector, min: 0, max: 1 });
      binaries.push(selector);
      selectors.set(key, selector);
      for (let jobIndex = 0; jobIndex < choices.length; jobIndex++) {
        const terms = new Map<string, number>([[selector, -1]]);
        for (const variable of choices[jobIndex]!.get(key)!)
          addTerm(terms, variable, 1);
        addRows(rows, `link_${name}_${choiceIndex}_${jobIndex}`, terms, "=", 0);
      }
    }
    addRows(
      rows,
      `shared_one_${name}`,
      [...selectors.values()].map((selector) => [selector, 1] as const),
      "=",
      1,
    );
    // 必须显式禁用不属于交集的选择。
    const allowed = new Set(keys);
    choices.forEach((choice, jobIndex) => {
      for (const [key, variables] of choice)
        if (!allowed.has(key)) {
          addRows(
            rows,
            `shared_absent_${name}_${jobIndex}_${rows.length}`,
            variables.map((variable) => [variable, 1] as const),
            "=",
            0,
          );
        }
    });
    return selectors;
  };
  const sharedEquipmentDomains: SharedEquipmentDomain[] =
    options.commonSlots.map((slot) => {
      const pairSplits = preparedJobs.map(({ ringSplit }) => {
        const projection = projections.get(slot);
        return projection === undefined &&
          ringSplit !== undefined &&
          ringSplit.originalSlotName === slot
          ? ringSplit
          : undefined;
      });
      const splitPair =
        pairSplits.length > 0 &&
        pairSplits.every((split) => split !== undefined);
      if (splitPair) {
        const choices = preparedJobs.map(({ originalJob }, jobIndex) => {
          const split = pairSplits[jobIndex]!;
          const byKey = new Map<string, SharedEquipmentEntry>();
          for (const equipment of originalJob.options.slots[
            split.originalSlotIndex
          ]!) {
            const pair = ringPairCandidate(equipment);
            if (pair === undefined)
              throw new Error(`共享槽位 ${slot} 包含非戒指对候选`);
            const key = ringPairSharedIdentity(pair, options.equipmentIdentity);
            const childIdentityCounts = new Map<string, number>();
            for (const child of pair.ringEquips) {
              const identity = options.equipmentIdentity(child);
              childIdentityCounts.set(
                identity,
                (childIdentityCounts.get(identity) ?? 0) + 1,
              );
            }
            if (!byKey.has(key))
              byKey.set(key, {
                equipment: pair,
                variables: [],
                childIdentityCounts,
              });
          }
          return byKey;
        });
        const keys = new Set(
          [...choices[0]!.keys()].filter((key) =>
            choices.every((choice) => choice.has(key)),
          ),
        );
        return { slot, choices, keys, splitPair: true };
      }

      const choices = preparedJobs.map(({ job, prepared }, jobIndex) => {
        const slotIndex = job.slotNames.indexOf(actualSlotName(slot, jobIndex));
        if (slotIndex < 0)
          throw new Error(`共享槽位 ${slot} 不存在于 ${job.id}`);
        const byKey = new Map<string, SharedEquipmentEntry>();
        job.options.slots[slotIndex]!.forEach((equipment, candidateIndex) => {
          const projected = projectedEquipment(equipment, slot, jobIndex);
          const key = options.equipmentIdentity(projected);
          const attributes = projections.has(slot)
            ? undefined
            : prepared.model.equipmentAttributes[slotIndex]?.[candidateIndex];
          const entry = byKey.get(key);
          if (entry === undefined) {
            byKey.set(key, {
              equipment: projected,
              variables: [],
              ...(attributes === undefined ? {} : { attributes }),
            });
          } else if (
            attributes === undefined ||
            entry.attributes === undefined ||
            attributes.length !== entry.attributes.length ||
            attributes.some(
              (value, index) => value !== entry.attributes![index],
            )
          ) {
            delete entry.attributes;
          }
          const linkedEntry = byKey.get(key)!;
          linkedEntry.variables.push(
            prefix(
              jobIndex,
              prepared.model.slotVariables[slotIndex]![candidateIndex]!,
            ),
          );
        });
        return byKey;
      });
      const keys = new Set(
        [...choices[0]!.keys()].filter((key) =>
          choices.every((choice) => choice.has(key)),
        ),
      );
      choices.forEach((choice, jobIndex) => {
        for (const [key, entry] of choice)
          if (!keys.has(key))
            addRows(
              rows,
              `shared_absent_${slot}_${jobIndex}_${rows.length}`,
              entry.variables.map((variable) => [variable, 1] as const),
              "=",
              0,
            );
      });
      return { slot, choices, keys };
    });
  if (sharedEquipmentDomains.some((domain) => domain.keys.size === 0))
    return undefined;
  const sharedEquipmentSelectors = new Map<string, Map<string, string>>();
  for (const domain of sharedEquipmentDomains) {
    let selectors: Map<string, string> | undefined;
    if (domain.splitPair) {
      selectors = new Map();
      const keys = [...domain.keys];
      for (let choiceIndex = 0; choiceIndex < keys.length; choiceIndex++) {
        const key = keys[choiceIndex]!;
        const selector = `shared_equipment_${domain.slot}_${choiceIndex}`;
        bounds.push({ name: selector, min: 0, max: 1 });
        binaries.push(selector);
        selectors.set(key, selector);
        domain.choices.forEach((choice) =>
          choice.get(key)!.variables.push(selector),
        );
      }
      addRows(
        rows,
        `shared_one_equipment_${domain.slot}`,
        [...selectors.values()].map((selector) => [selector, 1] as const),
        "=",
        1,
      );
      for (let jobIndex = 0; jobIndex < preparedJobs.length; jobIndex++) {
        const { job, ringSplit, prepared } = preparedJobs[jobIndex]!;
        if (ringSplit === undefined)
          throw new Error(`共享戒指对槽 ${domain.slot} 缺少拆分模型`);
        const childIdentities = new Set<string>();
        for (const slotIndex of [
          ringSplit.firstSlotIndex,
          ringSplit.secondSlotIndex,
        ]) {
          job.options.slots[slotIndex]!.forEach((candidate) =>
            childIdentities.add(options.equipmentIdentity(candidate)),
          );
        }
        for (const childIdentity of childIdentities) {
          const terms = new Map<string, number>();
          for (const slotIndex of [
            ringSplit.firstSlotIndex,
            ringSplit.secondSlotIndex,
          ]) {
            job.options.slots[slotIndex]!.forEach(
              (candidate, candidateIndex) => {
                if (options.equipmentIdentity(candidate) === childIdentity) {
                  addTerm(
                    terms,
                    prefix(
                      jobIndex,
                      prepared.model.slotVariables[slotIndex]![candidateIndex]!,
                    ),
                    1,
                  );
                }
              },
            );
          }
          for (const key of domain.keys) {
            const count =
              domain.choices[jobIndex]!.get(key)!.childIdentityCounts?.get(
                childIdentity,
              ) ?? 0;
            if (count > 0) addTerm(terms, selectors.get(key)!, -count);
          }
          addRows(
            rows,
            `link_equipment_${domain.slot}_${jobIndex}_${rows.length}`,
            terms,
            "=",
            0,
          );
        }
      }
    } else {
      const choices = domain.choices.map(
        (choice) =>
          new Map(
            [...choice].map(([key, entry]) => [key, entry.variables] as const),
          ),
      );
      selectors = linkChoices(`equipment_${domain.slot}`, choices);
    }
    if (selectors === undefined) return undefined;
    sharedEquipmentSelectors.set(domain.slot, selectors);
  }
  // 保留通用属性档案：其中包含每个职业的提取器和属性坐标。
  // 单个投影戒指按其完整实体身份共享，另一枚戒指则可在每个完整且满足唯一性规则的戒指对候选中自由选择。
  const profileRows = new Set<string>();
  for (let targetJob = 0; targetJob < preparedJobs.length; targetJob++) {
    const target = preparedJobs[targetJob]!.job.options;
    for (const attributeId of target.attributeIds) {
      const contributions = sharedEquipmentDomains.map(
        (domain) =>
          new Map(
            [...domain.keys].map((key) => {
              const equipment = domain.choices[targetJob]!.get(key)!.equipment;
              const params =
                target.equipmentAttributeExtractor?.(equipment) ??
                equipment.baseParams;
              return [
                key,
                params.reduce(
                  (sum, param) =>
                    sum + (param.baseParamId === attributeId ? param.value : 0),
                  0,
                ),
              ];
            }),
          ),
      );
      for (let sourceJob = 1; sourceJob < preparedJobs.length; sourceJob++) {
        const terms = new Map<string, number>();
        sharedEquipmentDomains.forEach((domain, domainIndex) => {
          for (const key of domain.keys) {
            const coefficient = contributions[domainIndex]!.get(key)!;
            for (const variable of domain.choices[sourceJob]!.get(key)!
              .variables)
              addTerm(terms, variable, coefficient);
            for (const variable of domain.choices[0]!.get(key)!.variables)
              addTerm(terms, variable, -coefficient);
          }
        });
        const rowKey = JSON.stringify(
          [...terms].sort(([left], [right]) => left.localeCompare(right)),
        );
        if (terms.size > 0 && !profileRows.has(rowKey)) {
          profileRows.add(rowKey);
          const attributeToken =
            attributeId < 0 ? `n${-attributeId}` : `p${attributeId}`;
          addRows(
            rows,
            `shared_profile_${targetJob}_${attributeToken}_${sourceJob}`,
            terms,
            "=",
            0,
          );
        }
      }
    }
  }
  let sharedFoodSelectors: Map<string, string> | undefined;
  if (
    options.sharedFood &&
    preparedJobs.some(({ job }) => job.options.foods.length > 0)
  ) {
    const choices = preparedJobs.map(({ job, prepared }, jobIndex) => {
      const byKey = new Map<string, string[]>();
      job.options.foods.forEach((food, foodIndex) => {
        const key = options.foodIdentity(food);
        const variables = byKey.get(key) ?? [];
        variables.push(
          prefix(jobIndex, prepared.model.foodVariables[foodIndex]!),
        );
        byKey.set(key, variables);
      });
      return byKey;
    });
    sharedFoodSelectors = linkChoices("food", choices);
    if (sharedFoodSelectors === undefined) return undefined;
  }

  return {
    get rows() {
      return rows;
    },
    get bounds() {
      return bounds;
    },
    get binaries() {
      return binaries;
    },
    get generals() {
      return generals;
    },
    get objective() {
      return objective;
    },
    get jobSurrogates() {
      return jobSurrogates;
    },
    get maximumOffset() {
      return maximumOffset;
    },
    get baselineQ() {
      return baselineQ;
    },
    get prefix() {
      return prefix;
    },
    get sharedEquipmentDomains() {
      return sharedEquipmentDomains;
    },
    get sharedEquipmentSelectors() {
      return sharedEquipmentSelectors;
    },
    get sharedFoodSelectors() {
      return sharedFoodSelectors;
    },
  };
}

export type JointModel = NonNullable<ReturnType<typeof assembleJointModel>>;
