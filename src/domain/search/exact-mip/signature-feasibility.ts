import type { ExactMipOptions } from "./types.ts";
import type { prepareExactMipModel } from "./model-preparation.ts";
import type { GcdSpeedRange } from "../search-types.ts";
import { factorResourceWeightVectors } from "./resource-support.ts";

/** Build a safe superset of feasible signatures; uncertainty always retains a tuple. */
export function prepareSignatureFeasibility(
  options: ExactMipOptions,
  prepared: NonNullable<Awaited<ReturnType<typeof prepareExactMipModel>>>,
) {
  const { model, groups, mainAttribute, detAttribute, tenAttribute,
    crtAttribute, dhtAttribute, speedAttribute } = prepared;
  const attributeForFactorGroup = new Map<string, number>([
    ["main", mainAttribute],
    ["det", detAttribute ?? -1],
    ["ten", tenAttribute ?? -1],
    ["crt", crtAttribute ?? -1],
    ["dht", dhtAttribute ?? -1],
    ["gcd", speedAttribute],
  ]);
  const speedRange = model.ranges.get(speedAttribute);
  const clippedSpeedRange = (range: GcdSpeedRange): GcdSpeedRange | undefined => {
    const min = Math.max(range.min, speedRange?.min ?? Number.NEGATIVE_INFINITY);
    const max = Math.min(range.max, speedRange?.max ?? Number.POSITIVE_INFINITY);
    return min <= max ? { min, max } : undefined;
  };
  const requestedGcds = options.constraints?.gcdChoices !== undefined
    ? options.constraints.gcdChoices
    : options.constraints?.gcd === undefined
    ? undefined
    : [options.constraints.gcd];
  const scalarGcdRange = options.constraints?.gcd === undefined
    ? undefined
    : options.gcdToSpeedRange?.(options.constraints.gcd);
  const validGcdRanges = requestedGcds?.flatMap((gcdChoice) => {
    const rawRange = options.gcdToSpeedRange?.(gcdChoice);
    if (rawRange === undefined) return [];
    let combined = clippedSpeedRange(rawRange);
    if (combined === undefined) return [];
    if (scalarGcdRange !== undefined) {
      const intersected = clippedSpeedRange({
        min: Math.max(combined.min, scalarGcdRange.min),
        max: Math.min(combined.max, scalarGcdRange.max),
      });
      if (intersected === undefined) return [];
      combined = intersected;
    }
    return [{ centiseconds: Math.round(gcdChoice * 100), range: combined }];
  });
  const intersectsRange = (minimum: number, maximum: number, range: GcdSpeedRange): boolean =>
    maximum >= Math.ceil(range.min) && minimum <= Math.floor(range.max);
  const signatureBandGroups = groups.map((group) => {
    const attribute = attributeForFactorGroup.get(group.name);
    let classes = group.classes;
    if (attribute !== undefined && attribute >= 0) {
      const range = model.ranges.get(attribute);
      if (range !== undefined) {
        classes = classes.filter((factorClass) =>
          intersectsRange(factorClass.min, factorClass.max, {
            min: range.min ?? Number.NEGATIVE_INFINITY,
            max: range.max ?? Number.POSITIVE_INFINITY,
          }));
      }
    }
    if (group.name === "gcd" && validGcdRanges !== undefined) {
      classes = classes.filter((factorClass) => validGcdRanges.some((choice) =>
        factorClass.value === choice.centiseconds &&
        intersectsRange(factorClass.min, factorClass.max, choice.range)));
    }
    // 初始 MIP 已有可行解时，筛选后的组不应为空；若数值边界情况导致其为空，
    // 则保留未筛选的超集。
    if (classes.length === 0) classes = group.classes;
    return {
      name: group.name,
      classes: classes.map(({ q, value }) => ({ q, value })),
    };
  });
  const minimumAttributeByGroupAndQ = new Map<string, Map<number, number>>();
  for (const group of groups) {
    const filteredGroup = signatureBandGroups.find((candidate) => candidate.name === group.name)!;
    const classBySignature = new Map(filteredGroup.classes.map(({ q, value }) => [`${q}:${value}`, true]));
    const minimaByQ = new Map<number, number>();
    for (const factorClass of group.classes) {
      if (!classBySignature.has(`${factorClass.q}:${factorClass.value}`)) continue;
      const previous = minimaByQ.get(factorClass.q);
      if (previous === undefined || factorClass.min < previous) {
        minimaByQ.set(factorClass.q, factorClass.min);
      }
    }
    minimumAttributeByGroupAndQ.set(group.name, minimaByQ);
  }
  const resourceAttributes = [
    ["main", mainAttribute],
    ["det", detAttribute],
    ["ten", tenAttribute],
    ["crt", crtAttribute],
    ["dht", dhtAttribute],
    ["gcd", speedAttribute],
  ] as const;
  const presentResourceAttributes = resourceAttributes.flatMap(([name, attribute]) =>
    attribute === undefined ? [] : [[name, attribute] as const]);
  const maximumFoodBonuses = options.foods.map(() =>
    new Array<number>(options.attributeIds.length).fill(0));
  for (const bonus of model.foodBonuses) {
    const rawBonus = BigInt(bonus.maximumRaw) * BigInt(bonus.numerator) /
      BigInt(bonus.denominator);
    const cappedBonus = rawBonus >= BigInt(bonus.cap) ? bonus.cap : Number(rawBonus);
    maximumFoodBonuses[bonus.foodIndex]![bonus.attribute] += cappedBonus;
  }
  const subsetBudgets: { axes: readonly (readonly [string, number, number])[]; maximum: number }[] = [];
  for (let mask = 1; mask < 1 << presentResourceAttributes.length; mask++) {
    const included = presentResourceAttributes.filter((_, index) => (mask & (1 << index)) !== 0);
    const axes = included.map(([name, attribute]) => [name, attribute, 1] as const);
    let maximum = 0;
    for (const slot of model.equipmentAttributes) {
      let slotMaximum = Number.NEGATIVE_INFINITY;
      for (const candidate of slot) {
        const contribution = axes.reduce((total, [, attribute, weight]) =>
          total + candidate[attribute]! * weight, 0);
        slotMaximum = Math.max(slotMaximum, contribution);
      }
      maximum += slotMaximum;
    }
    let foodMaximum = 0;
    for (let foodIndex = 0; foodIndex < options.foods.length; foodIndex++) {
      const foodContribution = axes.reduce((total, [, attribute, weight]) =>
        total + maximumFoodBonuses[foodIndex]![attribute]! * weight, 0);
      foodMaximum = Math.max(foodMaximum, foodContribution);
    }
    maximum += foodMaximum;
    if (Number.isSafeInteger(maximum)) {
      subsetBudgets.push({ axes, maximum });
    }
  }
  for (const weights of factorResourceWeightVectors(groups, presentResourceAttributes.map(([name]) => name))) {
    const axes = presentResourceAttributes.flatMap(([name, attribute], index) => {
      const weight = weights[index]!;
      return weight > 0 ? [[name, attribute, weight] as const] : [];
    });
    const gearMaximum = model.equipmentAttributes.reduce((total, slot) => {
      let slotMaximum = Number.NEGATIVE_INFINITY;
      for (const candidate of slot) {
        const contribution = axes.reduce((sum, [, attribute, weight]) =>
          sum + candidate[attribute]! * weight, 0);
        slotMaximum = Math.max(slotMaximum, contribution);
      }
      return total + slotMaximum;
    }, 0);
    let foodMaximum = 0;
    for (let foodIndex = 0; foodIndex < options.foods.length; foodIndex++) {
      const foodContribution = axes.reduce((total, [, attribute, weight]) =>
        total + maximumFoodBonuses[foodIndex]![attribute]! * weight, 0);
      foodMaximum = Math.max(foodMaximum, foodContribution);
    }
    const maximum = gearMaximum + foodMaximum;
    if (Number.isSafeInteger(maximum)) {
      subsetBudgets.push({ axes, maximum });
    }
  }
  const isPossiblyFeasibleFactorTuple = (
    signature: readonly { name: string; q: number; value: number }[],
  ): boolean => {
    const qByGroup = new Map(signature.map((factor) => [factor.name, factor.q]));
    for (const budget of subsetBudgets) {
      let minimum = 0;
      for (const [name, , weight] of budget.axes) {
        const q = qByGroup.get(name);
        const attributeMinimum = q === undefined
          ? undefined
          : minimumAttributeByGroupAndQ.get(name)?.get(q);
        // 映射未知时必须保留该元组；只有完整的下界才能将其排除。
        if (attributeMinimum === undefined) {
          minimum = Number.NEGATIVE_INFINITY;
          break;
        }
        minimum += attributeMinimum * weight;
      }
      if (Number.isSafeInteger(minimum) && minimum > budget.maximum) return false;
    }
    return true;
  };
  return { signatureBandGroups, isPossiblyFeasibleFactorTuple };
}
