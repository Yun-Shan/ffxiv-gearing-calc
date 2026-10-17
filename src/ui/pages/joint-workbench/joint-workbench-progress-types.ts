import type { JobId } from "@/domain/types";
import type { LinearMipProgress } from "@/domain/search/linear-mip";

export type JointSearchPhase = "prepare" | "baseline" | "joint" | "verify";

export interface JointSearchStats {
  seedCandidates?: number;
  seedLimit?: number;
  warmStartCandidates?: number;
  exactAttempts?: number;
  outerNodes?: number;
  completeNodes?: number;
  upperBoundPrunes?: number;
  innerMipSolves?: number;
  parentResultReuses?: number;
  incumbent?: number;
  elapsedMs?: number;
}

export interface JointSearchProgressJob {
  jobId: JobId;
  name: string;
  prepared: boolean;
  preparationFailed?: boolean;
  solver?: LinearMipProgress;
}

export interface JointSearchProgressState {
  phase: JointSearchPhase;
  startedAt: number;
  jobs: readonly JointSearchProgressJob[];
  jointSolver?: LinearMipProgress;
  jointStats: JointSearchStats;
  verifyMessage?: string;
}
