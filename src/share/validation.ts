import { gameData } from "../domain/data.ts";
import {
  jointOptimizationConfigError,
  optimizationConfigError,
} from "../domain/config-validation.ts";
import { check, gcdCode, uint } from "./binary.ts";
import { percentTenths } from "./config-codec.ts";
import { dutyId } from "./tables.ts";
import {
  isUnknownSource,
  SHARED_SLOTS,
  type ShareConfig,
  type ShareDocument,
} from "./types.ts";
import type { OptimizationConfig } from "../domain/types.ts";
import { validateForcedRegularMateria } from "../domain/optimizer/candidates/materia-rules.ts";
import { fixedCustomEquipmentMelds } from "../domain/custom-gear-parameters.ts";

/** This projection validates known fields only. It must never become a search or pool input. */
export function validationConfig(config: ShareConfig): OptimizationConfig {
  const { syncDuty: _syncDuty, excludedSources, ...rest } = config;
  return {
    ...rest,
    excludedSources: excludedSources?.filter(
      (source): source is string => typeof source === "string",
    ),
  };
}
export function domainConfig(config: ShareConfig): OptimizationConfig {
  check(
    (config.excludedSources ?? []).every(
      (source) => typeof source === "string",
    ),
    "来源条件不完整",
  );
  return validationConfig(config);
}
function sourceKeys(config: ShareConfig): Set<string> {
  return new Set(
    (config.excludedSources ?? []).map((source) =>
      typeof source === "string"
        ? `text:${source}`
        : `ref:${source.unknownSourceId}`,
    ),
  );
}
export function validateConfigs(
  document: Pick<
    ShareDocument,
    "mode" | "configs" | "commonSlots" | "foodStrategy"
  >,
): void {
  const configs = document.configs;
  check(
    document.mode === "single" ? configs.length === 1 : configs.length >= 2,
    "职业数量无效",
  );
  check(
    configs.length <= Object.keys(gameData.jobs).length &&
      new Set(configs.map((c) => c.jobId)).size === configs.length,
    "职业重复或过多",
  );
  for (const c of configs) {
    const error = optimizationConfigError(validationConfig(c));
    check(!error, error);
    check(c.minItemLevel >= 90, "最低装备品级至少为90");
    if (c.syncDuty !== undefined) dutyId(c.syncDuty, c.sync);
    for (const source of c.excludedSources ?? [])
      check(
        typeof source === "string" ||
          (isUnknownSource(source) && source.unknownSourceId < 2 ** 52),
        "来源字段无效",
      );
    for (const key of ["speedMin", "speedMax", "minTenacity"] as const)
      if (c[key] !== undefined) uint(c[key]);
    if (c.toughnessMinPercent !== undefined)
      percentTenths(c.toughnessMinPercent);
    c.gcdChoices?.forEach(gcdCode);
    for (const id of c.excludedGearIds ?? [])
      check(gameData.getGearById(id), `未知装备 ${id}`);
    if (c.foodId !== 0)
      check(
        gameData.foods.some((f) => f.id === c.foodId),
        `未知食物 ${c.foodId}`,
      );
    for (const force of Object.values(c.forcedGear ?? {})) {
      if (force === undefined) continue;
      const raw = gameData.getGearById(
        typeof force === "number" ? force : force.id,
      );
      check(raw, "未知强制装备");
      if (typeof force === "object" && "melds" in force)
        validateForcedRegularMateria(raw, c.jobId, force.melds);
      if (typeof force === "object" && "customStats" in force) {
        for (const v of Object.values(force.customStats)) uint(v);
        fixedCustomEquipmentMelds(raw, c.jobId, force.customStats);
      }
    }
  }
  if (document.mode === "joint") {
    check(
      new Set(document.commonSlots).size === document.commonSlots.length &&
        document.commonSlots.every((slot) => SHARED_SLOTS.includes(slot)),
      "共享槽位无效",
    );
    const first = configs[0],
      keys = sourceKeys(first);
    check(
      configs.every((c) => {
        const other = sourceKeys(c);
        return (
          c.syncDuty === first.syncDuty &&
          other.size === keys.size &&
          [...other].every((key) => keys.has(key))
        );
      }),
      "联合来源或同步副本不一致",
    );
    const error = jointOptimizationConfigError({
      jobs: configs.map(validationConfig),
      commonSlots: document.commonSlots,
      foodStrategy: document.foodStrategy,
      objective: first.objective,
    });
    check(!error, error);
  }
}
