import { gearOptionsFor, slotsForJob } from "@/domain";
import type { Gear, GearSlot, OptimizationConfig } from "@/domain";
import type { EquipmentGearCatalog } from "./types";

/** Uses the existing domain candidate API; no gear eligibility rules are duplicated here. */
export function domainGearOptionsForConfig(
  config: OptimizationConfig,
  slots: readonly GearSlot[] = slotsForJob(config.jobId),
): Gear[] {
  const unrestrictedConfig: OptimizationConfig = {
    ...config,
    excludedSources: [],
    excludedGearIds: [],
    forcedGear: {},
  };
  const byId = new Map<number, Gear>();
  for (const slot of slots) {
    for (const gear of gearOptionsFor(unrestrictedConfig, slot))
      byId.set(gear.id, gear);
  }
  return [...byId.values()];
}

export function intersectGearOptionsById(
  optionSets: readonly (readonly Gear[])[],
): Gear[] {
  if (optionSets.length === 0) return [];
  const sharedIds = new Set(optionSets[0]!.map((gear) => gear.id));
  for (const options of optionSets.slice(1)) {
    const ids = new Set(options.map((gear) => gear.id));
    for (const id of sharedIds) if (!ids.has(id)) sharedIds.delete(id);
  }
  return optionSets[0]!.filter((gear) => sharedIds.has(gear.id));
}

export function equipmentGearCatalog(
  gearOptions: readonly Gear[],
  allowedForcedGearSlots: readonly GearSlot[],
  forceGearOptions?: Partial<Record<GearSlot, readonly Gear[]>>,
): EquipmentGearCatalog {
  const sourceOptions = [
    ...new Set(
      gearOptions
        .map((gear) => gear.source)
        .filter((source): source is string => Boolean(source)),
    ),
  ].sort();
  return {
    gearOptions,
    forceGearOptions,
    sourceOptions,
    allowedForcedGearSlots,
  };
}
