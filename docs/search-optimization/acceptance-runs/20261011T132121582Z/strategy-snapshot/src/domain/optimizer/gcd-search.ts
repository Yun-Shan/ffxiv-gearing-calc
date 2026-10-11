import { jobSchemas } from "../jobs.ts";
import { applyFood, calculateBaseStats, getSpeedStat } from "../rules.ts";
import {
  equippedEffects,
  equippedToughnessForMitigationPercent,
} from "../search/equipped-effects.ts";
import type { OptimizationConfig, SearchOptions } from "../types.ts";
import { foodsFor, foodStatsForJob } from "./equipment-candidates.ts";
import { prepareSearch } from "./search-preparation.ts";
import { attributeIndex, jobLevelFor, throwIfAborted } from "./context.ts";

export function findFeasibleGcdsLocally(
  config: OptimizationConfig,
  options: SearchOptions = {},
): number[] {
  throwIfAborted(options.signal);
  const job = jobSchemas[config.jobId];
  const speedStat = getSpeedStat(job);
  const speedIndex = attributeIndex.get(speedStat)!;
  const tenacityIndex = attributeIndex.get("TEN")!;
  // The GCD reachability DP aggregates speed/TEN without a joint MIP, so keep
  // its existing legal pair domain rather than dropping cross-ring uniqueness.
  const prepared = prepareSearch(config, options, false, false);
  if (
    prepared.slots.some((slot) => slot.candidates.length === 0) ||
    !prepared.foods.length
  )
    return [];
  let states = new Map<number, number>([[0, 0]]);
  for (const slot of prepared.slots) {
    const next = new Map<number, number>();
    for (const [speed, tenacity] of states) {
      for (const equipment of slot.candidates) {
        const profile = {
          speed:
            equipment.baseParams.find(
              (param) => param.baseParamId === speedIndex,
            )?.value ?? 0,
          tenacity:
            equipment.baseParams.find(
              (param) => param.baseParamId === tenacityIndex,
            )?.value ?? 0,
        };
        const totalSpeed = speed + profile.speed;
        const totalTenacity = tenacity + profile.tenacity;
        next.set(
          totalSpeed,
          Math.max(
            next.get(totalSpeed) ?? Number.NEGATIVE_INFINITY,
            totalTenacity,
          ),
        );
      }
    }
    states = next;
    if (!states.size) return [];
  }
  const baseStats = calculateBaseStats(job, jobLevelFor(config));
  // Keep the best TEN contribution for every effective speed/GCD. Foods can
  // improve speed or TEN, so evaluate them after the equipment profile is built.
  const finalStates = new Map<number, number>();
  for (const [speedContribution, tenacityContribution] of states) {
    for (const food of foodsFor(config)) {
      const applicableFood = foodStatsForJob(food, config.jobId);
      const totalStats = applyFood(
        {
          ...baseStats,
          [speedStat]: (baseStats[speedStat] ?? 0) + speedContribution,
          TEN: (baseStats.TEN ?? 0) + tenacityContribution,
        },
        applicableFood.stats,
        applicableFood.statRates,
      );
      const effectiveSpeedContribution =
        (totalStats[speedStat] ?? 0) - (baseStats[speedStat] ?? 0);
      const effectiveTenacityContribution =
        (totalStats.TEN ?? 0) - (baseStats.TEN ?? 0);
      if (
        config.speedMin !== undefined &&
        (totalStats[speedStat] ?? 0) < config.speedMin
      )
        continue;
      if (
        config.speedMax !== undefined &&
        (totalStats[speedStat] ?? 0) > config.speedMax
      )
        continue;
      const minimumTenacity = Math.max(
        Math.max(
          0,
          (config.minTenacity ?? config.toughnessMin ?? 0) -
            (baseStats.TEN ?? 0),
        ),
        config.toughnessMinPercent === undefined
          ? 0
          : equippedToughnessForMitigationPercent(
              config.jobId,
              jobLevelFor(config),
              config.toughnessMinPercent,
            ),
      );
      finalStates.set(
        effectiveSpeedContribution,
        Math.max(
          finalStates.get(effectiveSpeedContribution) ??
            Number.NEGATIVE_INFINITY,
          effectiveTenacityContribution,
        ),
      );
      throwIfAborted(options.signal);
    }
  }
  for (const [speed, tenacity] of finalStates) {
    const minimumTenacity = Math.max(
      Math.max(
        0,
        (config.minTenacity ?? config.toughnessMin ?? 0) - (baseStats.TEN ?? 0),
      ),
      config.toughnessMinPercent === undefined
        ? 0
        : equippedToughnessForMitigationPercent(
            config.jobId,
            jobLevelFor(config),
            config.toughnessMinPercent,
          ),
    );
    if (tenacity < minimumTenacity) finalStates.delete(speed);
  }
  const maximumTenacity =
    config.maximizeTenacity && job.role === "tank"
      ? Math.max(Number.NEGATIVE_INFINITY, ...finalStates.values())
      : undefined;
  return [...finalStates.entries()]
    .filter(([, tenacity]) =>
      maximumTenacity === undefined ? true : tenacity === maximumTenacity,
    )
    .map(([speedContribution]) => {
      const effects = equippedEffects(config.jobId, jobLevelFor(config), {
        [speedStat]: speedContribution,
      });
      return effects?.gcd;
    })
    .filter((gcd): gcd is number => gcd !== undefined)
    .filter((gcd, index, all) => all.indexOf(gcd) === index)
    .sort((left, right) => right - left);
}
