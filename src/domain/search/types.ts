/**
 * Solver-side equipment shape. `baseParamId` is an index in the attribute
 * vector supplied by the caller, not a Lumina BaseParam row ID.
 */
import type {
  CustomizableStat,
  ResistanceWeaponAdjust,
} from "../types.ts";

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
  /** Identifies an independent first/second ring slot for exact unique-item constraints. */
  ringSlotIndex?: 0 | 1;
  /** Physical item uniqueness metadata, retained when ring candidates cross a worker boundary. */
  isUnique?: boolean;
  /** Stable encoding of custom parameters and actual materia assignment. */
  variantKey?: string;
  key: string;
  baseParams: ParamInfo[];
  PDMG: number;
  MDMG: number;
  DLY: number;
  resistanceWeaponAdjust?: ResistanceWeaponAdjust & {
    /** Per-stat reduction caused by the active item-level sync cap. */
    statMaximums?: Partial<Record<CustomizableStat, number>>;
  };
  /** Selected positive allocation values, attached only to a solved result. */
  resistanceAllocation?: readonly {
    stat: CustomizableStat;
    baseParamId: number;
    value: number;
  }[];
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
