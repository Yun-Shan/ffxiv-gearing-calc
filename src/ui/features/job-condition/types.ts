import type { JobId, OptimizationConfig } from "@/domain";

export type SyncItemLevelDraft =
  { mode: "disabled" } | { mode: "enabled"; itemLevel: number };

export interface SearchRangeDraft {
  minItemLevel: number;
  maxItemLevel: number;
  sync: SyncItemLevelDraft;
  /** 族群基础属性索引；默认 0（人族·中原之民）。 */
  clanIndex: number;
}

export type GcdDraft =
  | { mode: "any" }
  | { mode: "tiers"; tiers: number[] }
  | { mode: "speed"; min?: number; max?: number };

export type FoodDraft = { mode: "auto" } | { mode: "specific"; foodId: number };

export type TankStrategy = "any" | "tenacity" | "reduction" | "maximize";

export interface TankConditionDraft {
  /** Editor strategy belongs to the draft, never to a domain request. */
  strategy?: TankStrategy;
  minimumTenacity?: number;
  minimumDamageReductionPercent?: number;
  maximizeTenacity: boolean;
}

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
  | "syncLevel"
  | "clanIndex"
  | "minTenacity"
  | "toughnessMin"
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
    | "syncLevel"
    | "clanIndex"
    | "gcdTarget"
    | "gcdChoices"
    | "speedMin"
    | "speedMax"
    | "minTenacity"
    | "toughnessMinPercent"
    | "maximizeTenacity"
    | "objective"
    | "foodId"
  >;
  levelResolution: "domain";
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
