import {
  createIntegerDamageFactorEvaluator,
  type IntegerDamageFactors,
} from "./equipped-effects.ts";
import {
  findBestLoadoutExactMip,
  findBestJointFactorMip,
  type ExactMipOptions,
  type ExactMipResult,
} from "./loadout-finder-exact-mip.ts";
import type { EquipInfo, FoodInfo, ParamInfo } from "./types.ts";

export type JointLoadoutJobV3 = {
  id: string;
  /** Slot names align with options.slots and allow jobs with different slot indexes. */
  slotNames: readonly string[];
  options: ExactMipOptions;
};

export type JointLoadoutV3Options = {
  jobs: readonly JointLoadoutJobV3[];
  /** Names of the slots whose complete EquipInfo, including materia variant, is shared. */
  commonSlots: readonly string[];
  foodStrategy: "shared" | "independent";
  /** Defaults to raw damage; DPS uses exact product/GCD fractions. */
  objective?: "damage" | "dps";
  /** One wall-clock budget for baselines and the complete outer search; capped at 235 seconds. */
  maxSearchMs?: number;
  /** FIFO-bounded cache for restricted inner MIP results. Defaults to 2048 entries. */
  cacheLimit?: number;
  onProgress?: (message: string) => void;
};

export type JointLoadoutV3Result = {
  /** Exact sum of per-job damage divided by that job's unconstrained optimum. */
  value: { numerator: string; denominator: string; approximate: number };
  commonEquipments: Record<string, EquipInfo>;
  /** Each selection is aligned to the corresponding job's original options.slots. */
  jobResults: Record<string, JointLoadoutJobResultV3>;
  optima: Record<string, JointLoadoutJobResultV3>;
  statistics: JointLoadoutV3Statistics;
  proof: {
    complete: true;
    objective: "damage" | "dps";
    optimalityScope: string;
    outerBound: string;
    innerSolverStatus: "Optimal";
    formalCertificate: false;
    numericalLimitation: string;
    terminationReason: string;
  };
};

export type JointLoadoutJobResultV3 = ExactMipResult & {
  gcd: number;
  damagePerSecond: number;
};

export type JointLoadoutV3Statistics = {
  elapsedMs: number;
  timeLimitMs: number;
  outerNodes: number;
  completeNodes: number;
  upperBoundPrunes: number;
  relaxedOptimaAttained: number;
  innerSolves: number;
  parentResultReuses: number;
  cacheHits: number;
  cacheMisses: number;
  cacheEntries: number;
  cacheLimit: number;
  rssBytes: number;
  heapUsedBytes: number;
};

type Rational = { numerator: bigint; denominator: bigint };
type CommonChoice = {
  key: string;
  equipments: Map<string, EquipInfo>;
};
type FoodChoice = {
  key: string;
  foods: Map<string, FoodInfo | undefined>;
};
type JobContext = {
  job: JointLoadoutJobV3;
  solverSlots: readonly (readonly EquipInfo[])[];
  indexByName: Map<string, number>;
  factorEvaluator: ReturnType<typeof createIntegerDamageFactorEvaluator>;
  attributeIndexes: Map<number, number>;
  equipAttributes: WeakMap<EquipInfo, readonly number[]>;
  optimum: ExactMipResult;
  optimumProduct: bigint;
  optimumGcd: number;
  active: boolean;
  constraints: ExactMipOptions["constraints"];
};
type MutableStatistics = Omit<JointLoadoutV3Statistics, "elapsedMs" | "timeLimitMs" | "rssBytes" | "heapUsedBytes" | "cacheLimit">;

const MAX_SEARCH_MS = 235_000;
const RSS_LIMIT_BYTES = 3.5 * 1024 * 1024 * 1024;

function bigintGcd(a: bigint, b: bigint): bigint {
  let left = a < 0n ? -a : a;
  let right = b < 0n ? -b : b;
  while (right !== 0n) [left, right] = [right, left % right];
  return left;
}

function rational(numerator: bigint, denominator: bigint): Rational {
  if (denominator === 0n) throw new RangeError("联合配装评分分母不能为零");
  if (denominator < 0n) return rational(-numerator, -denominator);
  if (numerator === 0n) return { numerator: 0n, denominator: 1n };
  const divisor = bigintGcd(numerator, denominator);
  return { numerator: numerator / divisor, denominator: denominator / divisor };
}

function addRational(left: Rational, right: Rational): Rational {
  const common = bigintGcd(left.denominator, right.denominator);
  const leftScale = right.denominator / common;
  const rightScale = left.denominator / common;
  return rational(
    left.numerator * leftScale + right.numerator * rightScale,
    left.denominator * leftScale,
  );
}

function compareRational(left: Rational, right: Rational): number {
  const a = left.numerator * right.denominator;
  const b = right.numerator * left.denominator;
  return a < b ? -1 : a > b ? 1 : 0;
}

function integerDamageProduct(factors: IntegerDamageFactors): bigint {
  const values = [
    factors.weaponDamage,
    factors.mainStat,
    factors.determination,
    factors.tenacity,
    factors.critical,
    factors.directHit,
  ];
  if (values.some((value) => !Number.isSafeInteger(value) || value < 1)) {
    throw new RangeError(`伤害因子不是正安全整数：${values.join(",")}`);
  }
  return values.reduce((product, value) => product * BigInt(value), 1n);
}

function sortedParams(params: readonly ParamInfo[]): readonly (readonly [number, number])[] {
  return params
    .map(({ baseParamId, value }) => [baseParamId, value] as const)
    .sort((left, right) => left[0] - right[0] || left[1] - right[1]);
}

/** Includes the full materia result and nested ring identities, not just itemId or summed ring stats. */
function equipmentIdentity(equipment: EquipInfo): string {
  const ringEquips = (equipment as EquipInfo & { ringEquips?: readonly EquipInfo[] }).ringEquips;
  const ringKeys = ringEquips?.map(equipmentIdentity).sort();
  return JSON.stringify({
    ...(ringKeys === undefined ? { itemId: equipment.itemId } : {}),
    itemLevel: equipment.itemLevel,
    baseParams: sortedParams(equipment.baseParams),
    PDMG: equipment.PDMG,
    MDMG: equipment.MDMG,
    DLY: equipment.DLY,
    ...(ringKeys === undefined ? {} : { ringEquips: ringKeys }),
  });
}

function foodIdentity(food: FoodInfo): string {
  return JSON.stringify({
    itemId: food.itemId,
    itemLevel: food.itemLevel,
    baseParams: food.baseParams
      .map(({ baseParamId, multiplier, maxValue }) => [baseParamId, multiplier, maxValue] as const)
      .sort((left, right) => left[0] - right[0] || left[1] - right[1] || left[2] - right[2]),
  });
}

function applyFood(attributes: readonly number[], food: FoodInfo | undefined, indexes: ReadonlyMap<number, number>): number[] {
  const final = [...attributes];
  if (food === undefined) return final;
  for (const param of food.baseParams) {
    const index = indexes.get(param.baseParamId);
    if (index === undefined) continue;
    final[index] += Math.min(
      param.maxValue,
      Math.trunc(final[index]! * (param.multiplier - 1) + 1e-7),
    );
  }
  return final;
}

function buildRawAttributes(context: JobContext, selection: readonly EquipInfo[]): number[] {
  const attributes = new Array<number>(context.job.options.attributeIds.length).fill(0);
  for (const equipment of selection) {
    let values = context.equipAttributes.get(equipment);
    if (values === undefined) {
      const next = new Array<number>(attributes.length).fill(0);
      const params = context.job.options.equipmentAttributeExtractor?.(equipment) ?? equipment.baseParams;
      for (const param of params) {
        const index = context.attributeIndexes.get(param.baseParamId);
        if (index !== undefined) next[index] += param.value;
      }
      if (next.some((value) => !Number.isSafeInteger(value))) {
        throw new RangeError(`装备 ${equipment.itemId} 的属性不是安全整数`);
      }
      values = next;
      context.equipAttributes.set(equipment, values);
    }
    for (let index = 0; index < attributes.length; index++) attributes[index] += values[index]!;
  }
  return attributes;
}

function pruneInnerSlots(context: JobContext): readonly (readonly EquipInfo[])[] {
  // BLU's INT-to-weapon lookup is table-based and is not monotone over its full range.
  if (context.job.options.job === "BLU") return context.job.options.slots;
  const constraints = context.constraints ?? {};
  const mustKeepSpeedEqual = constraints.gcd !== undefined ||
    (constraints.gcdChoices?.length ?? 0) > 0 || constraints.speedMax !== undefined;
  const speedIndex = context.job.options.speedAttributeId === undefined
    ? undefined
    : context.attributeIndexes.get(context.job.options.speedAttributeId);

  return context.job.options.slots.map((slot) => {
    if (slot.length < 2) return slot;
    const candidates = slot.map((equipment, inputOrder) => ({
      equipment,
      inputOrder,
      attributes: buildRawAttributes(context, [equipment]),
    }));
    candidates.sort((left, right) => {
      const leftSum = left.attributes.reduce((total, value) => total + value, 0);
      const rightSum = right.attributes.reduce((total, value) => total + value, 0);
      return rightSum - leftSum || left.inputOrder - right.inputOrder;
    });
    const frontier: typeof candidates = [];
    const dominates = (left: readonly number[], right: readonly number[]) => {
      let strict = false;
      for (let index = 0; index < left.length; index++) {
        if (mustKeepSpeedEqual && index === speedIndex && left[index] !== right[index]) return false;
        if (left[index]! < right[index]!) return false;
        if (left[index]! > right[index]!) strict = true;
      }
      return strict || left.every((value, index) => value === right[index]);
    };
    for (const candidate of candidates) {
      if (frontier.some((kept) => dominates(kept.attributes, candidate.attributes))) continue;
      for (let index = frontier.length - 1; index >= 0; index--) {
        if (dominates(candidate.attributes, frontier[index]!.attributes)) frontier.splice(index, 1);
      }
      frontier.push(candidate);
    }
    return frontier.map(({ equipment }) => equipment);
  });
}

function speedMustRemainEqual(context: JobContext): boolean {
  const constraints = context.constraints ?? {};
  return constraints.gcd !== undefined ||
    (constraints.gcdChoices?.length ?? 0) > 0 ||
    constraints.speedMax !== undefined;
}

function commonChoiceMetrics(
  choice: CommonChoice,
  contexts: readonly JobContext[],
): readonly (readonly number[])[] {
  return contexts.map((context) => {
    const equipment = choice.equipments.get(context.job.id)!;
    return [...buildRawAttributes(context, [equipment]), equipment.PDMG, equipment.MDMG];
  });
}

function pruneCommonChoices(
  slotName: string,
  choices: readonly CommonChoice[],
  contexts: readonly JobContext[],
  checkBudget: () => void,
): CommonChoice[] {
  if (choices.length < 2 || contexts.some((context) => context.job.options.job === "BLU")) {
    return [...choices];
  }
  const metrics = choices.map((choice) => commonChoiceMetrics(choice, contexts));
  const baselineMatches = choices.map((choice) => contexts.reduce((count, context) => {
    const slotIndex = context.indexByName.get(slotName)!;
    return count + Number(choice.key === equipmentIdentity(context.optimum.selection[slotIndex]!));
  }, 0));
  const dominates = (leftIndex: number, rightIndex: number): boolean => {
    let strict = false;
    for (let jobIndex = 0; jobIndex < contexts.length; jobIndex++) {
      const context = contexts[jobIndex]!;
      const left = metrics[leftIndex]![jobIndex]!;
      const right = metrics[rightIndex]![jobIndex]!;
      const speedIndex = context.job.options.speedAttributeId === undefined
        ? undefined
        : context.attributeIndexes.get(context.job.options.speedAttributeId);
      for (let attribute = 0; attribute < left.length; attribute++) {
        if (speedMustRemainEqual(context) && attribute === speedIndex && left[attribute] !== right[attribute]) {
          return false;
        }
        if (left[attribute]! < right[attribute]!) return false;
        if (left[attribute]! > right[attribute]!) strict = true;
      }
    }
    return strict;
  };
  const keep = choices.map((_, candidateIndex) => {
    if ((candidateIndex & 15) === 0) checkBudget();
    for (let otherIndex = 0; otherIndex < choices.length; otherIndex++) {
      if (candidateIndex === otherIndex) continue;
      if (dominates(otherIndex, candidateIndex)) return false;
      const equalMetrics = metrics[otherIndex]!.every((values, jobIndex) =>
        values.every((value, attribute) => value === metrics[candidateIndex]![jobIndex]![attribute]));
      if (
        equalMetrics &&
        (baselineMatches[otherIndex]! > baselineMatches[candidateIndex]! ||
          (baselineMatches[otherIndex] === baselineMatches[candidateIndex] && otherIndex < candidateIndex))
      ) return false;
    }
    return true;
  });
  return choices.filter((_, index) => keep[index]);
}

function rawAttributeMaximums(context: JobContext, checkBudget: () => void): number[] {
  const maximums = new Array<number>(context.job.options.attributeIds.length).fill(0);
  for (const slot of context.job.options.slots) {
    checkBudget();
    for (let attribute = 0; attribute < maximums.length; attribute++) {
      const maximum = Math.max(0, ...slot.map((equipment) =>
        buildRawAttributes(context, [equipment])[attribute]!));
      maximums[attribute] += maximum;
    }
  }
  return maximums;
}

function foodBonus(food: FoodInfo | undefined, attributeId: number, raw: number): number {
  const param = food?.baseParams.find((entry) => entry.baseParamId === attributeId);
  if (param === undefined) return 0;
  return Math.min(param.maxValue, Math.trunc(raw * (param.multiplier - 1) + 1e-7));
}

function sharedFoodDominates(
  left: FoodChoice,
  right: FoodChoice,
  contexts: readonly JobContext[],
  rawMaximums: ReadonlyMap<string, readonly number[]>,
  checkBudget: () => void,
): boolean {
  if (contexts.some((context) => context.job.options.job === "BLU")) return false;
  let strict = false;
  for (const context of contexts) {
    const leftFood = left.foods.get(context.job.id);
    const rightFood = right.foods.get(context.job.id);
    const speedId = context.job.options.speedAttributeId;
    const maximums = rawMaximums.get(context.job.id)!;
    const attributeIds = new Set([
      ...(leftFood?.baseParams.map((param) => param.baseParamId) ?? []),
      ...(rightFood?.baseParams.map((param) => param.baseParamId) ?? []),
    ]);
    for (const attributeId of attributeIds) {
      const attribute = context.attributeIndexes.get(attributeId);
      if (attribute === undefined) continue;
      const maximum = maximums[attribute]!;
      for (let raw = 0; raw <= maximum; raw++) {
        if ((raw & 2047) === 0) checkBudget();
        const leftBonus = foodBonus(leftFood, attributeId, raw);
        const rightBonus = foodBonus(rightFood, attributeId, raw);
        if (speedMustRemainEqual(context) && attributeId === speedId && leftBonus !== rightBonus) {
          return false;
        }
        if (leftBonus < rightBonus) return false;
        if (leftBonus > rightBonus) strict = true;
      }
    }
  }
  return strict;
}

function sharedFoodsEquivalent(
  left: FoodChoice,
  right: FoodChoice,
  contexts: readonly JobContext[],
  rawMaximums: ReadonlyMap<string, readonly number[]>,
  checkBudget: () => void,
): boolean {
  for (const context of contexts) {
    const leftFood = left.foods.get(context.job.id);
    const rightFood = right.foods.get(context.job.id);
    const maximums = rawMaximums.get(context.job.id)!;
    const attributeIds = new Set([
      ...(leftFood?.baseParams.map((param) => param.baseParamId) ?? []),
      ...(rightFood?.baseParams.map((param) => param.baseParamId) ?? []),
    ]);
    for (const attributeId of attributeIds) {
      const attribute = context.attributeIndexes.get(attributeId);
      if (attribute === undefined) continue;
      for (let raw = 0; raw <= maximums[attribute]!; raw++) {
        if ((raw & 2047) === 0) checkBudget();
        if (foodBonus(leftFood, attributeId, raw) !== foodBonus(rightFood, attributeId, raw)) {
          return false;
        }
      }
    }
  }
  return true;
}

function pruneSharedFoods(
  choices: readonly FoodChoice[],
  contexts: readonly JobContext[],
  checkBudget: () => void,
): FoodChoice[] {
  if (choices.length < 2 || contexts.some((context) => context.job.options.job === "BLU")) {
    return [...choices];
  }
  const rawMaximums = new Map(contexts.map((context) => [
    context.job.id,
    rawAttributeMaximums(context, checkBudget),
  ]));
  const baselineMatches = choices.map((choice) => contexts.reduce((count, context) =>
    count + Number(choice.key === foodIdentityForOptional(context.optimum.food)), 0));
  return choices.filter((candidate, candidateIndex) => {
    if ((candidateIndex & 3) === 0) checkBudget();
    for (let otherIndex = 0; otherIndex < choices.length; otherIndex++) {
      if (candidateIndex === otherIndex) continue;
      if (sharedFoodDominates(choices[otherIndex]!, candidate, contexts, rawMaximums, checkBudget)) return false;
      const equalEffects = sharedFoodsEquivalent(choices[otherIndex]!, candidate, contexts, rawMaximums, checkBudget);
      if (
        equalEffects &&
        (baselineMatches[otherIndex]! > baselineMatches[candidateIndex]! ||
          (baselineMatches[otherIndex] === baselineMatches[candidateIndex] && otherIndex < candidateIndex))
      ) return false;
    }
    return true;
  });
}

function factorsForResult(context: JobContext, result: ExactMipResult): IntegerDamageFactors {
  const raw = buildRawAttributes(context, result.selection);
  const final = applyFood(raw, result.food, context.attributeIndexes);
  const factors = context.factorEvaluator(final);
  if (factors === undefined) throw new Error(`职业 ${context.job.id} 的正式伤害因子无法计算`);
  return factors;
}

function makeJobOptions(
  context: JobContext,
  fixed: ReadonlyMap<string, CommonChoice>,
  foodChoice: FoodChoice | undefined,
  maxSearchMs: number,
  objective: "damage" | "dps",
): ExactMipOptions {
  const slots = [...context.solverSlots];
  for (const [name, choice] of fixed) {
    const slotIndex = context.indexByName.get(name)!;
    slots[slotIndex] = [choice.equipments.get(context.job.id)!];
  }

  let foods: readonly FoodInfo[] = context.job.options.foods;
  if (foodChoice !== undefined) {
    const fixedFood = foodChoice.foods.get(context.job.id);
    foods = fixedFood === undefined ? [] : [fixedFood];
  }

  const originalConstraints = context.constraints ?? {};
  let constraints = originalConstraints;
  if (originalConstraints.maxToughnessMode === true) {
    const maximumToughness = context.optimum.maximumToughness;
    if (maximumToughness === undefined) {
      throw new Error(`职业 ${context.job.id} 的最高坚韧基线没有返回最大值`);
    }
    constraints = {
      ...originalConstraints,
      maxToughnessMode: false,
      toughMin: Math.max(originalConstraints.toughMin ?? Number.NEGATIVE_INFINITY, maximumToughness),
    };
  }

  return {
    ...context.job.options,
    slots,
    foods,
    constraints,
    objective,
    maxSearchMs: Math.min(maxSearchMs, context.job.options.maxSearchMs ?? MAX_SEARCH_MS),
  };
}

function statisticsSnapshot(
  mutable: MutableStatistics,
  startedAt: number,
  timeLimitMs: number,
  cacheLimit: number,
  cacheEntries: number,
): JointLoadoutV3Statistics {
  const memory = process.memoryUsage();
  return {
    ...mutable,
    elapsedMs: performance.now() - startedAt,
    timeLimitMs,
    cacheLimit,
    cacheEntries,
    rssBytes: memory.rss,
    heapUsedBytes: memory.heapUsed,
  };
}

/** Exact joint search over the supplied per-job candidates. It throws instead of returning an unproven partial result on timeout. */
export async function findBestJointLoadoutV3(
  options: JointLoadoutV3Options,
): Promise<JointLoadoutV3Result | undefined> {
  const startedAt = performance.now();
  const requestedMs = options.maxSearchMs ?? MAX_SEARCH_MS;
  if (!Number.isFinite(requestedMs) || requestedMs <= 0) {
    throw new RangeError("V3 maxSearchMs 必须是正有限数");
  }
  const timeLimitMs = Math.min(requestedMs, MAX_SEARCH_MS);
  const deadline = startedAt + timeLimitMs;
  const objective = options.objective ?? "damage";
  if (objective !== "damage" && objective !== "dps") {
    throw new RangeError("V3 objective 必须是 damage 或 dps");
  }
  if (options.foodStrategy !== "shared" && options.foodStrategy !== "independent") {
    throw new RangeError("V3 foodStrategy 必须是 shared 或 independent");
  }
  const cacheLimit = options.cacheLimit ?? 2048;
  if (!Number.isSafeInteger(cacheLimit) || cacheLimit < 0 || cacheLimit > 50_000) {
    throw new RangeError("V3 cacheLimit 必须是 0 到 50000 之间的整数");
  }
  if (options.jobs.length === 0) throw new RangeError("V3 至少需要一个职业");

  const mutable: MutableStatistics = {
    outerNodes: 0,
    completeNodes: 0,
    upperBoundPrunes: 0,
    relaxedOptimaAttained: 0,
    innerSolves: 0,
    parentResultReuses: 0,
    cacheHits: 0,
    cacheMisses: 0,
    cacheEntries: 0,
  };
  const assertWithinBudget = (stage: string) => {
    if (performance.now() >= deadline) {
      throw new Error(`V3 搜索超过 ${timeLimitMs}ms，未完成最优性证明（${stage}）；未返回近似结果`);
    }
    const memory = process.memoryUsage();
    if (memory.rss > RSS_LIMIT_BYTES) {
      throw new Error(`V3 RSS 达到 3.5 GiB 限制（${stage}）；未返回近似结果`);
    }
  };

  const jobIds = new Set<string>();
  const contexts: JobContext[] = [];
  for (const job of options.jobs) {
    assertWithinBudget("输入校验");
    if (job.id.length === 0 || jobIds.has(job.id)) throw new RangeError(`V3 职业 id 为空或重复：${job.id}`);
    jobIds.add(job.id);
    if (job.slotNames.length !== job.options.slots.length) {
      throw new RangeError(`职业 ${job.id} 的 slotNames 与 slots 长度不一致`);
    }
    const indexByName = new Map<string, number>();
    job.slotNames.forEach((name, index) => {
      if (name.length === 0 || indexByName.has(name)) throw new RangeError(`职业 ${job.id} 有空或重复槽位名：${name}`);
      indexByName.set(name, index);
    });
    if (job.options.slots.some((slot) => slot.length === 0)) return undefined;
    const attributeIndexes = new Map(job.options.attributeIds.map((id, index) => [id, index]));
    if (attributeIndexes.size !== job.options.attributeIds.length) {
      throw new RangeError(`职业 ${job.id} 的 attributeIds 包含重复项`);
    }
    contexts.push({
      job,
      solverSlots: job.options.slots,
      indexByName,
      factorEvaluator: createIntegerDamageFactorEvaluator(job.options.job, job.options.jobLevel, job.options.statIndexes),
      attributeIndexes,
      equipAttributes: new WeakMap(),
      optimum: undefined as unknown as ExactMipResult,
      optimumProduct: 0n,
      optimumGcd: 0,
      active: true,
      constraints: job.options.constraints,
    });
  }

  for (const context of contexts) {
    assertWithinBudget("单职业候选等价剪枝");
    context.solverSlots = pruneInnerSlots(context);
  }
  if (new Set(options.commonSlots).size !== options.commonSlots.length) {
    throw new RangeError("V3 commonSlots 包含重复槽位名");
  }
  for (const name of options.commonSlots) {
    if (contexts.some((context) => !context.indexByName.has(name))) {
      throw new RangeError(`通用槽位 ${name} 在所有职业中必须存在`);
    }
  }

  const commonChoicesByName = new Map<string, CommonChoice[]>();
  for (const name of options.commonSlots) {
    assertWithinBudget("通用装备匹配");
    const first = contexts[0]!;
    const firstSlot = first.job.options.slots[first.indexByName.get(name)!]!;
    const candidates = new Map<string, CommonChoice>();
    for (const equipment of firstSlot) {
      const key = equipmentIdentity(equipment);
      if (!candidates.has(key)) candidates.set(key, { key, equipments: new Map([[first.job.id, equipment]]) });
    }
    for (let index = 1; index < contexts.length; index++) {
      const context = contexts[index]!;
      const slot = context.job.options.slots[context.indexByName.get(name)!]!;
      const available = new Map<string, EquipInfo>();
      for (const equipment of slot) {
        const key = equipmentIdentity(equipment);
        if (!available.has(key)) available.set(key, equipment);
      }
      for (const [key, choice] of candidates) {
        const equipment = available.get(key);
        if (equipment === undefined) candidates.delete(key);
        else choice.equipments.set(context.job.id, equipment);
      }
    }
    if (candidates.size === 0) return undefined;
    commonChoicesByName.set(name, [...candidates.values()]);
  }

  const foodChoices: FoodChoice[] = [];
  if (options.foodStrategy === "shared") {
    if (contexts.every((context) => context.job.options.foods.length === 0)) {
      foodChoices.push({ key: "no-food", foods: new Map(contexts.map((context) => [context.job.id, undefined])) });
    } else {
      const firstFoods = contexts[0]!.job.options.foods;
      const candidates = new Map<string, FoodChoice>();
      for (const food of firstFoods) {
        const key = foodIdentity(food);
        if (!candidates.has(key)) candidates.set(key, { key, foods: new Map([[contexts[0]!.job.id, food]]) });
      }
      for (let index = 1; index < contexts.length; index++) {
        const context = contexts[index]!;
        const available = new Map<string, FoodInfo>();
        for (const food of context.job.options.foods) {
          const key = foodIdentity(food);
          if (!available.has(key)) available.set(key, food);
        }
        for (const [key, choice] of candidates) {
          const food = available.get(key);
          if (food === undefined) candidates.delete(key);
          else choice.foods.set(context.job.id, food);
        }
      }
      foodChoices.push(...candidates.values());
    }
    if (foodChoices.length === 0) return undefined;
  } else {
    foodChoices.push({ key: "independent-food", foods: new Map() });
  }

  assertWithinBudget("单职业最优基线");
  for (const context of contexts) {
    const remainingMs = Math.floor(deadline - performance.now());
    if (remainingMs <= 0) {
      throw new Error(`V3 搜索超过 ${timeLimitMs}ms，未完成最优性证明（单职业最优基线）；未返回近似结果`);
    }
    mutable.innerSolves++;
    mutable.cacheMisses++;
    options.onProgress?.(`V3：正在计算 ${context.job.id} 的单职业最优伤害基线`);
    const optimum = await findBestLoadoutExactMip({
      ...context.job.options,
      slots: context.solverSlots,
      objective,
      maxSearchMs: Math.min(remainingMs, context.job.options.maxSearchMs ?? MAX_SEARCH_MS),
      onProgress: options.onProgress === undefined
        ? context.job.options.onProgress
        : (message) => options.onProgress?.(`${context.job.id}: ${message}`),
    });
    assertWithinBudget("单职业最优基线");
    if (optimum === undefined) return undefined;
    context.optimum = optimum;
    const optimumFactors = factorsForResult(context, optimum);
    context.optimumProduct = integerDamageProduct(optimumFactors);
    context.optimumGcd = optimumFactors.gcdCentiseconds;
    context.active = optimum.damage > 0;
    if (context.optimumProduct <= 0n || context.optimumGcd <= 0) {
      throw new Error(`职业 ${context.job.id} 的伤害基线无效`);
    }
  }

  for (const [name, choices] of commonChoicesByName) {
    commonChoicesByName.set(name, pruneCommonChoices(
      name,
      choices,
      contexts,
      () => assertWithinBudget("通用装备等价剪枝"),
    ));
  }
  if (options.foodStrategy === "shared") {
    foodChoices.splice(0, foodChoices.length, ...pruneSharedFoods(
      foodChoices,
      contexts,
      () => assertWithinBudget("通用食物等价剪枝"),
    ));
    const matchingBaselineCount = (choice: FoodChoice) => contexts.reduce((count, context) =>
      count + Number(choice.key === foodIdentityForOptional(context.optimum.food)), 0);
    foodChoices.sort((left, right) => matchingBaselineCount(right) - matchingBaselineCount(left));
  }

  const slotOrder = [...options.commonSlots].sort((left, right) =>
    commonChoicesByName.get(left)!.length - commonChoicesByName.get(right)!.length ||
    options.commonSlots.indexOf(left) - options.commonSlots.indexOf(right));
  const slotOrderIndex = new Map(slotOrder.map((name, index) => [name, index]));
  for (const name of options.commonSlots) {
    const choices = commonChoicesByName.get(name)!;
    const baselineKeys = contexts.map((context) => equipmentIdentity(
      context.optimum.selection[context.indexByName.get(name)!]!,
    ));
    choices.sort((left, right) => {
      const leftMatches = baselineKeys.reduce((count, key) => count + Number(left.key === key), 0);
      const rightMatches = baselineKeys.reduce((count, key) => count + Number(right.key === key), 0);
      return rightMatches - leftMatches;
    });
  }

  const cache = new Map<string, ExactMipResult | null>();
  let best: {
    score: Rational;
    commonEquipments: Record<string, EquipInfo>;
    jobResults: Record<string, ExactMipResult>;
  } | undefined;
  let stopAtProvenCeiling = false;

  const resultForNode = async (
    context: JobContext,
    fixed: ReadonlyMap<string, CommonChoice>,
    foodChoice: FoodChoice | undefined,
    parentResult: ExactMipResult | undefined,
  ): Promise<ExactMipResult | undefined> => {
    const foodKey = foodChoice?.key ?? "independent-food";
    const fixedKey = [...fixed]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, choice]) => `${name}=${choice.key}`)
      .join(";");
    const key = `${context.job.id}|${foodKey}|${fixedKey}`;
    const cached = cache.get(key);
    if (cached !== undefined || cache.has(key)) {
      mutable.cacheHits++;
      cache.delete(key);
      cache.set(key, cached ?? null);
      return cached ?? undefined;
    }

    if (parentResult !== undefined) {
      const satisfiesFixed = [...fixed].every(([name, choice]) =>
        equipmentIdentity(parentResult.selection[context.indexByName.get(name)!]!) === choice.key);
      const chosenFood = foodChoice?.foods.get(context.job.id);
      const satisfiesFood = foodChoice === undefined ||
        foodIdentityForOptional(parentResult.food) === foodIdentityForOptional(chosenFood);
      if (satisfiesFixed && satisfiesFood) {
        mutable.parentResultReuses++;
        remember(key, parentResult);
        return parentResult;
      }
    }

    for (const [name, choice] of fixed) {
      const baselineEquipment = context.optimum.selection[context.indexByName.get(name)!]!;
      if (equipmentIdentity(baselineEquipment) !== choice.key) return solveAndRemember();
    }
    if (foodChoice !== undefined) {
      const chosenFood = foodChoice.foods.get(context.job.id);
      if (foodIdentityForOptional(context.optimum.food) !== foodIdentityForOptional(chosenFood)) return solveAndRemember();
    }
    remember(key, context.optimum);
    return context.optimum;

    async function solveAndRemember(): Promise<ExactMipResult | undefined> {
      assertWithinBudget("受限单职业求解");
      const remainingMs = Math.floor(deadline - performance.now());
      if (remainingMs <= 0) {
        throw new Error(`V3 搜索超过 ${timeLimitMs}ms，未完成最优性证明（受限单职业求解）；未返回近似结果`);
      }
      mutable.innerSolves++;
      mutable.cacheMisses++;
      const mipOptions = makeJobOptions(context, fixed, foodChoice, remainingMs, objective);
      if (options.onProgress !== undefined) {
        mipOptions.onProgress = (message) => options.onProgress?.(`${context.job.id}: ${message}`);
      }
      const result = await findBestLoadoutExactMip(mipOptions);
      assertWithinBudget("受限单职业求解");
      remember(key, result ?? null);
      return result;
    }

    function remember(cacheKey: string, result: ExactMipResult | null): void {
      if (cacheLimit === 0) return;
      cache.set(cacheKey, result);
      while (cache.size > cacheLimit) cache.delete(cache.keys().next().value!);
      mutable.cacheEntries = cache.size;
    }
  };

  const exactScore = (results: readonly ExactMipResult[]): Rational => {
    let total = rational(0n, 1n);
    for (let index = 0; index < contexts.length; index++) {
      const context = contexts[index]!;
      if (!context.active) continue;
      const factors = factorsForResult(context, results[index]!);
      const product = integerDamageProduct(factors);
      const normalized = objective === "dps"
        ? rational(
            product * BigInt(context.optimumGcd),
            BigInt(factors.gcdCentiseconds) * context.optimumProduct,
          )
        : rational(product, context.optimumProduct);
      total = addRational(total, normalized);
    }
    return total;
  };

  const updateBest = (
    score: Rational,
    results: readonly ExactMipResult[],
  ) => {
    if (best !== undefined && compareRational(score, best.score) <= 0) return;
    const commonEquipments: Record<string, EquipInfo> = {};
    for (const name of options.commonSlots) {
      const firstContext = contexts[0]!;
      const selected = results[0]!.selection[firstContext.indexByName.get(name)!]!;
      const selectedKey = equipmentIdentity(selected);
      for (let index = 1; index < contexts.length; index++) {
        const context = contexts[index]!;
        const other = results[index]!.selection[context.indexByName.get(name)!]!;
        if (equipmentIdentity(other) !== selectedKey) {
          throw new Error(`内部错误：共享槽位 ${name} 在候选结果中不一致`);
        }
      }
      commonEquipments[name] = selected;
    }
    best = {
      score,
      commonEquipments,
      jobResults: Object.fromEntries(contexts.map((context, index) => [context.job.id, results[index]!])),
    };
    const activeCount = contexts.reduce((count, context) => count + Number(context.active), 0);
    const ceiling = rational(BigInt(activeCount), 1n);
    if (options.onProgress !== undefined) {
      const approximate = Number(score.numerator) / Number(score.denominator);
      const scoreLabel = Number.isFinite(approximate)
        ? approximate.toPrecision(10)
        : `${score.numerator}/${score.denominator}`;
      options.onProgress(
        `V3 incumbent 更新：归一化目标=${scoreLabel}；外层节点=${mutable.outerNodes}；内层 MIP=${mutable.innerSolves}；耗时=${Math.round(performance.now() - startedAt)}ms`,
      );
    }
    if (compareRational(score, ceiling) === 0) stopAtProvenCeiling = true;
  };

  let jointFactorProof = false;
  if (contexts.every((context) => context.active) && options.commonSlots.length > 0) {
    for (const anchor of contexts) {
      const initialFixed = new Map<string, CommonChoice>();
      for (const name of options.commonSlots) {
        const key = equipmentIdentity(anchor.optimum.selection[anchor.indexByName.get(name)!]!);
        const choices = commonChoicesByName.get(name)!;
        initialFixed.set(name, choices.find((choice) => choice.key === key) ?? choices[0]!);
      }
      const initialFood = foodChoices.find((choice) =>
        choice.key === foodIdentityForOptional(anchor.optimum.food)) ?? foodChoices[0];
      const candidateResults: ExactMipResult[] = [];
      for (const context of contexts) {
        const result = await resultForNode(context, initialFixed,
          options.foodStrategy === "shared" ? initialFood : undefined, undefined);
        if (result === undefined) break;
        candidateResults.push(result);
      }
      if (candidateResults.length === contexts.length) updateBest(exactScore(candidateResults), candidateResults);
      if (stopAtProvenCeiling) break;
    }
    const initialResults = best === undefined ? [] : contexts.map((context) => best!.jobResults[context.job.id]!);
    const remainingMs = Math.floor(deadline - performance.now());
    const joint = stopAtProvenCeiling ? undefined : await findBestJointFactorMip({
      jobs: contexts.map((context) => {
        const jobOptions = makeJobOptions(context, new Map(), undefined, remainingMs, objective);
        const slots = [...jobOptions.slots];
        for (const name of options.commonSlots) {
          slots[context.indexByName.get(name)!] = commonChoicesByName.get(name)!
            .map((choice) => choice.equipments.get(context.job.id)!);
        }
        return {
          id: context.job.id,
          slotNames: context.job.slotNames,
          baseline: factorsForResult(context, context.optimum),
          options: { ...jobOptions, slots, foods: options.foodStrategy === "shared"
            ? foodChoices.map((choice) => choice.foods.get(context.job.id)).filter((food): food is FoodInfo => food !== undefined)
            : jobOptions.foods },
        };
      }),
      commonSlots: options.commonSlots,
      sharedFood: options.foodStrategy === "shared",
      equipmentIdentity,
      foodIdentity,
      objective,
      ...(initialResults.length === contexts.length ? { initialResults } : {}),
      maxSearchMs: remainingMs,
      ...(options.onProgress === undefined ? {} : { onProgress: options.onProgress }),
    });
    assertWithinBudget("联合因子模型复核");
    if (joint !== undefined) {
      mutable.innerSolves += joint.solverRuns;
      mutable.completeNodes++;
      const results = joint.results.map((result, index) => ({ ...result,
        ...(contexts[index]!.optimum.maximumToughness === undefined ? {} : {
          maximumToughness: contexts[index]!.optimum.maximumToughness,
        }),
      }));
      updateBest(exactScore(results), results);
    }
    jointFactorProof = true;
  } else {
    for (const foodChoice of foodChoices) {
      if (stopAtProvenCeiling) break;
      const fixed = new Map<string, CommonChoice>();
      await visit(fixed, foodChoice);
    }
  }

  assertWithinBudget("结果整理");
  if (best === undefined) return undefined;
  const stats = statisticsSnapshot(mutable, startedAt, timeLimitMs, cacheLimit, cache.size);
  const withMetrics = (context: JobContext, result: ExactMipResult): JointLoadoutJobResultV3 => {
    const factors = factorsForResult(context, result);
    const gcd = factors.gcdCentiseconds / 100;
    return {
      ...result,
      gcd,
      damagePerSecond: gcd > 0 ? result.damage / gcd : 0,
    };
  };
  return {
    value: {
      numerator: best.score.numerator.toString(),
      denominator: best.score.denominator.toString(),
      approximate: Number(best.score.numerator) / Number(best.score.denominator),
    },
    commonEquipments: best.commonEquipments,
    jobResults: Object.fromEntries(contexts.map((context) => [
      context.job.id,
      withMetrics(context, best!.jobResults[context.job.id]!),
    ])),
    optima: Object.fromEntries(contexts.map((context) => [context.job.id, withMetrics(context, context.optimum)])),
    statistics: stats,
    proof: {
      complete: true,
      objective,
      optimalityScope: "传入的每职业槽位候选、通用 EquipInfo 完整身份交集、食物列表和约束范围",
      outerBound: jointFactorProof
        ? "单职业最优基线归一化后，每职业比例不超过 1；总和不超过职业数减 1 加比例乘积，乘积仅筛选可能改进的因子签名；最终总和使用 BigInt 有理数比较"
        : objective === "dps"
        ? "每个外层节点以各职业在已固定通用装备下独立重优化的 DPS 上界求和；product/GCD 归一化分数用 BigInt 有理数比较"
        : "每个外层节点以各职业在已固定通用装备下独立重优化的伤害上界求和；归一化分数用 BigInt 有理数比较",
      innerSolverStatus: "Optimal",
      formalCertificate: false,
      numericalLimitation: "HiGHS 报告 Optimal 且整数模型行、属性重建和约束范围均已复核；HiGHS 浮点优化本身不是形式化有理数证明",
      terminationReason: stopAtProvenCeiling
        ? "已达到各职业单独最优基线之和这一全局上界"
        : jointFactorProof
        ? "完整共享模型已穷尽归一化总和可能改进的因子签名；乘积仅用于必要条件筛选，最终比较精确有理数总和"
        : "所有未剪枝通用装备分支均已完成，剩余分支由精确有理数上界剪除",
    },
  };

  async function visit(
    fixed: Map<string, CommonChoice>,
    foodChoice: FoodChoice,
    parentResults?: readonly ExactMipResult[],
  ): Promise<void> {
    if (stopAtProvenCeiling) return;
    assertWithinBudget("外层分支定界");
    mutable.outerNodes++;
    if ((mutable.outerNodes & 31) === 0) {
      assertWithinBudget("外层分支定界");
      mutable.cacheEntries = cache.size;
      if (options.onProgress !== undefined) {
        const score = best === undefined
          ? "无 incumbent"
          : (() => {
              const approximate = Number(best.score.numerator) / Number(best.score.denominator);
              return Number.isFinite(approximate)
                ? approximate.toPrecision(10)
                : `${best.score.numerator}/${best.score.denominator}`;
            })();
        options.onProgress(
          `V3 搜索进度：外层节点=${mutable.outerNodes}；完成=${mutable.completeNodes}；上界剪枝=${mutable.upperBoundPrunes}；内层 MIP=${mutable.innerSolves}；父结果复用=${mutable.parentResultReuses}；incumbent=${score}；耗时=${Math.round(performance.now() - startedAt)}ms`,
        );
      }
    }

    const results: ExactMipResult[] = [];
    for (let contextIndex = 0; contextIndex < contexts.length; contextIndex++) {
      const context = contexts[contextIndex]!;
      const result = await resultForNode(
        context,
        fixed,
        options.foodStrategy === "shared" ? foodChoice : undefined,
        parentResults?.[contextIndex],
      );
      if (result === undefined) return;
      results.push(result);
    }
    const upperBound = exactScore(results);
    if (best !== undefined && compareRational(upperBound, best.score) <= 0) {
      mutable.upperBoundPrunes++;
      return;
    }

    let allSharedChoicesAgree = true;
    for (const name of options.commonSlots) {
      const firstContext = contexts[0]!;
      const firstEquipment = results[0]!.selection[firstContext.indexByName.get(name)!]!;
      const firstKey = equipmentIdentity(firstEquipment);
      for (let index = 1; index < contexts.length; index++) {
        const context = contexts[index]!;
        if (equipmentIdentity(results[index]!.selection[context.indexByName.get(name)!]!) !== firstKey) {
          allSharedChoicesAgree = false;
          break;
        }
      }
      if (!allSharedChoicesAgree) break;
    }
    if (allSharedChoicesAgree) {
      mutable.completeNodes++;
      mutable.relaxedOptimaAttained++;
      updateBest(upperBound, results);
      return;
    }

    const relaxedKeysBySlot = new Map<string, string[]>();
    for (const name of options.commonSlots) {
      if (fixed.has(name)) continue;
      relaxedKeysBySlot.set(name, contexts.map((context, index) =>
        equipmentIdentity(results[index]!.selection[context.indexByName.get(name)!]!),
      ));
    }
    const disagreeingSlots = [...relaxedKeysBySlot.entries()]
      .filter(([, keys]) => keys.some((key) => key !== keys[0]))
      .sort(([left], [right]) =>
        commonChoicesByName.get(left)!.length - commonChoicesByName.get(right)!.length ||
        slotOrderIndex.get(left)! - slotOrderIndex.get(right)!);
    const branchSlot = disagreeingSlots[0]?.[0];
    if (branchSlot === undefined) {
      throw new Error("内部错误：松弛最优装备不一致，但没有可分支的通用槽位");
    }
    const relaxedKeys = relaxedKeysBySlot.get(branchSlot)!;
    const branchChoices = commonChoicesByName.get(branchSlot)!
      .map((choice, index) => ({
        choice,
        index,
        matches: relaxedKeys.reduce((count, key) => count + Number(choice.key === key), 0),
      }))
      .sort((left, right) => right.matches - left.matches || left.index - right.index);
    for (const { choice } of branchChoices) {
      fixed.set(branchSlot, choice);
      await visit(fixed, foodChoice, results);
      fixed.delete(branchSlot);
      if (stopAtProvenCeiling) return;
    }
  }
}

function foodIdentityForOptional(food: FoodInfo | undefined): string {
  return food === undefined ? "no-food" : foodIdentity(food);
}
