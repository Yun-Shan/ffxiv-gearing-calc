import type { GeneratedGear } from "../../../../domain/types.ts";
import { ByteWriter, fail } from "../../shared/bytes.ts";
import { writeValue } from "../../shared/schema-write.ts";
import type { CustomizableStat, GearStat } from "../../../../domain/types.ts";
import { writeGearIndex } from "./gear-wire.ts";
import {
  CUSTOM_STAT_CODES,
  GEAR_RECORD_FLAGS,
  RESISTANCE_WEAPON_STAT_CODES,
  SLOT_CODES,
  STAT_CODES,
  STAT_NAMES,
  gearRecordHeaderSchema,
  isSupportedGearSlot,
} from "./schema.ts";

export interface GearRecordWriteContext {
  jobCombinationIndexByGearId: ReadonlyMap<number, number>;
  jobCombinationCount: number;
  statMaskIndexes: ReadonlyMap<number, number>;
  statMaskCount: number;
  nameStringIds: ReadonlyMap<string, number>;
  sourceStringIds: ReadonlyMap<string, number>;
  nameStringCount: number;
  sourceStringCount: number;
}

export function encodeGearRecordBody(
  gear: GeneratedGear,
  context: GearRecordWriteContext,
): Uint8Array {
  const writer = new ByteWriter();
  let flags = 0;
  if (gear.materiaAdvanced === true) flags |= GEAR_RECORD_FLAGS.materiaAdvanced;
  if (gear.unique === true) flags |= GEAR_RECORD_FLAGS.unique;
  if (gear.equipLevelVariable === true)
    flags |= GEAR_RECORD_FLAGS.equipLevelVariable;
  if (gear.resistanceWeaponAdjust)
    flags |= GEAR_RECORD_FLAGS.resistanceWeaponAdjust;
  const hasSpecialBonus = Object.hasOwn(gear, "itemSpecialBonus");
  if (hasSpecialBonus) flags |= GEAR_RECORD_FLAGS.itemSpecialBonus;

  const hasCustomParameters = Object.hasOwn(gear, "customParameters");
  if (hasCustomParameters) flags |= GEAR_RECORD_FLAGS.customParameters;
  const customParameters = gear.customParameters ?? [];
  const hasSource = Object.hasOwn(gear, "source") && gear.source !== undefined;
  if (hasSource) flags |= GEAR_RECORD_FLAGS.source;
  const statMask = makeStatMask(gear.stats);
  const slotCode = isSupportedGearSlot(gear.slot)
    ? SLOT_CODES.get(gear.slot)
    : undefined;
  if (slotCode === undefined) fail(`装备 ${gear.id} 的槽位无效`);

  writeValue(
    writer,
    gearRecordHeaderSchema,
    {
      slotCode,
      icon: gear.icon,
      equipLevel: gear.equipLevel,
      rawSlot: gear.rawSlot,
      roleId: gear.roleId,
      materiaSlots: gear.materiaSlots,
      flags,
    },
    noStringIds,
    "装备记录头",
  );
  const jobCombinationIndex = context.jobCombinationIndexByGearId.get(gear.id);
  if (jobCombinationIndex === undefined)
    fail(`装备 ${gear.id} 缺少职业组合字典引用`);
  writeGearIndex(
    writer,
    jobCombinationIndex,
    context.jobCombinationCount,
    "装备职业组合字典序号",
  );
  const statMaskIndex = context.statMaskIndexes.get(statMask);
  if (statMaskIndex === undefined) fail(`装备 ${gear.id} 的属性掩码未进入字典`);
  writeGearIndex(
    writer,
    statMaskIndex,
    context.statMaskCount,
    "装备属性掩码字典序号",
  );
  for (const stat of STAT_NAMES)
    if (statMask & (1 << STAT_CODES.get(stat)!))
      writer.u16(gear.stats[stat]!, `装备属性 ${stat}`);

  if (hasCustomParameters) {
    writer.u8(customParameters.length, "装备自定义参数数量");
    for (const parameter of customParameters) {
      const statCode = customStatCode(parameter.stat, gear.id);
      writer.u32(parameter.materiaId, "装备 materiaId");
      writer.u8(statCode, "装备自定义属性代码");
      writer.u8(parameter.bigValueIndex, "装备 bigValueIndex");
      writer.u8(parameter.smallValueIndex, "装备 smallValueIndex");
      writer.u16(parameter.bigValue, "装备 bigValue");
      writer.u16(parameter.smallValue, "装备 smallValue");
    }
  }

  if (gear.resistanceWeaponAdjust) {
    const adjustment = gear.resistanceWeaponAdjust;
    writer.u32(
      adjustment.maxTotalStats,
      "ResistanceWeaponAdjust MaxTotalStats",
    );
    writer.u32(adjustment.maxEachStat, "ResistanceWeaponAdjust MaxEachStat");
    writer.u8(adjustment.stats.length, "ResistanceWeaponAdjust 属性数量");
    for (const stat of adjustment.stats) {
      const statCode = RESISTANCE_WEAPON_STAT_CODES.get(stat);
      if (statCode === undefined)
        fail(`装备 ${gear.id} 含无效 resistance 调整属性 ${stat}`);
      writer.u8(statCode, "ResistanceWeaponAdjust 属性代码");
    }
  }

  if (hasSpecialBonus) {
    const specialStats = gear.specialStats;
    if (!specialStats) fail(`装备 ${gear.id} 的 ItemSpecialBonus 字段不完整`);
    writer.u32(gear.itemSpecialBonus!, "装备 ItemSpecialBonus");
    writer.u32(gear.itemSpecialBonusParam!, "装备 ItemSpecialBonusParam");
    const specialStatMask = makeStatMask(specialStats);
    const specialStatMaskIndex = context.statMaskIndexes.get(specialStatMask);
    if (specialStatMaskIndex === undefined)
      fail(`装备 ${gear.id} 的特殊属性掩码未进入字典`);
    writeGearIndex(
      writer,
      specialStatMaskIndex,
      context.statMaskCount,
      "装备特殊属性掩码字典序号",
    );
    for (const stat of STAT_NAMES)
      if (specialStatMask & (1 << STAT_CODES.get(stat)!))
        writer.u16(specialStats[stat]!, `装备特殊属性 ${stat}`);
  }

  writeGearIndex(
    writer,
    requiredStringId(context.nameStringIds, gear.name, "装备 name"),
    context.nameStringCount,
    "装备名称字符串序号",
  );
  if (hasSource) {
    if (gear.source === undefined) fail(`装备 ${gear.id} 的 source 字段无效`);
    writeGearIndex(
      writer,
      requiredStringId(context.sourceStringIds, gear.source, "装备 source"),
      context.sourceStringCount,
      "装备来源字符串序号",
    );
  }
  return writer.finish();
}

export function makeStatMask(stats: Partial<Record<GearStat, number>>): number {
  let statMask = 0;
  for (const stat of STAT_NAMES)
    if (Object.hasOwn(stats, stat)) statMask |= 1 << STAT_CODES.get(stat)!;
  return statMask;
}

function customStatCode(stat: CustomizableStat, gearId: number): number {
  const code = CUSTOM_STAT_CODES.get(stat);
  if (code === undefined) fail(`装备 ${gearId} 含未知自定义参数属性`);
  return code;
}

function requiredStringId(
  stringIds: ReadonlyMap<string, number>,
  value: string,
  field: string,
): number {
  const stringId = stringIds.get(value);
  if (stringId === undefined) fail(`${field} 未进入装备字符串表`);
  return stringId;
}

function noStringIds(): number {
  return fail("装备固定数值布局不应包含字符串");
}
