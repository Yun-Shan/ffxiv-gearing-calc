import type {
  GearStat,
  GeneratedGear,
  JobId,
} from "../../../../domain/types.ts";
import { ByteReader, fail } from "../../shared/bytes.ts";
import { readValue } from "../../shared/schema-read.ts";
import {
  reportTiming,
  timingStart,
  type TimingCallback,
} from "../../shared/timing.ts";
import type {
  GearPhysicalGroupRange,
  GeneratedGameData,
  MainStat,
  PhysicalGearGroup,
} from "../../types.ts";
import { decodeGearRecord, type GearRecordEntry } from "./record-read.ts";
import { mainStatIndexWidth, readGearStringPool } from "./gear-wire.ts";
import {
  gearDirectoryEntrySchema,
  gearGroupDescriptorSchema,
  gearJobCombinationDictionarySchema,
  mainStatIndexHeaderSchema,
  gearStatMaskDictionarySchema,
  MAX_GEAR_RECORDS,
  MAIN_STATS,
  PHYSICAL_GROUPS,
  STAT_NAMES,
  type JobCombinationLayout,
  type GearDirectoryEntryLayout,
  type GearGroupDescriptorLayout,
  type MainStatIndexHeaderLayout,
} from "./schema.ts";

type GearCatalogData = Pick<
  GeneratedGameData,
  | "gears"
  | "gearIndexesByMainStat"
  | "gearLevelByRecordIndex"
  | "gearMinLevel"
  | "gearMaxLevel"
  | "gearStatNames"
  | "gearPhysicalGroupRanges"
  | "getGearAtRecordIndex"
  | "getGearById"
>;

interface GearGroupDescriptor {
  name: PhysicalGearGroup;
  start: number;
  count: number;
  byteLength: number;
}

export function decodeGearCatalog(
  bytes: Uint8Array,
  jobIds: readonly JobId[],
  onTiming?: TimingCallback,
): GearCatalogData {
  const reader = new ByteReader(bytes, "GEAR_CATALOG_BINARY");
  let phaseStartedAt = timingStart(onTiming);
  const statUnionMask = reader.u32();
  if (statUnionMask & ~((1 << STAT_NAMES.length) - 1))
    fail("装备属性并集掩码含未知属性");
  const gearMinLevel = reader.u16();
  const gearMaxLevel = reader.u16();
  if (gearMinLevel > gearMaxLevel) fail("装备最低品级大于最高品级");
  const nameStrings = readGearStringPool(reader, "装备名称池");
  const sourceStrings = readGearStringPool(reader, "装备来源池");
  const statMasks = readValue(
    reader,
    gearStatMaskDictionarySchema,
    noStrings,
  ) as number[];
  if (!statMasks.length) fail("装备属性掩码字典为空");
  let previousMask = -1;
  for (const mask of statMasks) {
    if (mask & ~((1 << STAT_NAMES.length) - 1) || mask <= previousMask)
      fail("装备属性掩码字典含未知、重复或未排序的掩码");
    previousMask = mask;
  }
  const jobCombinations = readValue(
    reader,
    gearJobCombinationDictionarySchema,
    noStrings,
  ) as JobCombinationLayout[];
  if (!jobCombinations.length) fail("装备职业组合字典为空");
  validateJobCombinations(jobCombinations, jobIds);
  reportTiming(onTiming, "equipmentStringsMs", phaseStartedAt);

  phaseStartedAt = timingStart(onTiming);
  const physicalGroupCount = reader.u8();
  if (physicalGroupCount !== PHYSICAL_GROUPS.length) fail("装备物理组数量异常");
  const groupDescriptors = new Array<GearGroupDescriptor>(
    PHYSICAL_GROUPS.length,
  );
  const gearPhysicalGroupRanges = {} as Record<
    PhysicalGearGroup,
    GearPhysicalGroupRange
  >;
  let recordCount = 0;
  for (let groupIndex = 0; groupIndex < PHYSICAL_GROUPS.length; groupIndex++) {
    const groupName = PHYSICAL_GROUPS[groupIndex];
    const expectedCode =
      groupIndex < MAIN_STATS.length ? groupIndex : MAIN_STATS.length;
    const descriptor = readValue(
      reader,
      gearGroupDescriptorSchema,
      noStrings,
    ) as GearGroupDescriptorLayout;
    if (descriptor.groupCode !== expectedCode)
      fail(`${groupName} 物理组代码或顺序错误`);
    const { count, byteLength } = descriptor;
    if (count > MAX_GEAR_RECORDS - recordCount) fail("装备记录总数异常");
    gearPhysicalGroupRanges[groupName] = { start: recordCount, count };
    groupDescriptors[groupIndex] = {
      name: groupName,
      start: recordCount,
      count,
      byteLength,
    };
    recordCount += count;
  }
  if (!recordCount) fail("装备记录数为空");

  const entries = new Array<GearRecordEntry>(recordCount);
  const gearLevelByRecordIndex = new Uint16Array(recordCount);
  const indexById = new Map<number, number>();
  let actualMinLevel = Number.POSITIVE_INFINITY;
  let actualMaxLevel = Number.NEGATIVE_INFINITY;
  for (const group of groupDescriptors) {
    if (group.count > Math.floor((reader.bytes.byteLength - reader.offset) / 7))
      fail(`${group.name} 装备目录被截断`);
    let groupBodyOffset = 0;
    let previous: Pick<GearRecordEntry, "id" | "level"> | undefined;
    for (let offsetInGroup = 0; offsetInGroup < group.count; offsetInGroup++) {
      const globalIndex = group.start + offsetInGroup;
      const directoryEntry = readValue(
        reader,
        gearDirectoryEntrySchema,
        noStrings,
      ) as GearDirectoryEntryLayout;
      const { id, level, bodyByteLength } = directoryEntry;
      if (id === 0) fail(`${group.name} 装备目录 ID 无效`);
      if (indexById.has(id)) fail(`装备目录 ID 重复：${id}`);
      if (
        previous &&
        (level < previous.level ||
          (level === previous.level && id <= previous.id))
      )
        fail(`${group.name} 装备目录未按品级和 ID 严格排序`);
      previous = { id, level };
      indexById.set(id, globalIndex);
      entries[globalIndex] = {
        id,
        level,
        bodyOffset: groupBodyOffset,
        groupIndex: PHYSICAL_GROUPS.indexOf(group.name),
      };
      if (
        bodyByteLength === 0 ||
        bodyByteLength > group.byteLength - groupBodyOffset
      )
        fail(`${group.name} 装备记录体长度无效`);
      groupBodyOffset += bodyByteLength;
      gearLevelByRecordIndex[globalIndex] = level;
      actualMinLevel = Math.min(actualMinLevel, level);
      actualMaxLevel = Math.max(actualMaxLevel, level);
    }
    if (groupBodyOffset !== group.byteLength)
      fail(`${group.name} 目录记录长度与物理组长度不匹配`);
  }
  if (actualMinLevel !== gearMinLevel || actualMaxLevel !== gearMaxLevel)
    fail("装备目录品级范围与头部不匹配");
  reportTiming(onTiming, "equipmentDirectoryMs", phaseStartedAt);

  phaseStartedAt = timingStart(onTiming);
  const logicalGroupCount = reader.u8();
  if (logicalGroupCount !== MAIN_STATS.length) fail("逻辑主属性索引数异常");
  const refWidth = reader.u8();
  if (refWidth !== 2 && refWidth !== 4) fail("主属性索引宽度无效");
  if (refWidth !== mainStatIndexWidth(recordCount))
    fail("主属性索引宽度与装备记录数不匹配");
  const gearIndexesByMainStat = {} as Record<MainStat, Uint32Array>;
  for (const [groupCode, mainStat] of MAIN_STATS.entries()) {
    const indexHeader = readValue(
      reader,
      mainStatIndexHeaderSchema,
      noStrings,
    ) as MainStatIndexHeaderLayout;
    if (indexHeader.groupCode !== groupCode)
      fail(`${mainStat} 主属性索引代码或顺序错误`);
    const { count } = indexHeader;
    if (
      count > Math.floor((reader.bytes.byteLength - reader.offset) / refWidth)
    )
      fail(`${mainStat} 主属性索引被截断`);
    const refsOffset = reader.offset;
    reader.slice(count * refWidth);
    const refs = new Uint32Array(count);
    for (let index = 0; index < count; index++)
      refs[index] =
        refWidth === 2
          ? reader.view.getUint16(refsOffset + index * 2, true)
          : reader.view.getUint32(refsOffset + index * 4, true);
    let previous: GearRecordEntry | undefined;
    for (const ref of refs) {
      if (ref >= recordCount) fail(`${mainStat} 主属性索引引用越界：${ref}`);
      const entry = entries[ref];
      if (
        entry.groupIndex !== groupCode &&
        entry.groupIndex !== MAIN_STATS.length
      )
        fail(`${mainStat} 主属性索引引用了不匹配的物理组记录`);
      if (
        previous &&
        (entry.level < previous.level ||
          (entry.level === previous.level && entry.id <= previous.id))
      )
        fail(`${mainStat} 主属性索引未按品级和 ID 严格排序`);
      previous = entry;
    }
    gearIndexesByMainStat[mainStat] = refs;
  }
  reportTiming(onTiming, "mainStatIndexDecodeMs", phaseStartedAt);

  phaseStartedAt = timingStart(onTiming);
  const bodySections = new Array<Uint8Array>(PHYSICAL_GROUPS.length);
  for (let groupIndex = 0; groupIndex < groupDescriptors.length; groupIndex++) {
    const group = groupDescriptors[groupIndex];
    const groupBytes = reader.slice(group.byteLength);
    bodySections[groupIndex] = groupBytes;
    if (group.count === 0) {
      if (group.byteLength !== 0) fail(`${group.name} 空物理组包含记录体字节`);
      continue;
    }
    const first = entries[group.start];
    if (first.bodyOffset !== 0) fail(`${group.name} 首条记录体偏移必须为零`);
    for (let index = 0; index < group.count; index++) {
      const entry = entries[group.start + index];
      const endOffset =
        index + 1 < group.count
          ? entries[group.start + index + 1].bodyOffset
          : group.byteLength;
      if (entry.bodyOffset >= endOffset || endOffset > group.byteLength)
        fail(`${group.name} 装备记录体偏移无效`);
    }
  }
  reader.finish();
  reportTiming(onTiming, "equipmentRecordRangesMs", phaseStartedAt);

  const gearCache = new Array<GeneratedGear | undefined>(recordCount);
  // 保留数组访问方式，同时将单件装备的解码延迟到首次读取并缓存结果。
  const getGearAtRecordIndex = (index: number): GeneratedGear => {
    if (!Number.isInteger(index) || index < 0 || index >= recordCount)
      fail(`装备记录序号越界：${index}`);
    let gear = gearCache[index];
    if (gear === undefined) {
      const entry = entries[index];
      const group = groupDescriptors[entry.groupIndex];
      const groupBytes = bodySections[entry.groupIndex];
      const groupEnd = group.start + group.count;
      const endOffset =
        index + 1 < groupEnd
          ? entries[index + 1].bodyOffset
          : groupBytes.byteLength;
      gear = decodeGearRecord(
        index,
        entry,
        endOffset,
        groupBytes,
        nameStrings,
        sourceStrings,
        jobIds,
        jobCombinations,
        statMasks,
        onTiming,
      );
      gearCache[index] = gear;
    }
    return gear;
  };
  const gearArray = new Proxy(
    new Array<GeneratedGear | undefined>(recordCount).fill(undefined),
    {
      get(target, property, receiver) {
        if (typeof property === "string" && property !== "") {
          const index = Number(property);
          if (
            Number.isInteger(index) &&
            index >= 0 &&
            index < recordCount &&
            String(index) === property
          )
            return getGearAtRecordIndex(index);
        }
        return Reflect.get(target, property, receiver);
      },
    },
  );
  const gears = gearArray as GeneratedGear[];

  return {
    gears,
    gearIndexesByMainStat,
    getGearAtRecordIndex,
    getGearById(id) {
      const index = indexById.get(id);
      return index === undefined ? undefined : getGearAtRecordIndex(index);
    },
    gearLevelByRecordIndex,
    gearMinLevel,
    gearMaxLevel,
    gearStatNames: STAT_NAMES.filter(
      (_, index) => statUnionMask & (1 << index),
    ) as GearStat[],
    gearPhysicalGroupRanges,
  };
}

const noStrings = {
  length: 0,
  get(index: number): string {
    return fail(`装备固定字段不应引用字符串 ${index}`);
  },
};

function validateJobCombinations(
  combinations: readonly JobCombinationLayout[],
  jobIds: readonly JobId[],
): void {
  const seen = new Set<string>();
  for (const combination of combinations) {
    if (
      !combination ||
      !Number.isInteger(combination.jobCategory) ||
      combination.jobCategory < 0 ||
      combination.jobCategory > 0xffff ||
      !Array.isArray(combination.jobs) ||
      combination.jobs.length < 1 ||
      combination.jobs.length > 255
    )
      fail("装备职业组合字典记录无效");
    const jobs = new Set<number>();
    for (const jobIndex of combination.jobs) {
      if (
        !Number.isInteger(jobIndex) ||
        jobIndex < 0 ||
        jobIndex >= jobIds.length ||
        jobs.has(jobIndex)
      )
        fail("装备职业组合含越界或重复职业序号");
      jobs.add(jobIndex);
    }
    const key = `${combination.jobCategory}:${combination.jobs.join(",")}`;
    if (seen.has(key)) fail("装备职业组合字典含重复记录");
    seen.add(key);
  }
}
