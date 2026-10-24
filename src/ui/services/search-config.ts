import type { JointOptimizationConfig, OptimizationConfig } from "@/domain";

/** UI snapshots retain the selected duty; calculation identity is still just SyncTarget. */
export type UiOptimizationConfig = OptimizationConfig & { syncDuty?: string };
export type UiJointOptimizationConfig = Omit<
  JointOptimizationConfig,
  "jobs"
> & {
  jobs: UiOptimizationConfig[];
};

export function optimizationConfigForDomain(
  config: UiOptimizationConfig,
): OptimizationConfig {
  const { syncDuty: _syncDuty, ...input } = config;
  return input;
}

export function jointConfigForDomain(
  config: UiJointOptimizationConfig,
): JointOptimizationConfig {
  return { ...config, jobs: config.jobs.map(optimizationConfigForDomain) };
}
