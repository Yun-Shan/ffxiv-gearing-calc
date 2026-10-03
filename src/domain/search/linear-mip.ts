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
  objectiveValue?: number;
  bestBound?: number;
  gap?: number;
  nodes?: string;
  message?: string;
};

export type LinearMipRequest = {
  name: string;
  objective: ReadonlyMap<string, number>;
  rows: readonly LinearMipRow[];
  variables: readonly LinearMipVariable[];
  binaryVariables: readonly string[];
  integerVariables: readonly string[];
  timeLimitMs: number;
  solutionHint?: ReadonlyMap<string, number>;
  onProgress?: (event: LinearMipProgress) => void;
};

export type LinearMipSolution = {
  Status: string;
  Columns: Record<string, { Primal: number }>;
  ObjectiveValue?: number;
};
