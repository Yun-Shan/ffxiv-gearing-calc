import type {
  JobId,
  JointOptimizationResult,
} from "@/domain";
import type { UiJointOptimizationConfig as JointOptimizationConfig } from "@/ui/services/search-config";
import type { JointSearchProgressState } from "./joint-workbench-progress-types";
import type {
  FoodDraft,
  GcdDraft,
  JobConditionDraft,
  JobConditionRuntime,
  SearchRangeDraft,
  TankConditionDraft,
} from "@/ui/features/job-condition/types";
import type { JointEquipmentDraft } from "@/ui/features/equipment/types";

export type {
  FoodDraft,
  GcdDraft,
  JobConditionDraft,
  JobConditionRuntime,
  SearchRangeDraft,
  TankConditionDraft,
};

export type JointEditorTarget = "shared" | JobId;

/**
 * 联合条件中每个职业只保留职业级条件；搜索范围与食物策略属于共享配置。
 * 编译时使用 JointSharedDraft.range 生成每个职业的完整 OptimizationConfig。
 */
export type JointJobConditionDraft = Pick<
  JobConditionDraft,
  "gcd" | "food" | "tank"
>;

export type JointJobConditionDraftChange =
  | JointJobConditionDraft
  | ((current: JointJobConditionDraft) => JointJobConditionDraft);

export interface JointSharedDraft {
  range: SearchRangeDraft;
  foodStrategy: "shared" | "independent";
  food: FoodDraft;
  equipment: JointEquipmentDraft;
}

export interface JointWorkbenchDraft {
  jobs: readonly JobId[];
  conditions: Readonly<Record<JobId, JointJobConditionDraft>>;
  shared: JointSharedDraft;
}

export type JointWorkbenchRuntime = Readonly<Record<JobId, JobConditionRuntime>>;

export interface JointOptimizationSnapshot {
  config: JointOptimizationConfig;
  dataVersion: string;
  startedAtISO?: string;
  historyId?: string;
}

export type JointWorkbenchPhase =
  | { phase: "selection" }
  | {
      phase: "conditions";
      draft: JointWorkbenchDraft;
      runtime: JointWorkbenchRuntime;
    }
  | {
      phase: "progress";
      snapshot: JointOptimizationSnapshot;
      progress: JointSearchProgressState;
      startedAt: number;
    }
  | {
      phase: "result";
      snapshot: JointOptimizationSnapshot;
      result: JointOptimizationResult;
    };
