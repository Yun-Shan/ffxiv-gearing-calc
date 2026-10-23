import type {
  CustomizableStat,
  GearSlot,
  GearStat,
} from "../../../../domain/types.ts";
import type { MainStat, PhysicalGearGroup } from "../../types.ts";
import { wire } from "../../shared/schema.ts";

export const SLOT_NAMES = [
  "weapon",
  "offhand",
  "head",
  "body",
  "hands",
  "legs",
  "feet",
  "earrings",
  "necklace",
  "bracelet",
  "ring",
] as const satisfies readonly GearSlot[];

export const STAT_NAMES = [
  "STR",
  "DEX",
  "INT",
  "MND",
  "VIT",
  "CRT",
  "DET",
  "DHT",
  "SKS",
  "SPS",
  "TEN",
  "PIE",
  "PDMG",
  "MDMG",
  "DLY",
  "main",
  "secondary",
] as const satisfies readonly GearStat[];

export const CUSTOM_STAT_NAMES = [
  "CRT",
  "DET",
  "DHT",
  "SKS",
  "SPS",
  "TEN",
  "PIE",
] as const satisfies readonly CustomizableStat[];

export const RESISTANCE_WEAPON_STAT_NAMES = CUSTOM_STAT_NAMES;

export const MAIN_STATS = [
  "VIT",
  "STR",
  "DEX",
  "MND",
  "INT",
] as const satisfies readonly MainStat[];
export const PHYSICAL_GROUPS = [
  ...MAIN_STATS,
  "SHARED",
] as const satisfies readonly PhysicalGearGroup[];

export const SLOT_CODES = makeCodes(SLOT_NAMES);
export const STAT_CODES = makeCodes(STAT_NAMES);
export const CUSTOM_STAT_CODES = makeCodes(CUSTOM_STAT_NAMES);
export const RESISTANCE_WEAPON_STAT_CODES = CUSTOM_STAT_CODES;
export const MAIN_STAT_CODES = makeCodes(MAIN_STATS);

export const MAX_GEAR_RECORDS = 1_000_000;
export const GEAR_RECORD_FLAGS = {
  materiaAdvanced: 1 << 0,
  unique: 1 << 1,
  equipLevelVariable: 1 << 2,
  resistanceWeaponAdjust: 1 << 3,
  itemSpecialBonus: 1 << 4,
  source: 1 << 5,
  customParameters: 1 << 6,
} as const;

export interface GearRecordHeader {
  slotCode: number;
  icon: number;
  equipLevel: number;
  rawSlot: number;
  roleId: number;
  materiaSlots: number;
  flags: number;
}

export interface GearGroupDescriptorLayout {
  groupCode: number;
  count: number;
  byteLength: number;
}

export interface GearDirectoryEntryLayout {
  id: number;
  level: number;
  bodyByteLength: number;
}

export interface MainStatIndexHeaderLayout {
  groupCode: number;
  count: number;
}

export interface JobCombinationLayout {
  jobCategory: number;
  jobs: number[];
}

export const gearRecordHeaderSchema = wire.struct([
  ["slotCode", wire.u8],
  ["icon", wire.u32],
  ["equipLevel", wire.u8],
  ["rawSlot", wire.u8],
  ["roleId", wire.u8],
  ["materiaSlots", wire.u8],
  ["flags", wire.u8],
]);

/** The two equipment string pools share this count + varuint lengths prefix. */
export const gearStringLengthsSchema = wire.array(wire.uint);

/** Dictionary entries used by ordinary and special gear stat records. */
export const gearStatMaskDictionarySchema = wire.array(wire.u32);

/** Job indices are in the same order as the original Gear.jobs list. */
export const gearJobCombinationSchema = wire.struct([
  ["jobCategory", wire.u16],
  ["jobs", wire.array(wire.u8)],
]);
export const gearJobCombinationDictionarySchema = wire.array(
  gearJobCombinationSchema,
);

export type BinaryGearSlot = (typeof SLOT_NAMES)[number];

export function isSupportedGearSlot(slot: GearSlot): slot is BinaryGearSlot {
  return SLOT_CODES.has(slot as BinaryGearSlot);
}

export const gearGroupDescriptorSchema = wire.struct([
  ["groupCode", wire.u8],
  ["count", wire.u32],
  ["byteLength", wire.u32],
]);

export const gearDirectoryEntrySchema = wire.struct([
  ["id", wire.u32],
  ["level", wire.u16],
  ["bodyByteLength", wire.uint],
]);

export const mainStatIndexHeaderSchema = wire.struct([
  ["groupCode", wire.u8],
  ["count", wire.u32],
]);

function makeCodes<const T extends readonly string[]>(
  values: T,
): Map<T[number], number> {
  return new Map(values.map((value, index) => [value, index]));
}
