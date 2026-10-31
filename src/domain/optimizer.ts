import type {
  JointOptimizationConfig,
  JointOptimizationResult,
  OptimizationConfig,
  OptimizationResult,
  SearchOptions,
} from "./types.ts";
import { normalizeSearchStrategies } from "./search/strategies.ts";

export { slotsForJob } from "./optimizer/context.ts";
export { gearOptionsFor } from "./optimizer/equipment-candidates.ts";
export { runOptimizationLocally } from "./optimizer/single-search.ts";
export { runJointOptimizationLocally } from "./optimizer/joint-search.ts";
export { findFeasibleGcdsLocally } from "./optimizer/gcd-search.ts";

export async function optimize(
  config: OptimizationConfig,
  options: SearchOptions = {},
): Promise<OptimizationResult | undefined> {
  options = { ...options, strategies: normalizeSearchStrategies(options.strategies) };
  const { optimizeInWorker } = await import("./worker-client");
  return optimizeInWorker({ kind: "single", config }, options);
}

export async function optimizeJoint(
  config: JointOptimizationConfig,
  options: SearchOptions = {},
): Promise<JointOptimizationResult | undefined> {
  options = { ...options, strategies: normalizeSearchStrategies(options.strategies) };
  const { optimizeInWorker } = await import("./worker-client");
  return optimizeInWorker({ kind: "joint", config }, options);
}

export async function findFeasibleGcds(
  config: OptimizationConfig,
  options: SearchOptions = {},
): Promise<number[]> {
  options = { ...options, strategies: normalizeSearchStrategies(options.strategies) };
  const { optimizeInWorker } = await import("./worker-client");
  return optimizeInWorker({ kind: "gcds", config }, options);
}
