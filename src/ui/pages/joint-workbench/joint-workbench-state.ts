import { shareableSlotsForJobs } from "./shared-slot-options";
import {
  cloneForcedGearMap,
  forcedGearEqual,
  type GearSlot,
  type JobId,
} from "@/domain";
import type { UiJointOptimizationConfig as JointOptimizationConfig, UiOptimizationConfig as OptimizationConfig } from "@/ui/services/search-config";
import { assertUiJointOptimizationConfig } from "@/ui/services/search-config";
import {
  createJobConditionRuntime,
  jobConditionDraftFromConfig,
} from "@/ui/features/job-condition/draft";
import { compileJobCondition, normalizeJointObjective } from "@/ui/features/job-condition/compiler";
import type {
  JobConditionDraft,
  JointJobConditionDraft,
  JointWorkbenchDraft,
  JointWorkbenchRuntime,
  SearchRangeDraft,
} from "./joint-workbench-types";
import type { JointEquipmentDraft } from "@/ui/features/equipment/types";
import { makeConfig } from "@/ui/services/app-config";

export function createJointWorkbenchRuntime(jobs: readonly JobId[]): JointWorkbenchRuntime {
  return Object.fromEntries(jobs.map((jobId) => [jobId, createJobConditionRuntime()])) as JointWorkbenchRuntime;
}

function searchRangeDraftFromConfig(config: OptimizationConfig): SearchRangeDraft {
  return {
    minItemLevel: config.minItemLevel,
    maxItemLevel: config.maxItemLevel,
    sync: config.sync,
    syncDuty: config.syncDuty,
    clanIndex: config.clanIndex,
  };
}

/** 联合职业条件只保留 gcd/food/tank；搜索范围统一放在共享条件。 */
function jointJobConditionFromConfig(config: OptimizationConfig): JointJobConditionDraft {
  const condition = jobConditionDraftFromConfig(config);
  return { gcd: condition.gcd, food: condition.food, tank: condition.tank };
}

export function createJointWorkbenchDraft(jobs: readonly JobId[]): JointWorkbenchDraft {
  const configs = Object.fromEntries(jobs.map((jobId) => [jobId, makeConfig(jobId)])) as Partial<Record<JobId, OptimizationConfig>>;
  const firstConfig = configs[jobs[0]!]!;
  const commonSlots = shareableSlotsForJobs(jobs);
  const equipment: JointEquipmentDraft = {
    commonSlots: [...commonSlots],
    shared: { excludedSources: [], excludedGearIds: [], forcedGear: {} },
    jobs: Object.fromEntries(jobs.map((jobId) => [jobId, {
      excludedGearIds: [...(configs[jobId]?.excludedGearIds ?? [])],
      forcedGear: cloneForcedGearMap(configs[jobId]?.forcedGear ?? {}),
    }])),
  };

  return {
    jobs: [...jobs],
    conditions: Object.fromEntries(jobs.map((jobId): [JobId, JointJobConditionDraft] => [jobId, {
      ...jointJobConditionFromConfig(configs[jobId]!), gcd: { mode: "tiers", tiers: [] },
    }])) as Record<JobId, JointJobConditionDraft>,
    shared: {
      range: searchRangeDraftFromConfig(firstConfig),
      foodStrategy: "shared",
      food: { mode: "auto" },
      equipment,
    },
  };
}

export function jointWorkbenchDraftFromConfig(config: JointOptimizationConfig): JointWorkbenchDraft {
  assertUiJointOptimizationConfig(config);
  const firstConfig = config.jobs[0]!;
  const conditions = Object.fromEntries(config.jobs.map((job) => [job.jobId, jointJobConditionFromConfig(job)])) as Record<JobId, JointJobConditionDraft>;
  const sharedSources = [...(firstConfig.excludedSources ?? [])];
  const sharedGearIds = firstConfig.excludedGearIds?.filter((id) =>
    config.jobs.every((job) => job.excludedGearIds?.includes(id))) ?? [];
  const commonGearSlots = new Set<GearSlot>(config.commonSlots);
  const sharedForcedGear = cloneForcedGearMap(Object.fromEntries(
    config.commonSlots.map((slot) => [slot, firstConfig.forcedGear?.[slot]]),
  ));
  const equipment: JointEquipmentDraft = {
    commonSlots: [...config.commonSlots],
    shared: { excludedSources: sharedSources, excludedGearIds: sharedGearIds, forcedGear: sharedForcedGear },
    jobs: Object.fromEntries(config.jobs.map((job) => {
      const excludedGearIds = (job.excludedGearIds ?? []).filter((id) => !sharedGearIds.includes(id));
      const forcedGear = cloneForcedGearMap(Object.fromEntries(
        Object.entries(job.forcedGear ?? {}).filter(([slot, value]) =>
          value !== undefined && !(commonGearSlots.has(slot as GearSlot) && forcedGearEqual(sharedForcedGear[slot as GearSlot], value)),
        ),
      ));
      return [job.jobId, { excludedGearIds, forcedGear }];
    })),
  };
  const firstFoodId = firstConfig.foodId;

  return {
    jobs: config.jobs.map((job) => job.jobId),
    conditions,
    shared: {
      range: searchRangeDraftFromConfig(firstConfig),
      foodStrategy: config.foodStrategy,
      food: firstFoodId === 0 ? { mode: "auto" } : { mode: "specific", foodId: firstFoodId },
      equipment,
    },
  };
}

/** 把共享搜索范围与共享食物合并进职业条件，得到完整编辑器/编译输入。 */
export function jobConditionForEffectiveFood(
  draft: JointWorkbenchDraft,
  jobId: JobId,
): JobConditionDraft {
  const condition = draft.conditions[jobId]!;
  const effectiveFood =
    draft.shared.foodStrategy === "shared"
      ? { ...condition, food: draft.shared.food }
      : condition;
  return { ...effectiveFood, range: draft.shared.range };
}

/** 从完整职业条件中取出联合 Draft 持有的部分，避免把共享范围写回职业条件。 */
export function jointJobConditionFromDraft(
  condition: JobConditionDraft,
): JointJobConditionDraft {
  return {
    gcd: condition.gcd,
    food: condition.food,
    tank: condition.tank,
  };
}

/**
 * 共享食物策略下编辑器展示的是共享食物；写回时保留该职业原来的独立食物，
 * 避免只修改 GCD/坚韧时覆盖独立模式的选择。
 */
export function jointJobConditionFromEffectiveDraft(
  draft: JointWorkbenchDraft,
  jobId: JobId,
  condition: JobConditionDraft,
): JointJobConditionDraft {
  const converted = jointJobConditionFromDraft(condition);
  return draft.shared.foodStrategy === "shared"
    ? { ...converted, food: draft.conditions[jobId]!.food }
    : converted;
}

export function compileJointWorkbenchDraft(
  draft: JointWorkbenchDraft,
  runtime: JointWorkbenchRuntime,
): JointOptimizationConfig {
  const compiledJobs = draft.jobs.map((jobId) => {
    const condition = jobConditionForEffectiveFood(draft, jobId);
    const equipment = draft.shared.equipment.jobs[jobId];
    const base = makeConfig(jobId);
    const gcdAnalysis = runtime[jobId]?.gcdAnalysis;
    const compiled = compileJobCondition(condition, {
      jobId,
      autoFoodId: 0,
      feasibleGcds: gcdAnalysis?.status === "ready" ? gcdAnalysis.feasibleTiers : undefined,
    });
    const forcedGear = cloneForcedGearMap({
      ...equipment?.forcedGear,
      ...draft.shared.equipment.shared.forcedGear,
    });
    const excludedGearIds = new Set([
      ...(equipment?.excludedGearIds ?? []),
      ...draft.shared.equipment.shared.excludedGearIds,
    ]);
    return {
      ...base,
      ...compiled.config,
      objective: compiled.config.objective,
      excludedSources: [...draft.shared.equipment.shared.excludedSources],
      excludedGearIds: [...excludedGearIds],
      forcedGear,
    } satisfies OptimizationConfig;
  });
  const normalized = normalizeJointObjective(compiledJobs);
  return {
    jobs: normalized.jobs,
    commonSlots: [...draft.shared.equipment.commonSlots],
    foodStrategy: draft.shared.foodStrategy,
    objective: normalized.objective,
  };
}
