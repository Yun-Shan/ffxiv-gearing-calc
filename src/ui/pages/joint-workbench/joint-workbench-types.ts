import type {
  JobId,
  JointOptimizationConfig,
  JointOptimizationResult,
} from "@/domain";
import type { JointSearchProgressState } from "./joint-workbench-progress-types";
import type {
  FoodDraft,
  JobConditionDraft,
  JobConditionRuntime,
} from "@/ui/features/job-condition/types";
import type { JointEquipmentDraft } from "@/ui/features/equipment/types";

export type { FoodDraft, JobConditionDraft, JobConditionRuntime };

export type JointEditorTarget = "shared" | JobId;

export interface JointSharedDraft {
  foodStrategy: "shared" | "independent";
  food: FoodDraft;
  equipment: JointEquipmentDraft;
}

export interface JointWorkbenchDraft {
  jobs: readonly JobId[];
  conditions: Readonly<Record<JobId, JobConditionDraft>>;
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
      durationMs: number;
    };
