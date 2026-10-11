import type { CallbackType } from "highs";

/** A finite-domain integer linear model used by the exact loadout search. */
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
  /** Incumbent objective value, taken from HiGHS' primal bound when present. */
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

/** Detached, serializable context for a full HiGHS callback observation. */
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
  timeLimitMs?: number;
  solutionHint?: ReadonlyMap<string, number>;
  /** Interrupt a maximization after its proven dual bound cannot beat an exact incumbent. */
  stopWhenDualBoundProvesOptimal?: (dualBound: number) => boolean;
  onProgress?: (event: LinearMipProgress) => void;
  onCallback?: (event: HighsCallbackTrace) => void;
};

export type LinearMipSolution = {
  Status: string;
  Columns: Record<string, { Primal: number }>;
  ObjectiveValue?: number;
};
