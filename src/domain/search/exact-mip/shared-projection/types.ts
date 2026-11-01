export const PROJECTION_AXES = [
  "weapon",
  "main",
  "det",
  "ten",
  "crt",
  "dht",
  "gcd",
] as const;
export type ProjectionAxisName = (typeof PROJECTION_AXES)[number];

export type ProjectionClass = {
  min: number;
  max: number;
  q: number;
  value: number;
  selector: string;
};
export type ProjectionAxis = {
  name: ProjectionAxisName;
  rawMin: number;
  rawMax: number;
  classes: readonly ProjectionClass[];
};
export type ProjectionChoice = { key: string; values: readonly number[] };
export type ProjectionSlot = {
  name: string;
  choices: readonly ProjectionChoice[];
};
export type ProjectionBonus = {
  numerator: number;
  denominator: number;
  offset: number;
  cap: number;
};
export type ProjectionFood = {
  key: string;
  sharedKey: string;
  bonuses: readonly (ProjectionBonus | null)[];
};
export type ProjectionJob = {
  axes: readonly ProjectionAxis[];
  slots: readonly ProjectionSlot[];
  foods: readonly ProjectionFood[];
  rhs: number;
  speedRanges?: readonly { min: number; max: number }[];
};
export type ProjectionBlock = {
  name: string;
  keys: readonly { key: string; selectors: readonly string[] }[];
};
export type ProjectionModel = {
  blocks: readonly ProjectionBlock[];
  jobs: readonly ProjectionJob[];
};

/** Only a local projection may decline work. Cancellation and the search deadline propagate separately. */
export class ProjectionLimit extends Error {}
