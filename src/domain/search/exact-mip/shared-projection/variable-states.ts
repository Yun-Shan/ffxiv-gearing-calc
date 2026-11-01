import { prepareSharedAxisGate } from "./axis-gate.ts";
import {
  backtrackAxis,
  projectAxis,
  type AxisAllowed,
  type AxisProjection,
  type AxisState,
  type SupportAxis,
} from "./axis-support.ts";
import { projectionClass } from "./factor-signature.ts";
import {
  prepareSharedSpeedDomain,
  requireVariableDomain,
  safeVariable,
  variableSpeedAllowed,
} from "./shared-speed-domain.ts";
import {
  ProjectionLimit,
  type ProjectionClass,
  type ProjectionJob,
  type ProjectionModel,
} from "./types.ts";

type Baseline = {
  weaponDamage: number;
  mainStat: number;
  determination: number;
  tenacity: number;
  critical: number;
  directHit: number;
};
const resources: readonly SupportAxis[] = ["ten", "crt", "det", "dht"];
const index: Readonly<Record<SupportAxis, number>> = {
  crt: 4,
  det: 2,
  ten: 3,
  dht: 5,
};
const fields: readonly (keyof Baseline)[] = [
  "weaponDamage",
  "mainStat",
  "determination",
  "tenacity",
  "critical",
  "directHit",
];
const projectionLimits = {
  localMs: 8_000,
  maxStates: 1_250_000,
  maxBits: 256_000_000,
  maxTransitions: 80_000_000,
};

function pairs(states: readonly AxisState[], tick: () => void): number {
  let count = 0;
  for (const state of states) {
    let bits = state.bits;
    while (bits) {
      tick();
      let word = Number(bits & 0xffffffffn);
      while (word) {
        tick();
        count++;
        word = (word & (word - 1)) >>> 0;
      }
      bits >>= 32n;
    }
  }
  return count;
}

/** Checks an upper bound over every supplied shared raw vector, all common foods,
 * and every original private weapon. Q maximizers and true-score maximizers are independent.
 */
function noBetterVector(
  jobs: readonly ProjectionJob[],
  sharedDepth: number,
  foods: readonly (readonly number[])[],
  states: readonly AxisState[],
  names: readonly SupportAxis[],
  jointRhs: number,
  baselines: readonly Baseline[],
  best: { numerator: bigint; denominator: bigint },
  check: () => void,
): boolean {
  requireVariableDomain(
    names.length === 3 && new Set(names).size === 3,
    "three selected shared axes required",
  );
  const last = resources.find((name) => !names.includes(name))!;
  const denominators = baselines.map((baseline) =>
    fields.reduce(
      (product, field) => product * BigInt(safeVariable(baseline[field], 1)),
      1n,
    ),
  );
  const denominator = denominators.reduce(
    (product, value) => product * value,
    1n,
  );
  const weights = denominators.map((value) => denominator / value);
  const jointThreshold = BigInt(jointRhs);
  let work = 0,
    cacheEntries = 0;
  const tick = () => {
    if ((++work & 1023) === 0) check();
    requireVariableDomain(work <= 200_000_000, "true-score work budget");
  };
  const takeCache = () => {
    requireVariableDomain(
      ++cacheEntries <= 1_000_000,
      "true-score cache budget",
    );
  };
  const evaluators = jobs.map((job, j) =>
    foods.map((food) => {
      const local = food[j],
        cache = Array.from(
          { length: 7 },
          () => new Map<number, ProjectionClass | null>(),
        );
      const at = (a: number, raw: number): ProjectionClass | null => {
        tick();
        const existing = cache[a].get(raw);
        if (existing !== undefined) return existing;
        safeVariable(raw);
        const axis = job.axes[a];
        const found =
          raw < axis.rawMin ||
          raw > axis.rawMax ||
          (a === 6 && !variableSpeedAllowed(job, local, raw))
            ? null
            : (projectionClass(job, local, a, raw) ?? null);
        takeCache();
        cache[a].set(raw, found);
        return found;
      };
      const cores = new Map<
        string,
        readonly { weapon: readonly number[]; product: bigint; q: bigint }[]
      >();
      const fixed = (state: AxisState) => {
        const key = `${state.speed},${state.main}`,
          existing = cores.get(key);
        if (existing) return existing;
        const result: {
          weapon: readonly number[];
          product: bigint;
          q: bigint;
        }[] = [];
        // Iterate the unshortened original private slot, even when distinct weapons have equal Q bounds.
        for (const choice of job.slots[sharedDepth].choices) {
          tick();
          const w = choice.values;
          const wc = at(0, w[0]),
            mc = at(1, safeVariable(state.main + w[1])),
            sc = at(6, safeVariable(state.speed + w[6]));
          if (wc && mc && sc) {
            takeCache();
            result.push({
              weapon: w,
              product: BigInt(wc.value) * BigInt(mc.value),
              q: BigInt(wc.q) + BigInt(mc.q) + BigInt(sc.q),
            });
          }
        }
        takeCache();
        cores.set(key, result);
        return result;
      };
      return { at, fixed };
    }),
  );
  for (const state of states) {
    tick();
    let bits = state.bits,
      offset = 0;
    while (bits) {
      tick();
      let word = Number(bits & 0xffffffffn);
      while (word) {
        tick();
        const bit = offset + 31 - Math.clz32(word & -word);
        const shared: Record<SupportAxis, number> = {
          crt: 0,
          det: 0,
          dht: 0,
          ten: 0,
        };
        shared[names[0]] = state.basis[0];
        shared[names[1]] = state.basis[1];
        shared[names[2]] = bit;
        shared[last] = safeVariable(
          state.z - state.basis[0] - state.basis[1] - bit,
        );
        for (let f = 0; f < foods.length; f++) {
          tick();
          let score = 0n,
            maxQ = 0n,
            supported = true;
          for (let j = 0; j < jobs.length; j++) {
            const evaluator = evaluators[j][f];
            let maximum: bigint | null = null,
              highestQ: bigint | null = null;
            for (const core of evaluator.fixed(state)) {
              tick();
              let product = core.product,
                q = core.q,
                valid = true;
              for (const name of resources) {
                const cls = evaluator.at(
                  index[name],
                  safeVariable(shared[name] + core.weapon[index[name]]),
                );
                if (!cls) {
                  valid = false;
                  break;
                }
                product *= BigInt(cls.value);
                q += BigInt(cls.q);
              }
              if (!valid || q < BigInt(jobs[j].rhs)) continue;
              if (maximum === null || product > maximum) maximum = product;
              if (highestQ === null || q > highestQ) highestQ = q;
            }
            if (maximum === null || highestQ === null) {
              supported = false;
              break;
            }
            score += maximum * weights[j];
            maxQ += highestQ;
          }
          if (
            supported &&
            maxQ >= jointThreshold &&
            score * best.denominator > best.numerator * denominator
          )
            return false;
        }
        word = (word & (word - 1)) >>> 0;
      }
      bits >>= 32n;
      offset += 32;
    }
  }
  check();
  return true;
}

/** Necessary-domain proof for the typed damage/shared-food route. Unsupported domains
 * and local resource exhaustion decline closure; caller cancellation always propagates.
 */
export function projectVariableStates(
  model: ProjectionModel,
  jointRhs: number,
  baselines: readonly Baseline[],
  best: { numerator: bigint; denominator: bigint },
  check: () => void,
): { closed: boolean; stages: readonly SupportAxis[] } {
  const stages: SupportAxis[] = [],
    began = performance.now();
  let interrupted = false;
  const outerCheck = () => {
    try {
      check();
    } catch (error) {
      interrupted = true;
      throw error;
    }
  };
  const guard = () => {
    outerCheck();
    if (performance.now() - began >= 160_000)
      throw new ProjectionLimit(
        "Variable shared projection: local time budget",
      );
  };
  let plannerWork = 0;
  const tick = () => {
    if ((++plannerWork & 1023) === 0) guard();
    requireVariableDomain(plannerWork <= 20_000_000, "planner work budget");
  };
  try {
    guard();
    safeVariable(jointRhs, Number.MIN_SAFE_INTEGER);
    requireVariableDomain(
      baselines.length === model.jobs.length &&
        typeof best.numerator === "bigint" &&
        best.numerator >= 0n &&
        typeof best.denominator === "bigint" &&
        best.denominator > 0n,
      "original score target and denominators required",
    );
    baselines.forEach((baseline) =>
      fields.forEach((field) => safeVariable(baseline[field], 1)),
    );
    const domain = prepareSharedSpeedDomain(model, guard);
    if (!domain.cells.length) {
      guard();
      return { closed: true, stages };
    }
    const gate = prepareSharedAxisGate(
      model.jobs,
      model.blocks.length,
      domain.foods,
      domain.maxCapacity,
      jointRhs,
      guard,
    );
    const cells = domain.cells
      .map((cell) => {
        const minZ = gate.minimum(cell.speed, cell.main, cell.maxZ);
        return {
          speed: cell.speed,
          main: cell.main,
          minZ: minZ === null ? null : Math.max(minZ, cell.minZ),
        };
      })
      .filter((cell) => cell.minZ !== null);
    if (!cells.length) {
      guard();
      return { closed: true, stages };
    }
    const basis: SupportAxis[] = [];
    let allowed: AxisAllowed | undefined;
    const project = (axis: SupportAxis) =>
      projectAxis(domain.slots, cells, {
        axis,
        basis,
        allowed,
        check: guard,
        limits: projectionLimits,
      });
    for (let depth = 0; depth < 3; depth++) {
      guard();
      const attempts: { axis: SupportAxis; estimate: number }[] = [];
      let reusable:
        | { axis: SupportAxis; estimate: number; projection: AxisProjection }
        | undefined;
      for (const axis of resources.filter((name) => !basis.includes(name))) {
        try {
          const projection = project(axis);
          if (!projection.states.length) {
            stages.push(axis);
            guard();
            return { closed: true, stages };
          }
          const sample =
            projection.states.length <= 48
              ? projection.states
              : Array.from(
                  { length: 48 },
                  (_, i) =>
                    projection.states[
                      Math.floor(((i + 0.5) * projection.states.length) / 48)
                    ],
                );
          const kept = gate.filter(sample, basis, axis);
          const estimate =
            (pairs(kept, tick) * projection.states.length) / sample.length;
          attempts.push({ axis, estimate });
          if (!reusable || estimate < reusable.estimate)
            reusable = { axis, estimate, projection };
        } catch (error) {
          if (interrupted || !(error instanceof ProjectionLimit)) throw error;
          guard();
        }
      }
      attempts.sort((a, b) => a.estimate - b.estimate);
      let selected:
        | {
            axis: SupportAxis;
            projection: AxisProjection;
            states: readonly AxisState[];
            pairs: number;
          }
        | undefined;
      for (const attempt of attempts) {
        try {
          const projection =
            reusable?.axis === attempt.axis
              ? reusable.projection
              : project(attempt.axis);
          const states = gate.filter(projection.states, basis, attempt.axis),
            count = pairs(states, tick);
          if (!selected || count < selected.pairs)
            selected = { axis: attempt.axis, projection, states, pairs: count };
          if (depth === 2 || count <= (depth === 0 ? 1024 : 64)) break;
        } catch (error) {
          if (interrupted || !(error instanceof ProjectionLimit)) throw error;
          guard();
        }
      }
      if (!selected) return { closed: false, stages };
      stages.push(selected.axis);
      if (!selected.states.length) {
        guard();
        return { closed: true, stages };
      }
      if (depth === 2) {
        const closed = noBetterVector(
          model.jobs,
          model.blocks.length,
          domain.foods,
          selected.states,
          [...basis, selected.axis],
          jointRhs,
          baselines,
          best,
          guard,
        );
        guard();
        return { closed, stages };
      }
      allowed = backtrackAxis(selected.projection.graph, selected.states, {
        check: guard,
        limits: { localMs: 8_000, maxTransitions: 80_000_000 },
      });
      basis.push(selected.axis);
    }
    return { closed: false, stages };
  } catch (error) {
    if (interrupted || !(error instanceof ProjectionLimit)) throw error;
    outerCheck();
    return { closed: false, stages };
  }
}
