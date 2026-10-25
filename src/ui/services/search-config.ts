import type { JointOptimizationConfig, OptimizationConfig } from "@/domain";
import {
  jointOptimizationConfigError,
  optimizationConfigError,
} from "@/domain";

/** UI snapshots retain the selected duty; calculation identity is still just SyncTarget. */
export type UiOptimizationConfig = OptimizationConfig & { syncDuty?: string };
export type UiJointOptimizationConfig = Omit<
  JointOptimizationConfig,
  "jobs"
> & {
  jobs: UiOptimizationConfig[];
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function uiOptimizationConfigError(value: unknown): string | undefined {
  if (!isObject(value)) return optimizationConfigError(value);
  const { syncDuty, ...input } = value;
  const error = optimizationConfigError(input);
  if (error) return error;
  if (
    syncDuty !== undefined &&
    (value.sync === undefined ||
      typeof syncDuty !== "string" ||
      syncDuty.trim().length === 0)
  )
    return "同步副本名称无效";
  return undefined;
}

export function uiJointOptimizationConfigError(
  value: unknown,
): string | undefined {
  if (!isObject(value) || !Array.isArray(value.jobs))
    return jointOptimizationConfigError(value);
  for (const job of value.jobs) {
    const error = uiOptimizationConfigError(job);
    if (error) return error;
  }
  const jobs = value.jobs as UiOptimizationConfig[];
  if (jobs.some((job) => job.syncDuty !== jobs[0]!.syncDuty))
    return "联合搜索的同步副本名称必须一致";
  return jointOptimizationConfigError({
    ...value,
    jobs: jobs.map(optimizationConfigForDomain),
  });
}

export function assertUiJointOptimizationConfig(
  value: unknown,
): asserts value is UiJointOptimizationConfig {
  const error = uiJointOptimizationConfigError(value);
  if (error) throw new TypeError(error);
}

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
