import { calculateFeasibleGcdTiers } from "../gcd-tier-calculator.ts";
import {
  calculationJobLevelFor,
  gearOptionsFor,
  slotsForJob,
} from "../gear-options.ts";
import type { OptimizationConfig, SearchOptions } from "../types.ts";
import { withDomainItemSpecialBonusDefaults } from "../item-special-bonus.ts";

export function findFeasibleGcdsLocally(
  config: OptimizationConfig,
  options: SearchOptions = {},
): number[] {
  config = withDomainItemSpecialBonusDefaults(config);
  return calculateFeasibleGcdTiers(config, options, {
    getJobLevel: calculationJobLevelFor,
    gearOptionsFor,
    slotsForJob,
  });
}
