import {
  type GearSlot,
  type JobId,
  type JointOptimizationConfig,
  type OptimizationConfig,
  slotsForJob,
} from "@/domain";
import {
  createJobConditionRuntime,
  jobConditionDraftFromConfig,
} from "@/ui/features/job-condition/draft";
import { compileJobCondition, normalizeJointObjective } from "@/ui/features/job-condition/compiler";
import type {
  FoodDraft,
  JobConditionDraft,
  JointWorkbenchDraft,
  JointWorkbenchRuntime,
} from "./joint-workbench-types";
import type { JointEquipmentDraft } from "@/ui/features/equipment/types";
import { defaultCommonSlots, makeConfig } from "@/ui/services/app-config";

export function createJointWorkbenchRuntime(jobs: readonly JobId[]): JointWorkbenchRuntime {
  return Object.fromEntries(jobs.map((jobId) => [jobId, createJobConditionRuntime()])) as JointWorkbenchRuntime;
}

export function createJointWorkbenchDraft(jobs: readonly JobId[]): JointWorkbenchDraft {
  const configs = Object.fromEntries(jobs.map((jobId) => [jobId, makeConfig(jobId)])) as Partial<Record<JobId, OptimizationConfig>>;
  const supportedSlots = new Set(jobs.length > 0 ? slotsForJob(jobs[0]!) : []);
  for (const jobId of jobs.slice(1)) {
    const jobSlots = new Set(slotsForJob(jobId));
    for (const slot of supportedSlots) if (!jobSlots.has(slot)) supportedSlots.delete(slot);
  }
  const commonSlots = defaultCommonSlots.filter((slot) => supportedSlots.has(slot));
  const equipment: JointEquipmentDraft = {
    commonSlots: [...commonSlots],
    shared: { excludedSources: [], excludedGearIds: [], forcedGear: {} },
    jobs: Object.fromEntries(jobs.map((jobId) => [jobId, {
      excludedGearIds: [...(configs[jobId]?.excludedGearIds ?? [])],
      forcedGear: { ...configs[jobId]?.forcedGear },
    }])),
  };

  return {
    jobs: [...jobs],
    conditions: Object.fromEntries(jobs.map((jobId) => [jobId, jobConditionDraftFromConfig(configs[jobId]!)])) as Record<JobId, JobConditionDraft>,
    shared: {
      foodStrategy: "shared",
      food: { mode: "auto" },
      equipment,
    },
  };
}

export function jointWorkbenchDraftFromConfig(config: JointOptimizationConfig): JointWorkbenchDraft {
  const conditions = Object.fromEntries(config.jobs.map((job) => [job.jobId, jobConditionDraftFromConfig(job)])) as Record<JobId, JobConditionDraft>;
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
  const sharedForcedGear: Partial<Record<GearSlot, number>> = {};
  for (const slot of commonGearSlots) {
    const forcedIds = new Set(config.jobs
      .map((job) => job.forcedGear[slot])
      .filter((id): id is number => id !== undefined));
    if (forcedIds.size > 1) {
      throw new Error(`历史快照的共享部位 ${slot} 包含多个不同强制装备，无法安全恢复。`);
    }
    const [forcedId] = forcedIds;
    if (forcedId !== undefined) sharedForcedGear[slot] = forcedId;
  }
  const equipment: JointEquipmentDraft = {
    commonSlots: [...config.commonSlots],
    shared: { excludedSources: sharedSources, excludedGearIds: sharedGearIds, forcedGear: sharedForcedGear },
    jobs: Object.fromEntries(config.jobs.map((job) => {
      const excludedGearIds = (job.excludedGearIds ?? []).filter((id) => !sharedGearIds.includes(id));
      const forcedGear = Object.fromEntries(Object.entries(job.forcedGear).filter(([slot, id]) =>
        id !== undefined && !(commonGearSlots.has(slot as GearSlot) && sharedForcedGear[slot as GearSlot] === id),
      )) as Partial<Record<GearSlot, number>>;
      return [job.jobId, { excludedGearIds, forcedGear }];
    })),
  };
  const firstFoodId = config.jobs[0]?.foodId ?? 0;

  return {
    jobs: config.jobs.map((job) => job.jobId),
    conditions,
    shared: {
      foodStrategy: config.foodStrategy,
      food: firstFoodId === 0 ? { mode: "auto" } : { mode: "specific", foodId: firstFoodId },
      equipment,
    },
  };
}

export function jobConditionForEffectiveFood(
  draft: JointWorkbenchDraft,
  jobId: JobId,
): JobConditionDraft {
  const condition = draft.conditions[jobId];
  if (!condition || draft.shared.foodStrategy !== "shared") return condition;
  return { ...condition, food: draft.shared.food };
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
    const forcedGear = { ...equipment?.forcedGear, ...draft.shared.equipment.shared.forcedGear };
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
