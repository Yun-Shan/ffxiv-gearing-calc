import type { JobId } from "@/domain";
import type { UiOptimizationConfig as OptimizationConfig } from "@/ui/services/search-config";

export type SearchRangeDraft = Pick<
  OptimizationConfig,
  "minItemLevel" | "maxItemLevel" | "sync" | "syncDuty" | "clanIndex"
>;

export type GcdDraft =
  | { mode: "any" }
  | { mode: "tiers"; tiers: number[]; multiple?: boolean }
  | { mode: "speed"; min?: number; max?: number };

export type FoodDraft = { mode: "auto" } | { mode: "specific"; foodId: number };

export type TankStrategy = "any" | "tenacity" | "reduction" | "maximize";

/** Empty numeric input is an editing state; the strategy itself is always explicit. */
export type TankConditionDraft =
  | { strategy: "any" }
  | { strategy: "tenacity"; minimumTenacity?: number }
  | { strategy: "reduction"; minimumDamageReductionPercent?: number }
  | { strategy: "maximize" };

export interface JobConditionDraft {
  range: SearchRangeDraft;
  gcd: GcdDraft;
  food: FoodDraft;
  tank: TankConditionDraft;
}

export type GcdAnalysisState =
  | { status: "idle" }
  | { status: "loading"; key: string }
  | { status: "ready"; key: string; feasibleTiers: number[] }
  | { status: "error"; key: string; message: string };

export interface JobConditionRuntime {
  gcdAnalysis: GcdAnalysisState;
}

/** Only fields that can change the feasible GCD set; objective and GCD selection are excluded. */
export type GcdAnalysisInput = Pick<
  OptimizationConfig,
  | "jobId"
  | "minItemLevel"
  | "maxItemLevel"
  | "speedMin"
  | "speedMax"
  | "sync"
  | "clanIndex"
  | "minTenacity"
  | "toughnessMinPercent"
  | "maximizeTenacity"
  | "excludedSources"
  | "excludedGearIds"
  | "forcedGear"
  | "foodId"
>;

export interface JobConditionCompileContext {
  jobId: JobId;
  autoFoodId?: number;
  feasibleGcds?: readonly number[];
}

export interface CompiledJobCondition {
  config: Pick<
    OptimizationConfig,
    | "jobId"
    | "minItemLevel"
    | "maxItemLevel"
    | "sync"
    | "syncDuty"
    | "clanIndex"
    | "gcdChoices"
    | "speedMin"
    | "speedMax"
    | "minTenacity"
    | "toughnessMinPercent"
    | "maximizeTenacity"
    | "objective"
    | "foodId"
  >;
}

export type ValidationStatus = "valid" | "invalid" | "pending";

export interface ValidationIssue {
  code: string;
  message: string;
  path: readonly (string | number)[];
  jobId?: JobId;
}

export interface SectionValidation {
  status: ValidationStatus;
  issues: readonly ValidationIssue[];
}

export interface JobValidation {
  status: ValidationStatus;
  valid: boolean;
  issues: readonly ValidationIssue[];
  sections: Readonly<{
    range: SectionValidation;
    gcd: SectionValidation;
    tank: SectionValidation;
  }>;
}

export interface WorkbenchValidation {
  status: ValidationStatus;
  valid: boolean;
  issues: readonly ValidationIssue[];
  shared?: { status: ValidationStatus; issues: readonly ValidationIssue[] };
  jobs: Readonly<Partial<Record<JobId, JobValidation>>>;
}

export type AnalyzeFeasibleGcds = (
  input: GcdAnalysisInput,
  signal: AbortSignal,
) => Promise<readonly number[]>;
