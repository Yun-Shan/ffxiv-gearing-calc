/**
 * Solver-side equipment shape. `baseParamId` is an index in the attribute
 * vector supplied by the caller, not a Lumina BaseParam row ID.
 */
export type ParamInfo = {
  baseParamId: number;
  value: number;
};

export type FoodParam = {
  /** Base attributes included before applying the food percentage. */
  baseValue?: number;
  baseParamId: number;
  multiplier: number;
  maxValue: number;
};

export type ComparableInfo = {
  itemId: number;
  itemLevel: number;
  key: string;
  baseParams: (ParamInfo | FoodParam)[];
};

export type FoodInfo = {
  itemId: number;
  itemLevel: number;
  key: string;
  /** Identity of the physical food, independent of job-specific usable stats. */
  physicalKey?: string;
  baseParams: FoodParam[];
};

export type EquipInfo = {
  itemId: number;
  itemLevel: number;
  /** Stable encoding of custom parameters and actual materia assignment. */
  variantKey?: string;
  key: string;
  baseParams: ParamInfo[];
  PDMG: number;
  MDMG: number;
  DLY: number;
};

/** A shared virtual slot projected from a full equipment candidate. */
export type SharedSlotProjection = {
  /** User-facing/common-slot key, for example "ring" or "ring2". */
  commonSlot: string;
  /** Real solver slot which contains the complete candidate. */
  slotName: string;
  /** Index within a legal ordered ring pair. */
  ringIndex: 0 | 1;
};
