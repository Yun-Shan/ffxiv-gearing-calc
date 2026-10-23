import { getGearById } from "../../data.ts";
import { gearOptionsFor } from "../../gear-options.ts";
import { jobSchemas } from "../../jobs.ts";
import { getSpeedStat } from "../../rules.ts";
import { insertParetoCandidate, paretoRingCandidates, type ParetoCandidate } from "../../search/candidate-pareto.ts";
import { equipmentIdentity } from "../../search/equipment-identity.ts";
import { buildRingPairEquipInfos } from "../../search/ring-pairs.ts";
import type { GearSlot, JobId, MeldedGear, OptimizationConfig, Stat } from "../../types.ts";
import { forcedGearId } from "../../types.ts";
import { attributeIndex, attributeStats, jobSlots, type GearCandidate, type SearchSlot, type SolverGear } from "../context.ts";
import { forcedValueForSlot, makeGearCandidates } from "./gear-candidates.ts";

function paretoAttributeStats(jobId: JobId): Stat[] {
  const schema = jobSchemas[jobId];
  if (schema.mainStat === undefined) return attributeStats;
  const mainStat: Stat = schema.mainStat;
  const weaponStat: Stat =
    schema.mainStat === "INT" || schema.mainStat === "MND" ? "MDMG" : "PDMG";
  const relevant = new Set<Stat>([
    mainStat,
    weaponStat,
    "DET",
    "TEN",
    "CRT",
    "DHT",
    getSpeedStat(schema),
  ]);
  if ([...relevant].some((stat) => !attributeIndex.has(stat)))
    return attributeStats;
  return attributeStats.filter((stat) => relevant.has(stat));
}

export function candidatePools(
  config: OptimizationConfig,
  gearsByIdentity: Map<string, MeldedGear>,
  preserveRingOrder: boolean,
  independentRingSlots: boolean,
  paretoSlots?: ReadonlySet<string>,
  paretoIndependentRings = false,
): { slots: SearchSlot[] } {
  const jobId = config.jobId;
  const slots = jobSlots(jobId);
  const results: SearchSlot[] = [];
  const slotCandidates = new Map<string, GearCandidate[]>();
  const speedStat = getSpeedStat(jobSchemas[jobId]);
  const paretoStats = paretoAttributeStats(jobId);
  const preserveSpeed =
    config.gcdTarget !== undefined ||
    (config.gcdChoices?.length ?? 0) > 0 ||
    config.speedMax !== undefined;
  const speedCoordinate = preserveSpeed
    ? paretoStats.indexOf(speedStat)
    : undefined;
  if (preserveSpeed && speedCoordinate === undefined) {
    throw new RangeError(`职业 ${jobId} 缺少 ${speedStat} Pareto 搜索坐标`);
  }

  const forgetCandidate = (candidate: GearCandidate) => {
    const identity = equipmentIdentity(candidate.equipment);
    if (gearsByIdentity.get(identity) === candidate.gear)
      gearsByIdentity.delete(identity);
  };

  for (const slotName of slots.filter((name) => name !== "rings")) {
    const slot = slotName as GearSlot;
    const pool = gearOptionsFor(config, slot);
    const forcedId = forcedGearId(forcedValueForSlot(config, slot));
    const gearsForSlot =
      forcedId === undefined
        ? pool
        : pool.filter((item) => item.id === forcedId);
    const usePareto = paretoSlots?.has(slotName) === true;
    const candidates: GearCandidate[] = [];
    const frontier: ParetoCandidate<GearCandidate>[] = [];
    let candidateOrder = 0;
    for (const gear of gearsForSlot) {
      for (const candidate of makeGearCandidates(
        gear,
        slot,
        config,
        gearsByIdentity,
      )) {
        // 求解器用有界整数变量分配这些属性；若拿零分配的基础候选比较，会错误地将它剪枝。
        if (usePareto && candidate.gear.resistanceWeaponAdjust !== undefined) {
          candidates.push(candidate);
          continue;
        }
        if (!usePareto) {
          candidates.push(candidate);
          continue;
        }
        const insertion = insertParetoCandidate(
          frontier,
          {
            value: candidate,
            attributes: paretoStats.map(
              (stat) => candidate.gear.finalStats[stat] ?? 0,
            ),
            order: candidateOrder++,
          },
          speedCoordinate,
        );
        if (!insertion.accepted) forgetCandidate(candidate);
        for (const removed of insertion.removed) forgetCandidate(removed.value);
      }
    }
    if (usePareto) {
      candidates.push(
        ...frontier
          .sort((left, right) => left.order - right.order)
          .map(({ value }) => value),
      );
    }
    slotCandidates.set(slotName, candidates);
  }

  const ringPool = gearOptionsFor(config, "ring");
  const forcedRing = forcedGearId(forcedValueForSlot(config, "ring"));
  const forcedRing2 = forcedGearId(forcedValueForSlot(config, "ring2"));
  const firstPool =
    forcedRing === undefined
      ? ringPool
      : ringPool.filter((gear) => gear.id === forcedRing);
  const secondPool =
    forcedRing2 === undefined
      ? ringPool
      : ringPool.filter((gear) => gear.id === forcedRing2);
  const firstCandidates = firstPool.flatMap((gear) =>
    makeGearCandidates(gear, "ring", config, gearsByIdentity),
  );
  const secondCandidates = secondPool.flatMap((gear) =>
    makeGearCandidates(gear, "ring2", config, gearsByIdentity),
  );
  if (independentRingSlots) {
    const optimizedFirst = paretoIndependentRings
      ? paretoRingCandidates(
          firstCandidates.map((candidate, order) => ({
            value: candidate,
            itemId: candidate.gear.id,
            isUnique: candidate.gear.unique === true,
            attributes: paretoStats.map(
              (stat) => candidate.gear.finalStats[stat] ?? 0,
            ),
            order,
          })),
          secondCandidates.map(({ gear }) => ({
            itemId: gear.id,
            isUnique: gear.unique === true,
          })),
          speedCoordinate,
        ).map(({ value }) => value)
      : firstCandidates;
    const optimizedSecond = paretoIndependentRings
      ? paretoRingCandidates(
          secondCandidates.map((candidate, order) => ({
            value: candidate,
            itemId: candidate.gear.id,
            isUnique: candidate.gear.unique === true,
            attributes: paretoStats.map(
              (stat) => candidate.gear.finalStats[stat] ?? 0,
            ),
            order,
          })),
          firstCandidates.map(({ gear }) => ({
            itemId: gear.id,
            isUnique: gear.unique === true,
          })),
          speedCoordinate,
        ).map(({ value }) => value)
      : secondCandidates;
    if (paretoIndependentRings) {
      const retainedIdentities = new Set(
        [...optimizedFirst, ...optimizedSecond].map(({ equipment }) =>
          equipmentIdentity(equipment),
        ),
      );
      for (const candidate of [...firstCandidates, ...secondCandidates]) {
        const identity = equipmentIdentity(candidate.equipment);
        if (!retainedIdentities.has(identity)) gearsByIdentity.delete(identity);
      }
    }
    for (const candidate of optimizedFirst) {
      const key = equipmentIdentity(candidate.equipment);
      const existing = gearsByIdentity.get(key);
      if (existing) gearsByIdentity.set(key, { ...existing, slot: "ring" });
    }
    for (const candidate of optimizedSecond) {
      const key = equipmentIdentity(candidate.equipment);
      const existing = gearsByIdentity.get(key);
      if (existing) gearsByIdentity.set(key, { ...existing, slot: "ring2" });
    }
    slotCandidates.set(
      "ring",
      optimizedFirst.map((candidate) => ({
        ...candidate,
        equipment: {
          ...candidate.equipment,
          ringSlotIndex: 0,
          isUnique: candidate.gear.unique === true,
        },
      })),
    );
    slotCandidates.set(
      "ring2",
      optimizedSecond.map((candidate) => ({
        ...candidate,
        equipment: {
          ...candidate.equipment,
          ringSlotIndex: 1,
          isUnique: candidate.gear.unique === true,
        },
      })),
    );
    const outputSlotNames = [
      ...slots.filter((name) => name !== "rings"),
      "ring",
      "ring2",
    ];
    const results = outputSlotNames.map((name) => ({
      name,
      candidates:
        slotCandidates.get(name)?.map(({ equipment }) => equipment) ?? [],
    }));
    return {
      slots: results.sort(
        (left, right) => left.candidates.length - right.candidates.length,
      ),
    };
  }
  const firstCandidateIdentities = new Set(
    firstCandidates.map((candidate) => equipmentIdentity(candidate.equipment)),
  );
  const secondCandidateIdentities = new Set(
    secondCandidates.map((candidate) => equipmentIdentity(candidate.equipment)),
  );
  const symmetricRingSlots =
    !preserveRingOrder &&
    forcedRing === undefined &&
    forcedRing2 === undefined &&
    firstCandidateIdentities.size === secondCandidateIdentities.size &&
    [...firstCandidateIdentities].every((identity) =>
      secondCandidateIdentities.has(identity),
    );
  const estimatedRingPairs = firstCandidates.length * secondCandidates.length;
  if (estimatedRingPairs > 1_000_000) {
    throw new Error(
      `原始戒指候选预计产生 ${estimatedRingPairs} 个有序戒指对，超过候选内存保护线；未返回搜索结果`,
    );
  }
  const ringCandidates = [
    ...new Map(
      [...firstCandidates, ...secondCandidates].map((candidate) => [
        equipmentIdentity(candidate.equipment),
        candidate,
      ]),
    ).values(),
  ];
  const ringPairInfos = buildRingPairEquipInfos(
    ringCandidates.map(({ equipment }) => equipment),
    (itemId) => {
      return getGearById(itemId)?.unique === true;
    },
    symmetricRingSlots
      ? (left, right) => {
          const leftIdentity = equipmentIdentity(left);
          const rightIdentity = equipmentIdentity(right);
          return leftIdentity < rightIdentity
            ? -1
            : leftIdentity > rightIdentity
              ? 1
              : 0;
        }
      : undefined,
  ).filter((pair) => {
    const [first, second] = pair.ringEquips;
    if (forcedRing !== undefined && first.itemId !== forcedRing) return false;
    if (forcedRing2 !== undefined && second.itemId !== forcedRing2)
      return false;
    return (
      firstCandidateIdentities.has(equipmentIdentity(first)) &&
      secondCandidateIdentities.has(equipmentIdentity(second))
    );
  });
  const pairedCandidates = ringPairInfos.map(
    (equipment) => equipment as SolverGear,
  );
  // 从戒指对的完整嵌套身份派生其中的候选，以便结构化克隆后仍能稳定查找戒指身份。
  for (const pair of pairedCandidates) {
    const ringPair = pair.ringEquips;
    if (!ringPair) continue;
    for (const [ringInfo, slot] of [
      [ringPair[0], "ring"],
      [ringPair[1], "ring2"],
    ] as const) {
      const key = equipmentIdentity(ringInfo);
      const existing = gearsByIdentity.get(key);
      if (existing) gearsByIdentity.set(key, { ...existing, slot });
    }
  }
  slotCandidates.set(
    "rings",
    pairedCandidates.map((equipment) => ({
      equipment,
      gear: {} as MeldedGear,
    })),
  );

  for (const name of slots) {
    const candidates =
      slotCandidates.get(name)?.map(({ equipment }) => equipment) ?? [];
    results.push({ name, candidates });
  }
  return {
    slots: results.sort(
      (left, right) => left.candidates.length - right.candidates.length,
    ),
  };
}
