import { speedAttributeLabel } from "@/ui/services/labels";
import { clanLabel } from "@/ui/services/clans";
import { syncSummaryLabel } from "@/ui/services/sync-selection";
import {
  foods,
  jobSchemas,
  calculationJobLevelFor,
  type JobId,
} from "@/domain";
import type { FoodDraft, JobConditionDraft } from "./types";

export function formatFood(foodId: number): string {
  if (foodId === 0) return "自动选择";
  return foods.find((food) => food.id === foodId)?.name ?? "食物 " + foodId;
}

export function formatDraftFood(food: FoodDraft): string {
  return food.mode === "auto" ? "自动选择" : formatFood(food.foodId);
}

export function formatDraftGcd(draft: JobConditionDraft, jobId: JobId): string {
  if (draft.gcd.mode === "tiers")
    return draft.gcd.tiers.length
      ? draft.gcd.tiers.map((value) => value.toFixed(2)).join("、") + " 秒"
      : "尚未选择档位";
  if (draft.gcd.mode === "speed")
    return (
      speedAttributeLabel(jobId) +
      " " +
      String(draft.gcd.min ?? "不限") +
      "–" +
      String(draft.gcd.max ?? "不限")
    );
  return "不限";
}

function formulaLevelLabel(draft: JobConditionDraft, jobId: JobId): string {
  try {
    return (
      String(calculationJobLevelFor({ jobId, sync: draft.range.sync })) + " 级"
    );
  } catch {
    return "同步目标无有效等级映射";
  }
}

export function conditionRows(
  draft: JobConditionDraft,
  jobId: JobId,
  calculationLevel?: number,
) {
  const rows = [
    {
      label: "种族",
      value: clanLabel(draft.range.clanIndex),
    },
    {
      label: "装备品级",
      value: draft.range.minItemLevel + "–" + draft.range.maxItemLevel,
    },
    {
      label: "同步目标",
      value: syncSummaryLabel(draft.range.sync, draft.range.syncDuty),
    },
    {
      label: "公式等级",
      value:
        calculationLevel === undefined
          ? formulaLevelLabel(draft, jobId)
          : `${calculationLevel} 级`,
    },
    { label: "GCD", value: formatDraftGcd(draft, jobId) },
    { label: "食物", value: formatDraftFood(draft.food) },
  ];
  if (jobSchemas[jobId].role === "tank") {
    rows.push({
      label: "坚韧约束",
      value:
        [
          draft.tank.strategy === "tenacity" && draft.tank.minimumTenacity !== undefined &&
            `最低坚韧值${draft.tank.minimumTenacity}`,
          draft.tank.strategy === "reduction" && draft.tank.minimumDamageReductionPercent !== undefined &&
            `最低减伤${draft.tank.minimumDamageReductionPercent}%`,
          draft.tank.strategy === "maximize" && "最大化减伤百分比",
        ]
          .filter(Boolean)
          .join("、") || "未设置",
    });
  }
  return rows;
}
