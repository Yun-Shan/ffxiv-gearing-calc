/**
 * 求解器使用的装备结构。`baseParamId` 是调用方提供的属性向量中的索引，
 * 并非 Lumina BaseParam 行 ID。
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
  /** 应用食物百分比加成前包含的基础属性。 */
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
  /** 食物实体身份，与职业可用属性无关。 */
  physicalKey?: string;
  baseParams: FoodParam[];
};

export type EquipInfo = {
  itemId: number;
  itemLevel: number;
  /** 标识独立的第一或第二戒指槽，供精确唯一装备约束使用。 */
  ringSlotIndex?: 0 | 1;
  /** 物品实体的唯一性元数据；戒指候选跨越工作线程边界时仍会保留。 */
  isUnique?: boolean;
  /** 自定义参数和实际魔晶石分配的稳定编码。 */
  variantKey?: string;
  key: string;
  baseParams: ParamInfo[];
  PDMG: number;
  MDMG: number;
  DLY: number;
  resistanceWeaponAdjust?: ResistanceWeaponAdjust & {
    /** 当前品级同步上限导致的各属性降低值。 */
    statMaximums?: Partial<Record<CustomizableStat, number>>;
  };
  /** 选中的正数分配值，仅附加到已求解结果中。 */
  resistanceAllocation?: readonly {
    stat: CustomizableStat;
    baseParamId: number;
    value: number;
  }[];
};

/** 从完整装备候选中投影出的共享虚拟槽位。 */
export type SharedSlotProjection = {
  /** 面向用户的共享槽位键，例如 "ring" 或 "ring2"。 */
  commonSlot: string;
  /** 包含完整候选的实际求解器槽位。 */
  slotName: string;
  /** 在合法有序戒指对中的索引。 */
  ringIndex: 0 | 1;
};
