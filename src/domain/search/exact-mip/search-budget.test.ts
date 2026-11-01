import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { LinearMipRequest, LinearMipRow, LinearMipSolution } from "../linear-mip.ts";
import type { EquipInfo } from "../types.ts";
import type { ExactMipOptions } from "./types.ts";
import type { JointSearchOptions } from "./joint-types.ts";
import * as resultDecoding from "./result-decoding.ts";

// Lifecycle fixtures, not physical gear/native/optimality tests. The owners,
// cancellation, strategy normalization, diagnostics, model helpers and integer
// primal validator execute as production modules. Only their declared candidate,
// formula, proof-aid, decoding and solver boundaries below are controlled.
type Kind = "single" | "joint";
type Phase = "assemble" | "native" | "preparation" | "initial-build" | "decode"
  | "progress-status" | "progress-candidate" | "signature-proof" | "signature-check"
  | "shared-preprocess" | "summary" | "profile" | "progress-other";
type Action = "cancel" | "expire" | "both";
type State = {
  now: number;
  cancelled: boolean;
  requests: LinearMipRequest[];
  trace: Phase[];
};
type Config = {
  hook?: (phase: Phase, state: State) => void;
  budget?: unknown;
  unlimited?: boolean;
  status?: string;
  statuses?: readonly string[];
  noPrepared?: boolean;
  noAssembled?: boolean;
  candidateGate?: boolean;
  invalidPrimal?: boolean;
  maxToughness?: boolean;
  perJobCancellation?: boolean | "parent-active";
  initialBest?: boolean;
  needsBandSearch?: boolean;
  ratioProof?: boolean;
};

const registeredMocks = new Set<string>();
beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("FFXIV_PROFILE_TIMING", "1");
});
afterEach(async () => {
  // Use the real microtask queue; fake timers would change the await boundary
  // this regression specifically exercises. Drain before restoring the clock.
  await Promise.resolve();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const id of registeredMocks) vi.doUnmock(id);
  registeredMocks.clear();
  vi.resetModules();
});

function fixture(config: Config = {}) {
  const state: State = { now: 0, cancelled: false, requests: [], trace: [] };
  const hit = (phase: Phase) => {
    state.trace.push(phase);
    config.hook?.(phase, state);
  };
  const unexpected = (name: string) => () => { throw new Error(`Unexpected fixture path: ${name}`); };
  const factors = { weaponDamage: 1, mainStat: 1, determination: 1, tenacity: 1, critical: 1, directHit: 1, gcdCentiseconds: 100, traitMultiplier: 1 };
  const groups = ["weapon", "main", "det", "ten", "crt", "dht", "gcd"].map((name, index) => ({
    name, classes: [{ variable: `g${index}`, q: 1, min: 1, max: index === 6 ? 100 : 1, value: index === 6 ? 100 : 1 }],
  }));
  const bounds = groups.map(group => ({ name: group.classes[0]!.variable, min: 1, max: 1 }));
  const columns = Object.fromEntries(bounds.map(bound => [bound.name, { Primal: 1 }]));
  const baseRows: LinearMipRow[] = bounds.map(bound => ({
    name: `fixed_${bound.name}`, terms: new Map([[bound.name, 1]]), sense: "=", rhs: 1,
  }));
  const rows = [...baseRows];
  // The actual single owner's rows=[...model.rows] happens after its old budget
  // snapshot. Advancing here tests request construction, not a copied caller.
  rows[Symbol.iterator] = () => { hit("assemble"); return baseRows[Symbol.iterator](); };
  const model = {
    rows, bounds, binaryVars: [] as string[], generalVars: bounds.map(bound => bound.name),
    slotVariables: [["equipment"]], foodVariables: [] as string[], resistanceAllocationVariables: [],
    idToIndex: new Map<number, number>(), rawVariables: [] as string[], finalVariables: [] as string[],
    ranges: new Map<number, { min?: number; max?: number }>(),
  };
  const prepared = {
    model, groups, factorEvaluator: () => ({ ...factors }), useDps: false,
    qByVariable: new Map(bounds.map(bound => [bound.name, 1])), primaryResourceSupportsEnabled: false,
    reachableFactorClassesRemoved: 0, reachableAttributePruningSkipped: 0,
    reachableWeaponFactorClassesRemoved: 0, reachableWeaponPruningSkipped: 0,
  };
  const equipment: EquipInfo = {
    itemId: 1, itemLevel: 90, key: "budget-fixture", PDMG: 0, MDMG: 0, DLY: 0, baseParams: [],
  };
  const singleOptions: ExactMipOptions = {
    job: "PLD", jobLevel: 100, clanIndex: 0, objective: "damage", slots: [[equipment]], foods: [],
    attributeIds: [], statIndexes: new Map(),
    strategies: { candidateUpperBound: "off", resourceBudgetCandidateBounds: "off", feasibleSeeds: "off", foodProductBound: "off" },
    isCancelled: () => state.cancelled,
    evaluationFunction: () => { hit("decode"); return { damage: 1, gcd: 1 }; },
    onProgress: message => {
      hit(message.includes("状态=") ? "progress-status"
        : message.includes("当前最优") || message.includes("精确候选已核验") ? "progress-candidate"
        : message.includes("BigInt") ? "signature-proof" : "progress-other");
    },
    onSolverProgress: event => {
      if (event.message?.startsWith("PROFILE ")) {
        const profile = JSON.parse(event.message.slice(8)) as { phase: string };
        hit(profile.phase.endsWith("search-summary") ? "summary" : "profile");
      }
    },
  };
  if (!config.unlimited) {
    // Deliberately pass malformed runtime inputs in the validation cases.
    singleOptions.maxSearchMs = (Object.hasOwn(config, "budget") ? config.budget : 10) as number;
  }
  if (config.maxToughness) {
    singleOptions.constraints = { maxToughnessMode: true };
    singleOptions.toughnessAttributeId = 19;
    model.idToIndex.set(19, 0);
    model.finalVariables.push("g0");
  }
  const solve = vi.fn(async (request: LinearMipRequest): Promise<LinearMipSolution> => {
    state.requests.push(request);
    hit("native");
    return {
      Status: config.statuses?.[state.requests.length - 1] ?? config.status ??
        (request.jointObjective && request.jointObjective.kind !== "ratio-bound" ? "FeasibleSignature" : "Optimal"),
      Columns: config.invalidPrimal ? { ...columns, g0: { Primal: 2 } } : columns,
      ObjectiveValue: 7,
    };
  });
  const maps = (names: readonly string[]) => Object.fromEntries(names.map(name => [name, new Map()]));
  const zeros = (names: readonly string[]) => Object.fromEntries(names.map(name => [name, 0]));
  const shared = {
    ...zeros(["sharedPairCandidateCount", "sharedPairCandidatesEvaluated", "sharedPairPreprocessingMs", "sharedPairPreprocessingSkipped",
      "sharedAssignmentCandidateCount", "sharedAssignmentCandidatesEvaluated", "sharedAssignmentPrefixEvaluationLimit",
      "sharedAssignmentUpperBoundLimit", "sharedAssignmentPreprocessingBudgetMs", "sharedAssignmentPreprocessingMs",
      "sharedAssignmentPreprocessingSkipped", "sharedAssignmentPrefixSearchUsed", "sharedAssignmentPrefixesEvaluated"]),
    ...maps(["sharedPairConflictRows", "sharedAssignmentConflictRows", "sharedAssignmentResourceScoreConflictRows"]),
    sharedPairCandidateUpperBound: 0n, sharedAssignmentCandidateUpperBound: 0n,
    sharedAssignmentPrefixChoiceOrder: [], sharedAssignmentDomainOrder: [], sharedAssignmentCutPrefixDepthCounts: {},
    prepareSharedPairUpperBounds: () => {}, prepareSharedAssignmentUpperBounds: () => { hit("shared-preprocess"); },
  };
  const cuts = {
    ...maps(["factorClassConflictRows", "factorClassPairConflictRows", "factorClassJointPairConflictRows",
      "factorClassJointTripleConflictRows", "factorClassTripleConflictRows", "ratioUpperNecessaryRows"]),
    factorClassTriplePreprocessingWork: 0, factorClassTriplePreprocessingSkipped: false,
  };
  const candidateBounds = {
    candidateSpecificUpperBounds: [], candidateSpecificUpperBoundPreparationMs: 0, candidateSpecificUpperBoundSkippedJobs: 0,
    resourceBudgetCandidateUpperBounds: [], resourceBudgetCandidateUpperBoundSkippedJobs: 0,
    resourceBudgetCandidateUpperBoundPreparationMs: 0, resourceBudgetCandidateUpperBoundProofRows: new Map(),
    factorClassUpperBounds: [], compareExactRatios: () => 0, factorClassUpperBoundsByJobAndGroup: [new Map(), new Map()],
  };
  const jointResults = [{ selection: [equipment], damage: 1 }, { selection: [equipment], damage: 1 }];
  const mocks: Record<string, Record<string, unknown>> = {
    "../../clans.ts": { assertClanIndex: (value: number) => { expect(value).toBe(0); return value; } },
    "../exact-mip-candidate-upper-bound.ts": {
      inheritCanonicalEvaluatorCandidateUpperBound: (_from: unknown, to: unknown) => to,
      hasCanonicalEvaluatorCandidateUpperBound: () => false,
      shouldEnableCanonicalCandidateUpperBound: () => config.candidateGate === true,
      candidateUpperBoundCannotImproveIncumbent: unexpected("candidate bound"),
    },
    "../core/highs-solver.ts": { solveIntegerModel: solve },
    "../memory-usage.ts": { getMemoryUsageSnapshot: () => ({}) },
    "./model-preparation.ts": {
      SURROGATE_OBJECTIVE_SCALE: 65536,
      prepareExactMipModel: async () => { hit("preparation"); return config.noPrepared ? undefined : prepared; },
    },
    "./attribute-model.ts": {
      buildLinearAttributeModel: () => { hit("initial-build"); return undefined; },
      addRangeConstraint: unexpected("max-toughness range"),
    },
    "./initial-solution.ts": {
      greedyMipStart: unexpected("greedy start"), sparseMipStart: unexpected("sparse start"), completeFeasibleMipStart: unexpected("complete start"),
    },
    "./candidate-bounds.ts": {
      pruneCandidatesByIncumbentUpperBound: unexpected("candidate pruning"), prepareResourceBudgetCandidateBounds: unexpected("resource bounds"),
    },
    "../equipped-effects.ts": { createIntegerDamageFactorEvaluator: unexpected("canonical formula") },
    "./food-product-bound.ts": { prepareFoodProductBound: () => ({ rows: [], statistics: { elapsedMs: 0 } }) },
    "./materia-families.ts": {
      prepareMateriaFamilies: () => ({ elapsedMs: 0, points: 0, rejectedGroups: 0 }), materiaModelFamilies: () => [],
    },
    "./signature-feasibility.ts": {
      prepareSignatureFeasibility: () => ({ signatureBandGroups: [], isPossiblyFeasibleFactorTuple: () => true }),
    },
    "../signature-band.ts": { hasStrictlyBetterFactorCombination: () => { hit("signature-check"); return config.needsBandSearch === true; } },
    "./factor-model.ts": { factorObjectiveLogScore: () => 7, betterFactors: () => false },
    "./result-decoding.ts": { ...resultDecoding, slotsForResultWithResistanceAllocations: () => [equipment], foodForResult: () => undefined },
    "./attributes.ts": { getAttributeVector: () => [] },
    "./joint-identity.ts": { prepareJointIdentity: () => ({ originalSelectionIdentity: () => "" }) },
    "./joint-preparation.ts": {
      prepareJointJobs: async (options: JointSearchOptions) => {
        hit("preparation");
        return config.noPrepared ? undefined : {
          preparedJobs: options.jobs.map(job => ({ job, prepared: { ...prepared, groups: [] } })),
          canonicalRingRanks: new Map(), canonicalRingSlotIndexes: [], jointInitialResults: [], modelPreparationMs: 0,
        };
      },
    },
    "./joint-model.ts": {
      assembleJointModel: () => { hit("initial-build"); return config.noAssembled ? undefined : {
        rows: baseRows, bounds, binaries: [], generals: bounds.map(bound => bound.name), objective: new Map(),
      }; },
    },
    "./joint-candidate-bounds.ts": { prepareJointCandidateBounds: () => candidateBounds },
    "./joint-ratio-envelope.ts": { assembleJointRatioEnvelope: () => ({
      ratioUpperBoundScale: 1n, ratioUpperBoundVariables: config.ratioProof ? ["g0", "g1"] : [], ratioUpperBoundObjectiveEnabled: config.ratioProof === true,
      ratioUpperBoundObjective: config.ratioProof ? new Map([["g0", 1], ["g1", 1]]) : new Map(), ratioUpperBoundPairCutCount: 0, ratioUpperBoundPairPreprocessingWork: 0,
    }) },
    "./joint-shared-bounds.ts": { createJointSharedBounds: () => shared },
    "./joint-factor-cuts.ts": { createJointFactorCuts: () => cuts },
    "./joint-candidate-proofs.ts": { createJointCandidateProofs: () => ({
      candidateSpecificUpperBoundProofRows: new Map(), candidateSpecificUpperBoundEqualityRows: new Map(), factorScoreUpperCannotBeatThreshold: () => false,
    }) },
    "./joint-iteration-model.ts": { buildJointIterationRows: () => {
      hit("assemble"); return { solveRows: baseRows, jobLowerBounds: [], signatureRestrictions: [] };
    } },
    "./joint-solution-hint.ts": { createJointSolutionHint: () => new Map() },
    "./joint-results.ts": {
      validateJointInitialResults: () => config.initialBest ? { signature: ["g0"], results: jointResults, numerator: 1n, denominator: 1n } : undefined,
      decodeJointSolution: () => { hit("decode"); return { signature: ["g0"], results: jointResults, numerator: 2n, denominator: 1n }; },
    },
  };
  const jointOptions: JointSearchOptions = {
    objective: "damage", strategies: singleOptions.strategies, commonSlots: [], sharedFood: false,
    equipmentIdentity: item => item.key, foodIdentity: food => food.key,
    jobs: [
      { id: "PLD", slotNames: ["weapon"], options: { ...singleOptions }, baseline: factors },
      { id: "WAR", slotNames: ["weapon"], options: { ...singleOptions, job: "WAR" }, baseline: factors },
    ],
    maxSearchMs: singleOptions.maxSearchMs, isCancelled: singleOptions.isCancelled,
    onProgress: singleOptions.onProgress, onSolverProgress: singleOptions.onSolverProgress,
  };
  if (config.perJobCancellation === "parent-active") jointOptions.isCancelled = () => false;
  else if (config.perJobCancellation) delete jointOptions.isCancelled;
  return { state, mocks, singleOptions, jointOptions };
}

async function load(kind: Kind, config: Config = {}) {
  const f = fixture(config);
  vi.spyOn(performance, "now").mockImplementation(() => f.state.now);
  for (const [id, exports] of Object.entries(f.mocks)) {
    registeredMocks.add(id);
    vi.doMock(id, () => exports);
  }
  // Dynamic import happens only after the per-case module mocks are registered.
  // These are the real production owners, without eval/VM/source rewriting.
  const run = kind === "single"
    ? async () => (await import("./single-search.ts")).findBestLoadoutExactMip(f.singleOptions)
    : async () => (await import("./joint-search.ts")).findBestJointFactorMip(f.jointOptions);
  return { ...f, run };
}

type Expected = { reject?: RegExp; errorName?: string; requests?: number; absent?: boolean };
async function execute(kind: Kind, config: Config = {}, expected: Expected = {}) {
  const f = await load(kind, config);
  const originalStrategies = JSON.stringify(f.singleOptions.strategies);
  let result: Awaited<ReturnType<typeof f.run>>, error: unknown;
  try { result = await f.run(); } catch (caught) { error = caught; }
  expect(JSON.stringify(f.singleOptions.strategies)).toBe(originalStrategies);
  if (expected.reject) {
    expect(result).toBeUndefined();
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(expected.reject);
    if (expected.errorName) expect((error as Error).name).toBe(expected.errorName);
  } else {
    if (error) throw error;
    if (expected.absent) expect(result).toBeUndefined();
    else {
      expect(result).toBeDefined();
      if (kind === "single") expect(result).toMatchObject({ damage: 1 });
      else expect(result).toMatchObject({ results: [{ damage: 1 }, { damage: 1 }] });
    }
  }
  if (expected.requests !== undefined) expect(f.state.requests).toHaveLength(expected.requests);
  return { ...f, result };
}

const expired = /达到时限/;
const cancelled = /搜索已取消/;
const phases = ["assemble", "native", "progress-status", "decode", "progress-candidate", "summary"] as const;
function stopAt(phase: Phase, action: Action): Config {
  return { hook: (observed, state) => {
    if (observed === phase) {
      if (action !== "expire") state.cancelled = true;
      if (action !== "cancel") state.now = 10;
    }
  } };
}
function rejected(action: Action, requests?: number): Expected {
  return { reject: action === "expire" ? expired : cancelled, errorName: action === "expire" ? "Error" : "AbortError", requests };
}

describe("production exact-MIP caller budgets with controlled dependencies", { concurrent: false }, () => {
  for (const kind of ["single", "joint"] as const) {
    describe(kind, () => {
      test("returns the complete active fixture", async () => { await execute(kind, {}, { requests: 1 }); });
      test("does not impose a budget on unlimited requests", async () => {
        const f = await execute(kind, { unlimited: true }, { requests: 1 });
        expect(f.state.requests[0]!.timeLimitMs).toBeUndefined();
      });
      test("accepts positive fractional budgets without a minimum floor", async () => {
        const f = await execute(kind, { budget: 0.5 }, { requests: 1 });
        expect(f.state.requests[0]!.timeLimitMs).toBe(0.5);
      });
      test("recomputes 10-7=3ms after assembling the actual request", async () => {
        const f = await execute(kind, { hook: (phase, state) => { if (phase === "assemble") state.now = 7; } }, { requests: 1 });
        expect(f.state.requests[0]!.timeLimitMs).toBe(3);
      });
      for (const action of ["cancel", "expire"] as const) {
        test.each(phases)(`${action} at %s cannot return a result`, async phase => {
          await execute(kind, stopAt(phase, action), rejected(action, phase === "assemble" ? 0 : 1));
        });
        test.each(["Infeasible", "DualBound"])(`${action} after terminal solver %s still rejects`, async status => {
          await execute(kind, { ...stopAt("native", action), status }, rejected(action, 1));
        });
        test(`${action} before undefined preparation cannot return silently`, async () => {
          await execute(kind, { ...stopAt("preparation", action), noPrepared: true }, rejected(action, 0));
        });
        test(`${action} before undefined initial model cannot return silently`, async () => {
          await execute(kind, { ...stopAt("initial-build", action), ...(kind === "single" ? { candidateGate: true } : { noAssembled: true }) }, rejected(action, 0));
        });
      }
      test.each([0, -1, Infinity, -Infinity, NaN, "10", null, false])("rejects malformed maxSearchMs %s before solving", async budget => {
        await execute(kind, { budget }, { reject: /maxSearchMs.*正有限/, errorName: "RangeError", requests: 0 });
      });
      test("still invokes the real integer validator", async () => {
        await execute(kind, { invalidPrimal: true }, { reject: /超出上下界/, requests: 1 });
      });
      test.each(phases)("cancellation wins over simultaneous expiry at %s", async phase => {
        await execute(kind, stopAt(phase, "both"), rejected("both", phase === "assemble" ? 0 : 1));
      });
    });
  }

  test.each([true, "parent-active"] as const)("joint inherits cancellation from an individual job (%s)", async perJobCancellation => {
    await execute("joint", { ...stopAt("native", "cancel"), perJobCancellation }, rejected("cancel", 1));
  });
  test("single checks cancellation after signature-proof progress", async () => {
    await execute("single", stopAt("signature-proof", "cancel"), rejected("cancel", 1));
  });
  test("single cancellation takes priority after the signature checker", async () => {
    await execute("single", stopAt("signature-check", "both"), rejected("both", 1));
  });
  test("joint rechecks after incumbent shared preprocessing in the loop", async () => {
    await execute("joint", { initialBest: true, hook: (phase, state) => {
      if (phase === "shared-preprocess" && state.trace.filter(value => value === phase).length === 2) {
        state.cancelled = true; state.now = 10;
      }
    } }, rejected("both", 0));
  });
  for (const maxToughness of [false, true]) {
    test.each(["cancel", "expire", "both"] as const)(`single microtask %s closes ${maxToughness ? "highest-TEN" : "ordinary"} Infeasible early return`, async action => {
      await execute("single", { maxToughness, status: "Infeasible", hook: (phase, state) => {
        if (phase === "progress-status") queueMicrotask(() => {
          if (action !== "expire") state.cancelled = true;
          if (action !== "cancel") state.now = 10;
        });
      } }, rejected(action, 1));
    });
  }

  for (const kind of ["single", "joint"] as const) {
    test(`${kind} rejects already-cancelled entry before preparation`, async () => {
      const f = await load(kind); f.state.cancelled = true;
      await expect(f.run()).rejects.toMatchObject({ name: "AbortError" });
      expect(f.state.requests).toHaveLength(0); expect(f.state.trace).not.toContain("preparation");
    });
    test(`${kind} allows active undefined preparation`, async () => {
      await execute(kind, { noPrepared: true }, { absent: true, requests: 0 });
    });
    test(`${kind} allows active undefined initial model`, async () => {
      await execute(kind, kind === "single" ? { candidateGate: true } : { noAssembled: true }, { absent: true, requests: 0 });
    });
    test(`${kind} allows active initial Infeasible`, async () => {
      await execute(kind, { status: "Infeasible" }, { absent: true, requests: 1 });
    });
  }
  test("single allows active highest-TEN Infeasible", async () => {
    const f = await execute("single", { maxToughness: true, status: "Infeasible" }, { absent: true, requests: 1 });
    expect(f.state.requests[0]!.name).toBe("maximum_tenacity");
  });
  test.each(["Infeasible", "DualBound"])("joint can retain an active incumbent after terminal %s", async status => {
    const f = await execute("joint", { initialBest: true, status, ratioProof: status === "DualBound" }, { requests: 1 });
    expect(f.result).toMatchObject({ solverRuns: 1, innerSolverStatus: status,
      termination: status === "DualBound" ? "ratio-dual-bound" : "remaining-domain-infeasible" });
  });
  test("a non-ratio request cannot finish on a dual bound", async () => {
    await execute("joint", { initialBest: true, status: "DualBound" }, { reject: /比例上界/, requests: 1 });
  });
  test("single can return the checked incumbent after band Infeasible", async () => {
    const f = await execute("single", { needsBandSearch: true, statuses: ["Optimal", "Infeasible"] }, { requests: 2 });
    expect(f.state.requests.map(request => request.name)).toEqual(["exact_damage_initial", "exact_damage_band_feasibility"]);
  });
  test.each(["cancel", "expire", "both"] as const)("single microtask %s closes the incumbent band Infeasible return", async action => {
    await execute("single", { needsBandSearch: true, statuses: ["Optimal", "Infeasible"], hook: (phase, state) => {
      if (phase === "progress-status" && state.requests.length === 2) queueMicrotask(() => {
        if (action !== "expire") state.cancelled = true;
        if (action !== "cancel") state.now = 10;
      });
    } }, rejected(action, 2));
  });
});
