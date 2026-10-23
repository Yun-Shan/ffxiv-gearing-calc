import type {
  GeneratedGear,
  JobId,
  GearSlot,
  GearStat,
  CustomizableStat,
} from "../../../../domain/types.ts";
import { ByteReader, fail } from "../../shared/bytes.ts";
import { readValue } from "../../shared/schema-read.ts";
import type { StringPool } from "../../shared/strings.ts";
import { timingStart, type TimingCallback } from "../../shared/timing.ts";
import { readGearIndex } from "./gear-wire.ts";
import {
  CUSTOM_STAT_NAMES,
  GEAR_RECORD_FLAGS,
  RESISTANCE_WEAPON_STAT_NAMES,
  SLOT_NAMES,
  STAT_NAMES,
  gearRecordHeaderSchema,
  type GearRecordHeader,
  type JobCombinationLayout,
} from "./schema.ts";

export interface GearRecordEntry {
  id: number;
  level: number;
  bodyOffset: number;
  groupIndex: number;
}

const noStrings = {
  length: 0,
  get(index: number): string {
    return fail(`装备记录固定字段不应引用字符串 ${index}`);
  },
};

export function decodeGearRecord(
  recordIndex: number,
  entry: GearRecordEntry,
  endOffset: number,
  section: Uint8Array,
  nameStrings: StringPool,
  sourceStrings: StringPool,
  jobIds: readonly JobId[],
  jobCombinations: readonly JobCombinationLayout[],
  statMasks: readonly number[],
  onTiming?: TimingCallback,
): GeneratedGear {
  const recordStartedAt = timingStart(onTiming);
  const bytes = section.subarray(entry.bodyOffset, endOffset);
  const reader = new ByteReader(
    bytes,
    `GEAR_CATALOG_BINARY 装备记录 ${recordIndex}`,
  );
  const header = readValue(
    reader,
    gearRecordHeaderSchema,
    noStrings,
  ) as GearRecordHeader;
  const { slotCode, icon, equipLevel, rawSlot, roleId, materiaSlots, flags } =
    header;
  if (icon === 0) fail("装备图标 ID 无效");
  if (slotCode >= SLOT_NAMES.length) fail("装备槽位代码无效");
  if (flags & ~127) fail("装备标志含保留位");
  const jobCombination =
    jobCombinations[
      readGearIndex(reader, jobCombinations.length, "装备职业组合字典序号")
    ];
  if (!jobCombination) fail("装备引用不存在的职业组合");
  const jobs = jobCombination.jobs.map((jobIndex) => {
    const jobId = jobIds[jobIndex];
    if (jobId === undefined) fail("装备职业组合包含越界职业序号");
    return jobId;
  });

  const statMaskIndex = readGearIndex(
    reader,
    statMasks.length,
    "装备属性掩码字典序号",
  );
  const statMask = statMasks[statMaskIndex];
  const stats = readStats(reader, statMask, "装备属性");

  let customParameters: NonNullable<GeneratedGear["customParameters"]> = [];
  if (flags & GEAR_RECORD_FLAGS.customParameters) {
    const customParameterCount = reader.u8();
    if (
      customParameterCount >
      Math.floor((reader.bytes.byteLength - reader.offset) / 11)
    )
      fail("装备自定义参数数量超出记录长度");
    customParameters = new Array(customParameterCount);
    for (let index = 0; index < customParameterCount; index++) {
      const materiaId = reader.u32();
      const statCode = reader.u8();
      const bigValueIndex = reader.u8();
      const smallValueIndex = reader.u8();
      const bigValue = reader.u16();
      const smallValue = reader.u16();
      const stat = CUSTOM_STAT_NAMES[statCode];
      if (stat === undefined) fail("装备自定义参数属性代码无效");
      customParameters[index] = {
        materiaId,
        stat,
        bigValueIndex,
        smallValueIndex,
        bigValue,
        smallValue,
      };
    }
  }

  let resistanceWeaponAdjust: GeneratedGear["resistanceWeaponAdjust"];
  if (flags & GEAR_RECORD_FLAGS.resistanceWeaponAdjust) {
    const maxTotalStats = reader.u32();
    const maxEachStat = reader.u32();
    const statCount = reader.u8();
    if (statCount < 1 || statCount > RESISTANCE_WEAPON_STAT_NAMES.length)
      fail("ResistanceWeaponAdjust 属性数量无效");
    const stats = new Array<CustomizableStat>(statCount);
    const seen = new Set<CustomizableStat>();
    for (let index = 0; index < statCount; index++) {
      const stat = RESISTANCE_WEAPON_STAT_NAMES[reader.u8()];
      if (stat === undefined) fail("ResistanceWeaponAdjust 属性代码无效");
      if (seen.has(stat)) fail("ResistanceWeaponAdjust 属性重复");
      seen.add(stat);
      stats[index] = stat;
    }
    resistanceWeaponAdjust = { maxTotalStats, maxEachStat, stats };
  }

  let itemSpecialBonus: number | undefined;
  let itemSpecialBonusParam: number | undefined;
  let specialStats: Partial<Record<GearStat, number>> | undefined;
  if (flags & GEAR_RECORD_FLAGS.itemSpecialBonus) {
    itemSpecialBonus = reader.u32();
    if (itemSpecialBonus !== 11) fail("装备 ItemSpecialBonus 当前只支持 11");
    itemSpecialBonusParam = reader.u32();
    const specialStatMaskIndex = readGearIndex(
      reader,
      statMasks.length,
      "装备特殊属性掩码字典序号",
    );
    specialStats = readStats(
      reader,
      statMasks[specialStatMaskIndex],
      "装备特殊属性",
    );
  }

  const sourceStartedAt = timingStart(onTiming);
  const nameIndex = readGearIndex(reader, nameStrings.length, "装备 name");
  const name = readString(nameStrings, nameIndex, "装备 name");
  const sourcePresent = Boolean(flags & GEAR_RECORD_FLAGS.source);
  let source: string | undefined;
  if (sourcePresent) {
    const sourceIndex = readGearIndex(
      reader,
      sourceStrings.length,
      "装备 source",
    );
    source = readString(sourceStrings, sourceIndex, "装备 source");
  }
  reader.finish();
  const sourceMetadataMs = onTiming
    ? globalThis.performance.now() - sourceStartedAt
    : 0;

  const gear: GeneratedGear = {
    id: entry.id,
    slot: SLOT_NAMES[slotCode] as GearSlot,
    icon,
    rawSlot,
    level: entry.level,
    equipLevel,
    roleId,
    jobCategory: jobCombination.jobCategory,
    stats,
    materiaSlots,
    jobs,
    name,
  };
  if (flags & GEAR_RECORD_FLAGS.materiaAdvanced) gear.materiaAdvanced = true;
  gear.unique = Boolean(flags & GEAR_RECORD_FLAGS.unique);
  if (flags & GEAR_RECORD_FLAGS.equipLevelVariable)
    gear.equipLevelVariable = true;
  if (flags & GEAR_RECORD_FLAGS.customParameters)
    gear.customParameters = customParameters;
  if (resistanceWeaponAdjust)
    gear.resistanceWeaponAdjust = resistanceWeaponAdjust;
  if (itemSpecialBonus !== undefined) {
    gear.itemSpecialBonus = itemSpecialBonus;
    gear.itemSpecialBonusParam = itemSpecialBonusParam!;
    gear.specialStats = specialStats!;
  }
  if (sourcePresent) gear.source = source!;
  const weaponDamage = stats.PDMG ?? stats.MDMG;
  if (weaponDamage !== undefined) gear.weaponDamage = weaponDamage;
  if (onTiming) {
    onTiming("gearSourceMetadataMs", sourceMetadataMs);
    onTiming(
      "gearOtherRecordFieldsMs",
      Math.max(
        0,
        globalThis.performance.now() - recordStartedAt - sourceMetadataMs,
      ),
    );
  }
  return gear;
}

function readStats(
  reader: ByteReader,
  statMask: number,
  label: string,
): Partial<Record<GearStat, number>> {
  if (statMask & ~((1 << STAT_NAMES.length) - 1))
    fail(`${label}掩码含未知属性`);
  const stats: Partial<Record<GearStat, number>> = {};
  for (let statCode = 0; statCode < STAT_NAMES.length; statCode++)
    if (statMask & (1 << statCode)) stats[STAT_NAMES[statCode]] = reader.u16();
  return stats;
}

function readString(strings: StringPool, index: number, label: string): string {
  if (!Number.isInteger(index) || index < 0 || index >= strings.length)
    fail(`${label} 引用了不存在的字符串 ${index}`);
  return strings.get(index);
}
