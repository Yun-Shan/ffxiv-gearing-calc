import { calculateFeasibleGcdTiers } from "../gcd-tier-calculator.ts";
import {
  calculationJobLevelFor,
  gearOptionsFor,
  slotsForJob,
} from "../gear-options.ts";
import type { OptimizationConfig, SearchOptions } from "../types.ts";

export function findFeasibleGcdsLocally(
  config: OptimizationConfig,
  options: SearchOptions = {},
): number[] {
  return calculateFeasibleGcdTiers(config, options, {
    getJobLevel: calculationJobLevelFor,
    gearOptionsFor,
    slotsForJob,
  });
}
