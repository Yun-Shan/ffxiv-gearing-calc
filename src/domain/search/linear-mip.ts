import type { CallbackType } from "highs";
import type { MateriaModelFamily, MateriaFamilyProjectionStatistics } from "./core/materia-family-projection.ts";

/** 精确配装搜索使用的有限域整数线性模型。 */
export type LinearMipRow = {
  name: string;
  terms: ReadonlyMap<string, number>;
  sense: "=" | "<=" | ">=";
  rhs: number;
};

export type LinearMipVariable = {
  name: string;
  min: number;
  max: number;
};

export type LinearMipProgress = {
  backend: "HiGHS";
  model: string;
  kind: "incumbent" | "bound" | "log";
  elapsedMs?: number;
  /** 当前最优解的目标值；若存在，则取自 HiGHS 的原始界。 */
  objectiveValue?: number;
  bestBound?: number;
  gap?: number;
  nodes?: string;
  totalLpIterations?: string;
  variableCount?: number;
  rowCount?: number;
  status?: string;
  completed?: boolean;
  message?: string;
};

export type HighsCallbackName =
  | "logging"
  | "simplexInterrupt"
  | "ipmInterrupt"
  | "mipSolution"
  | "mipImprovingSolution"
  | "mipLogging"
  | "mipInterrupt"
  | "mipCutPool"
  | "mipUserSolution";

/** 用于完整记录 HiGHS 回调观测结果的独立可序列化上下文。 */
export type HighsCallbackTrace = {
  model: string;
  callbackType: CallbackType;
  callbackName: HighsCallbackName;
  event: {
    ownKeys: string[];
    type: CallbackType;
    message: string;
    data: Readonly<Record<string, unknown>>;
    controlMethods: {
      interrupt: boolean;
      setSolution: boolean;
      repairSolution: boolean;
    };
  };
};

export type LinearMipRequest = {
  name: string;
  objective: ReadonlyMap<string, number>;
  rows: readonly LinearMipRow[];
  variables: readonly LinearMipVariable[];
  binaryVariables: readonly string[];
  integerVariables: readonly string[];
  /** Object policy also supports a safe integer percentage in [0,100], defaulting to zero. */
  equalityQuotient?: boolean | { maxRowDensityGrowth: number; minVariableReductionPercent?: number };
  materiaFamilies?: readonly MateriaModelFamily[];
  isCancelled?: () => boolean;
  onMateriaFamilyProjection?: (statistics: MateriaFamilyProjectionStatistics) => void;
  timeLimitMs?: number;
  solutionHint?: ReadonlyMap<string, number>;
  /** 当已证明的对偶界无法超过精确当前最优解时，中断最大化求解。 */
  stopWhenDualBoundProvesOptimal?: (dualBound: number) => boolean;
  onProgress?: (event: LinearMipProgress) => void;
  onCallback?: (event: HighsCallbackTrace) => void;
};

export type LinearMipSolution = {
  Status: string;
  Columns: Record<string, { Primal: number }>;
  ObjectiveValue?: number;
};
