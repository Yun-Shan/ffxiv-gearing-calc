import type {
  CompiledJobCondition,
  GcdDraft,
  JobConditionCompileContext,
  JobConditionDraft,
} from "./types";

export function deriveJobObjective(
  gcd: GcdDraft,
  feasibleGcds?: readonly number[],
): "damage" | "dps" {
  if (gcd.mode === "tiers") return gcd.tiers.length === 1 ? "damage" : "dps";
  if (feasibleGcds?.length === 1) return "damage";
  return "dps";
}

export function compileJobCondition(
  draft: JobConditionDraft,
  context: JobConditionCompileContext,
): CompiledJobCondition {
  const config: CompiledJobCondition["config"] = {
    jobId: context.jobId,
    minItemLevel: draft.range.minItemLevel,
    maxItemLevel: draft.range.maxItemLevel,
    sync: draft.range.sync,
    syncDuty: draft.range.syncDuty,
    clanIndex: draft.range.clanIndex,
    gcdChoices: draft.gcd.mode === "tiers" ? [...draft.gcd.tiers] : undefined,
    speedMin: draft.gcd.mode === "speed" ? draft.gcd.min : undefined,
    speedMax: draft.gcd.mode === "speed" ? draft.gcd.max : undefined,
    minTenacity:
      draft.tank.strategy === "tenacity"
        ? draft.tank.minimumTenacity
        : undefined,
    toughnessMinPercent:
      draft.tank.strategy === "reduction"
        ? draft.tank.minimumDamageReductionPercent
        : undefined,
    maximizeTenacity: draft.tank.strategy === "maximize",
    objective: deriveJobObjective(draft.gcd, context.feasibleGcds),
    foodId:
      draft.food.mode === "specific"
        ? draft.food.foodId
        : (context.autoFoodId ?? 0),
  };

  return { config };
}

export function normalizeJointObjective<
  T extends { objective: "damage" | "dps" },
>(jobs: readonly T[]): { objective: "damage" | "dps"; jobs: T[] } {
  const objective = jobs.every((job) => job.objective === "damage")
    ? "damage"
    : "dps";
  return {
    objective,
    jobs: jobs.map((job) => ({ ...job, objective })),
  };
}
