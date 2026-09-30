import type { EquipInfo, FoodInfo, ParamInfo } from "./types.ts";

export type EquipmentAttributeExtractor = (
  equipment: EquipInfo,
) => readonly ParamInfo[];

export type LoadoutSearchResult = {
  damage: number;
  selection: EquipInfo[];
  food: FoodInfo | undefined;
};

export type LoadoutConstraints = {
  gcd?: number;
  speedMin?: number;
  speedMax?: number;
  toughnessMinPercent?: number;
  toughMin?: number;
  maxToughnessMode?: boolean;
};

export type GcdSpeedRange = { min: number; max: number };
