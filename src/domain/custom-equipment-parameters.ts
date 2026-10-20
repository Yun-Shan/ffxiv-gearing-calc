import { concretizeGearStats } from "./rules.ts";
import { jobSchemas } from "./jobs.ts";
import {
  customParameterMelds,
  fixedCustomParameterMelds,
  validateCustomEquipmentStats,
} from "./custom-gear-parameters.ts";
import type { CustomizableStat, Gear, JobId, Stats } from "./types.ts";

export function prepareCustomEquipmentParameters(gear: Gear, jobId: JobId) {
  const base = concretizeGearStats(gear.stats, jobSchemas[jobId]);
  if (
    gear.customParameters !== undefined &&
    gear.resistanceWeaponAdjust !== undefined
  )
    throw new Error(`装备 ${gear.id} 同时包含两种自定义参数规则`);
  if (gear.customParameters !== undefined) {
    customParameterMelds(gear);
    return {
      kind: "manderville" as const,
      gear,
      jobId,
      attributes: gear.customParameters.map((parameter) => ({
        ...parameter,
        base: base[parameter.stat] ?? 0,
      })),
    };
  }
  const adjustment = gear.resistanceWeaponAdjust;
  if (adjustment === undefined)
    throw new Error(`装备 ${gear.id} 不支持自定义参数`);
  return {
    kind: "resistance" as const,
    gear,
    jobId,
    maxTotalStats: adjustment.maxTotalStats,
    attributes: adjustment.stats.map((stat) => ({
      stat,
      base: base[stat] ?? 0,
      max: (base[stat] ?? 0) + adjustment.maxEachStat,
    })),
  };
}

export type CustomEquipmentParameterModel = ReturnType<
  typeof prepareCustomEquipmentParameters
>;
export type CustomEquipmentParameterDraft =
  | { kind: "manderville"; choices: (CustomizableStat | "")[] }
  | {
      kind: "resistance";
      values: Partial<Record<CustomizableStat, number | null>>;
    };

export function initialCustomEquipmentParameters(
  model: CustomEquipmentParameterModel,
): CustomEquipmentParameterDraft {
  return model.kind === "manderville"
    ? { kind: "manderville", choices: ["", "", ""] }
    : {
        kind: "resistance",
        values: Object.fromEntries(
          model.attributes.map(({ stat, base }) => [stat, base]),
        ),
      };
}

/** Restore editor choices through the same allocation rules used for candidates. */
export function customEquipmentParametersFromStats(
  model: CustomEquipmentParameterModel,
  stats: Stats,
): CustomEquipmentParameterDraft {
  if (model.kind === "resistance") {
    return {
      kind: "resistance",
      values: Object.fromEntries(
        model.attributes.map(({ stat }) => [stat, stats[stat] ?? null]),
      ),
    };
  }
  try {
    const melds = fixedCustomParameterMelds(model.gear, stats, jobSchemas[model.jobId]);
    return { kind: "manderville", choices: melds.map(({ stat }) => stat) };
  } catch {
    return initialCustomEquipmentParameters(model);
  }
}

export function evaluateCustomEquipmentParameters(
  model: CustomEquipmentParameterModel,
  draft: CustomEquipmentParameterDraft,
): { stats?: Stats; error?: string; total?: number } {
  let total: number | undefined;
  try {
    let requested: Stats;
    if (model.kind === "manderville" && draft.kind === "manderville") {
      if (
        draft.choices.length !== 3 ||
        draft.choices.some((stat) => stat === "")
      )
        throw new Error("请选择两个大属性和一个小属性。");
      requested = Object.fromEntries(
        model.attributes.map(({ stat, base }) => [stat, base]),
      );
      draft.choices.forEach((stat, index) => {
        const attribute = model.attributes.find(
          (attribute) => attribute.stat === stat,
        );
        if (!attribute) throw new Error("请选择装备支持的属性。");
        requested[attribute.stat] =
          (requested[attribute.stat] ?? 0) +
          (index < 2 ? attribute.bigValue : attribute.smallValue);
      });
    } else if (model.kind === "resistance" && draft.kind === "resistance") {
      if (
        model.attributes.some(
          ({ stat }) =>
            draft.values[stat] === null || draft.values[stat] === undefined,
        )
      )
        throw new Error("请填写全部属性值。");
      requested = draft.values as Stats;
      total = model.attributes.reduce(
        (sum, { stat, base }) => sum + requested[stat]! - base,
        0,
      );
    } else {
      throw new Error("参数类型与装备不匹配。");
    }
    try {
      return {
        stats: validateCustomEquipmentStats(model.gear, model.jobId, requested),
        total,
      };
    } catch {
      throw new Error(
        model.kind === "manderville"
          ? "请选择三个不同的可用属性。"
          : total !== undefined && total > model.maxTotalStats
            ? `总分配不能超过 ${model.maxTotalStats}。`
            : "请为全部属性填写范围内的整数。",
      );
    }
  } catch (error) {
    return { error: (error as Error).message, total };
  }
}
