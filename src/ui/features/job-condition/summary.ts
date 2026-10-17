import { speedAttributeLabel } from "@/ui/services/labels";
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
      String(
        calculationJobLevelFor({
          jobId,
          syncLevel:
            draft.range.sync.mode === "enabled"
              ? draft.range.sync.itemLevel
              : undefined,
        }),
      ) + " 级"
    );
  } catch {
    return "同步品级无有效等级映射";
  }
}

export function conditionRows(
  draft: JobConditionDraft,
  jobId: JobId,
  calculationLevel?: number,
) {
  return [
    {
      label: "装备品级",
      value: draft.range.minItemLevel + "–" + draft.range.maxItemLevel,
    },
    {
      label: "同步品级",
      value:
        draft.range.sync.mode === "enabled"
          ? String(draft.range.sync.itemLevel)
          : "未启用",
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
    {
      label: "最低坚韧",
      value:
        draft.tank.minimumTenacity === undefined
          ? "未设置"
          : draft.tank.minimumTenacity.toLocaleString("zh-CN"),
    },
    {
      label: "最低减伤",
      value:
        draft.tank.minimumDamageReductionPercent === undefined
          ? "未设置"
          : draft.tank.minimumDamageReductionPercent + "%",
    },
    {
      label: "坚韧目标",
      value: draft.tank.maximizeTenacity ? "尽可能提高" : "未启用",
    },
  ].filter(
    (row) =>
      jobSchemas[jobId].role === "tank" ||
      !["最低坚韧", "最低减伤", "坚韧目标"].includes(row.label),
  );
}
