import { gameData } from "../../../data.ts";
import type { Stat } from "../../../types.ts";
import type { LinearMipRow } from "../../linear-mip.ts";
import type { JointModel, SharedEquipmentDomain } from "../joint-model.ts";
import type { JointPreparedJob, JointSearchOptions } from "../joint-types.ts";
import {
  orderedRingChildrenKey,
  ringChildStructuralKey,
  ringPairCandidate,
  ringPairSharedIdentity,
} from "../ring-domain.ts";
import { PROJECTION_AXES } from "./types.ts";
import type {
  ProjectionBlock,
  ProjectionFood,
  ProjectionJob,
  ProjectionModel,
  ProjectionSlot,
} from "./types.ts";

class UnsupportedProjection extends Error {}
function requireProjection(condition: unknown): asserts condition {
  if (!condition) throw new UnsupportedProjection();
}
const safe = (value: number, minimum = 0) => {
  requireProjection(Number.isSafeInteger(value) && value >= minimum);
  return value;
};
const equalVector = (left: readonly number[], right: readonly number[]) =>
  left.length === right.length &&
  left.every((value, index) => value === right[index]);
const canonicalPairAllowed = (
  order:
    | {
        firstSlotIndex: number;
        secondSlotIndex: number;
        firstRanks: readonly number[];
        secondRanks: readonly number[];
      }
    | undefined,
  left: { slot: number; index: number },
  right: { slot: number; index: number },
) => {
  if (order === undefined) return true;
  const ordered =
    left.slot === order.firstSlotIndex && right.slot === order.secondSlotIndex
      ? [left, right]
      : right.slot === order.firstSlotIndex &&
          left.slot === order.secondSlotIndex
        ? [right, left]
        : undefined;
  if (ordered !== undefined) {
    const first = order.firstRanks[ordered[0]!.index],
      second = order.secondRanks[ordered[1]!.index];
    // Incomplete optional metadata can only weaken this relaxation.
    return (
      first === undefined ||
      second === undefined ||
      !Number.isFinite(first) ||
      !Number.isFinite(second) ||
      first <= second
    );
  }
  return true;
};

/** A necessary relaxation of the current typed domain, never a reconstruction of MIP rows. */
export function prepareProjectionModel(
  options: JointSearchOptions,
  jobs: readonly JointPreparedJob[],
  assembled: JointModel,
  necessaryJobRows: readonly LinearMipRow[],
  check: () => void,
): ProjectionModel | undefined {
  let work = 0;
  const tick = () => {
    if ((++work & 1023) === 0) check();
    requireProjection(work <= 20_000_000);
  };
  try {
    check();
    requireProjection(
      jobs.length >= 2 &&
        jobs.length <= 16 &&
        options.jobs.length === jobs.length,
    );
    requireProjection(
      options.commonSlots.length > 0 &&
        options.commonSlots.length <= 17 &&
        new Set(options.commonSlots).size === options.commonSlots.length,
    );
    requireProjection(
      assembled.sharedEquipmentDomains.length === options.commonSlots.length,
    );
    const contexts = jobs.map(
      ({ job, originalJob, prepared, ringSplit }, jobIndex) => {
        check();
        requireProjection(
          originalJob === options.jobs[jobIndex] &&
            prepared.useDps === (options.objective === "dps"),
        );
        const model = prepared.model;
        requireProjection(
          model.resistanceAllocationVariables.length === 0 &&
            job.options.slots.length <= 17 &&
            job.slotNames.length === job.options.slots.length &&
            new Set(job.slotNames).size === job.slotNames.length,
        );
        const schema = gameData.jobSchemas[job.options.job];
        requireProjection(schema.mainStat !== undefined);
        const stats: readonly (Stat | undefined)[] = [
          schema.mainStat === "INT" || schema.mainStat === "MND"
            ? "MDMG"
            : "PDMG",
          schema.mainStat,
          "DET",
          "TEN",
          "CRT",
          "DHT",
          schema.stats?.includes("SKS") ? "SKS" : "SPS",
        ];
        const coordinates = stats.map((stat) => {
          const index =
            stat === undefined ? undefined : job.options.statIndexes.get(stat);
          const id =
            index === undefined ? undefined : job.options.attributeIds[index];
          return id === undefined ? undefined : model.idToIndex.get(id);
        });
        requireProjection(
          coordinates[0] !== undefined &&
            coordinates[1] !== undefined &&
            coordinates[6] !== undefined,
        );
        const present = coordinates.filter(
          (coordinate) => coordinate !== undefined,
        );
        requireProjection(
          new Set(present).size === present.length &&
            prepared.groups.length === PROJECTION_AXES.length,
        );
        const necessary = necessaryJobRows.filter(
          (row) => row.name === `joint_necessary_job_${jobIndex}`,
        );
        requireProjection(
          necessary.length === 1 && necessary[0]!.sense === ">=",
        );
        const row = necessary[0]!;
        safe(row.rhs, Number.MIN_SAFE_INTEGER);
        const selectors = new Set<string>();
        const axes = PROJECTION_AXES.map((name, axisIndex) => {
          const matching = prepared.groups.filter(
            (group) => group.name === name,
          );
          requireProjection(
            matching.length === 1 &&
              matching[0]!.classes.length > 0 &&
              matching[0]!.classes.length <= 100_000,
          );
          let maximumQ = Number.MIN_SAFE_INTEGER;
          for (const entry of matching[0]!.classes) {
            tick();
            maximumQ = Math.max(
              maximumQ,
              safe(entry.q, Number.MIN_SAFE_INTEGER),
            );
          }
          let previousMax = -1;
          const classes = matching[0]!.classes.map((entry) => {
            tick();
            // Auxiliary main-to-weapon coupling (BLU) is not a separable seven-axis domain.
            requireProjection(
              entry.auxiliary === undefined && entry.min > previousMax,
            );
            safe(entry.min);
            safe(entry.max, entry.min);
            safe(entry.value, 1);
            previousMax = entry.max;
            const q = prepared.qByVariable.get(entry.variable);
            requireProjection(
              q !== undefined &&
                q === entry.q - maximumQ &&
                !selectors.has(entry.variable),
            );
            safe(q, Number.MIN_SAFE_INTEGER);
            selectors.add(entry.variable);
            const selector = assembled.prefix(jobIndex, entry.variable);
            requireProjection((row.terms.get(selector) ?? 0) === q);
            return {
              min: entry.min,
              max: entry.max,
              value: entry.value,
              q,
              selector,
            };
          });
          if (coordinates[axisIndex] === undefined)
            requireProjection(
              classes.length === 1 &&
                classes[0]!.min === 0 &&
                classes[0]!.max === 0,
            );
          return { name, rawMin: 0, rawMax: 0, classes };
        });
        requireProjection(prepared.qByVariable.size === selectors.size);
        const expected = new Map(
          [...prepared.qByVariable].map(([variable, q]) => [
            assembled.prefix(jobIndex, variable),
            q,
          ]),
        );
        for (const [variable, q] of row.terms) {
          tick();
          requireProjection(q === (expected.get(variable) ?? 0));
        }
        const candidates = new Map<
          string,
          { values: number[]; slot: number; index: number }
        >();
        const originalSlots = job.options.slots.map((slot, slotIndex) => {
          requireProjection(
            slot.length > 0 &&
              slot.length <= 20_000 &&
              model.slotVariables[slotIndex]?.length === slot.length &&
              model.fixedEquipmentAttributes[slotIndex]?.length === slot.length,
          );
          const choices = slot.map((equipment, candidateIndex) => {
            tick();
            requireProjection(equipment.resistanceWeaponAdjust === undefined);
            const attributes =
              model.fixedEquipmentAttributes[slotIndex]![candidateIndex]!;
            requireProjection(
              attributes.length === job.options.attributeIds.length,
            );
            const values = coordinates.map((coordinate) =>
              coordinate === undefined ? 0 : safe(attributes[coordinate]!),
            );
            const key = assembled.prefix(
              jobIndex,
              model.slotVariables[slotIndex]![candidateIndex]!,
            );
            requireProjection(!candidates.has(key));
            candidates.set(key, {
              values,
              slot: slotIndex,
              index: candidateIndex,
            });
            return { key, values };
          });
          return { name: job.slotNames[slotIndex]!, choices };
        });
        const foods: ProjectionFood[] = [];
        requireProjection(
          job.options.foods.length <= 256 &&
            model.foodVariables.length === job.options.foods.length,
        );
        for (
          let foodIndex = 0;
          foodIndex < Math.max(1, job.options.foods.length);
          foodIndex++
        ) {
          tick();
          const food = job.options.foods[foodIndex];
          const bonuses = coordinates.map((coordinate) => {
            if (coordinate === undefined || food === undefined) return null;
            const id = job.options.attributeIds[coordinate];
            const params = food.baseParams.filter(
              (param) => param.baseParamId === id,
            );
            requireProjection(params.length <= 1);
            const param = params[0];
            const formulas = model.foodBonuses.filter(
              (bonus) =>
                bonus.foodIndex === foodIndex && bonus.attribute === coordinate,
            );
            requireProjection(formulas.length <= 1);
            if (
              param === undefined ||
              param.maxValue <= 0 ||
              param.multiplier <= 1
            ) {
              requireProjection(formulas.length === 0);
              return null;
            }
            requireProjection(formulas.length === 1);
            const formula = formulas[0]!;
            const numerator = safe(formula.numerator, 1),
              denominator = safe(formula.denominator, 1);
            const offset = safe(numerator * (param.baseValue ?? 0));
            const cap = safe(formula.cap, 1);
            requireProjection(
              cap === param.maxValue &&
                formula.maximumRaw ===
                  model.rawMaximums[coordinate]! + (param.baseValue ?? 0),
            );
            safe(numerator * model.rawMaximums[coordinate]! + offset);
            safe(denominator * cap);
            return { numerator, denominator, offset, cap };
          });
          foods.push({
            key:
              food === undefined
                ? `j${jobIndex}_no_food`
                : assembled.prefix(jobIndex, model.foodVariables[foodIndex]!),
            sharedKey:
              food === undefined ? "no_food" : options.foodIdentity(food),
            bonuses,
          });
        }
        const speedCoordinate = coordinates[6]!;
        const configuredSpeedCoordinate =
          job.options.speedAttributeId === undefined
            ? undefined
            : model.idToIndex.get(job.options.speedAttributeId);
        const speedRange = model.ranges.get(speedCoordinate);
        const rangeMin =
          speedRange?.min === undefined ? 0 : Math.ceil(speedRange.min);
        const rangeMax =
          speedRange?.max === undefined
            ? Number.MAX_SAFE_INTEGER
            : Math.floor(speedRange.max);
        // The GCD constraint callback targets speedAttributeId. Its ranges need
        // not constrain the formula's speed coordinate in an arbitrary typed call.
        const gcdRanges =
          configuredSpeedCoordinate === speedCoordinate
            ? model.gcdChoiceRanges
            : [];
        const speedRanges = (
          gcdRanges.length > 0
            ? gcdRanges
            : [{ min: 0, max: Number.MAX_SAFE_INTEGER }]
        )
          .map((range) => ({
            min: Math.max(range.min, rangeMin),
            max: Math.min(range.max, rangeMax),
          }))
          .filter((range) => range.min <= range.max);
        requireProjection(speedRanges.length > 0);
        speedRanges.forEach((range) => {
          safe(range.min);
          safe(range.max, range.min);
        });
        const physicalRingSlots = new Map<0 | 1, number>();
        job.options.slots.forEach((slot, index) => {
          const marker = slot[0]?.ringSlotIndex;
          if (
            (marker === 0 || marker === 1) &&
            slot.every((equipment) => {
              tick();
              return equipment.ringSlotIndex === marker;
            })
          )
            physicalRingSlots.set(marker, index);
        });
        return {
          job,
          originalJob,
          ringSplit,
          model,
          coordinates,
          axes,
          rhs: row.rhs,
          originalSlots,
          candidates,
          foods,
          speedRanges,
          physicalRingSlots,
          consumed: new Set<number>(),
        };
      },
    );

    type BoundBlock = {
      block: ProjectionBlock;
      values: number[][][];
      domains: readonly SharedEquipmentDomain[];
    };
    const boundBlocks: BoundBlock[] = [];
    for (const domain of assembled.sharedEquipmentDomains) {
      check();
      requireProjection(
        options.commonSlots.includes(domain.slot) &&
          domain.choices.length === jobs.length &&
          domain.keys.size > 0 &&
          domain.keys.size <= 100_000,
      );
      const selectors = assembled.sharedEquipmentSelectors.get(domain.slot);
      requireProjection(
        selectors !== undefined && selectors.size === domain.keys.size,
      );
      const keys = [...domain.keys];
      const block: ProjectionBlock = {
        name: domain.slot,
        keys: keys.map((identity) => {
          const selector = selectors.get(identity);
          requireProjection(selector !== undefined);
          return { key: selector, selectors: [selector] };
        }),
      };
      const values = contexts.map((context, jobIndex) => {
        const projection = options.commonSlotProjections?.find(
          (value) => value.commonSlot === domain.slot,
        );
        const split = context.ringSplit;
        const actualName =
          projection === undefined
            ? domain.slot
            : split !== undefined &&
                projection.slotName === split.originalSlotName
              ? projection.ringIndex === 0
                ? split.firstSlotName
                : split.secondSlotName
              : projection.slotName;
        const sourceSlot = context.job.slotNames.indexOf(actualName);
        const domainSlots =
          domain.splitPair && split !== undefined
            ? [split.firstSlotIndex, split.secondSlotIndex]
            : [sourceSlot];
        requireProjection(
          domainSlots.every((slot) => slot >= 0 && !context.consumed.has(slot)),
        );
        domainSlots.forEach((slot) => context.consumed.add(slot));
        const pairValues = new Map<string, number[][]>();
        if (domain.splitPair) {
          requireProjection(
            split !== undefined && split.originalSlotName === domain.slot,
          );
          const childValues = [split.firstSlotIndex, split.secondSlotIndex].map(
            (slot) => {
              const byStructure = new Map<string, readonly number[]>();
              context.job.options.slots[slot]!.forEach((candidate, index) => {
                tick();
                const key = ringChildStructuralKey(candidate),
                  vector = context.originalSlots[slot]!.choices[index]!.values;
                const previous = byStructure.get(key);
                requireProjection(
                  previous === undefined || equalVector(previous, vector),
                );
                if (previous === undefined) byStructure.set(key, vector);
              });
              return byStructure;
            },
          );
          for (const equipment of context.originalJob.options.slots[
            split.originalSlotIndex
          ]!) {
            tick();
            const pair = ringPairCandidate(equipment);
            requireProjection(pair !== undefined);
            const childKeys = pair.ringEquips.map(ringChildStructuralKey);
            requireProjection(
              split.pairByOrderedChildren.has(
                orderedRingChildrenKey(childKeys[0]!, childKeys[1]!),
              ),
            );
            const parts = childKeys.map((key, index) =>
              childValues[index]!.get(key),
            );
            requireProjection(parts[0] !== undefined && parts[1] !== undefined);
            const vector = PROJECTION_AXES.map((_, axis) =>
              safe(parts[0]![axis]! + parts[1]![axis]!),
            );
            const identity = ringPairSharedIdentity(
              pair,
              options.equipmentIdentity,
            );
            const entries = pairValues.get(identity) ?? [];
            entries.push(vector);
            pairValues.set(identity, entries);
          }
        }
        return keys.map((identity) => {
          tick();
          const entry = domain.choices[jobIndex]!.get(identity);
          requireProjection(entry !== undefined);
          let vectors: readonly number[][];
          if (domain.splitPair) {
            vectors = pairValues.get(identity) ?? [];
          } else {
            requireProjection(entry.variables.length > 0);
            vectors = entry.variables.map((variable) => {
              tick();
              const candidate = context.candidates.get(variable);
              requireProjection(candidate !== undefined);
              requireProjection(sourceSlot === candidate.slot);
              // A projected pair cannot be separated into endpoint resources without a certified split.
              requireProjection(
                projection === undefined ||
                  (context.ringSplit !== undefined &&
                    projection.slotName === context.ringSplit.originalSlotName),
              );
              return candidate.values;
            });
          }
          requireProjection(
            vectors.length > 0 &&
              vectors.every((vector) => equalVector(vector, vectors[0]!)),
          );
          return [...vectors[0]!];
        });
      });
      boundBlocks.push({ block, values, domains: [domain] });
    }

    // Keep the broad non-ring ranks first. An ordered ring pair forms one rank,
    // preserving positional restrictions; uniqueness filtering below is conservative.
    const first = boundBlocks.find(
      (entry) => entry.block.name === "ring" && !entry.domains[0]!.splitPair,
    );
    const second = boundBlocks.find(
      (entry) => entry.block.name === "ring2" && !entry.domains[0]!.splitPair,
    );
    const ordered = boundBlocks.filter(
      (entry) =>
        entry !== first && entry !== second && !entry.domains[0]!.splitPair,
    );
    if (first !== undefined && second !== undefined) {
      requireProjection(
        first.block.keys.length * second.block.keys.length <= 200_000,
      );
      const pairKeys: ProjectionBlock["keys"][number][] = [];
      const values = contexts.map(() => [] as number[][]);
      const endpointCandidates = [first, second].map((bound) => {
        const domain = bound.domains[0]!;
        return contexts.map((context, jobIndex) =>
          [...domain.keys].map((identity) =>
            domain.choices[jobIndex]!.get(identity)!.variables.map((variable) =>
              context.candidates.get(variable)!,
            ),
          ),
        );
      });
      for (let left = 0; left < first.block.keys.length; left++)
        for (let right = 0; right < second.block.keys.length; right++) {
          tick();
          const endpoint = [
            first.block.keys[left]!,
            second.block.keys[right]!,
          ] as const;
          let allowed = true;
          for (
            let jobIndex = 0;
            jobIndex < contexts.length && allowed;
            jobIndex++
          ) {
            const context = contexts[jobIndex]!;
            const candidates = [
              endpointCandidates[0]![jobIndex]![left]!,
              endpointCandidates[1]![jobIndex]![right]!,
            ];
            allowed = candidates[0]!.some((a) =>
              candidates[1]!.some((b) => {
                tick();
                const aEquipment = context.job.options.slots[a.slot]![a.index]!;
                const bEquipment = context.job.options.slots[b.slot]![b.index]!;
                const split = context.ringSplit;
                const splitEndpoints =
                  split !== undefined &&
                  ((a.slot === split.firstSlotIndex &&
                    b.slot === split.secondSlotIndex) ||
                    (b.slot === split.firstSlotIndex &&
                      a.slot === split.secondSlotIndex));
                const physicalEndpoints =
                  context.physicalRingSlots.size === 2 &&
                  ((context.physicalRingSlots.get(0) === a.slot &&
                    context.physicalRingSlots.get(1) === b.slot) ||
                    (context.physicalRingSlots.get(0) === b.slot &&
                      context.physicalRingSlots.get(1) === a.slot));
                if (
                  aEquipment.itemId === bEquipment.itemId &&
                  (splitEndpoints
                    ? split!.uniqueItemIds.has(aEquipment.itemId)
                    : physicalEndpoints &&
                      (aEquipment.isUnique === true ||
                        bEquipment.isUnique === true))
                )
                  return false;
                if (
                  !canonicalPairAllowed(
                    context.model.canonicalRingOrder,
                    a,
                    b,
                  ) ||
                  !canonicalPairAllowed(
                    assembled.sharedCanonicalRingOrders?.[jobIndex],
                    a,
                    b,
                  )
                )
                  return false;
                return true;
              }),
            );
          }
          if (!allowed) continue;
          pairKeys.push({
            key: JSON.stringify(endpoint.map((key) => key.key)),
            selectors: endpoint.flatMap((key) => key.selectors),
          });
          contexts.forEach((_, jobIndex) =>
            values[jobIndex]!.push(
              PROJECTION_AXES.map((_, axis) =>
                safe(
                  first.values[jobIndex]![left]![axis]! +
                    second.values[jobIndex]![right]![axis]!,
                ),
              ),
            ),
          );
        }
      requireProjection(pairKeys.length > 0);
      ordered.push({
        block: { name: "orderedRingPair", keys: pairKeys },
        values,
        domains: [...first.domains, ...second.domains],
      });
    } else {
      if (first !== undefined) ordered.push(first);
      if (second !== undefined) ordered.push(second);
    }
    ordered.push(...boundBlocks.filter((entry) => entry.domains[0]!.splitPair));
    const outputJobs: ProjectionJob[] = contexts.map((context, jobIndex) => {
      const slots: ProjectionSlot[] = ordered.map(({ block, values }) => ({
        name: block.name,
        choices: block.keys.map((key, index) => ({
          key: key.key,
          values: values[jobIndex]![index]!,
        })),
      }));
      context.originalSlots.forEach((slot, index) => {
        if (!context.consumed.has(index)) slots.push(slot);
      });
      const axes = context.axes.map((axis, index) => {
        let rawMin = 0,
          rawMax = 0;
        for (const slot of slots) {
          let minimum = Number.MAX_SAFE_INTEGER,
            maximum = 0;
          for (const choice of slot.choices) {
            tick();
            minimum = Math.min(minimum, choice.values[index]!);
            maximum = Math.max(maximum, choice.values[index]!);
          }
          rawMin = safe(rawMin + minimum);
          rawMax = safe(rawMax + maximum);
        }
        return { ...axis, rawMin, rawMax };
      });
      return {
        axes,
        slots,
        foods: context.foods,
        rhs: context.rhs,
        speedRanges: context.speedRanges,
      };
    });
    check();
    return { blocks: ordered.map(({ block }) => block), jobs: outputJobs };
  } catch (error) {
    if (error instanceof UnsupportedProjection) return undefined;
    throw error;
  }
}
