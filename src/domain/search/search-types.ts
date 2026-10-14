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
  /** 优化同一结果时，接受列表中的任一精确 GCD 阈值。 */
  gcdChoices?: readonly number[];
  speedMin?: number;
  speedMax?: number;
  toughnessMinPercent?: number;
  toughMin?: number;
  maxToughnessMode?: boolean;
};

export type GcdSpeedRange = { min: number; max: number };
