import { getSpeedStat, jobSchemas, type JobId } from "@/domain";
import type { CommonGearSlot, GearSlot, Stat } from "@/domain";

export const gearSlotLabels: Record<GearSlot, string> = {
  weapon: "武器",
  offhand: "盾牌",
  head: "头部",
  body: "身体",
  hands: "手部",
  legs: "腿部",
  feet: "脚部",
  earrings: "耳饰",
  necklace: "项链",
  bracelet: "手镯",
  ring: "戒指1",
  ring2: "戒指2",
};

export const commonGearSlotLabels: Record<CommonGearSlot, string> = {
  ...gearSlotLabels,
  ring: "戒指 1",
  ring2: "戒指 2",
  rings: "两个戒指",
};

const sharedSlotLabels: Record<CommonGearSlot, string> = {
  weapon: "武",
  offhand: "盾",
  head: "头",
  body: "身",
  hands: "手",
  legs: "腿",
  feet: "脚",
  earrings: "耳",
  necklace: "颈",
  bracelet: "腕",
  ring: "戒",
  ring2: "戒",
  rings: "戒",
};

export function formatSharedSlots(slots: readonly CommonGearSlot[]): string {
  return slots.map((slot) => sharedSlotLabels[slot]).join("/") || "未设置";
}

export const statNames: Record<Stat, string> = {
  STR: "力量",
  DEX: "灵巧",
  INT: "智力",
  MND: "精神",
  VIT: "耐力",
  CRT: "暴击",
  DET: "信念",
  DHT: "直击",
  SKS: "技速",
  SPS: "咏速",
  TEN: "坚韧",
  PIE: "信仰",
  PDMG: "物理基本性能",
  MDMG: "魔法基本性能",
  DLY: "攻击间隔",
};

export function statName(stat: string): string {
  return statNames[stat as Stat] ?? "未知属性";
}

export function statValue(stat: string, value: number): string {
  return stat === "DLY" ? (value / 1000).toFixed(2) : value.toLocaleString();
}

export function speedAttributeLabel(jobId: JobId): string {
  return getSpeedStat(jobSchemas[jobId]) === "SPS" ? "咏唱速度" : "技能速度";
}
