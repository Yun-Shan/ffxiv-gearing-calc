import type {
  GeneratedGear,
  JobId,
  JobSchema,
  GearStat,
} from "../../../../domain/types.ts";
import { assertUInt, ByteWriter, fail } from "../../shared/bytes.ts";
import { writeValue } from "../../shared/schema-write.ts";
import type {
  GearPhysicalGroupRange,
  MainStat,
  PhysicalGearGroup,
} from "../../types.ts";
import { mainStatIndexWidth, writeGearStringPool } from "./gear-wire.ts";
import {
  encodeGearRecordBody,
  makeStatMask,
  type GearRecordWriteContext,
} from "./record-write.ts";
import {
  CUSTOM_STAT_CODES,
  gearDirectoryEntrySchema,
  gearGroupDescriptorSchema,
  gearJobCombinationDictionarySchema,
  gearStatMaskDictionarySchema,
  isSupportedGearSlot,
  MAIN_STAT_CODES,
  MAIN_STATS,
  mainStatIndexHeaderSchema,
  PHYSICAL_GROUPS,
  RESISTANCE_WEAPON_STAT_CODES,
  STAT_CODES,
  STAT_NAMES,
  MAX_GEAR_RECORDS,
} from "./schema.ts";

export interface EncodedGearCatalog {
  bytes: Uint8Array;
  gears: GeneratedGear[];
  sources: string[];
  groupCounts: Record<MainStat, number>;
  mainStatIndexBytes: number;
  gearPhysicalGroupRanges: Record<PhysicalGearGroup, GearPhysicalGroupRange>;
}

export function encodeGearCatalog(
  gearsInput: GeneratedGear[],
  jobSchemas: Record<JobId, JobSchema>,
): EncodedGearCatalog {
  const jobIds = Object.keys(jobSchemas) as JobId[];
  if (!jobIds.length || jobIds.length > 255)
    fail(`职业数量无效：${jobIds.length}`);
  const jobIndexes = new Map<JobId, number>(
    jobIds.map((jobId, index) => [jobId, index]),
  );
  for (const jobId of jobIds)
    if (!MAIN_STAT_CODES.has(jobSchemas[jobId]?.mainStat))
      fail(`职业 ${jobId} 缺少有效主属性`);

  const sortedInput = gearsInput
    .slice()
    .sort((left, right) => left.level - right.level || left.id - right.id);
  if (sortedInput.length > MAX_GEAR_RECORDS) fail("装备记录总数异常");
  const seenIds = new Set<number>();
  for (const gear of sortedInput)
    validateGearForWrite(gear, jobIndexes, seenIds);

  // 多主属性装备只写入共享物理组，再由各主属性索引引用，避免重复存储。
  const physicalMembers = new Map<PhysicalGearGroup, GeneratedGear[]>(
    PHYSICAL_GROUPS.map((group) => [group, []]),
  );
  for (const gear of sortedInput) {
    const applicableMainStats = new Set(
      gear.jobs.map((jobId) => jobSchemas[jobId].mainStat),
    );
    const physicalGroup: PhysicalGearGroup =
      applicableMainStats.size === 1
        ? applicableMainStats.values().next().value!
        : "SHARED";
    physicalMembers.get(physicalGroup)!.push(gear);
  }

  const gears = PHYSICAL_GROUPS.flatMap((group) => physicalMembers.get(group)!);
  const gearGroupByIndex: PhysicalGearGroup[] = [];
  const recordIndexById = new Map<number, number>();
  const gearPhysicalGroupRanges = {} as Record<
    PhysicalGearGroup,
    GearPhysicalGroupRange
  >;
  let globalIndex = 0;
  for (const physicalGroup of PHYSICAL_GROUPS) {
    const members = physicalMembers.get(physicalGroup)!;
    gearPhysicalGroupRanges[physicalGroup] = {
      start: globalIndex,
      count: members.length,
    };
    for (const gear of members) {
      gearGroupByIndex[globalIndex] = physicalGroup;
      recordIndexById.set(gear.id, globalIndex++);
    }
  }

  const names: string[] = [];
  const nameStringIds = new Map<string, number>();
  const sources: string[] = [];
  const sourceStringIds = new Map<string, number>();
  const addString = (
    value: string,
    values: string[],
    ids: Map<string, number>,
  ): void => {
    if (!ids.has(value)) {
      ids.set(value, values.length);
      values.push(value);
    }
  };
  for (const gear of gears) {
    addString(gear.name, names, nameStringIds);
    if (Object.hasOwn(gear, "source") && gear.source !== undefined)
      addString(gear.source, sources, sourceStringIds);
  }

  const jobCombinations: { jobCategory: number; jobs: number[] }[] = [];
  const jobCombinationIds = new Map<string, number>();
  const jobCombinationIndexByGearId = new Map<number, number>();
  for (const gear of gears) {
    const jobs = gear.jobs.map((jobId) => jobIndexes.get(jobId)!);
    const key = jobCombinationKey(gear.jobCategory, jobs);
    let index = jobCombinationIds.get(key);
    if (index === undefined) {
      index = jobCombinations.length;
      jobCombinationIds.set(key, index);
      jobCombinations.push({ jobCategory: gear.jobCategory, jobs });
    }
    jobCombinationIndexByGearId.set(gear.id, index);
  }

  const statMaskValues = new Set<number>();
  for (const gear of gears) {
    statMaskValues.add(makeStatMask(gear.stats));
    if (gear.specialStats) statMaskValues.add(makeStatMask(gear.specialStats));
  }
  const statMasks = [...statMaskValues].sort((left, right) => left - right);
  const statMaskIndexes = new Map(
    statMasks.map((mask, index) => [mask, index]),
  );
  const recordContext: GearRecordWriteContext = {
    jobCombinationIndexByGearId,
    jobCombinationCount: jobCombinations.length,
    statMaskIndexes,
    statMaskCount: statMasks.length,
    nameStringIds,
    sourceStringIds,
    nameStringCount: names.length,
    sourceStringCount: sources.length,
  };

  const recordBodiesByGroup = new Map<PhysicalGearGroup, Uint8Array[]>(
    PHYSICAL_GROUPS.map((group) => [group, []]),
  );
  const groupByteLengths = new Map<PhysicalGearGroup, number>(
    PHYSICAL_GROUPS.map((group) => [group, 0]),
  );
  let statUnionMask = 0;
  for (let index = 0; index < gears.length; index++) {
    const gear = gears[index];
    statUnionMask |= makeStatMask(gear.stats);
    const body = encodeGearRecordBody(gear, recordContext);
    const physicalGroup = gearGroupByIndex[index];
    const nextGroupBytes =
      groupByteLengths.get(physicalGroup)! + body.byteLength;
    assertUInt(nextGroupBytes, 32, `${physicalGroup} 记录体长度`);
    recordBodiesByGroup.get(physicalGroup)!.push(body);
    groupByteLengths.set(physicalGroup, nextGroupBytes);
  }

  const logicalGroups = new Map<MainStat, number[]>(
    MAIN_STATS.map((mainStat) => [mainStat, []]),
  );
  for (const mainStat of MAIN_STATS) {
    const refs = logicalGroups.get(mainStat)!;
    for (const gear of physicalMembers.get(mainStat)!)
      refs.push(recordIndexById.get(gear.id)!);
    for (const gear of physicalMembers.get("SHARED")!)
      if (gear.jobs.some((jobId) => jobSchemas[jobId].mainStat === mainStat))
        refs.push(recordIndexById.get(gear.id)!);
    refs.sort((left, right) => {
      const a = gears[left];
      const b = gears[right];
      return a.level - b.level || a.id - b.id;
    });
  }

  const writer = new ByteWriter();
  writer.u32(statUnionMask, "装备属性并集掩码");
  writer.u16(sortedInput[0]?.level ?? 0, "装备最低品级");
  writer.u16(sortedInput.at(-1)?.level ?? 0, "装备最高品级");
  writeGearStringPool(writer, names, "装备名称池");
  writeGearStringPool(writer, sources, "装备来源池");
  writeValue(
    writer,
    gearStatMaskDictionarySchema,
    statMasks,
    noStringIds,
    "装备属性掩码字典",
  );
  writeValue(
    writer,
    gearJobCombinationDictionarySchema,
    jobCombinations,
    noStringIds,
    "装备职业组合字典",
  );

  writer.u8(PHYSICAL_GROUPS.length, "装备物理组数量");
  for (const physicalGroup of PHYSICAL_GROUPS) {
    writeValue(
      writer,
      gearGroupDescriptorSchema,
      {
        groupCode:
          MAIN_STAT_CODES.get(physicalGroup as MainStat) ?? MAIN_STATS.length,
        count: physicalMembers.get(physicalGroup)!.length,
        byteLength: groupByteLengths.get(physicalGroup)!,
      },
      noStringIds,
      `${physicalGroup} 装备物理组描述`,
    );
  }

  for (const physicalGroup of PHYSICAL_GROUPS) {
    const members = physicalMembers.get(physicalGroup)!;
    const bodies = recordBodiesByGroup.get(physicalGroup)!;
    for (let index = 0; index < members.length; index++) {
      const gear = members[index];
      writeValue(
        writer,
        gearDirectoryEntrySchema,
        {
          id: gear.id,
          level: gear.level,
          bodyByteLength: bodies[index].byteLength,
        },
        noStringIds,
        "装备目录记录",
      );
    }
  }

  writer.u8(MAIN_STATS.length, "逻辑主属性索引数量");
  const indexWidth = mainStatIndexWidth(gears.length);
  writer.u8(indexWidth, "主属性装备索引宽度");
  const groupCounts = {} as Record<MainStat, number>;
  for (const [groupCode, mainStat] of MAIN_STATS.entries()) {
    const refs = logicalGroups.get(mainStat)!;
    groupCounts[mainStat] = refs.length;
    writeValue(
      writer,
      mainStatIndexHeaderSchema,
      {
        groupCode,
        count: refs.length,
      },
      noStringIds,
      `${mainStat} 主属性索引头`,
    );
    for (const recordIndex of refs) {
      if (indexWidth === 2)
        writer.u16(recordIndex, `${mainStat} 全局装备记录序号`);
      else writer.u32(recordIndex, `${mainStat} 全局装备记录序号`);
    }
  }

  for (const physicalGroup of PHYSICAL_GROUPS)
    for (const body of recordBodiesByGroup.get(physicalGroup)!)
      writer.append(body);

  return {
    bytes: writer.finish(),
    gears,
    sources,
    groupCounts,
    gearPhysicalGroupRanges,
    mainStatIndexBytes: Object.values(groupCounts).reduce((sum, count) => sum + count, 0) * indexWidth,
  };
}

function validateGearForWrite(
  gear: GeneratedGear,
  jobIndexes: ReadonlyMap<JobId, number>,
  seenIds: Set<number>,
): void {
  if (
    !gear ||
    typeof gear !== "object" ||
    !Number.isSafeInteger(gear.id) ||
    gear.id <= 0
  )
    fail("装备包含无效 ID");
  if (seenIds.has(gear.id)) fail(`装备 ID 重复：${gear.id}`);
  seenIds.add(gear.id);
  if (typeof gear.name !== "string" || !gear.name.trim())
    fail(`装备 ${gear.id} 名称无效`);
  if (Object.hasOwn(gear, "sourceFile") || Object.hasOwn(gear, "dataSources"))
    fail(`装备 ${gear.id} 仍包含已移除的逐件溯源字段`);
  if (!Number.isSafeInteger(gear.icon) || gear.icon <= 0)
    fail(`装备 ${gear.id} 缺少有效 icon`);
  if (
    !Array.isArray(gear.jobs) ||
    !gear.jobs.length ||
    new Set(gear.jobs).size !== gear.jobs.length
  )
    fail(`装备 ${gear.id} 的适用职业为空或重复`);
  if (
    !gear.stats ||
    typeof gear.stats !== "object" ||
    Array.isArray(gear.stats)
  )
    fail(`装备 ${gear.id} 的属性表无效`);
  if (!isSupportedGearSlot(gear.slot)) fail(`装备 ${gear.id} 的槽位无效`);
  const uintFields: readonly [string, number, number][] = [
    ["id", gear.id, 32],
    ["icon", gear.icon, 32],
    ["level", gear.level, 16],
    ["equipLevel", gear.equipLevel, 8],
    ["rawSlot", gear.rawSlot, 8],
    ["roleId", gear.roleId, 8],
    ["jobCategory", gear.jobCategory, 16],
    ["materiaSlots", gear.materiaSlots, 8],
  ];
  for (const [field, value, bits] of uintFields)
    assertUInt(value, bits, `装备 ${gear.id} ${field}`);
  validateStats(gear.stats, gear.id, "属性");
  for (const jobId of gear.jobs)
    if (!jobIndexes.has(jobId)) fail(`装备 ${gear.id} 引用了未知职业 ${jobId}`);
  if (Object.hasOwn(gear, "unique") && typeof gear.unique !== "boolean")
    fail(`装备 ${gear.id} 的 unique 不是布尔值`);
  if (
    Object.hasOwn(gear, "materiaAdvanced") &&
    typeof gear.materiaAdvanced !== "boolean"
  )
    fail(`装备 ${gear.id} 的 materiaAdvanced 不是布尔值`);
  if (
    Object.hasOwn(gear, "equipLevelVariable") &&
    typeof gear.equipLevelVariable !== "boolean"
  )
    fail(`装备 ${gear.id} 的 equipLevelVariable 不是布尔值`);
  if (
    Object.hasOwn(gear, "customParameters") &&
    !Array.isArray(gear.customParameters)
  )
    fail(`装备 ${gear.id} 的 customParameters 不是数组`);
  if (gear.resistanceWeaponAdjust) {
    const adjustment = gear.resistanceWeaponAdjust;
    if (
      (gear.slot !== "weapon" && gear.slot !== "offhand") ||
      !Array.isArray(adjustment.stats) ||
      adjustment.stats.length < 1 ||
      adjustment.stats.length > RESISTANCE_WEAPON_STAT_CODES.size
    )
      fail(`装备 ${gear.id} 的 resistanceWeaponAdjust 结构无效`);
    assertUInt(
      adjustment.maxTotalStats,
      32,
      `装备 ${gear.id} resistance MaxTotalStats`,
    );
    assertUInt(
      adjustment.maxEachStat,
      32,
      `装备 ${gear.id} resistance MaxEachStat`,
    );
    const seenAdjustmentStats = new Set<string>();
    for (const stat of adjustment.stats) {
      if (
        !RESISTANCE_WEAPON_STAT_CODES.has(stat) ||
        seenAdjustmentStats.has(stat)
      )
        fail(`装备 ${gear.id} 含无效或重复的 resistance 调整属性 ${stat}`);
      seenAdjustmentStats.add(stat);
    }
  }
  const specialBonusPresence = [
    Object.hasOwn(gear, "itemSpecialBonus"),
    Object.hasOwn(gear, "itemSpecialBonusParam"),
    Object.hasOwn(gear, "specialStats"),
  ];
  if (
    specialBonusPresence.some(Boolean) &&
    !specialBonusPresence.every(Boolean)
  )
    fail(`装备 ${gear.id} 的 ItemSpecialBonus 字段不完整`);
  if (specialBonusPresence.every(Boolean)) {
    if (gear.itemSpecialBonus !== 11)
      fail(`装备 ${gear.id} 的 ItemSpecialBonus 当前只支持 11`);
    assertUInt(
      gear.itemSpecialBonusParam!,
      32,
      `装备 ${gear.id} ItemSpecialBonusParam`,
    );
    if (
      !gear.specialStats ||
      typeof gear.specialStats !== "object" ||
      Array.isArray(gear.specialStats)
    )
      fail(`装备 ${gear.id} 的 specialStats 无效`);
    validateStats(gear.specialStats, gear.id, "特殊属性");
  }
  if (gear.customParameters && gear.customParameters.length > 255)
    fail(`装备 ${gear.id} 的 customParameters 数量超出 u8`);
  for (const parameter of gear.customParameters ?? []) {
    if (!CUSTOM_STAT_CODES.has(parameter?.stat))
      fail(`装备 ${gear.id} 含未知自定义参数属性`);
  }
  if (
    Object.hasOwn(gear, "source") &&
    gear.source !== undefined &&
    typeof gear.source !== "string"
  )
    fail(`装备 ${gear.id} 的 source 无效`);
}

function validateStats(
  stats: Partial<Record<GearStat, number>>,
  gearId: number,
  label: string,
): void {
  for (const [stat, value] of Object.entries(stats)) {
    if (
      !STAT_CODES.has(stat as GearStat) ||
      !Number.isSafeInteger(value) ||
      value < 0 ||
      value > 65535
    )
      fail(`装备 ${gearId} 的${label} ${stat} 超出二进制格式范围`);
  }
}

function jobCombinationKey(
  jobCategory: number,
  jobs: readonly number[],
): string {
  return `${jobCategory}:${jobs.join(",")}`;
}

function noStringIds(): number {
  return fail("装备固定数值布局不应包含字符串");
}
