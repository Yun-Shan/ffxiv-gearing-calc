import type { LinearMipRow } from "../../linear-mip.ts";
import { strategyEnabled, type SearchStrategies } from "../../strategies.ts";
import type { JointModel } from "../joint-model.ts";
import type { JointIncumbent } from "../joint-results.ts";
import type { JointPreparedJob, JointSearchOptions } from "../joint-types.ts";
import { projectFixedRanks } from "./fixed-ranks.ts";
import { prepareProjectionModel } from "./model.ts";
import { ProjectionLimit } from "./types.ts";
import { projectVariableStates } from "./variable-states.ts";

export function canProjectSharedDomain(strategies?: SearchStrategies): boolean {
  // These searches use shared states, exact factor/speed supports and
  // conditional resource bounds together. Other solver policies keep their
  // own switches (including hints, native representations and restricted reuse).
  return (
    strategyEnabled(strategies, "sharedStateSearch") &&
    strategyEnabled(strategies, "factorReachability") &&
    strategyEnabled(strategies, "speedFoodProjection") &&
    strategyEnabled(strategies, "resourceSupports") &&
    strategyEnabled(strategies, "conditionalResourceSupports") &&
    strategyEnabled(strategies, "jointSharedBounds") &&
    strategyEnabled(strategies, "jointFactorCuts")
  );
}

type ResidualProjection = {
  route: "fixed-ten-ranks" | "shared-attributes";
  closed: boolean;
  rows: LinearMipRow[];
  details: Readonly<Record<string, number | string>>;
};

/** The result is computed and consumed synchronously for these exact iteration
 * rows. No proof or subset of candidates is cached across a change of incumbent. */
export function projectRemainingDomain(
  options: JointSearchOptions,
  jobs: readonly JointPreparedJob[],
  model: JointModel,
  jobLowerBounds: readonly LinearMipRow[],
  signatureRestrictions: readonly LinearMipRow[],
  best: JointIncumbent,
  budgetMs: number,
  checkSearch: () => void,
): ResidualProjection | undefined {
  checkSearch();
  if (
    !canProjectSharedDomain(options.strategies) ||
    !model.sharedEquipmentDomains.length ||
    budgetMs < 1 ||
    jobs.length < 2 ||
    jobs.length > 16 ||
    jobs.some((_, i) => !jobLowerBounds[i])
  )
    return;
  const start = performance.now();
  let localMs = budgetMs;
  let interrupted = false;
  let interruption: unknown;
  const check = () => {
    if (interrupted) throw interruption;
    try {
      checkSearch();
    } catch (error) {
      interrupted = true;
      interruption = error;
      throw error;
    }
    if (performance.now() - start >= localMs)
      throw new ProjectionLimit("共享投影达到局部时限");
  };
  try {
    const domain = prepareProjectionModel(
      options,
      jobs,
      model,
      jobLowerBounds,
      check,
    );
    if (!domain) return;
    if (
      domain.jobs.every((job) => job.axes[3]!.rawMin === job.axes[3]!.rawMax)
    ) {
      localMs = Math.min(localMs, 20_000);
      check();
      const { closed, rows, ...details } = projectFixedRanks(
        domain,
        signatureRestrictions,
        check,
      );
      check();
      return { route: "fixed-ten-ranks", closed, rows, details };
    }
    const productRow = signatureRestrictions.find((row) => row.sense === ">=");
    if (options.objective !== "damage" || !options.sharedFood || !productRow)
      return;
    // The variable-resource gate sums each job's original normalized Q.
    // Only the exact aggregate row with those coefficients supplies its RHS.
    const coefficients = new Map(
      jobLowerBounds.flatMap((row) => [...row.terms]),
    );
    if (
      productRow.terms.size !== coefficients.size ||
      [...coefficients].some(([v, q]) => productRow.terms.get(v) !== q)
    )
      return;
    const state = projectVariableStates(
      domain,
      productRow.rhs,
      jobs.map((j) => j.job.baseline),
      best,
      check,
    );
    check();
    return {
      route: "shared-attributes",
      closed: state.closed,
      rows: [],
      details: { axes: state.stages.join(",") },
    };
  } catch (error) {
    if (interrupted) throw interruption;
    checkSearch();
    if (!(error instanceof ProjectionLimit)) throw error;
    return undefined;
  }
}
