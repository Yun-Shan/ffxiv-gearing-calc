import {
  gameData,
  getGearById,
  slotsForJob,
  type EquipmentMateriaConfig,
  type ForcedGearMap,
  type ForcedGearValue,
  type Gear,
  type GearSlot,
  type JobId,
  type Materia,
} from "@/domain";
import { makeConfig } from "@/ui/services/app-config";
import {
  forcedAllowedMateriaStats,
  makeGearCandidates,
  materiaAllowedAtPosition,
} from "@/domain/optimizer/equipment-candidates";
import { parseReferenceGearset } from "@/ui/services/reference-gearset-share";
import type { EquipmentGearCatalog } from "./types";

export interface ForcedGearImportEntry {
  slot: GearSlot;
  gear: Gear;
  value: ForcedGearValue;
}

export interface RestrictedForcedGearImportEntry {
  id: number;
  name: string;
  reason: string;
}

export function prepareForcedGearImport(
  input: string,
  options: {
    allowedJobs: readonly JobId[];
    allowedSlots: readonly GearSlot[];
    catalog: EquipmentGearCatalog;
    config: EquipmentMateriaConfig;
  },
): {
  jobId: JobId;
  entries: ForcedGearImportEntry[];
  forces: ForcedGearMap;
  unknownGearIds: number[];
  restrictedGear: RestrictedForcedGearImportEntry[];
} {
  const parsed = parseReferenceGearset(input);
  let ringIndex = 0;
  const unknownGearIds: number[] = [];
  const assigned = parsed.gears.flatMap((source) => {
    const gear = getGearById(source.id);
    if (!gear) {
      unknownGearIds.push(source.id);
      return [];
    }
    const slot: GearSlot =
      gear.slot === "ring" ? (ringIndex++ === 0 ? "ring" : "ring2") : gear.slot;
    return [{ source, gear, slot }];
  });

  const allowedSlots = new Set(options.allowedSlots);
  const targetSlots = new Map(
    options.allowedJobs.map((job) => [job, new Set(slotsForJob(job))]),
  );
  const inScope = assigned.filter(({ slot }) => allowedSlots.has(slot));
  const restrictedGear: RestrictedForcedGearImportEntry[] = [];
  const retained: typeof assigned = [];
  for (const entry of inScope) {
    const incompatibleJobs = options.allowedJobs.filter(
      (job) =>
        !entry.gear.jobs.includes(job) ||
        !targetSlots.get(job)?.has(entry.slot),
    );
    let reason: string | undefined;
    if (incompatibleJobs.length > 0) {
      reason = `不适用于选中的职业：${incompatibleJobs.join("、")}。`;
    } else {
      const eligible =
        options.catalog.forceGearOptions?.[entry.slot] ??
        options.catalog.gearOptions;
      if (!eligible.some((candidate) => candidate.id === entry.gear.id)) {
        reason = `不符合当前${entry.slot}部位的可选条件。`;
      }
    }
    if (reason !== undefined) {
      restrictedGear.push({
        id: entry.gear.id,
        name: entry.gear.name,
        reason,
      });
      continue;
    }
    retained.push(entry);
  }
  if (
    retained.length === 0 &&
    unknownGearIds.length === 0 &&
    restrictedGear.length === 0
  ) {
    throw new Error("配装链接中没有适用于当前装备范围的部位。");
  }

  const slotOrder = new Map(
    slotsForJob(options.config.jobId).map((slot, index) => [slot, index]),
  );
  retained.sort(
    (left, right) =>
      (slotOrder.get(left.slot) ?? Number.POSITIVE_INFINITY) -
      (slotOrder.get(right.slot) ?? Number.POSITIVE_INFINITY),
  );

  const entries: ForcedGearImportEntry[] = [];
  for (const { source, gear, slot } of retained) {
    let value: ForcedGearValue = gear.id;
    if (source.customStats !== undefined) {
      if (source.materias.some((materia) => materia !== null)) {
        throw new Error(`自定义装备 ${gear.name} 不能同时设置普通魔晶石。`);
      }
      value = { id: gear.id, customStats: { ...source.customStats } };
    } else if (source.materias.length > 0) {
      const capacity = gear.materiaAdvanced === true ? 5 : gear.materiaSlots;
      const melds: (Materia | null)[] = Array.from(
        { length: capacity },
        () => null,
      );
      source.materias.forEach((materia, index) => {
        if (materia === null) return;
        if (index >= capacity) return;
        const [stat, grade] = materia;
        const materiaStat = stat as Materia["stat"];
        if (
          options.allowedJobs.some(
            (jobId) => !forcedAllowedMateriaStats(jobId).includes(materiaStat),
          )
        ) {
          return;
        }
        const itemValue = gameData.materias[materiaStat]?.[grade - 1];
        if (!Number.isSafeInteger(itemValue) || itemValue! <= 0) {
          throw new Error(
            `装备 ${gear.name} 的 ${grade} 级${stat}魔晶石数据无效。`,
          );
        }
        const importedMateria = { stat: materiaStat, grade, value: itemValue! };
        if (!materiaAllowedAtPosition(gear, index, importedMateria)) return;
        melds[index] = importedMateria;
      });
      value = { id: gear.id, melds };
    }

    const candidateFailures: string[] = [];
    for (const jobId of options.allowedJobs) {
      try {
        const config = {
          ...makeConfig(jobId),
          syncLevel: options.config.syncLevel,
          forcedGear: { [slot]: value },
        };
        if (!makeGearCandidates(gear, slot, config, new Map()).length) {
          candidateFailures.push(`${jobId}：没有可用候选`);
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        candidateFailures.push(`${jobId}：${detail}`);
      }
    }
    if (candidateFailures.length > 0) {
      restrictedGear.push({
        id: gear.id,
        name: gear.name,
        reason: `不符合选中职业的强制参数条件：${candidateFailures.join("；")}`,
      });
      continue;
    }
    entries.push({ slot, gear, value });
  }

  const seenSlots = new Set<GearSlot>();
  for (const { slot } of entries) {
    if (seenSlots.has(slot)) throw new Error(`配装链接重复包含${slot}部位。`);
    seenSlots.add(slot);
  }

  const ring = entries.find(({ slot }) => slot === "ring");
  const ring2 = entries.find(({ slot }) => slot === "ring2");
  if (ring?.gear.unique === true && ring.gear.id === ring2?.gear.id) {
    throw new Error("配装链接不能在两个戒指槽重复使用同一枚唯一戒指。");
  }

  const forces = Object.fromEntries(
    entries.map(({ slot, value }) => [slot, value]),
  ) as ForcedGearMap;
  return { jobId: parsed.job, entries, forces, unknownGearIds, restrictedGear };
}
