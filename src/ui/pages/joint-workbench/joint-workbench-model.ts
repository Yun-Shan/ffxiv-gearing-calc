import { isSlotShared } from "@/ui/features/equipment";
import { conditionRows, formatFood } from "@/ui/features/job-condition/summary";
export {
  conditionRows,
  formatDraftFood,
  formatFood,
} from "@/ui/features/job-condition/summary";
import { freezeSnapshot } from "@/ui/services/snapshots/freeze-snapshot";
import { buildGearTableGearItem } from "@/ui/components/results/gear-table/result-gear-table-rows";
import {
  gears,
  jobSchemas,
  slotsForJob,
  type GearSlot,
  type JobId,
  type JointOptimizationConfig,
  type JointOptimizationResult,
  type OptimizationConfig,
  type OptimizationResult,
} from "@/domain";
import {
  gcdAnalysisInputFromConfig,
  gcdAnalysisKey,
  jobConditionDraftFromConfig,
} from "@/ui/features/job-condition";
import type {
  ValidationIssue,
  WorkbenchValidation,
} from "@/ui/features/job-condition";
import type { GearTableRow } from "@/ui/components/results/gear-table/GearTable";
import { buildResultMetricEntry } from "@/ui/components/results/core-metric-bar/CoreMetricBar";
import { commonGearSlotLabels } from "@/ui/services/labels";
import { makeConfig } from "@/ui/services/app-config";
import { deriveWorkbenchValidation } from "@/ui/features/job-condition";
import type {
  JobConditionDraft,
  JointWorkbenchDraft,
  JointWorkbenchRuntime,
} from "./joint-workbench-types";
import type { JointSearchStats } from "./joint-workbench-progress-types";
import {
  compileJointWorkbenchDraft,
  jobConditionForEffectiveFood,
} from "./joint-workbench-state";
export const gearById = new Map(gears.map((gear) => [gear.id, gear]));
export const jobSelectionSlots = (jobs: readonly JobId[]) =>
  Object.fromEntries(
    jobs.map((jobId) => [jobId, slotsForJob(jobId)]),
  ) as Partial<Record<JobId, readonly GearSlot[]>>;

export function freezeJointConfig(
  config: JointOptimizationConfig,
): JointOptimizationConfig {
  return freezeSnapshot(config);
}

export function objectiveLabel(
  objective: "damage" | "dps" | undefined,
): string {
  return objective === "damage" ? "每威力伤害期望" : "按 GCD 折算";
}

export function sharedIssues(draft: JointWorkbenchDraft): ValidationIssue[] {
  const validSlots =
    draft.jobs.length === 0
      ? new Set<GearSlot>()
      : slotsForJob(draft.jobs[0]!).reduce((common, slot) => {
          if (draft.jobs.every((jobId) => slotsForJob(jobId).includes(slot)))
            common.add(slot);
          return common;
        }, new Set<GearSlot>());
  return draft.shared.equipment.commonSlots
    .filter((slot) =>
      slot === "rings"
        ? !(validSlots.has("ring") && validSlots.has("ring2"))
        : !validSlots.has(slot),
    )
    .map((slot) => ({
      code: "shared.slot.unsupported",
      message:
        commonGearSlotLabels[slot] + "不是所有已选职业都支持的共享部位。",
      path: ["shared", "equipment", "commonSlots", slot],
    }));
}

export function deriveJointValidation(
  draft: JointWorkbenchDraft,
  runtime: JointWorkbenchRuntime,
): WorkbenchValidation {
  const config = compileJointWorkbenchDraft(draft, runtime);
  const jobs = draft.jobs.map((jobId) => {
    const jobConfig =
      config.jobs.find((job) => job.jobId === jobId) ?? makeConfig(jobId);
    return {
      jobId,
      draft: jobConditionForEffectiveFood(draft, jobId),
      runtime: runtime[jobId] ?? { gcdAnalysis: { status: "idle" as const } },
      expectedGcdKey: gcdAnalysisKey(gcdAnalysisInputFromConfig(jobConfig)),
    };
  });
  return deriveWorkbenchValidation({ jobs, sharedIssues: sharedIssues(draft) });
}

export function parseJointProgressStats(
  message: string,
): Partial<JointSearchStats> {
  const stats: Partial<JointSearchStats> = {};
  const parseNumber = (pattern: RegExp): number | undefined => {
    const value = pattern.exec(message)?.[1]?.replaceAll(",", "");
    if (!value) return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
  };
  const patterns: [keyof JointSearchStats, RegExp][] = [
    ["seedCandidates", /共享候选组合估分\s*([\d,]+)\s*个/],
    ["seedLimit", /枚举上限\s*([\d,]+)/],
    ["warmStartCandidates", /热启动候选\s*([\d,]+)/],
    ["exactAttempts", /精确尝试\s*([\d,]+)/],
    ["outerNodes", /外层节点[=:：]\s*([\d,]+)/],
    ["completeNodes", /完成[=:：]\s*([\d,]+)/],
    ["upperBoundPrunes", /上界剪枝[=:：]\s*([\d,]+)/],
    ["innerMipSolves", /内层 MIP[=:：]\s*([\d,]+)/],
    ["parentResultReuses", /父结果复用[=:：]\s*([\d,]+)/],
    ["elapsedMs", /耗时[=:：]\s*([\d,.]+)\s*ms/],
  ];
  for (const [key, pattern] of patterns) {
    const value = parseNumber(pattern);
    if (value !== undefined) stats[key] = value;
  }
  const objectiveLabel =
    /归一化目标\s*[=:：]\s*(\d+\s*\/\s*\d+|[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)(?=\s*[;；]|$)/.exec(
      message,
    )?.[1];
  const fraction =
    objectiveLabel && /^(\d+)\s*\/\s*(\d+)$/.exec(objectiveLabel);
  let incumbent: number | undefined;
  if (fraction) {
    const numerator = BigInt(fraction[1]!);
    const denominator = BigInt(fraction[2]!);
    if (denominator > 0n) incumbent = Number(numerator) / Number(denominator);
  } else if (objectiveLabel) {
    incumbent = Number(objectiveLabel);
  } else {
    incumbent = parseNumber(/incumbent[=:：]\s*([\d,.]+)/i);
  }
  if (incumbent !== undefined && Number.isFinite(incumbent) && incumbent >= 0)
    stats.incumbent = incumbent;
  return stats;
}

export function equipmentRestrictionRows(config: OptimizationConfig) {
  return [
    {
      label: "来源排除",
      value: config.excludedSources.length
        ? config.excludedSources.join("、")
        : "未设置",
    },
    {
      label: "装备排除",
      value: String(config.excludedGearIds?.length ?? 0) + " 项",
    },
    {
      label: "强制装备",
      value: String(Object.keys(config.forcedGear).length) + " 项",
    },
  ];
}

function jobSummaryRows(
  condition: JobConditionDraft,
  config: OptimizationConfig,
  calculationLevel?: number,
) {
  return [
    ...conditionRows(condition, config.jobId, calculationLevel),
    ...equipmentRestrictionRows(config),
  ];
}

export function jointJobSummaryRows(
  draft: JointWorkbenchDraft,
  config: OptimizationConfig,
  calculationLevel?: number,
) {
  return jobSummaryRows(
    jobConditionForEffectiveFood(draft, config.jobId),
    config,
    calculationLevel,
  );
}

export function effectiveConfigRows(
  config: OptimizationConfig,
  calculationLevel?: number,
) {
  return jobSummaryRows(
    jobConditionDraftFromConfig(config),
    config,
    calculationLevel,
  );
}

/** Read frozen facts without restoring an editable draft or validating old inputs. */
export function jointSharedSummaryRows(
  config: JointOptimizationConfig,
  foodName?: string,
) {
  const first = config.jobs[0]!;
  const sharedEquipment = {
    ...first,
    excludedSources: [
      ...new Set(config.jobs.flatMap((job) => job.excludedSources)),
    ],
    excludedGearIds: (first.excludedGearIds ?? []).filter((id) =>
      config.jobs.every((job) => job.excludedGearIds?.includes(id)),
    ),
    forcedGear: Object.fromEntries(
      Object.entries(first.forcedGear).filter(([slot]) =>
        isSlotShared(slot as GearSlot, config.commonSlots),
      ),
    ),
  };
  return [
    {
      label: "共享部位",
      value:
        config.commonSlots
          .map((slot) => commonGearSlotLabels[slot])
          .join("、") || "未设置",
    },
    {
      label: "食物策略",
      value: config.foodStrategy === "shared" ? "所有职业共用" : "各职业独立",
    },
    ...(config.foodStrategy === "shared"
      ? [{ label: "共享食物", value: foodName ?? formatFood(first.foodId) }]
      : []),
    ...equipmentRestrictionRows(sharedEquipment),
  ];
}

export function sharedGearRows(
  result: JointOptimizationResult,
): GearTableRow[] {
  return Object.entries(result.commonGear).flatMap(([commonSlot, items]) =>
    (items ?? []).map((gear, index) => ({
      key:
        "shared-" + commonSlot + "-" + gear.slot + "-" + gear.id + "-" + index,
      slotLabel:
        commonSlot === "rings"
          ? index === 0
            ? "戒指 1"
            : "戒指 2"
          : commonGearSlotLabels[
              commonSlot as keyof typeof commonGearSlotLabels
            ],
      item: buildGearTableGearItem(gear),
      marker: "共享",
    })),
  );
}

export function retentionPercent(
  joint: OptimizationResult | undefined,
  baseline: OptimizationResult | undefined,
): string {
  if (
    !joint ||
    !baseline ||
    !Number.isFinite(joint.score) ||
    !Number.isFinite(baseline.score) ||
    baseline.score <= 0
  )
    return "—";
  return ((joint.score / baseline.score) * 100).toFixed(2) + "%";
}

export function resultSummaryRows(
  config: JointOptimizationConfig,
  result: JointOptimizationResult,
) {
  return config.jobs.map(({ jobId }) => ({
    jobId,
    baseline: result.optima[jobId],
    joint: result.jobResults[jobId],
    retention: retentionPercent(result.jobResults[jobId], result.optima[jobId]),
  }));
}
