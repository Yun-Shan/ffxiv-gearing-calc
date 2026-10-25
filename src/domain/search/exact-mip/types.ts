import type { MemoryUsageSnapshot } from "../memory-usage.ts";
import type { LoadoutSearchResult } from "../search-types.ts";
import type { JobId } from "../../types.ts";
import type { Stat } from "../../types.ts";
import type { EquipInfo } from "../types.ts";
import type { FoodInfo } from "../types.ts";
import type { LoadoutConstraints } from "../search-types.ts";
import type { GcdSpeedRange } from "../search-types.ts";
import type { EquipmentAttributeExtractor } from "../search-types.ts";
import type { CandidateResourceSupportProfile } from "../candidate-resource-support-policy.ts";
import type { ResourceBudgetCandidateProfile } from "../candidate-resource-support-policy.ts";
import type { LinearMipProgress } from "../linear-mip.ts";
import type { HighsCallbackTrace } from "../linear-mip.ts";

export type JobLevel = number;

export type FactorClass = {
  min: number;
  max: number;
  value: number;
  auxiliary?: number;
  variable: string;
  q: number;
};

export type FactorGroup = {
  name: string;
  classes: FactorClass[];
};

export type AttributeFoodBonus = {
  foodIndex: number;
  attribute: number;
  bonus: string;
  capped: string;
  numerator: number;
  denominator: number;
  cap: number;
  maximumRaw: number;
};

export type ExactMipSearchStatistics = {
  elapsedMs: number;
  modelPreparationMs?: number;
  greedyMipStartMs?: number;
  solverWallMs?: number;
  otherSearchMs?: number;
  solverRuns: number;
  excludedSignatures: number;
  signatureBandChecks: number;
  signatureBandElapsedMs: number;
  signatureBandProof: boolean;
  variables: number;
  constraints: number;
  reachableFactorClassesRemoved?: number;
  reachableAttributePruningSkipped?: number;
  reachableWeaponFactorClassesRemoved?: number;
  reachableWeaponPruningSkipped?: number;
  maximumSurrogate: number;
  nextSurrogate: number | undefined;
  memoryUsage: MemoryUsageSnapshot;
  candidateUpperBound?: {
    candidatesBefore: number;
    candidatesAfter: number;
    elapsedMs: number;
  };
  resourceBudgetCandidateBound?: {
    candidates: number;
    supportCount: number;
    preparationMs: number;
  };
  resourceBudgetCandidateCuts?: number;
  primaryResourceSupportsEnabled?: boolean;
  mainStatResourceSupportEnabled?: boolean;
  incumbentCandidateUpperBoundCuts?: number;
  conditionalResourceSupport?: {
    candidateBands: number;
    rowsAdded: number;
    weightedRowsAdded?: number;
    nonzerosAdded: number;
    weightedResourceWeights?: Readonly<Record<string, number>>;
    skipReason?: "disabled-by-policy" | "no-out-of-window-candidates" | "no-strictly-tighter-bands" | "ring-pair-candidates" | "model-budget";
  };
};

export type ExactMipResult = LoadoutSearchResult & {
  maximumToughness?: number;
  statistics: ExactMipSearchStatistics;
};

export type ExactMipOptions = {
  job: JobId;
  jobLevel: JobLevel;
  /** 族群基础属性索引。 */
  clanIndex: number;
  attributeIds: readonly number[];
  statIndexes: ReadonlyMap<Stat, number>;
  slots: readonly (readonly EquipInfo[])[];
  foods: readonly FoodInfo[];
  constraints?: LoadoutConstraints;
  speedAttributeId?: number;
  toughnessAttributeId?: number;
  gcdToSpeedRange?: (gcdSeconds: number) => GcdSpeedRange | undefined;
  toughnessPercentToMinimum?: (percentage: number) => number;
  equipmentAttributeExtractor?: EquipmentAttributeExtractor;
  evaluationFunction: (
    attributes: readonly number[],
  ) => { damage: number; gcd: number } | undefined;
  /** 当前请求明确指定的搜索目标。 */
  objective: "damage" | "dps";
  /** 仅用于强化精确 MIP 资源松弛的内部区间。 */
  candidateItemLevelRanges?: readonly { min: number; max: number }[];
  /** V3 内部策略：根据品级先验构造条件约束行的数量。 */
  candidateResourceSupportProfile?: CandidateResourceSupportProfile;
  /** 在此前测量过的精确候选上界档位中进行内部选择。 */
  resourceBudgetCandidateProfile?: ResourceBudgetCandidateProfile;
  /** V3 基线内部策略；添加隐含的主属性或加权资源不等式。 */
  primaryResourceSupports?: boolean;
  /** V3 内部策略；仅添加主属性资源不等式。 */
  mainStatResourceSupport?: boolean;
  maxSearchMs?: number;
  onProgress?: (message: string) => void;
  onSolverProgress?: (event: LinearMipProgress) => void;
  onSolverCallback?: (event: HighsCallbackTrace) => void;
  isCancelled?: () => boolean;
};
