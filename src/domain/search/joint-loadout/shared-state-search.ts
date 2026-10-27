import type { ExactMipResult } from "../loadout-finder-exact-mip.ts";
import type { EquipInfo, FoodInfo, SharedSlotProjection } from "../types.ts";
import type { CommonChoice, FoodChoice, JobContext, JointLoadoutV3Options, Rational } from "./types.ts";
import { buildRawAttributes, applyFood } from "./attributes.ts";
import { equipmentIdentity } from "../equipment-identity.ts";
import { commonSlotIndex } from "./shared-equipment.ts";
import { makeJobOptions } from "./job-options.ts";
import { addRational, compareRational, integerDamageProduct, rational } from "./score.ts";
import { prepareExactMipModel } from "../exact-mip/model-preparation.ts";
import { factorObjectiveLogScore } from "../exact-mip/factor-model.ts";
import { factorResourceWeightVectors } from "../exact-mip/resource-support.ts";
import { prepareFactorResourceBudgetUpperBound, preparePartitionedFactorResourceBudgetUpperBound,
  type PreparedFactorResourceBudgetUpperBound, type ResourceBudgetFactorGroup } from "../factor-resource-budget-upper-bound.ts";
import { FIXED_SCALE, LOG_SCALE, floorDiv, logRatioFixedBounds } from "../core/exact-arithmetic.ts";
import type { FactorGroup } from "../exact-mip/types.ts";
import { integerDamageUtilityCertificate } from "../equipped-effects.ts";

export type SharedResourcePriceDiagnostic = {
  job: string;
  proposal: string;
  weights: string;
  sharedSpeed: number;
  food: string;
  resourceUpper: number;
  surrogateUpper: string;
  baselineSurrogate: string;
  requiredSurrogate: string;
  neededResource: number | "unreachable";
  resourceGap: number | "unreachable";
};

export type SharedStateSearchStatistics = {
  status: "complete-feasible" | "complete-infeasible" | "unsupported" | "budget-exhausted" | "skipped";
  reason?: string;
  elapsedMs: number;
  preparationMs: number;
  seedMs: number;
  enumerationMs: number;
  stage: "structure" | "seed" | "resource-support" | "enumeration";
  groups: number;
  contexts: number;
  states: number;
  mergedStates: number;
  transitions: number;
  speedPrunes: number;
  resourcePrunes: number;
  privateStates: number;
  privateEvaluations: number;
  seedEvaluations: number;
  maximumLayerStates: number;
  /** Per-context created witnesses conservatively bound its live predecessor DAG. */
  maximumContextStates: number;
  resourceSupports: number;
  resourcePriceCount: number;
  resourcePartitionAttempts: number;
  resourcePartitionPrices: number;
  resourcePartitions: number;
  resourcePartitionSupports: number;
  resourcePartitionPreparationMs: number;
  resourcePriceDiagnostics: SharedResourcePriceDiagnostic[];
  seedValueNumerator?: string;
  seedValueDenominator?: string;
  sharedVectorClasses: number;
  utilityClasses: number;
  equivalentJobs: number;
  privateEvaluationsSaved: number;
  utilityCertificateMs: number;
  activationDecision: "pending" | "enabled" | "skipped";
  activationReason?: string;
  activationContexts: number;
  /** Sum of saturated per-context footprints times representative envelopes; not an upper bound. */
  activationEstimatedWork: number;
  /** Permissive globally saturated footprint times largest envelope; performance decision only. */
  activationHeuristicWork: number;
  /** Numeric flag so the scalar PROFILE logger retains it. */
  activationSaturated: 0 | 1;
  activationDecisionMs: number;
  termination?: "enumeration" | "baseline-ceiling";
};

export type SharedStateSearchResult = {
  status: SharedStateSearchStatistics["status"];
  statistics: SharedStateSearchStatistics;
  /** An incumbent is independently feasible even when optional enumeration is abandoned. */
  results?: readonly ExactMipResult[];
};

type Limits = {
  maxStates?: number;
  maxTransitions?: number;
  maxPrivateStates?: number;
  maxElapsedMs?: number;
  maxSeedMs?: number;
  disableUtilityMerging?: boolean;
};
type Assignment = { slot: number; equipment: EquipInfo };
type Option = { vectors: number[][]; assignments: Assignment[][]; speed: number };
type Group = { names: string[]; options: Option[] };
type PrivateState = { values: number[]; assignments: Assignment[]; speed: number };
type State = { vectors: number[][]; speed: number; previous?: State; option?: Option };
type Price = {
  name: string;
  weights: number[];
  budget: PreparedFactorResourceBudgetUpperBound;
  baselineQ: bigint;
  slack: bigint;
  suffix: Map<number, number>[];
};
class OptionalBudget extends Error {}
class UnsupportedState extends Error {}

/**
 * T14/T15. Enumerate sufficient shared attribute states, then maximize each
 * independent private block. Every state retains a common physical witness.
 * Failure of this optional, bounded attempt never becomes an optimality claim.
 */
export async function findBestSharedStateLoadout(input: {
  options: JointLoadoutV3Options;
  contexts: readonly JobContext[];
  commonChoicesByName: ReadonlyMap<string, readonly CommonChoice[]>;
  foodChoices: readonly FoodChoice[];
  projections: ReadonlyMap<string, SharedSlotProjection>;
  assertWithinBudget: (stage: string) => void;
  remainingTimeLimit: () => number | undefined;
  limits?: Limits;
}): Promise<SharedStateSearchResult> {
  const { options, contexts, commonChoicesByName, foodChoices, projections } = input;
  const startedAt = performance.now();
  const stats: SharedStateSearchStatistics = {
    status: "unsupported", elapsedMs: 0, preparationMs: 0, seedMs: 0, enumerationMs: 0, stage: "structure", groups: 0,
    contexts: 0, states: 0, mergedStates: 0, transitions: 0, speedPrunes: 0,
    resourcePrunes: 0, privateStates: 0, privateEvaluations: 0, seedEvaluations: 0,
    maximumLayerStates: 0, maximumContextStates: 0, resourceSupports: 0, resourcePriceCount: 0,
    resourcePartitionAttempts: 0, resourcePartitionPrices: 0, resourcePartitions: 0,
    resourcePartitionSupports: 0, resourcePartitionPreparationMs: 0,
    resourcePriceDiagnostics: [], sharedVectorClasses: contexts.length,
    utilityClasses: contexts.length, equivalentJobs: 0, privateEvaluationsSaved: 0, utilityCertificateMs: 0,
    activationDecision: "pending", activationContexts: 0, activationEstimatedWork: 0,
    activationHeuristicWork: 0, activationSaturated: 0, activationDecisionMs: 0,
  };
  const constrained = contexts.every((context) => {
    const constraints = context.constraints;
    return constraints !== undefined && (constraints.gcd !== undefined || constraints.gcdChoices !== undefined ||
      constraints.speedMin !== undefined || constraints.speedMax !== undefined);
  });
  const remaining = input.remainingTimeLimit();
  const maxElapsedMs = input.limits?.maxElapsedMs ?? Math.min(constrained ? 20_000 : 200,
    remaining === undefined ? Infinity : Math.max(0, remaining * 0.4));
  const maxStates = input.limits?.maxStates ?? (constrained ? 300_000 : 15_000);
  const maxTransitions = input.limits?.maxTransitions ?? (constrained ? 12_000_000 : 500_000);
  const maxPrivateStates = input.limits?.maxPrivateStates ?? 20_000;
  const maxSeedMs = input.limits?.maxSeedMs ?? (constrained ? 4_000 : 40);
  let operations = 0;
  let best: { score: Rational; results: ExactMipResult[] } | undefined;
  let reachedCeiling = false;
  let contextStates = 0;
  let seedStartedAt: number | undefined;
  let enumerationStartedAt: number | undefined;
  const complete = (status: SharedStateSearchResult["status"], reason?: string): SharedStateSearchResult => {
    stats.status = status;
    stats.reason = reason;
    stats.elapsedMs = performance.now() - startedAt;
    if (stats.stage === "seed" && best !== undefined) {
      stats.seedValueNumerator = best.score.numerator.toString();
      stats.seedValueDenominator = best.score.denominator.toString();
    }
    if (stats.stage === "seed" && seedStartedAt !== undefined) stats.seedMs = performance.now() - seedStartedAt;
    stats.enumerationMs = enumerationStartedAt === undefined ? 0 : performance.now() - enumerationStartedAt;
    stats.preparationMs = Math.max(0, stats.elapsedMs - stats.seedMs - stats.enumerationMs);
    return { status, statistics: stats, ...(best === undefined ? {} : { results: best.results }) };
  };
  const checkpoint = (force = false) => {
    if (!force && (++operations & 255) !== 0) return;
    input.assertWithinBudget("共享完整属性状态搜索");
    if (performance.now() - startedAt >= maxElapsedMs || stats.transitions > maxTransitions || contextStates > maxStates) {
      throw new OptionalBudget("state/work/time budget");
    }
  };
  const sum = (left: readonly number[], right: readonly number[]) => {
    if (left.length !== right.length) throw new UnsupportedState("attribute dimensions differ");
    return left.map((value, index) => {
      const total = value + right[index]!;
      if (!Number.isSafeInteger(total) || total < 0) throw new UnsupportedState("unsafe cumulative attribute");
      return total;
    });
  };
  const vector = (context: JobContext, equipment: EquipInfo) => {
    const values = buildRawAttributes(context, [equipment]);
    if (values.some((value) => !Number.isSafeInteger(value) || value < 0)) throw new UnsupportedState("invalid attribute");
    return values;
  };
  try {
    checkpoint(true);
    if (contexts.length < 1 || !contexts.every((context) => context.active) || options.commonSlots.length === 0 ||
      options.foodStrategy !== "shared" || projections.size !== 0 || foodChoices.length === 0) {
      return complete("unsupported", "shared-food, independent static blocks and unprojected shared slots required");
    }
    if (![maxElapsedMs, maxStates, maxTransitions, maxPrivateStates, maxSeedMs].every((value) => Number.isFinite(value) && value >= 0) ||
      ![maxStates, maxTransitions, maxPrivateStates].every(Number.isSafeInteger)) {
      return complete("unsupported", "invalid optional search budget");
    }
    const speedIndexes = contexts.map((context) => context.job.options.speedAttributeId === undefined ? undefined :
      context.attributeIndexes.get(context.job.options.speedAttributeId));
    if (speedIndexes.some((index) => index === undefined)) return complete("unsupported", "missing speed coordinate");
    const normalized = contexts.map((context) => makeJobOptions(context, new Map(), projections, undefined,
      undefined, options.objective, options.isCancelled));
    const privateIndexes = contexts.map((context) => new Set(context.solverSlots.map((_, index) => index)));
    for (const context of contexts) for (const slot of context.solverSlots) for (const equipment of slot) {
      checkpoint();
      if (equipment.resistanceWeaponAdjust !== undefined || equipment.resistanceAllocation !== undefined) {
        return complete("unsupported", "variable weapon domains remain in the integer model");
      }
    }
    const hasSharedFirstRing = options.commonSlots.includes("ring");
    const hasSharedSecondRing = options.commonSlots.includes("ring2");
    if (hasSharedFirstRing !== hasSharedSecondRing) return complete("unsupported", "partial shared-ring compatibility");
    const ringLegal = (first: EquipInfo, second: EquipInfo) => {
      if (!Number.isSafeInteger(first.itemId) || !Number.isSafeInteger(second.itemId) ||
        typeof first.isUnique !== "boolean" || typeof second.isUnique !== "boolean") {
        throw new UnsupportedState("incomplete unique-ring metadata");
      }
      if (first.itemId === second.itemId && first.isUnique !== second.isUnique) {
        throw new UnsupportedState("inconsistent unique-ring metadata");
      }
      return first.itemId !== second.itemId || !first.isUnique;
    };
    const validCompletePair = (equipment: EquipInfo) => {
      const pair = (equipment as EquipInfo & { ringEquips?: readonly EquipInfo[] }).ringEquips;
      return pair === undefined || (pair.length === 2 && ringLegal(pair[0]!, pair[1]!));
    };
    const groups: Group[] = [];
    for (const name of options.commonSlots) {
      if (name === "ring2" && hasSharedFirstRing) continue;
      const names = name === "ring" && hasSharedSecondRing ? ["ring", "ring2"] : [name];
      const candidates = names.map((slotName) => commonChoicesByName.get(slotName));
      if (candidates.some((choices) => choices === undefined || choices.length === 0)) {
        return complete("complete-infeasible", "empty common identity intersection");
      }
      const unique = new Map<string, Option>();
      for (const first of candidates[0]!) for (const second of candidates[1] ?? [undefined]) {
        checkpoint();
        stats.transitions++;
        const selections = contexts.map((context) => names.map((slotName, index) => {
          const choice = index === 0 ? first : second!;
          const equipment = choice.equipments.get(context.job.id);
          const slot = commonSlotIndex(context, slotName, projections);
          if (equipment === undefined || equipmentIdentity(equipment) !== choice.key || !context.solverSlots[slot]!.includes(equipment)) {
            throw new UnsupportedState("common choice has no original physical witness");
          }
          privateIndexes[contexts.indexOf(context)]!.delete(slot);
          return { slot, equipment };
        }));
        if (selections.some((selection) => !selection.every(({ equipment }) => validCompletePair(equipment)) ||
          (names.length === 2 && !ringLegal(selection[0]!.equipment, selection[1]!.equipment)))) continue;
        const vectors = selections.map((selection, job) => selection.reduce((values, { equipment }) =>
          sum(values, vector(contexts[job]!, equipment)), new Array(contexts[job]!.job.options.attributeIds.length).fill(0)));
        const speeds = vectors.map((values, job) => values[speedIndexes[job]!]!);
        if (speeds.some((speed) => speed !== speeds[0])) return complete("unsupported", "shared speed has job-dependent contributions");
        const key = vectors.map((values) => values.join(",")).join(";");
        if (unique.has(key)) stats.mergedStates++;
        else unique.set(key, { vectors, assignments: selections, speed: speeds[0]! });
      }
      if (unique.size === 0) return complete("complete-infeasible", "no legal common ring group");
      groups.push({ names, options: [...unique.values()] });
    }
    groups.sort((left, right) => left.options.length - right.options.length);
    stats.groups = groups.length;
    // This is equality of complete shared contribution vectors, not equality
    // of utility functions or independent baselines. Private blocks, food,
    // constraints and normalization remain separate for every original job.
    const vectorRepresentatives: number[] = [];
    const vectorClass: number[] = [];
    const sameVectorSchema = (left: number, right: number) => {
      const a = contexts[left]!.job.options;
      const b = contexts[right]!.job.options;
      return a.attributeIds.length === b.attributeIds.length && a.attributeIds.every((id, index) => id === b.attributeIds[index]) &&
        a.statIndexes.size === b.statIndexes.size && [...a.statIndexes].every(([stat, index]) => b.statIndexes.get(stat) === index);
    };
    for (let job = 0; job < contexts.length; job++) {
      checkpoint();
      const representative = vectorRepresentatives.find((other) => sameVectorSchema(job, other) && groups.every((group) =>
        group.options.every((option) => option.vectors[job]!.every((value, index) => value === option.vectors[other]![index]))));
      vectorClass.push(representative ?? job);
      if (representative === undefined) vectorRepresentatives.push(job);
    }
    stats.sharedVectorClasses = vectorRepresentatives.length;
    const addShared = (left: readonly number[][], right: readonly number[][]) => {
      const result = new Array<number[]>(contexts.length);
      for (let job = 0; job < contexts.length; job++) {
        const representative = vectorClass[job]!;
        result[job] = representative === job ? sum(left[job]!, right[job]!) : result[representative]!;
      }
      return result;
    };
    const sharedKey = (vectors: readonly number[][]) => vectorRepresentatives.map((job) => vectors[job]!.join(",")).join(";");
    for (const group of groups) for (const option of group.options) {
      for (let job = 0; job < contexts.length; job++) option.vectors[job] = option.vectors[vectorClass[job]!]!;
    }
    const privateStates: PrivateState[][] = [];
    for (let job = 0; job < contexts.length; job++) {
      const context = contexts[job]!;
      const slots = [...privateIndexes[job]!];
      const ringSlots = slots.filter((slot) => context.solverSlots[slot]![0]?.ringSlotIndex !== undefined);
      if (ringSlots.length !== 0 && ringSlots.length !== 2) return complete("unsupported", "private/shared ring boundary");
      const privateGroups: Assignment[][][] = [];
      for (const slot of slots) {
        if (ringSlots.length === 2 && slot === ringSlots[1]) continue;
        const choices: Assignment[][] = [];
        for (const first of context.solverSlots[slot]!) {
          if (!validCompletePair(first)) continue;
          if (ringSlots.length === 2 && slot === ringSlots[0]) {
            for (const second of context.solverSlots[ringSlots[1]!]!) {
              checkpoint(); stats.transitions++;
              if (ringLegal(first, second)) choices.push([{ slot, equipment: first }, { slot: ringSlots[1]!, equipment: second }]);
            }
          } else choices.push([{ slot, equipment: first }]);
        }
        privateGroups.push(choices);
      }
      let states: PrivateState[] = [{ values: new Array(context.job.options.attributeIds.length).fill(0), assignments: [], speed: 0 }];
      for (const choices of privateGroups) {
        const next = new Map<string, PrivateState>();
        for (const state of states) for (const assignments of choices) {
          checkpoint(); stats.transitions++;
          const values = assignments.reduce((current, { equipment }) => sum(current, vector(context, equipment)), state.values);
          const key = values.join(",");
          if (next.has(key)) stats.mergedStates++;
          else next.set(key, { values, assignments: [...state.assignments, ...assignments], speed: values[speedIndexes[job]!]! });
          if (next.size > maxPrivateStates) throw new OptionalBudget("private state budget");
        }
        states = [...next.values()];
      }
      stats.privateStates += states.length;
      if (states.length === 0) return complete("complete-infeasible", "empty private domain");
      privateStates.push(states);
    }
    const foodFor = (choice: FoodChoice, job: number) => {
      const food = choice.foods.get(contexts[job]!.job.id);
      if (!choice.foods.has(contexts[job]!.job.id) || (food !== undefined && !contexts[job]!.job.options.foods.includes(food)) ||
        (food === undefined && contexts[job]!.job.options.foods.length !== 0)) {
        throw new UnsupportedState("shared food has no original-domain witness");
      }
      return food;
    };
    const finalAttributes = (job: number, raw: readonly number[], food: FoodInfo | undefined) => {
      const attributes = applyFood(raw, food, contexts[job]!.attributeIndexes);
      if (attributes.some((value) => !Number.isSafeInteger(value) || value < 0)) throw new UnsupportedState("unsafe food attributes");
      return attributes;
    };
    const legalAttributes = (job: number, attributes: readonly number[], gcd: number, onlySpeed = false) => {
      const constraints = normalized[job]!.constraints ?? {};
      const speed = attributes[speedIndexes[job]!]!;
      if ((constraints.gcd !== undefined && Math.round(constraints.gcd * 100) !== gcd) ||
        (constraints.gcdChoices !== undefined && !constraints.gcdChoices.some((choice) => Math.round(choice * 100) === gcd)) ||
        (constraints.speedMin !== undefined && speed < constraints.speedMin) ||
        (constraints.speedMax !== undefined && speed > constraints.speedMax)) return false;
      if (onlySpeed) return true;
      if (constraints.toughMin !== undefined || constraints.toughnessMinPercent !== undefined) {
        const attribute = normalized[job]!.toughnessAttributeId;
        const index = attribute === undefined ? undefined : contexts[job]!.attributeIndexes.get(attribute);
        if (index === undefined) throw new UnsupportedState("missing toughness coordinate");
        let minimum = constraints.toughMin ?? 0;
        if (constraints.toughnessMinPercent !== undefined) {
          const convert = normalized[job]!.toughnessPercentToMinimum;
          if (convert === undefined) throw new UnsupportedState("missing mitigation conversion");
          minimum = Math.max(minimum, convert(constraints.toughnessMinPercent));
        }
        if (!Number.isSafeInteger(minimum) || minimum < 0) throw new UnsupportedState("invalid toughness threshold");
        if (attributes[index]! < minimum) return false;
      }
      return true;
    };
    const certificateStartedAt = performance.now();
    type UtilityClass = { representative: number; members: number[]; coordinates: number[];
      witnesses: Map<number, Map<string, PrivateState>> };
    const utilityClasses: UtilityClass[] = [];
    const utilityByKey = new Map<string, UtilityClass>();
    const utilityVectorKey = (values: readonly number[], coordinates: readonly number[]) => coordinates.map((coordinate) => values[coordinate]).join(",");
    for (let job = 0; job < contexts.length; job++) {
      checkpoint(true);
      const context = contexts[job]!;
      const certificate = input.limits?.disableUtilityMerging ? undefined : integerDamageUtilityCertificate(context.factorEvaluator);
      const constraints = normalized[job]!.constraints ?? {};
      const toughId = normalized[job]!.toughnessAttributeId;
      const toughIndex = toughId === undefined ? undefined : context.attributeIndexes.get(toughId);
      let minimum = constraints.toughMin ?? 0;
      if (constraints.toughnessMinPercent !== undefined) {
        const convert = normalized[job]!.toughnessPercentToMinimum;
        if (convert === undefined) throw new UnsupportedState("missing mitigation conversion");
        minimum = Math.max(minimum, convert(constraints.toughnessMinPercent));
      }
      const coordinates = [...new Set([...(certificate?.coordinates ?? []), speedIndexes[job]!,
        ...(constraints.toughMin !== undefined || constraints.toughnessMinPercent !== undefined ? [toughIndex ?? -1] : [])])].sort((a, b) => a - b);
      let certifiable = certificate !== undefined && coordinates.every((coordinate) => coordinate >= 0 && coordinate < context.job.options.attributeIds.length) &&
        Number.isSafeInteger(minimum) && minimum >= 0;
      const transforms = foodChoices.map((choice) => {
        const seen = new Set<number>();
        const entries: number[][] = [];
        for (const parameter of foodFor(choice, job)?.baseParams ?? []) {
          const coordinate = context.attributeIndexes.get(parameter.baseParamId);
          if (coordinate === undefined || seen.has(coordinate) || !Number.isSafeInteger(parameter.maxValue) || parameter.maxValue < 0 ||
            !Number.isFinite(parameter.multiplier) || parameter.multiplier < 1 || !Number.isSafeInteger(parameter.baseValue ?? 0)) certifiable = false;
          if (coordinate === undefined) continue;
          seen.add(coordinate);
          if (coordinates.includes(coordinate)) entries.push([coordinate, parameter.multiplier, parameter.maxValue, parameter.baseValue ?? 0]);
        }
        return entries.sort((a, b) => a[0]! - b[0]!);
      });
      const witnesses = new Map<string, PrivateState>();
      for (const state of privateStates[job]!) {
        checkpoint();
        const key = utilityVectorKey(state.values, coordinates);
        if (!witnesses.has(key)) witnesses.set(key, state);
      }
      const sharedVectors = groups.map((group) => group.options.map((option) => {
        checkpoint(); return utilityVectorKey(option.vectors[job]!, coordinates);
      }));
      const key = certifiable ? JSON.stringify([certificate!.key, coordinates, speedIndexes[job],
        constraints.gcd === undefined ? null : Math.round(constraints.gcd * 100),
        constraints.gcdChoices?.map((gcd) => Math.round(gcd * 100)).sort((a, b) => a - b) ?? null,
        constraints.speedMin ?? null, constraints.speedMax ?? null, minimum, minimum > 0 ? toughIndex : null,
        context.optimumProduct.toString(), options.objective === "dps" ? context.optimumGcd : null,
        sharedVectors, transforms, [...witnesses.keys()].sort()]) : undefined;
      const existing = key === undefined ? undefined : utilityByKey.get(key);
      if (existing !== undefined) {
        existing.members.push(job); existing.witnesses.set(job, witnesses);
      } else {
        const group: UtilityClass = { representative: job, members: [job], coordinates, witnesses: new Map([[job, witnesses]]) };
        utilityClasses.push(group);
        if (key !== undefined) utilityByKey.set(key, group);
      }
    }
    stats.utilityClasses = utilityClasses.length;
    stats.equivalentJobs = contexts.length - utilityClasses.length;
    stats.utilityCertificateMs = performance.now() - certificateStartedAt;

    // Activation is a deliberately permissive performance heuristic. Counts
    // saturated at maxStates are never used for pruning or a completeness claim.
    const activationStartedAt = performance.now();
    const countCap = Math.max(1, Math.floor(maxStates));
    const saturating = (value: number, cap = Number.MAX_SAFE_INTEGER) => {
      if (!Number.isSafeInteger(value) || value > cap) { stats.activationSaturated = 1; return cap; }
      return value;
    };
    let sharedCounts = new Map<number, number>([[0, 1]]);
    for (const group of groups) {
      const frequency = new Map<number, number>();
      for (const option of group.options) frequency.set(option.speed, saturating((frequency.get(option.speed) ?? 0) + 1, countCap));
      const next = new Map<number, number>();
      for (const [prefix, count] of sharedCounts) for (const [speed, multiplicity] of frequency) {
        checkpoint();
        const total = prefix + speed;
        if (!Number.isSafeInteger(total)) {
          stats.activationDecision = "skipped"; stats.activationReason = "unknown activation speed";
          stats.activationDecisionMs = performance.now() - activationStartedAt;
          return complete("skipped", stats.activationReason);
        }
        next.set(total, saturating((next.get(total) ?? 0) + saturating(count * multiplicity, countCap), countCap));
      }
      sharedCounts = next;
    }
    const privateSpeedCounts = privateStates.map((states) => {
      const counts = new Map<number, number>();
      for (const state of states) counts.set(state.speed, (counts.get(state.speed) ?? 0) + 1);
      return counts;
    });
    const eligibleCount = (job: number, sharedSpeed: number, choice: FoodChoice) => {
      let count = 0;
      for (const [speed, multiplicity] of privateSpeedCounts[job]!) {
        checkpoint();
        const raw = new Array<number>(contexts[job]!.job.options.attributeIds.length).fill(0);
        raw[speedIndexes[job]!] = sharedSpeed + speed;
        if (!Number.isSafeInteger(raw[speedIndexes[job]!]!)) return undefined;
        const attributes = finalAttributes(job, raw, foodFor(choice, job));
        const factors = contexts[job]!.factorEvaluator(attributes);
        if (factors === undefined || !Number.isSafeInteger(factors.gcdCentiseconds) || factors.gcdCentiseconds <= 0) return undefined;
        if (legalAttributes(job, attributes, factors.gcdCentiseconds, true)) count += multiplicity;
      }
      return count;
    };
    let totalFootprint = 0;
    let maximumEnvelope = 0;
    for (const choice of foodChoices) for (const [speed, tuples] of sharedCounts) {
      const eligible = contexts.map((_, job) => eligibleCount(job, speed, choice));
      if (eligible.some((count) => count === undefined)) {
        stats.activationDecision = "skipped"; stats.activationReason = "unknown activation eligibility";
        stats.activationDecisionMs = performance.now() - activationStartedAt;
        return complete("skipped", stats.activationReason);
      }
      if (eligible.some((count) => count === 0)) continue;
      const envelope = utilityClasses.reduce((total, group) => total + eligible[group.representative]!, 0);
      stats.activationContexts++;
      stats.activationEstimatedWork = saturating(stats.activationEstimatedWork + saturating(tuples * envelope));
      totalFootprint = saturating(totalFootprint + tuples, countCap);
      maximumEnvelope = Math.max(maximumEnvelope, envelope);
    }
    stats.activationHeuristicWork = saturating(totalFootprint * maximumEnvelope);
    stats.activationDecisionMs = performance.now() - activationStartedAt;
    stats.activationDecision = stats.activationHeuristicWork > maxTransitions ? "skipped" : "enabled";
    stats.activationReason = stats.activationDecision === "enabled" ? "permissive shared footprint and private envelope" : "estimated shared/private burden";
    const skipStateEnumeration = stats.activationDecision === "skipped";

    const ratioFor = (job: number, product: bigint, gcd: number) => options.objective === "dps"
      ? rational(product * BigInt(contexts[job]!.optimumGcd), BigInt(gcd) * contexts[job]!.optimumProduct)
      : rational(product, contexts[job]!.optimumProduct);
    const makeResults = (shared: readonly Option[], chosen: readonly PrivateState[], choice: FoodChoice) => {
      const results: ExactMipResult[] = [];
      for (let job = 0; job < contexts.length; job++) {
        const context = contexts[job]!;
        const selection = new Array<EquipInfo>(context.solverSlots.length);
        for (const option of shared) for (const assignment of option.assignments[job]!) selection[assignment.slot] = assignment.equipment;
        for (const assignment of chosen[job]!.assignments) selection[assignment.slot] = assignment.equipment;
        if (selection.some((equipment, slot) => equipment === undefined || !context.solverSlots[slot]!.includes(equipment)) ||
          selection.filter(Boolean).length !== selection.length) throw new UnsupportedState("incomplete original-domain restoration");
        const raw = buildRawAttributes(context, selection);
        if (raw.some((value) => !Number.isSafeInteger(value) || value < 0)) throw new UnsupportedState("unsafe restored vector");
        const food = foodFor(choice, job);
        const evaluation = context.job.options.evaluationFunction(finalAttributes(job, raw, food));
        if (evaluation === undefined || !Number.isFinite(evaluation.damage) || !Number.isFinite(evaluation.gcd) || evaluation.gcd <= 0) {
          throw new UnsupportedState("invalid official evaluation");
        }
        results.push({ selection, food, damage: evaluation.damage,
          ...(context.optimum.maximumToughness === undefined ? {} : { maximumToughness: context.optimum.maximumToughness }),
          statistics: { elapsedMs: 0, solverRuns: 0, excludedSignatures: 0, signatureBandChecks: 0,
            signatureBandElapsedMs: 0, signatureBandProof: false, variables: 0, constraints: 0,
            maximumSurrogate: 0, nextSurrogate: undefined, memoryUsage: {} } });
      }
      return results;
    };
    const consider = (vectors: readonly number[][], shared: readonly Option[], choice: FoodChoice,
      eligible?: readonly (readonly PrivateState[])[]) => {
      let score = rational(0n, 1n);
      let completedEnvelopeSavings = 0;
      const chosen: PrivateState[] = [];
      for (const utility of utilityClasses) {
        const job = utility.representative;
        let winner: { state: PrivateState; ratio: Rational } | undefined;
        for (const state of eligible?.[job] ?? privateStates[job]!) {
          checkpoint(); stats.privateEvaluations++;
          const attributes = finalAttributes(job, sum(vectors[job]!, state.values), foodFor(choice, job));
          const factors = contexts[job]!.factorEvaluator(attributes);
          if (factors === undefined || !Number.isSafeInteger(factors.gcdCentiseconds) || factors.gcdCentiseconds <= 0) {
            throw new UnsupportedState("invalid canonical factors");
          }
          if (!legalAttributes(job, attributes, factors.gcdCentiseconds)) continue;
          const ratio = ratioFor(job, integerDamageProduct(factors), factors.gcdCentiseconds);
          if (compareRational(ratio, rational(1n, 1n)) > 0) {
            throw new Error(`职业 ${contexts[job]!.job.id} 的可行目标超过独立最优基线；停止共享状态证明`);
          }
          if (winner === undefined || compareRational(ratio, winner.ratio) > 0) winner = { state, ratio };
        }
        completedEnvelopeSavings += utility.members.reduce((total, member) => member === job ? total :
          total + (eligible?.[member] ?? privateStates[member]!).length, 0);
        if (winner === undefined) return;
        const key = utilityVectorKey(winner.state.values, utility.coordinates);
        for (const member of utility.members) {
          chosen[member] = member === job ? winner.state : utility.witnesses.get(member)!.get(key)!;
          if (chosen[member] === undefined) throw new UnsupportedState("missing equivalent private witness");
        }
        score = addRational(score, rational(winner.ratio.numerator * BigInt(utility.members.length), winner.ratio.denominator));
      }
      // Count savings only for completed envelopes. An infeasible earlier job
      // would also have stopped the original, unmerged per-job loop.
      stats.privateEvaluationsSaved += completedEnvelopeSavings;
      if (best === undefined || compareRational(score, best.score) > 0) {
        best = { score, results: makeResults(shared, chosen, choice) };
        reachedCeiling = compareRational(score, rational(BigInt(contexts.length), 1n)) === 0;
      }
      return score;
    };
    // These bounded coordinate walks only construct lower bounds. Their choices
    // never truncate the full state domain enumerated below.
    stats.stage = "seed";
    const seedStarted = performance.now();
    seedStartedAt = seedStarted;
    const seedDeadline = Math.min(startedAt + maxElapsedMs, seedStarted + maxSeedMs);
    const seeds: { shared: Option[]; choice: FoodChoice; vectors: number[][] }[] = [];
    for (const context of contexts) {
      const selected = groups.map((group) => group.options.find((option) =>
        option.assignments[contexts.indexOf(context)]!.every(({ slot, equipment }) =>
          equipmentIdentity(equipment) === equipmentIdentity(context.optimum.selection[slot]!))) ?? group.options[0]!);
      for (const choice of foodChoices) {
        checkpoint(); stats.seedEvaluations++;
        const vectors = selected.reduce((all, option) => addShared(all, option.vectors),
          contexts.map((job) => new Array<number>(job.job.options.attributeIds.length).fill(0)));
        consider(vectors, selected, choice);
        seeds.push({ shared: [...selected], choice, vectors });
        if (reachedCeiling) { stats.seedMs = performance.now() - seedStarted; stats.termination = "baseline-ceiling"; return complete("complete-feasible"); }
        if (performance.now() >= seedDeadline) break;
      }
      if (performance.now() >= seedDeadline) break;
    }
    for (const seed of seeds) {
      for (let pass = 0; pass < 2 && performance.now() < seedDeadline; pass++) {
        let changed = false;
        for (let group = 0; group < groups.length && performance.now() < seedDeadline; group++) {
          const previous = seed.shared[group]!;
          const without = seed.vectors.map((values, job) => values.map((value, attribute) => value - previous.vectors[job]![attribute]!));
          let winner = previous;
          let bestScore = consider(seed.vectors, seed.shared, seed.choice);
          for (const option of groups[group]!.options) {
            if (performance.now() >= seedDeadline) break;
            checkpoint(); stats.seedEvaluations++;
            const vectors = addShared(without, option.vectors);
            seed.shared[group] = option;
            const score = consider(vectors, seed.shared, seed.choice);
            if (score !== undefined && (bestScore === undefined || compareRational(score, bestScore) > 0)) {
              winner = option; bestScore = score;
            }
            if (reachedCeiling) { stats.seedMs = performance.now() - seedStarted; stats.termination = "baseline-ceiling"; return complete("complete-feasible"); }
          }
          seed.shared[group] = winner;
          seed.vectors = addShared(without, winner.vectors);
          changed ||= winner !== previous;
        }
        if (!changed) break;
      }
    }
    stats.seedMs = performance.now() - seedStarted;
    if (best !== undefined) {
      stats.seedValueNumerator = best.score.numerator.toString();
      stats.seedValueDenominator = best.score.denominator.toString();
    }
    // The activation decision applies to proof enumeration. A bounded ordinary
    // feasible seed can still help the complete MIP without visiting DP states.
    if (skipStateEnumeration) return complete("skipped", stats.activationReason);
    stats.stage = "resource-support";

    const suffixSpeeds: Set<number>[] = Array.from({ length: groups.length + 1 }, () => new Set());
    suffixSpeeds[groups.length]!.add(0);
    for (let group = groups.length - 1; group >= 0; group--) {
      const values = [...new Set(groups[group]!.options.map((option) => option.speed))];
      for (const speed of values) for (const suffix of suffixSpeeds[group + 1]!) {
        checkpoint(); stats.transitions++;
        const value = speed + suffix;
        if (!Number.isSafeInteger(value)) throw new UnsupportedState("unsafe suffix speed");
        suffixSpeeds[group]!.add(value);
      }
    }
    const prices: Price[][] = [];
    for (let job = 0; job < contexts.length; job++) {
      checkpoint(true);
      const prepared = await prepareExactMipModel(normalized[job]!);
      if (prepared === undefined) return complete("unsupported", "baseline and resource model disagree");
      const axes = ([
        ["main", prepared.mainAttribute], ["weapon", prepared.weaponAttribute], ["det", prepared.detAttribute],
        ["ten", prepared.tenAttribute], ["crt", prepared.crtAttribute], ["dht", prepared.dhtAttribute], ["gcd", prepared.speedAttribute],
      ] as const).filter((entry): entry is readonly [typeof entry[0], number] => entry[1] !== undefined);
      const baselineAttributes = finalAttributes(job,
        buildRawAttributes(contexts[job]!, contexts[job]!.optimum.selection), contexts[job]!.optimum.food);
      const baselineFactors = contexts[job]!.factorEvaluator(baselineAttributes);
      if (baselineFactors === undefined) throw new UnsupportedState("missing baseline factors");
      const proposals = sharedStateResourcePriceProposals(prepared.groups,
        axes.map(([name, attribute]) => ({ name, baselineValue: baselineAttributes[attribute]! })));
      const jobPrices: Price[] = [];
      const partitionCandidates: { price: Price; groups: ResourceBudgetFactorGroup[]; gap: bigint }[] = [];
      const crtGroup = prepared.groups.findIndex((group) => group.name === "crt" && group.classes.length > 1);
      const crtAxis = axes.findIndex(([name]) => name === "crt");
      for (const proposal of proposals) {
        checkpoint(true);
        const axisWeights = proposal.weights;
        const weights = new Array<number>(contexts[job]!.job.options.attributeIds.length).fill(0);
        axes.forEach(([, attribute], axis) => { weights[attribute] = axisWeights[axis]!; });
        const sharedCosts = groups.map((group) => group.options.map((option) => optionalDot(option.vectors[job]!, weights)));
        const privateCosts = privateStates[job]!.map((state) => optionalDot(state.values, weights));
        if (sharedCosts.some((costs) => costs.some((cost) => cost === undefined)) || privateCosts.some((cost) => cost === undefined)) continue;
        let maximumResource = 0;
        for (const costs of sharedCosts) maximumResource += (costs as number[]).reduce((maximum, cost) => Math.max(maximum, cost), 0);
        maximumResource += (privateCosts as number[]).reduce((maximum, cost) => Math.max(maximum, cost), 0);
        let maximumFoodResource = 0;
        for (const choice of foodChoices) {
          const caps = new Array<number>(weights.length).fill(0);
          for (const parameter of foodFor(choice, job)?.baseParams ?? []) {
            const attribute = contexts[job]!.attributeIndexes.get(parameter.baseParamId);
            if (attribute !== undefined) caps[attribute] += parameter.maxValue;
          }
          const cost = optionalDot(caps, weights);
          if (cost === undefined) { maximumFoodResource = Number.NaN; break; }
          maximumFoodResource = Math.max(maximumFoodResource, cost);
        }
        if (!Number.isSafeInteger(maximumResource) || !Number.isSafeInteger(maximumFoodResource) ||
          !Number.isSafeInteger(maximumResource + maximumFoodResource)) continue;
        const maximumAddition = Math.max(0, ...prepared.groups.flatMap((group) => group.classes.map((entry) => entry.auxiliary ?? 0)));
        const resourceGroups = prepared.groups.map((group) => {
          const axis = axes.findIndex(([name]) => name === group.name);
          const weight = axis < 0 ? 0 : axisWeights[axis]!;
          return { classes: group.classes.map((entry) => ({
            min: (group.name === "weapon" ? Math.max(0, entry.min - maximumAddition) : entry.min) * weight,
            score: entry.q,
          })) };
        });
        // Prepare and retain the original certificate first. The optional
        // partition helper has a separate work allowance and may fail even
        // when this complete-domain preparation succeeds.
        checkpoint(true);
        const budget = prepareFactorResourceBudgetUpperBound(resourceGroups, { maxWork: 250_000 });
        checkpoint(true);
        if (budget === undefined) continue;
        const suffix: Map<number, number>[] = Array.from({ length: groups.length + 1 }, () => new Map());
        suffix[groups.length]!.set(0, 0);
        for (let group = groups.length - 1; group >= 0; group--) {
          const bestBySpeed = new Map<number, number>();
          groups[group]!.options.forEach((option, index) => bestBySpeed.set(option.speed,
            Math.max(bestBySpeed.get(option.speed) ?? 0, sharedCosts[group]![index]!)));
          for (const [speed, cost] of bestBySpeed) for (const [remainingSpeed, remainingCost] of suffix[group + 1]!) {
            checkpoint(); stats.transitions++;
            const totalCost = cost + remainingCost;
            const totalSpeed = speed + remainingSpeed;
            if (!Number.isSafeInteger(totalCost) || !Number.isSafeInteger(totalSpeed)) throw new UnsupportedState("unsafe suffix resource");
            suffix[group]!.set(totalSpeed, Math.max(suffix[group]!.get(totalSpeed) ?? 0, totalCost));
          }
        }
        const price: Price = { name: proposal.name, weights, budget, suffix,
          baselineQ: BigInt(factorObjectiveLogScore(baselineFactors, options.objective === "dps")),
          slack: BigInt(prepared.groups.length) };
        jobPrices.push(price);
        const upper = budget.query(maximumResource + maximumFoodResource);
        if (upper !== undefined && crtGroup >= 0 && crtAxis >= 0 && axisWeights[crtAxis]! > 0) {
          partitionCandidates.push({ price, groups: resourceGroups, gap: upper - price.baselineQ });
        }
        stats.resourceSupports += budget.supportCount;
        stats.resourcePriceCount++;
      }
      // Price selection uses only certified root bounds in the same q units.
      // All other prices retain their original full-domain certificates.
      partitionCandidates.sort((left, right) => left.gap < right.gap ? -1 : left.gap > right.gap ? 1 : 0);
      for (const candidate of partitionCandidates.slice(0, 2)) {
        checkpoint(true);
        stats.resourcePartitionAttempts++;
        const partitionStartedAt = performance.now();
        const strengthened = preparePartitionedFactorResourceBudgetUpperBound(candidate.groups, crtGroup,
          { maxPartitions: 8, maxWork: 250_000 });
        stats.resourcePartitionPreparationMs += performance.now() - partitionStartedAt;
        checkpoint(true);
        const original = candidate.price.budget;
        if (strengthened === undefined || strengthened.partitionCount === undefined ||
          strengthened.minimumCost !== original.minimumCost) continue;
        candidate.price.budget = {
          minimumCost: original.minimumCost,
          supportCount: original.supportCount + strengthened.supportCount,
          partitionCount: strengthened.partitionCount,
          query(resource) {
            const base = original.query(resource);
            if (base === undefined) return undefined;
            const improved = strengthened.query(resource);
            return improved === undefined || base < improved ? base : improved;
          },
        };
        stats.resourcePartitionPrices++;
        stats.resourcePartitions += strengthened.partitionCount;
        stats.resourcePartitionSupports += strengthened.supportCount;
        stats.resourceSupports += strengthened.supportCount;
      }
      prices.push(jobPrices);
    }
    stats.preparationMs = performance.now() - startedAt - stats.seedMs;
    stats.stage = "enumeration";
    enumerationStartedAt = performance.now();
    let thresholdKey = "";
    let lowerQ: bigint[] | undefined;
    const updateThreshold = () => {
      const key = best === undefined ? "" : `${best.score.numerator}/${best.score.denominator}`;
      if (key === thresholdKey) return;
      thresholdKey = key;
      if (best === undefined) { lowerQ = undefined; return; }
      const threshold = best.score.numerator - BigInt(contexts.length - 1) * best.score.denominator;
      if (threshold <= 0n) { lowerQ = undefined; return; }
      const [lower] = logRatioFixedBounds(threshold, best.score.denominator);
      const ell = floorDiv(LOG_SCALE * lower, FIXED_SCALE);
      lowerQ = prices.map((jobPrices) => (jobPrices[0]?.baselineQ ?? 0n) + ell - (jobPrices[0]?.slack ?? 0n));
    };
    for (const choice of foodChoices) for (const targetSpeed of suffixSpeeds[0]!) {
      checkpoint(true);
      const eligible = privateStates.map((states, job) => states.filter((state) => {
        checkpoint();
        const raw = new Array<number>(contexts[job]!.job.options.attributeIds.length).fill(0);
        raw[speedIndexes[job]!] = targetSpeed + state.speed;
        if (!Number.isSafeInteger(raw[speedIndexes[job]!]!)) throw new UnsupportedState("unsafe total speed");
        const attributes = finalAttributes(job, raw, foodFor(choice, job));
        const factors = contexts[job]!.factorEvaluator(attributes);
        return factors !== undefined && legalAttributes(job, attributes, factors.gcdCentiseconds, true);
      }));
      if (eligible.some((states) => states.length === 0)) { stats.speedPrunes++; continue; }
      stats.contexts++;
      const privateMax = prices.map((jobPrices, job) => jobPrices.map((price) =>
        eligible[job]!.reduce((maximum, state) => Math.max(maximum, safeDot(state.values, price.weights)), 0)));
      const foodCost = prices.map((jobPrices, job) => jobPrices.map((price) => {
        let value = 0;
        for (const parameter of foodFor(choice, job)?.baseParams ?? []) {
          const attribute = contexts[job]!.attributeIndexes.get(parameter.baseParamId);
          if (attribute === undefined) continue;
          if (!Number.isSafeInteger(parameter.maxValue) || parameter.maxValue < 0 || !Number.isFinite(parameter.multiplier) || parameter.multiplier < 1) {
            throw new UnsupportedState("food resource metadata");
          }
          value += parameter.maxValue * price.weights[attribute]!;
          if (!Number.isSafeInteger(value)) throw new UnsupportedState("unsafe food resource");
        }
        return value;
      }));
      let costKey: string | undefined;
      let neededCost: number[][] = [];
      const refreshNeededCosts = () => {
        updateThreshold();
        if (costKey === thresholdKey) return;
        costKey = thresholdKey;
        neededCost = prices.map((jobPrices, job) => jobPrices.map((price, priceIndex) => {
          if (lowerQ === undefined) return 0;
          let high = price.suffix[0]!.get(targetSpeed)! + privateMax[job]![priceIndex]! + foodCost[job]![priceIndex]!;
          if (!Number.isSafeInteger(high)) throw new UnsupportedState("unsafe full resource");
          const threshold = price.baselineQ + (lowerQ[job]! - (jobPrices[0]?.baselineQ ?? 0n)) + (jobPrices[0]?.slack ?? 0n) - price.slack;
          const upper = price.budget.query(high);
          const rootResource = high;
          const record = (needed: number) => {
            if (stats.resourcePriceDiagnostics.length < 60) stats.resourcePriceDiagnostics.push({
              job: contexts[job]!.job.id, proposal: price.name, weights: price.weights.join(","),
              sharedSpeed: targetSpeed, food: choice.key, resourceUpper: rootResource,
              surrogateUpper: upper === undefined ? "below-minimum-cost" : upper.toString(),
              baselineSurrogate: price.baselineQ.toString(), requiredSurrogate: threshold.toString(),
              neededResource: Number.isFinite(needed) ? needed : "unreachable",
              resourceGap: Number.isFinite(needed) ? rootResource - needed : "unreachable",
            });
            return needed;
          };
          if (upper !== undefined && upper < threshold) return record(Number.POSITIVE_INFINITY);
          let low = price.budget.minimumCost;
          if (high < low) return record(low);
          while (low < high) {
            const middle = low + Math.floor((high - low) / 2);
            const bound = price.budget.query(middle);
            if (bound !== undefined && bound >= threshold) high = middle;
            else low = middle + 1;
          }
          return record(low);
        }));
      };
      // Previous contexts retain only the physical incumbent arrays, never a
      // State or predecessor node. Count the current context's entire created
      // DAG (a conservative live-memory bound), not all historical work.
      contextStates = 1;
      stats.maximumContextStates = Math.max(stats.maximumContextStates, contextStates);
      if (contextStates > maxStates) throw new OptionalBudget("context state budget");
      let states: State[] = [{ vectors: contexts.map((context) => new Array(context.job.options.attributeIds.length).fill(0)), speed: 0 }];
      for (let group = 0; group < groups.length; group++) {
        refreshNeededCosts();
        const next = new Map<string, State>();
        for (const state of states) for (const option of groups[group]!.options) {
          checkpoint(); stats.transitions++;
          const speed = state.speed + option.speed;
          const remainingSpeed = targetSpeed - speed;
          if (!suffixSpeeds[group + 1]!.has(remainingSpeed)) { stats.speedPrunes++; continue; }
          const vectors = addShared(state.vectors, option.vectors);
          let possible = true;
          for (let job = 0; job < prices.length && possible; job++) for (let priceIndex = 0; priceIndex < prices[job]!.length; priceIndex++) {
            const price = prices[job]![priceIndex]!;
            const resource = safeDot(vectors[job]!, price.weights) + price.suffix[group + 1]!.get(remainingSpeed)! +
              privateMax[job]![priceIndex]! + foodCost[job]![priceIndex]!;
            if (!Number.isSafeInteger(resource)) throw new UnsupportedState("unsafe prefix resource");
            if (resource < neededCost[job]![priceIndex]!) { possible = false; break; }
          }
          if (!possible) { stats.resourcePrunes++; continue; }
          const key = sharedKey(vectors);
          if (next.has(key)) stats.mergedStates++;
          else {
            const node = { vectors, speed, previous: state, option };
            if (group === groups.length - 1) {
              const selected: Option[] = [];
              let current: State | undefined = node;
              while (current?.option !== undefined) { selected.push(current.option); current = current.previous; }
              consider(vectors, selected, choice, eligible);
              if (reachedCeiling) { stats.termination = "baseline-ceiling"; return complete("complete-feasible"); }
            }
            next.set(key, node);
            stats.states++;
            contextStates++;
            stats.maximumContextStates = Math.max(stats.maximumContextStates, contextStates);
            if (contextStates > maxStates) throw new OptionalBudget("context state budget");
          }
        }
        stats.maximumLayerStates = Math.max(stats.maximumLayerStates, next.size);
        states = [...next.values()];
        if (states.length === 0) break;
      }
    }
    stats.termination = "enumeration";
    return complete(best === undefined ? "complete-infeasible" : "complete-feasible");
  } catch (error) {
    if (error instanceof OptionalBudget) return complete("budget-exhausted", error.message);
    if (error instanceof UnsupportedState) return complete("unsupported", error.message);
    throw error;
  }
}

function safeDot(values: readonly number[], weights: readonly number[]): number {
  const value = optionalDot(values, weights);
  if (value === undefined) throw new UnsupportedState("unsafe resource dot product");
  return value;
}

function optionalDot(values: readonly number[], weights: readonly number[]): number | undefined {
  let total = 0;
  for (let index = 0; index < values.length; index++) {
    const product = values[index]! * weights[index]!;
    total += product;
    if (!Number.isSafeInteger(product) || !Number.isSafeInteger(total) || total < 0) {
      return undefined;
    }
  }
  return total;
}

/** These directions only propose nonnegative prices. Every pruning threshold is
 * still certified against every original factor class by the resource budget. */
export function sharedStateResourcePriceProposals(
  groups: readonly FactorGroup[],
  axes: readonly { name: string; baselineValue: number }[],
): readonly { name: string; weights: number[] }[] {
  const proposals = new Map<string, { name: string; weights: number[] }>();
  const add = (name: string, weights: readonly number[]) => {
    if (weights.length !== axes.length || weights.some((weight) => !Number.isSafeInteger(weight) || weight < 0) ||
      !weights.some((weight) => weight > 0)) return;
    let divisor = 0;
    for (const weight of weights) {
      let left = divisor;
      let right = weight;
      while (right !== 0) [left, right] = [right, left % right];
      divisor = left;
    }
    const normalized = weights.map((weight) => weight / divisor);
    const key = normalized.join(",");
    if (!proposals.has(key)) proposals.set(key, { name, weights: normalized });
  };
  add("uniform", axes.map(() => 1));
  factorResourceWeightVectors(groups, axes.map(({ name }) => name)).forEach((weights, index) => add(`global-${index}`, weights));
  for (const window of [1, 4]) {
    const slopes = axes.map(({ name, baselineValue }) => {
      if (!Number.isSafeInteger(baselineValue) || baselineValue < 0) return 0;
      const classes = groups.find((group) => group.name === name)?.classes;
      if (classes === undefined || classes.length < 2) return 0;
      const center = classes.findIndex((entry) => entry.min <= baselineValue && entry.max >= baselineValue);
      if (center < 0) return 0;
      const lower = classes[Math.max(0, center - window)]!;
      const upper = classes[Math.min(classes.length - 1, center + window)]!;
      const span = upper.min - lower.min;
      const gain = upper.q - lower.q;
      return Number.isSafeInteger(span) && span > 0 && Number.isSafeInteger(gain) && gain > 0 ? gain / span : 0;
    });
    const maximum = Math.max(0, ...slopes);
    if (!Number.isFinite(maximum) || maximum <= 0) continue;
    for (const scale of [256, 4096, 65536]) add(`baseline-window-${window}-scale-${scale}`,
      slopes.map((slope) => slope <= 0 ? 0 : Math.max(1, Math.round(slope / maximum * scale))));
  }
  return [...proposals.values()];
}
