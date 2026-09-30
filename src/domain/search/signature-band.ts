export type SignatureBandFactorClass = {
  q: number;
  value: number;
};

export type SignatureBandFactorGroup = {
  name: string;
  classes: readonly SignatureBandFactorClass[];
};

export type SignatureBandIncumbent = {
  weaponDamage: number;
  mainStat: number;
  determination: number;
  tenacity: number;
  critical: number;
  directHit: number;
  gcdCentiseconds: number;
};

export type SignatureBandOptions = {
  groups: readonly SignatureBandFactorGroup[];
  objective: "damage" | "dps";
  incumbent: SignatureBandIncumbent;
  qMinimum: number;
  qMaximum: number;
  maxHalfCombinations?: number;
  /** Return true when the caller's search deadline has expired. */
  deadline?: () => boolean;
  /**
   * Optional conservative filter for exact better factor tuples. Returning
   * false must prove that the tuple cannot correspond to a feasible loadout.
   */
  isPossiblyFeasible?: (
    signature: readonly { name: string; q: number; value: number }[],
  ) => boolean;
};

type NormalizedClass = SignatureBandFactorClass & { exactValue: bigint };
type NormalizedGroup = { name: string; classes: NormalizedClass[] };
type ChoiceArray = Uint16Array | Uint32Array;
type HalfStates = {
  groups: NormalizedGroup[];
  q: Float64Array;
  choices: ChoiceArray;
  count: number;
};

const DEFAULT_HALF_CAP = 2_000_000;
const MAX_HALF_CAP = 2_000_000;
const MAX_NUMBER = Number.MAX_SAFE_INTEGER;
const REQUIRED_DAMAGE_GROUPS = ["weapon", "main", "det", "ten", "crt", "dht"] as const;
const REQUIRED_DPS_GROUPS = [...REQUIRED_DAMAGE_GROUPS, "gcd"] as const;

/**
 * Conservatively checks whether a factor signature in the requested rounded-log
 * band can strictly beat the incumbent. A false result is an exhaustive proof;
 * true also means the configured work limit prevented that proof.
 *
 * The MIP ties factor classes to actual loadouts. This check deliberately
 * relaxes those ties into a Cartesian product, so it can prove impossibility
 * without rejecting a feasible MIP signature.
 */
export function hasStrictlyBetterFactorCombination(
  options: SignatureBandOptions,
): boolean {
  try {
    return checkFactorBand(options);
  } catch {
    // This helper is an optional proof shortcut. Any unexpected numeric,
    // allocation, or deadline error must send the caller back to exact MIP.
    return true;
  }
}

function checkFactorBand(options: SignatureBandOptions): boolean {
  try {
    if (options.deadline?.() === true) return true;
  } catch {
    return true;
  }
  if (options.objective !== "damage" && options.objective !== "dps") return true;
  if (!Number.isSafeInteger(options.qMinimum) || !Number.isSafeInteger(options.qMaximum)) return true;
  if (options.qMinimum > options.qMaximum) return false;
  const configuredCap = options.maxHalfCombinations ?? DEFAULT_HALF_CAP;
  if (!Number.isSafeInteger(configuredCap) || configuredCap < 1) return true;
  const halfCap = Math.min(configuredCap, MAX_HALF_CAP);
  const isDps = options.objective === "dps";
  const requiredGroups: readonly string[] = isDps ? REQUIRED_DPS_GROUPS : REQUIRED_DAMAGE_GROUPS;
  const requiredSet = new Set<string>(requiredGroups);
  const seen = new Set<string>();
  const groups: NormalizedGroup[] = [];

  for (const inputGroup of options.groups) {
    if (!inputGroup || typeof inputGroup.name !== "string") return true;
    // Speed is immaterial to both the damage product and the damage-mode q
    // sum. Dropping it also avoids multiplying equivalent zero-q classes.
    if (!isDps && inputGroup.name === "gcd") continue;
    if (!requiredSet.has(inputGroup.name) || seen.has(inputGroup.name)) return true;
    seen.add(inputGroup.name);
    if (!Array.isArray(inputGroup.classes) || inputGroup.classes.length === 0) return false;

    // For a fixed q, retain only the best exact factor. Any discarded class has
    // the same band coordinate and can only make the product worse.
    const bestByQ = new Map<number, number>();
    for (const factorClass of inputGroup.classes) {
      if (!factorClass || !Number.isSafeInteger(factorClass.q) ||
          !Number.isSafeInteger(factorClass.value) || factorClass.value <= 0) return true;
      const previous = bestByQ.get(factorClass.q);
      const isBetter = previous === undefined || (inputGroup.name === "gcd"
        ? factorClass.value < previous
        : factorClass.value > previous);
      if (isBetter) bestByQ.set(factorClass.q, factorClass.value);
    }
    groups.push({
      name: inputGroup.name,
      classes: [...bestByQ.entries()].map(([q, value]) => ({ q, value, exactValue: BigInt(value) })),
    });
  }

  if (requiredGroups.some((name) => !seen.has(name))) return true;
  if (groups.length === 0) return true;

  const incumbentValues = new Map<string, number>([
    ["weapon", options.incumbent.weaponDamage],
    ["main", options.incumbent.mainStat],
    ["det", options.incumbent.determination],
    ["ten", options.incumbent.tenacity],
    ["crt", options.incumbent.critical],
    ["dht", options.incumbent.directHit],
    ["gcd", options.incumbent.gcdCentiseconds],
  ]);
  let incumbentProduct = 1n;
  let incumbentGcd = 1n;
  for (const group of groups) {
    const value = incumbentValues.get(group.name);
    if (value === undefined || !Number.isSafeInteger(value) || value <= 0) return true;
    if (group.name === "gcd") incumbentGcd = BigInt(value);
    else incumbentProduct *= BigInt(value);
  }

  const groupExtrema = groups.map((group) => {
    let minimum = MAX_NUMBER;
    let maximum = -MAX_NUMBER;
    for (const factorClass of group.classes) {
      minimum = Math.min(minimum, factorClass.q);
      maximum = Math.max(maximum, factorClass.q);
    }
    return { minimum, maximum };
  });
  const totalMinimum = sumSafe(groupExtrema.map((range) => range.minimum));
  const totalMaximum = sumSafe(groupExtrema.map((range) => range.maximum));
  if (totalMinimum === undefined || totalMaximum === undefined) return true;
  if (options.qMaximum < totalMinimum || options.qMinimum > totalMaximum) return false;

  const partition = balancedPartition(groups);
  const leftGroups = partition.left;
  const rightGroups = partition.right;
  const leftRange = extremaForGroups(leftGroups);
  const rightRange = extremaForGroups(rightGroups);
  if (leftRange === undefined || rightRange === undefined) return true;
  const leftAllowedMinimum = safeSubtract(options.qMinimum, rightRange.maximum);
  const leftAllowedMaximum = safeSubtract(options.qMaximum, rightRange.minimum);
  const rightAllowedMinimum = safeSubtract(options.qMinimum, leftRange.maximum);
  const rightAllowedMaximum = safeSubtract(options.qMaximum, leftRange.minimum);
  if (leftAllowedMinimum === undefined || leftAllowedMaximum === undefined ||
      rightAllowedMinimum === undefined || rightAllowedMaximum === undefined) return true;

  let workAborted = false;
  let deadlineChecks = 0;
  const deadlineExpired = (checkNow = false): boolean => {
    if (workAborted) return true;
    deadlineChecks++;
    if (!checkNow && (deadlineChecks & 1023) !== 0) return false;
    try {
      workAborted = options.deadline?.() === true;
    } catch {
      workAborted = true;
    }
    return workAborted;
  };
  const left = enumerateHalf(leftGroups, leftAllowedMinimum, leftAllowedMaximum, halfCap, deadlineExpired);
  if (left === undefined || workAborted) return true;
  if (left.count === 0) return false;
  const right = enumerateHalf(rightGroups, rightAllowedMinimum, rightAllowedMaximum, halfCap, deadlineExpired);
  if (right === undefined || workAborted) return true;
  if (right.count === 0) return false;

  const sortedLeft = sortByQ(left, deadlineExpired);
  if (sortedLeft === undefined || workAborted) return true;
  const orderedGroups = [...left.groups, ...right.groups];
  const allGroups = orderedGroups;
  let pairChecks = 0;

  for (let rightState = 0; rightState < right.count; rightState++) {
    if (deadlineExpired(true)) return true;
    const rightQ = right.q[rightState]!;
    const wantedMinimum = safeSubtract(options.qMinimum, rightQ);
    const wantedMaximum = safeSubtract(options.qMaximum, rightQ);
    if (wantedMinimum === undefined || wantedMaximum === undefined) return true;
    let start = lowerBound(left, sortedLeft, wantedMinimum);
    const end = lowerBound(left, sortedLeft, wantedMaximum, true);
    for (; start < end; start++) {
      pairChecks++;
      if ((pairChecks & 1023) === 0 && deadlineExpired(true)) return true;
      const leftState = sortedLeft[start]!;
      let candidateProduct = 1n;
      let candidateGcd = 1n;
      for (let groupIndex = 0; groupIndex < allGroups.length; groupIndex++) {
        const factorGroup = groupIndex < left.groups.length ? left : right;
        const localGroupIndex = groupIndex < left.groups.length
          ? groupIndex
          : groupIndex - left.groups.length;
        const stateIndex = groupIndex < left.groups.length ? leftState : rightState;
        const choiceIndex = factorGroup.choices[stateIndex * factorGroup.groups.length + localGroupIndex]!;
        const exactValue = factorGroup.groups[localGroupIndex]!.classes[choiceIndex]!.exactValue;
        if (factorGroup.groups[localGroupIndex]!.name === "gcd") candidateGcd = exactValue;
        else candidateProduct *= exactValue;
      }
      const strictlyBetter = isDps
        ? candidateProduct * incumbentGcd > incumbentProduct * candidateGcd
        : candidateProduct > incumbentProduct;
      if (!strictlyBetter) continue;
      if (options.isPossiblyFeasible === undefined) return true;
      const signature: { name: string; q: number; value: number }[] = [];
      for (let groupIndex = 0; groupIndex < allGroups.length; groupIndex++) {
        const factorGroup = groupIndex < left.groups.length ? left : right;
        const localGroupIndex = groupIndex < left.groups.length
          ? groupIndex
          : groupIndex - left.groups.length;
        const stateIndex = groupIndex < left.groups.length ? leftState : rightState;
        const choiceIndex = factorGroup.choices[stateIndex * factorGroup.groups.length + localGroupIndex]!;
        const group = factorGroup.groups[localGroupIndex]!;
        const factorClass = group.classes[choiceIndex]!;
        signature.push({ name: group.name, q: factorClass.q, value: factorClass.value });
      }
      if (options.isPossiblyFeasible(signature) !== false) return true;
    }
  }
  return false;
}

function balancedPartition(groups: NormalizedGroup[]): { left: NormalizedGroup[]; right: NormalizedGroup[] } {
  if (groups.length === 1) return { left: groups, right: [] };
  let bestLeft: NormalizedGroup[] = [];
  let bestRight: NormalizedGroup[] = [];
  let bestMaximum = Number.POSITIVE_INFINITY;
  let bestTotal = Number.POSITIVE_INFINITY;
  const masks = 1 << groups.length;
  for (let mask = 1; mask < masks - 1; mask++) {
    if ((mask & 1) === 0) continue;
    let leftLog = 0;
    let rightLog = 0;
    const left: NormalizedGroup[] = [];
    const right: NormalizedGroup[] = [];
    for (let index = 0; index < groups.length; index++) {
      const group = groups[index]!;
      if ((mask & (1 << index)) !== 0) {
        left.push(group);
        leftLog += Math.log(group.classes.length);
      } else {
        right.push(group);
        rightLog += Math.log(group.classes.length);
      }
    }
    const maximum = Math.max(leftLog, rightLog);
    const total = leftLog + rightLog;
    if (maximum < bestMaximum || (maximum === bestMaximum && total < bestTotal)) {
      bestLeft = left;
      bestRight = right;
      bestMaximum = maximum;
      bestTotal = total;
    }
  }
  return { left: bestLeft, right: bestRight };
}

function extremaForGroups(groups: readonly NormalizedGroup[]): { minimum: number; maximum: number } | undefined {
  let minimum = 0;
  let maximum = 0;
  for (const group of groups) {
    let groupMinimum = MAX_NUMBER;
    let groupMaximum = -MAX_NUMBER;
    for (const factorClass of group.classes) {
      groupMinimum = Math.min(groupMinimum, factorClass.q);
      groupMaximum = Math.max(groupMaximum, factorClass.q);
    }
    const nextMinimum = safeAdd(minimum, groupMinimum);
    const nextMaximum = safeAdd(maximum, groupMaximum);
    if (nextMinimum === undefined || nextMaximum === undefined) return undefined;
    minimum = nextMinimum;
    maximum = nextMaximum;
  }
  return { minimum, maximum };
}

function enumerateHalf(
  groups: NormalizedGroup[],
  allowedMinimum: number,
  allowedMaximum: number,
  cap: number,
  deadlineExpired: (checkNow?: boolean) => boolean,
): HalfStates | undefined {
  if (allowedMinimum > allowedMaximum) return {
    groups,
    q: new Float64Array(0),
    choices: new Uint16Array(0),
    count: 0,
  };
  const suffixMinimum = new Array<number>(groups.length + 1).fill(0);
  const suffixMaximum = new Array<number>(groups.length + 1).fill(0);
  for (let index = groups.length - 1; index >= 0; index--) {
    const group = groups[index]!;
    let minimum = MAX_NUMBER;
    let maximum = -MAX_NUMBER;
    for (const factorClass of group.classes) {
      minimum = Math.min(minimum, factorClass.q);
      maximum = Math.max(maximum, factorClass.q);
    }
    const nextMinimum = safeAdd(suffixMinimum[index + 1]!, minimum);
    const nextMaximum = safeAdd(suffixMaximum[index + 1]!, maximum);
    if (nextMinimum === undefined || nextMaximum === undefined) return undefined;
    suffixMinimum[index] = nextMinimum;
    suffixMaximum[index] = nextMaximum;
  }

  const use32BitChoices = groups.some((group) => group.classes.length > 0xffff);
  const choicesPerState = groups.length;
  let capacity = Math.min(cap, 1024);
  let qValues = new Float64Array(capacity);
  let choices: ChoiceArray = use32BitChoices
    ? new Uint32Array(capacity * choicesPerState)
    : new Uint16Array(capacity * choicesPerState);
  const picked = new Array<number>(groups.length).fill(0);
  let count = 0;
  let nodes = 0;
  const maxNodes = Math.max(10_000, cap * Math.max(2, groups.length + 1));

  const grow = (): boolean => {
    if (capacity >= cap) return false;
    const nextCapacity = Math.min(cap, capacity * 2);
    const nextQ = new Float64Array(nextCapacity);
    nextQ.set(qValues.subarray(0, count));
    const nextChoices: ChoiceArray = use32BitChoices
      ? new Uint32Array(nextCapacity * choicesPerState)
      : new Uint16Array(nextCapacity * choicesPerState);
    nextChoices.set(choices.subarray(0, count * choicesPerState));
    qValues = nextQ;
    choices = nextChoices;
    capacity = nextCapacity;
    return true;
  };

  const visit = (groupIndex: number, partialQ: number): boolean => {
    nodes++;
    if (nodes > maxNodes || (nodes & 4095) === 0 && deadlineExpired(true)) return false;
    const minimumPossible = safeAdd(partialQ, suffixMinimum[groupIndex]!);
    const maximumPossible = safeAdd(partialQ, suffixMaximum[groupIndex]!);
    if (minimumPossible === undefined || maximumPossible === undefined) return false;
    if (minimumPossible > allowedMaximum || maximumPossible < allowedMinimum) return true;
    if (groupIndex === groups.length) {
      if (count >= cap) return false;
      if (count === capacity && !grow()) return false;
      qValues[count] = partialQ;
      const offset = count * choicesPerState;
      for (let index = 0; index < choicesPerState; index++) choices[offset + index] = picked[index]!;
      count++;
      return true;
    }
    const group = groups[groupIndex]!;
    for (let classIndex = 0; classIndex < group.classes.length; classIndex++) {
      const nextQ = safeAdd(partialQ, group.classes[classIndex]!.q);
      if (nextQ === undefined) return false;
      picked[groupIndex] = classIndex;
      if (!visit(groupIndex + 1, nextQ)) return false;
    }
    return true;
  };

  if (!visit(0, 0)) return undefined;
  return { groups, q: qValues, choices, count };
}

function sortByQ(states: HalfStates, deadlineExpired: (checkNow?: boolean) => boolean): Uint32Array | undefined {
  const order = new Uint32Array(states.count);
  for (let index = 0; index < states.count; index++) order[index] = index;
  if (states.count < 2) return order;
  let source = order;
  let target = new Uint32Array(states.count);
  let comparisons = 0;
  for (let width = 1; width < states.count; width *= 2) {
    for (let start = 0; start < states.count; start += width * 2) {
      const middle = Math.min(start + width, states.count);
      const end = Math.min(start + width * 2, states.count);
      let left = start;
      let right = middle;
      for (let output = start; output < end; output++) {
        comparisons++;
        if ((comparisons & 65535) === 0 && deadlineExpired(true)) return undefined;
        if (right >= end || (left < middle && states.q[source[left]!]! <= states.q[source[right]!]!)) {
          target[output] = source[left++]!;
        } else {
          target[output] = source[right++]!;
        }
      }
    }
    const previousSource = source;
    source = target;
    target = previousSource;
  }
  return source;
}

function lowerBound(
  states: HalfStates,
  order: Uint32Array,
  q: number,
  strict = false,
): number {
  let low = 0;
  let high = states.count;
  while (low < high) {
    const middle = (low + high) >>> 1;
    const value = states.q[order[middle]!]!;
    if (strict ? value <= q : value < q) low = middle + 1;
    else high = middle;
  }
  return low;
}

function sumSafe(values: readonly number[]): number | undefined {
  let sum = 0;
  for (const value of values) {
    const next = safeAdd(sum, value);
    if (next === undefined) return undefined;
    sum = next;
  }
  return sum;
}

function safeAdd(left: number, right: number): number | undefined {
  const result = left + right;
  return Number.isSafeInteger(result) ? result : undefined;
}

function safeSubtract(left: number, right: number): number | undefined {
  const result = left - right;
  return Number.isSafeInteger(result) ? result : undefined;
}
