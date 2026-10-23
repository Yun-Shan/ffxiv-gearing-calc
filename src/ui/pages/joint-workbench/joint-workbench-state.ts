import { shareableSlotsForJobs } from "./shared-slot-options";
import {
  cloneForcedGearValue,
  cloneForcedGearMap,
  forcedGearEqual,
  type GearSlot,
  type ForcedGearMap,
  type ForcedGearValue,
  type JobId,
  type JointOptimizationConfig,
  type OptimizationConfig,
} from "@/domain";
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
    clanIndex: config.clanIndex ?? 0,
  };
}

function sameSearchRange(left: OptimizationConfig, right: OptimizationConfig): boolean {
  return (
    left.minItemLevel === right.minItemLevel &&
    left.maxItemLevel === right.maxItemLevel &&
    left.sync?.kind === right.sync?.kind &&
    left.sync?.value === right.sync?.value &&
    (left.clanIndex ?? 0) === (right.clanIndex ?? 0)
  );
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
    conditions: Object.fromEntries(jobs.map((jobId) => [jobId, jointJobConditionFromConfig(configs[jobId]!)])) as Record<JobId, JointJobConditionDraft>,
    shared: {
      range: searchRangeDraftFromConfig(firstConfig),
      foodStrategy: "shared",
      food: { mode: "auto" },
      equipment,
    },
  };
}

export function jointWorkbenchDraftFromConfig(config: JointOptimizationConfig): JointWorkbenchDraft {
  const firstConfig = config.jobs[0]!;
  if (!config.jobs.every((job) => sameSearchRange(job, firstConfig))) {
    throw new Error("历史条件中多个职业的搜索范围不同，无法恢复为共享搜索范围。");
  }
  const conditions = Object.fromEntries(config.jobs.map((job) => [job.jobId, jointJobConditionFromConfig(job)])) as Record<JobId, JointJobConditionDraft>;
  // The current Joint draft owns source exclusions globally. Legacy snapshots
  // stored them per job, so preserve every previously excluded source when
  // adapting a snapshot into the new, broader scope.
  const sharedSources = [...new Set(config.jobs.flatMap((job) => job.excludedSources))];
  const sharedGearIds = config.jobs.length > 0
    ? config.jobs[0]!.excludedGearIds?.filter((id) => config.jobs.every((job) => job.excludedGearIds?.includes(id))) ?? []
    : [];
  const commonGearSlots = new Set<GearSlot>(config.commonSlots.flatMap((slot) =>
    slot === "rings" ? ["ring", "ring2"] : [slot],
  ));
  const sharedForcedGear: ForcedGearMap = {};
  for (const slot of commonGearSlots) {
    const forcedValues = config.jobs
      .map((job) => job.forcedGear[slot])
      .filter((value): value is ForcedGearValue => value !== undefined);
    const [forcedValue] = forcedValues;
    if (forcedValues.some((value) => !forcedGearEqual(forcedValue, value))) {
      throw new Error(`历史快照的共享部位 ${slot} 包含多个不同强制装备，无法安全恢复。`);
    }
    const copy = cloneForcedGearValue(forcedValue);
    if (copy !== undefined) sharedForcedGear[slot] = copy;
  }
  const equipment: JointEquipmentDraft = {
    commonSlots: config.commonSlots.filter(slot => slot === "rings"
      ? shareableSlotsForJobs(config.jobs.map(job => job.jobId)).includes("ring")
      : shareableSlotsForJobs(config.jobs.map(job => job.jobId)).includes(slot)),
    shared: { excludedSources: sharedSources, excludedGearIds: sharedGearIds, forcedGear: sharedForcedGear },
    jobs: Object.fromEntries(config.jobs.map((job) => {
      const excludedGearIds = (job.excludedGearIds ?? []).filter((id) => !sharedGearIds.includes(id));
      const forcedGear = cloneForcedGearMap(Object.fromEntries(
        Object.entries(job.forcedGear).filter(([slot, value]) =>
          value !== undefined && !(commonGearSlots.has(slot as GearSlot) && forcedGearEqual(sharedForcedGear[slot as GearSlot], value)),
        ),
      ));
      return [job.jobId, { excludedGearIds, forcedGear }];
    })),
  };
  const firstFoodId = config.jobs[0]?.foodId ?? 0;

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
      sharedSlots: [...draft.shared.equipment.commonSlots].flatMap((slot): GearSlot[] => slot === "rings" ? ["ring", "ring2"] : [slot]),
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
