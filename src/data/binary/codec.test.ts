import { beforeAll, describe, expect, it } from "vitest";
import type { GeneratedGear, JobId } from "../../domain/types.ts";
import { ByteReader, ByteWriter } from "./shared/bytes.ts";
import { crc32 } from "./shared/crc.ts";
import { decodeSection } from "./shared/schema-read.ts";
import { metadataSchema } from "./sections/metadata/schema.ts";
import { encodeSection } from "./shared/schema-write.ts";
import { wire } from "./shared/schema.ts";
import type { GeneratedDataInput, GeneratedGameData } from "./types.ts";
import { decodeGeneratedData } from "./decode.ts";
import { encodeGeneratedData } from "./encode.ts";
import { decodeGearCatalog } from "./sections/gear-catalog/read.ts";
import { encodeGearCatalog } from "./sections/gear-catalog/write.ts";
import { readSection as readJobsSection } from "./sections/jobs/read.ts";
import { writeSection as writeJobsSection } from "./sections/jobs/write.ts";
import { readSection as readFoodsSection } from "./sections/foods/read.ts";
import { writeSection as writeFoodsSection } from "./sections/foods/write.ts";
import { readSection as readLevelCapsSection } from "./sections/item-level-caps/read.ts";
import { writeSection as writeLevelCapsSection } from "./sections/item-level-caps/write.ts";
import {
  CAP_COLUMNS,
  itemLevelCapsSectionSchema,
} from "./sections/item-level-caps/schema.ts";
import {
  gearIndexWidth,
  readGearIndex,
  writeGearIndex,
} from "./sections/gear-catalog/gear-wire.ts";
import {
  DIRECTORY_ENTRY_BYTES,
  FORMAT_VERSION,
  HEADER_BYTES,
  SECTION_IDS,
} from "./schema.ts";
import { readContainer } from "./container/read.ts";
import { writeContainer } from "./container/write.ts";

interface GoldenRecord {
  count: number;
  label: string;
  enabled?: boolean;
  mode: "off" | "on";
}

const goldenSchema = wire.struct([
  ["count", wire.u16],
  ["label", wire.string],
  ["enabled", wire.optional(wire.bool)],
  ["mode", wire.enum(["off", "on"])],
]);

function toGeneratedDataInput(data: GeneratedGameData): GeneratedDataInput {
  return {
    version: data.version,
    provenance: data.provenance,
    gears: Array.from(data.gears),
    foods: data.foods,
    jobs: data.jobs,
    sync: data.sync,
    materias: data.materias,
    materiaGradeRequiredLevels: data.materiaGradeRequiredLevels,
    materiaGradeIsRestricted: data.materiaGradeIsRestricted,
    bluMdmgAdditions: data.bluMdmgAdditions,
    levelCaps: data.levelCaps,
    slotCaps: data.slotCaps,
    roleCaps: data.roleCaps,
    baseStats: data.baseStats,
    clanStats: data.clanStats,
    jobSchemas: data.jobSchemas,
    jobLevelModifiers: data.jobLevelModifiers,
  };
}

function staticFields(data: GeneratedDataInput | GeneratedGameData) {
  return {
    version: data.version,
    provenance: data.provenance,
    foods: data.foods,
    jobs: data.jobs,
    sync: data.sync,
    materias: data.materias,
    materiaGradeRequiredLevels: data.materiaGradeRequiredLevels,
    materiaGradeIsRestricted: data.materiaGradeIsRestricted,
    bluMdmgAdditions: data.bluMdmgAdditions,
    levelCaps: data.levelCaps,
    slotCaps: data.slotCaps,
    roleCaps: data.roleCaps,
    baseStats: data.baseStats,
    clanStats: data.clanStats,
    jobSchemas: data.jobSchemas,
    jobLevelModifiers: data.jobLevelModifiers,
  };
}

function makeMinimalPayload(source: GeneratedDataInput): GeneratedDataInput {
  return {
    ...source,
    gears: [structuredClone(source.gears[0]!)],
    foods: structuredClone(source.foods),
    sync: structuredClone(source.sync),
    levelCaps: structuredClone(source.levelCaps),
  };
}

function resealCrc(bytes: Uint8Array): Uint8Array {
  const result = bytes.slice();
  new DataView(result.buffer).setUint32(
    result.length - 4,
    crc32(result.subarray(0, -4)),
    true,
  );
  return result;
}

function makeContainer(): Uint8Array {
  return writeContainer(
    new Map(SECTION_IDS.map((id) => [id, new Uint8Array([id])])),
  );
}

interface GearCatalogTestOffsets {
  recordCount: number;
  nameStringCount: number;
  sourceStringCount: number;
  mainStatReferenceOffset: number;
  mainStatReferenceWidth: number;
  firstRecordLengthOffset: number;
  firstNameLengthOffset: number;
  firstRecordOffset: number;
  recordBodyOffsetById: ReadonlyMap<number, number>;
  jobCombinationReferenceOffset: number;
  statMaskReferenceOffset: number;
  statMaskDictionaryOffset: number;
  statMaskCount: number;
  jobCombinationCount: number;
}

function locateGearCatalogTestOffsets(
  catalogBytes: Uint8Array,
): GearCatalogTestOffsets {
  const reader = new ByteReader(catalogBytes, "test gear catalog");
  reader.u32();
  reader.u16();
  reader.u16();

  const namePool = skipStringPool(reader);
  const sourcePool = skipStringPool(reader);

  const statMaskCount = reader.varUint();
  const statMaskDictionaryOffset = reader.offset;
  reader.slice(statMaskCount * 4);

  const jobCombinationCount = reader.varUint();
  for (let index = 0; index < jobCombinationCount; index++) {
    reader.u16();
    reader.slice(reader.varUint());
  }

  const physicalGroupCount = reader.u8();
  const groups: { count: number; byteLength: number }[] = [];
  const directoryByGroup: { id: number; bodyByteLength: number }[][] = [];
  let recordCount = 0;
  for (let index = 0; index < physicalGroupCount; index++) {
    reader.u8();
    const count = reader.u32();
    const byteLength = reader.u32();
    recordCount += count;
    groups.push({ count, byteLength });
  }

  let firstRecordLengthOffset = -1;
  for (const group of groups) {
    const entries: { id: number; bodyByteLength: number }[] = [];
    for (let index = 0; index < group.count; index++) {
      const id = reader.u32();
      reader.u16();
      if (firstRecordLengthOffset < 0) firstRecordLengthOffset = reader.offset;
      const bodyByteLength = reader.varUint();
      entries.push({ id, bodyByteLength });
    }
    directoryByGroup.push(entries);
  }

  const logicalGroupCount = reader.u8();
  const mainStatReferenceWidth = reader.u8();
  let mainStatReferenceOffset = -1;
  for (let index = 0; index < logicalGroupCount; index++) {
    reader.u8();
    const referenceCount = reader.u32();
    if (referenceCount > 0 && mainStatReferenceOffset < 0)
      mainStatReferenceOffset = reader.offset;
    reader.slice(referenceCount * mainStatReferenceWidth);
  }

  let firstRecordOffset = -1;
  let bodyOffset = reader.offset;
  const recordBodyOffsetById = new Map<number, number>();
  for (const [groupIndex, group] of groups.entries()) {
    if (group.count > 0 && firstRecordOffset < 0)
      firstRecordOffset = bodyOffset;
    for (const entry of directoryByGroup[groupIndex]) {
      recordBodyOffsetById.set(entry.id, bodyOffset);
      bodyOffset += entry.bodyByteLength;
    }
  }
  if (
    mainStatReferenceOffset < 0 ||
    firstRecordLengthOffset < 0 ||
    namePool.firstLengthOffset < 0 ||
    firstRecordOffset < 0
  )
    throw new Error("test gear catalog has an incomplete index or record");

  const jobCombinationReferenceOffset = firstRecordOffset + 10;
  const statMaskReferenceOffset =
    jobCombinationReferenceOffset + referenceWidth(jobCombinationCount);
  return {
    recordCount,
    nameStringCount: namePool.count,
    sourceStringCount: sourcePool.count,
    mainStatReferenceOffset,
    mainStatReferenceWidth,
    firstRecordLengthOffset,
    firstNameLengthOffset: namePool.firstLengthOffset,
    firstRecordOffset,
    recordBodyOffsetById,
    jobCombinationReferenceOffset,
    statMaskReferenceOffset,
    statMaskDictionaryOffset,
    statMaskCount,
    jobCombinationCount,
  };
}

function skipStringPool(reader: ByteReader): {
  count: number;
  firstLengthOffset: number;
} {
  const count = reader.varUint();
  let firstLengthOffset = -1;
  const lengths = new Array<number>(count);
  for (let index = 0; index < count; index++) {
    if (index === 0) firstLengthOffset = reader.offset;
    lengths[index] = reader.varUint();
  }
  for (const length of lengths) reader.slice(length);
  return { count, firstLengthOffset };
}

function referenceWidth(entryCount: number): number {
  if (entryCount <= 256) return 1;
  if (entryCount <= 65536) return 2;
  return 4;
}

function writeUnsignedAt(
  bytes: Uint8Array,
  offset: number,
  width: number,
  value: number,
): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (width === 1) view.setUint8(offset, value);
  else if (width === 2) view.setUint16(offset, value, true);
  else view.setUint32(offset, value, true);
}

function readUnsignedAt(
  bytes: Uint8Array,
  offset: number,
  width: number,
): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (width === 1) return view.getUint8(offset);
  if (width === 2) return view.getUint16(offset, true);
  return view.getUint32(offset, true);
}

function makeBareGear(
  source: GeneratedGear,
  overrides: Partial<GeneratedGear> = {},
): GeneratedGear {
  const gear = structuredClone(source);
  gear.name = "x";
  gear.jobs = [source.jobs[0]!];
  gear.stats = { main: 1 };
  for (const field of [
    "source",
    "customParameters",
    "resistanceWeaponAdjust",
    "itemSpecialBonus",
    "itemSpecialBonusParam",
    "specialStats",
    "materiaAdvanced",
    "unique",
    "equipLevelVariable",
  ] as const)
    Reflect.deleteProperty(gear, field);
  return { ...gear, ...overrides };
}

describe("format 13 wire schema", () => {
  it("matches the independent little-endian, UTF-8, optional-mask, and enum golden bytes", () => {
    const bytes = encodeSection(
      goldenSchema,
      { count: 0x1234, label: "界", enabled: true, mode: "on" },
      "golden fixture",
    );

    expect(Array.from(bytes)).toEqual([
      0x01, 0x03, 0xe7, 0x95, 0x8c, 0x01, 0x34, 0x12, 0x00, 0x01, 0x01,
    ]);
    expect(
      decodeSection<GoldenRecord>(goldenSchema, bytes, "golden fixture"),
    ).toEqual({
      count: 0x1234,
      label: "界",
      enabled: true,
      mode: "on",
    });
  });

  it("treats JSON-looking names as strings and rejects removed audit fields", () => {
    const jsonLookingName = '{"query":{"kind":"all-rows"}}';
    const nameSchema = wire.struct([["name", wire.string]]);
    const nameBytes = encodeSection(
      nameSchema,
      { name: jsonLookingName },
      "display name",
    );
    expect(
      decodeSection<{ name: string }>(nameSchema, nameBytes, "display name")
        .name,
    ).toBe(jsonLookingName);

    expect(() =>
      encodeSection(
        metadataSchema,
        {
          version: "fixture",
          provenance: {
            repository: "fixture",
            commit: "fixture",
            importedAt: "fixture",
            queryEvidence: {},
          },
        },
        "metadata",
      ),
    ).toThrow(/未定义字段 queryEvidence/);
  });
});

describe("format 14 container integrity", () => {
  it("writes the version 14 header and an exact eleven-section directory", () => {
    const bytes = makeContainer();
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    expect(FORMAT_VERSION).toBe(14);
    expect(view.getUint16(8, true)).toBe(FORMAT_VERSION);
    expect(view.getUint16(12, true)).toBe(11);
    expect(view.getUint16(14, true)).toBe(HEADER_BYTES);
    expect(readContainer(bytes).size).toBe(11);
    for (const [index, id] of SECTION_IDS.entries())
      expect(view.getUint16(16 + index * DIRECTORY_ENTRY_BYTES, true)).toBe(id);
  });

  it("rejects structural corruption after its CRC has been repaired", () => {
    const valid = makeContainer();

    const unsupportedVersion = valid.slice();
    new DataView(unsupportedVersion.buffer).setUint16(8, 12, true);
    expect(() => readContainer(resealCrc(unsupportedVersion))).toThrow(
      /不支持的格式版本/,
    );

    const wrongSectionId = valid.slice();
    new DataView(wrongSectionId.buffer).setUint16(16, 0, true);
    expect(() => readContainer(resealCrc(wrongSectionId))).toThrow(
      /section ID/,
    );

    const invalidOffset = valid.slice();
    new DataView(invalidOffset.buffer).setUint32(20, HEADER_BYTES + 1, true);
    expect(() => readContainer(resealCrc(invalidOffset))).toThrow(/偏移不连续/);

    const truncatedBody = valid.subarray(0, valid.length - 5);
    const truncated = new Uint8Array(truncatedBody.length + 4);
    truncated.set(truncatedBody);
    expect(() => readContainer(resealCrc(truncated))).toThrow(/长度越界/);

    const trailingData = new Uint8Array(valid.length + 1);
    trailingData.set(valid.subarray(0, valid.length - 4));
    trailingData[valid.length - 4] = 0xa5;
    expect(() => readContainer(resealCrc(trailingData))).toThrow(/尾随数据/);
  });

  it("checks CRC when bytes change without a repaired checksum", () => {
    const invalid = makeContainer();
    invalid[invalid.length - 5] ^= 1;
    expect(() => readContainer(invalid)).toThrow(/CRC-32 不匹配/);
  });
});

describe("generated snapshot codec", () => {
  let generatedPayload: GeneratedDataInput;

  beforeAll(async () => {
    const { gameData } = await import("../../domain/data.ts");
    generatedPayload = toGeneratedDataInput(gameData);
  }, 300_000);

  it("roundtrips every real gear and all non-gear fields while keeping gear decoding lazy and cached", async () => {
    const encoded = await encodeGeneratedData(generatedPayload);
    const timingPhases: string[] = [];
    const recordTimingPhases = () =>
      timingPhases.filter(
        (phase) =>
          phase === "gearSourceMetadataMs" ||
          phase === "gearOtherRecordFieldsMs",
      );
    const decoded = await decodeGeneratedData(encoded.bytes, {
      onTiming: (phase) => timingPhases.push(phase),
    });

    expect(encoded.gearCount).toBe(generatedPayload.gears.length);
    expect(staticFields(decoded)).toEqual(staticFields(generatedPayload));
    const dexCap = decoded.levelCaps.DEX![0]!;
    decoded.levelCaps.STR![0] = dexCap + 1;
    expect(decoded.levelCaps.DEX![0]).toBe(dexCap);
    expect(decoded.gears.length).toBe(generatedPayload.gears.length);
    expect(recordTimingPhases()).toEqual([]);

    const sampleGear = generatedPayload.gears[0]!;
    const firstLookup = decoded.getGearById(sampleGear.id);
    expect(firstLookup).toBeDefined();
    expect(recordTimingPhases()).toEqual([
      "gearSourceMetadataMs",
      "gearOtherRecordFieldsMs",
    ]);
    expect(decoded.getGearById(sampleGear.id)).toBe(firstLookup);
    expect(recordTimingPhases()).toHaveLength(2);

    for (const expectedGear of generatedPayload.gears)
      expect(decoded.getGearById(expectedGear.id)).toEqual(expectedGear);

    expect(Object.keys(decoded.provenance).sort()).toEqual([
      "commit",
      "importedAt",
      "repository",
    ]);
    for (const record of [
      ...decoded.gears,
      ...decoded.foods,
      ...Object.values(decoded.jobSchemas),
    ]) {
      expect(record).not.toHaveProperty("sourceFile");
      expect(record).not.toHaveProperty("dataSources");
    }
    expect(decoded.gears.some((gear) => Boolean(gear.source))).toBe(true);
    expect(
      Object.values(generatedPayload.jobSchemas).some(
        (job) => job.statModifiers.gcdReason !== undefined,
      ),
    ).toBe(true);
  }, 300_000);

  it("roundtrips unique primary job main stats without a duplicate attack stat", () => {
    const bytes = writeJobsSection({
      jobs: generatedPayload.jobs,
      jobSchemas: generatedPayload.jobSchemas,
    });
    const decoded = readJobsSection(bytes);

    expect(
      Object.values(decoded.jobSchemas)
        .filter((job) => job.role === "tank")
        .every((job) => job.mainStat === "STR"),
    ).toBe(true);
    expect(
      Object.values(decoded.jobSchemas).every(
        (job) => !Object.hasOwn(job, "attackStat"),
      ),
    ).toBe(true);
    expect(decoded).toEqual({
      jobs: generatedPayload.jobs,
      jobSchemas: generatedPayload.jobSchemas,
    });
  });

  it("indexes tank and STR DPS gear together under STR and preserves their job lists", () => {
    const tankJobs = (
      Object.keys(generatedPayload.jobSchemas) as JobId[]
    ).filter(
      (jobId) =>
        generatedPayload.jobSchemas[jobId].role === "tank" &&
        generatedPayload.jobSchemas[jobId].mainStat === "STR",
    );
    const strDpsJobs = (
      Object.keys(generatedPayload.jobSchemas) as JobId[]
    ).filter(
      (jobId) =>
        generatedPayload.jobSchemas[jobId].role === "str" &&
        generatedPayload.jobSchemas[jobId].mainStat === "STR",
    );
    expect(tankJobs.length).toBeGreaterThan(0);
    expect(strDpsJobs.length).toBeGreaterThan(0);

    const sourceGear = generatedPayload.gears[0]!;
    const tankGear = makeBareGear(sourceGear, {
      id: 1_200_000_001,
      name: "tank-str-gear",
      jobs: tankJobs,
    });
    const strDpsGear = makeBareGear(sourceGear, {
      id: 1_200_000_002,
      name: "str-dps-gear",
      jobs: strDpsJobs,
    });
    const catalog = encodeGearCatalog(
      [tankGear, strDpsGear],
      generatedPayload.jobSchemas,
    );
    const decoded = decodeGearCatalog(
      catalog.bytes,
      Object.keys(generatedPayload.jobSchemas) as JobId[],
    );

    expect(catalog.gearPhysicalGroupRanges.VIT.count).toBe(0);
    expect(catalog.gearPhysicalGroupRanges.STR.count).toBe(2);
    expect(decoded.gearPhysicalGroupRanges.VIT.count).toBe(0);
    expect(decoded.gearIndexesByMainStat.VIT).toHaveLength(0);
    expect(decoded.gearIndexesByMainStat.STR).toHaveLength(2);
    expect(decoded.getGearById(tankGear.id)?.jobs).toEqual(tankJobs);
    expect(decoded.getGearById(strDpsGear.id)?.jobs).toEqual(strDpsJobs);
    const indexedIds = Array.from(
      decoded.gearIndexesByMainStat.STR,
      (index) => decoded.getGearAtRecordIndex(index).id,
    ).sort((left, right) => left - right);
    expect(indexedIds).toEqual([tankGear.id, strDpsGear.id]);
  });

  it("rejects an out-of-range main-stat record reference after CRC repair", async () => {
    const payload = makeMinimalPayload(generatedPayload);
    const encoded = await encodeGeneratedData(payload);
    const gearCatalog = readContainer(encoded.bytes).get(10)!;
    const { recordCount, mainStatReferenceOffset, mainStatReferenceWidth } =
      locateGearCatalogTestOffsets(gearCatalog);
    const directoryEntry =
      16 + SECTION_IDS.indexOf(10) * DIRECTORY_ENTRY_BYTES;
    const containerView = new DataView(
      encoded.bytes.buffer,
      encoded.bytes.byteOffset,
      encoded.bytes.byteLength,
    );
    const sectionOffset = containerView.getUint32(directoryEntry + 4, true);
    const corrupted = encoded.bytes.slice();
    writeUnsignedAt(
      corrupted,
      sectionOffset + mainStatReferenceOffset,
      mainStatReferenceWidth,
      recordCount,
    );

    await expect(decodeGeneratedData(resealCrc(corrupted))).rejects.toThrow(
      /主属性索引引用越界/,
    );
  }, 300_000);

  it("keeps gear IDs and icons as u32 and accepts u16 stat endpoints", () => {
    const gear = makeBareGear(generatedPayload.gears[0]!, {
      id: 0xffffffff,
      icon: 0xffffffff,
      stats: { main: 0, secondary: 65535 },
      itemSpecialBonus: 11,
      itemSpecialBonusParam: 64,
      specialStats: { CRT: 0, DET: 65535 },
    });
    const encoded = encodeGearCatalog([gear], generatedPayload.jobSchemas);
    const decoded = decodeGearCatalog(
      encoded.bytes,
      Object.keys(generatedPayload.jobSchemas) as JobId[],
    );
    const actual = decoded.getGearById(gear.id)!;

    expect(actual.id).toBe(0xffffffff);
    expect(actual.icon).toBe(0xffffffff);
    expect(actual.stats).toEqual({ main: 0, secondary: 65535 });
    expect(actual.specialStats).toEqual({ CRT: 0, DET: 65535 });
  });

  it.each([
    ["ordinary", -1],
    ["ordinary", 1.5],
    ["ordinary", 65536],
    ["special", -1],
    ["special", 1.5],
    ["special", 65536],
  ] as const)("rejects %s gear stat value %s outside u16", (kind, value) => {
    const gear = makeBareGear(generatedPayload.gears[0]!, {
      itemSpecialBonus: 11,
      itemSpecialBonusParam: 64,
      specialStats: { DET: 1 },
    });
    if (kind === "ordinary") gear.stats.main = value;
    else gear.specialStats!.DET = value;

    expect(() =>
      encodeGearCatalog([gear], generatedPayload.jobSchemas),
    ).toThrow(/范围/);
  });

  it.each(["id", "icon"] as const)("rejects a gear %s above u32", (field) => {
    const gear = makeBareGear(generatedPayload.gears[0]!);
    gear[field] = 0x1_0000_0000;
    expect(() =>
      encodeGearCatalog([gear], generatedPayload.jobSchemas),
    ).toThrow(/u32/);
  });

  it("rejects invalid gear dictionary references and damaged length tables", () => {
    const gear = makeBareGear(generatedPayload.gears[0]!);
    const jobIds = Object.keys(generatedPayload.jobSchemas) as JobId[];
    const catalog = encodeGearCatalog(
      [gear],
      generatedPayload.jobSchemas,
    ).bytes;
    const offsets = locateGearCatalogTestOffsets(catalog);

    const badJobCombinationReference = catalog.slice();
    writeUnsignedAt(
      badJobCombinationReference,
      offsets.jobCombinationReferenceOffset,
      referenceWidth(offsets.jobCombinationCount),
      offsets.jobCombinationCount,
    );
    expect(() =>
      decodeGearCatalog(badJobCombinationReference, jobIds).getGearById(
        gear.id,
      ),
    ).toThrow();

    const badStatMaskReference = catalog.slice();
    writeUnsignedAt(
      badStatMaskReference,
      offsets.statMaskReferenceOffset,
      referenceWidth(offsets.statMaskCount),
      offsets.statMaskCount,
    );
    expect(() =>
      decodeGearCatalog(badStatMaskReference, jobIds).getGearById(gear.id),
    ).toThrow();

    const badStatMaskDictionary = catalog.slice();
    new DataView(badStatMaskDictionary.buffer).setUint32(
      offsets.statMaskDictionaryOffset,
      0x80000000,
      true,
    );
    expect(() => decodeGearCatalog(badStatMaskDictionary, jobIds)).toThrow();

    const badRecordLength = catalog.slice();
    badRecordLength[offsets.firstRecordLengthOffset] = 0;
    expect(() => decodeGearCatalog(badRecordLength, jobIds)).toThrow();

    const badStringLength = catalog.slice();
    badStringLength[offsets.firstNameLengthOffset] = 0x81;
    expect(() => decodeGearCatalog(badStringLength, jobIds)).toThrow();
  });

  it.each([
    [256, 1],
    [257, 2],
    [65536, 2],
    [65537, 4],
  ] as const)(
    "roundtrips a %s-entry gear dictionary index using %s bytes",
    (count, width) => {
      expect(gearIndexWidth(count, "test dictionary")).toBe(width);
      const endpoint = count - 1;
      const writer = new ByteWriter();
      writeGearIndex(writer, endpoint, count, "test dictionary");
      const bytes = writer.finish();
      expect(bytes.byteLength).toBe(width);
      const reader = new ByteReader(bytes, "test dictionary");
      expect(readGearIndex(reader, count, "test dictionary")).toBe(endpoint);
      reader.finish();
    },
  );

  it("encodes source references across the 256-to-257-entry boundary", () => {
    const sourceGear = generatedPayload.gears[0]!;
    const jobIds = Object.keys(generatedPayload.jobSchemas) as JobId[];
    const sourceForCount = (count: number) =>
      Array.from({ length: count }, (_, index) =>
        makeBareGear(sourceGear, {
          id: 1_000_000_000 + index,
          name: `gear-${index}`,
          source: `source-${index}`,
        }),
      );

    for (const count of [256, 257]) {
      const gears = sourceForCount(count);
      const catalog = encodeGearCatalog(
        gears,
        generatedPayload.jobSchemas,
      ).bytes;
      const offsets = locateGearCatalogTestOffsets(catalog);
      const lastGear = gears[count - 1]!;
      expect(offsets.nameStringCount).toBe(count);
      expect(offsets.sourceStringCount).toBe(count);

      const recordOffset = offsets.recordBodyOffsetById.get(lastGear.id)!;
      const sourceReferenceOffset =
        recordOffset +
        10 +
        referenceWidth(offsets.jobCombinationCount) +
        referenceWidth(offsets.statMaskCount) +
        2 + // one u16 stat value for the main mask
        referenceWidth(offsets.nameStringCount);
      const sourceReferenceWidth = referenceWidth(offsets.sourceStringCount);
      expect(
        readUnsignedAt(catalog, sourceReferenceOffset, sourceReferenceWidth),
      ).toBe(count - 1);

      const decoded = decodeGearCatalog(catalog, jobIds);
      expect(decoded.getGearById(lastGear.id)?.source).toBe(
        `source-${count - 1}`,
      );
    }
  });

  it("keeps job-combination order and category in the dictionary without sharing decoded arrays", () => {
    const [jobA, jobB] = Object.keys(generatedPayload.jobSchemas) as JobId[];
    expect(jobA).toBeDefined();
    expect(jobB).toBeDefined();
    const sourceGear = generatedPayload.gears[0]!;
    const gears = [
      makeBareGear(sourceGear, {
        id: 1_100_000_001,
        jobCategory: 123,
        jobs: [jobA, jobB],
      }),
      makeBareGear(sourceGear, {
        id: 1_100_000_002,
        jobCategory: 123,
        jobs: [jobB, jobA],
      }),
      makeBareGear(sourceGear, {
        id: 1_100_000_003,
        jobCategory: 456,
        jobs: [jobA, jobB],
      }),
    ];
    const catalog = encodeGearCatalog(gears, generatedPayload.jobSchemas).bytes;
    const offsets = locateGearCatalogTestOffsets(catalog);
    expect(offsets.jobCombinationCount).toBe(3);

    const decoded = decodeGearCatalog(
      catalog,
      Object.keys(generatedPayload.jobSchemas) as JobId[],
    );
    const first = decoded.getGearById(gears[0]!.id)!;
    const second = decoded.getGearById(gears[1]!.id)!;
    const third = decoded.getGearById(gears[2]!.id)!;
    expect(first.jobs).toEqual([jobA, jobB]);
    expect(second.jobs).toEqual([jobB, jobA]);
    expect(third.jobs).toEqual([jobA, jobB]);

    first.jobs[0] = jobB;
    expect(second.jobs).toEqual([jobB, jobA]);
    expect(third.jobs).toEqual([jobA, jobB]);
  });

  it("encodes food stats as u16 and rates as direct u8 percentages", () => {
    const source = generatedPayload.foods[0]!;
    const food = {
      ...structuredClone(source),
      stats: { STR: 0, VIT: 65535 },
      statRates: { CRT: 0, DET: 255 },
    };
    const encoded = writeFoodsSection({ foods: [food] });
    expect(readFoodsSection(encoded).foods).toEqual([food]);

    for (const value of [-1, 1.5, 65536]) {
      const invalid = { ...food, stats: { STR: value } };
      expect(() => writeFoodsSection({ foods: [invalid] })).toThrow();
    }
    for (const value of [-1, 1.5, 256]) {
      const invalid = { ...food, statRates: { CRT: value } };
      expect(() => writeFoodsSection({ foods: [invalid] })).toThrow();
    }
  });

  it("deduplicates ItemLevel cap columns by content and rejects bad references", () => {
    const encoded = writeLevelCapsSection({
      levelCaps: generatedPayload.levelCaps,
    });
    const reader = new ByteReader(encoded, "test ItemLevel caps");
    reader.varUint(); // generic section string table: no strings in this schema
    const levelCount = reader.varUint();
    reader.slice(levelCount * 2);
    const columnCount = reader.varUint();
    for (let index = 0; index < columnCount; index++) {
      const rowCount = reader.varUint();
      reader.slice(rowCount * 2);
    }
    const referenceCount = reader.varUint();
    expect(referenceCount).toBe(20);
    const expectedDistinctCount = new Set(
      CAP_COLUMNS.map((column) =>
        generatedPayload.levelCaps[column]!.join(","),
      ),
    ).size;
    expect(columnCount).toBe(expectedDistinctCount);
    const referencesOffset = reader.offset;

    const decoded = readLevelCapsSection(encoded).levelCaps;
    expect(decoded).toEqual(generatedPayload.levelCaps);
    const dexCap = decoded.DEX![0]!;
    decoded.STR![0] = dexCap + 1;
    expect(decoded.DEX![0]).toBe(dexCap);

    const corrupted = encoded.slice();
    corrupted[referencesOffset] = columnCount;
    expect(() => readLevelCapsSection(corrupted)).toThrow(/列引用越界/);

    const duplicateColumns = encodeSection(
      itemLevelCapsSectionSchema,
      {
        levels: [100],
        columns: [[1], [1]],
        references: new Array(20).fill(0),
      },
      "duplicate ItemLevel cap columns",
    );
    expect(() => readLevelCapsSection(duplicateColumns)).toThrow(/重复列/);

    for (const value of [-1, 1.5, 65536]) {
      const invalidCaps = structuredClone(generatedPayload.levelCaps);
      invalidCaps.STR![0] = value;
      expect(() => writeLevelCapsSection({ levelCaps: invalidCaps })).toThrow();
    }

    const endpointCaps = structuredClone(generatedPayload.levelCaps);
    endpointCaps.STR![0] = 65535;
    expect(
      readLevelCapsSection(writeLevelCapsSection({ levelCaps: endpointCaps }))
        .levelCaps.STR![0],
    ).toBe(65535);
  });

  it("keeps a JSON-looking gear name as ordinary user text", async () => {
    const payload = makeMinimalPayload(generatedPayload);
    const gear = payload.gears[0]!;
    const name = '{"displayName":"custom set","source":{"kind":"reference"}}';
    gear.name = name;
    const encoded = await encodeGeneratedData(payload);
    const decoded = await decodeGeneratedData(encoded.bytes);

    expect(decoded.getGearById(gear.id)?.name).toBe(name);
  }, 300_000);

  it("preserves gear flags, raw main/secondary stats, and ItemSpecialBonus metadata", async () => {
    const sourceGear = generatedPayload.gears[0]!;
    const baseGear: GeneratedGear = {
      ...sourceGear,
      stats: { ...sourceGear.stats, main: 2, secondary: 3 },
    };
    Reflect.deleteProperty(baseGear, "equipLevelVariable");
    Reflect.deleteProperty(baseGear, "materiaAdvanced");
    Reflect.deleteProperty(baseGear, "unique");
    Reflect.deleteProperty(baseGear, "itemSpecialBonus");
    Reflect.deleteProperty(baseGear, "itemSpecialBonusParam");
    Reflect.deleteProperty(baseGear, "specialStats");

    const flagCases: readonly {
      flags: Pick<
        GeneratedGear,
        "equipLevelVariable" | "materiaAdvanced" | "unique"
      >;
    }[] = [
      { flags: {} },
      { flags: { equipLevelVariable: true } },
      {
        flags: {
          equipLevelVariable: true,
          materiaAdvanced: true,
          unique: true,
        },
      },
      { flags: { materiaAdvanced: true, unique: true } },
    ];

    for (const { flags } of flagCases) {
      const payload = {
        ...generatedPayload,
        gears: [{ ...baseGear, ...flags }],
      };
      const encoded = await encodeGeneratedData(payload);
      const decoded = await decodeGeneratedData(encoded.bytes);
      const actual = decoded.getGearById(baseGear.id)!;
      expect(actual.equipLevelVariable === true).toBe(
        flags.equipLevelVariable === true,
      );
      expect(actual.unique).toBe(flags.unique === true);
      expect(actual.materiaAdvanced === true).toBe(
        flags.materiaAdvanced === true,
      );
      expect(actual.stats.main).toBe(2);
      expect(actual.stats.secondary).toBe(3);
      expect(actual.icon).toBe(baseGear.icon);
      expect(decoded.foods[0]?.icon).toBe(generatedPayload.foods[0]?.icon);
      expect(decoded.jobs).toEqual(generatedPayload.jobs);
      expect(decoded.sync).toEqual(generatedPayload.sync);
    }

    const specialGear: GeneratedGear = {
      ...baseGear,
      itemSpecialBonus: 11,
      itemSpecialBonusParam: 64,
      specialStats: { secondary: 20, DET: 30 },
    };
    const specialEncoded = await encodeGeneratedData({
      ...generatedPayload,
      gears: [specialGear],
    });
    const specialDecoded = await decodeGeneratedData(specialEncoded.bytes);
    const actualSpecialGear = specialDecoded.getGearById(specialGear.id)!;
    expect(actualSpecialGear.itemSpecialBonus).toBe(11);
    expect(actualSpecialGear.itemSpecialBonusParam).toBe(64);
    expect(actualSpecialGear.specialStats).toEqual({ DET: 30, secondary: 20 });
    expect(actualSpecialGear.stats).toEqual(specialGear.stats);
  }, 300_000);

  it("rejects malformed gear flags, incomplete bonuses, and missing icons", async () => {
    const malformedFlag = makeMinimalPayload(generatedPayload);
    Object.assign(malformedFlag.gears[0]!, { equipLevelVariable: "true" });
    await expect(encodeGeneratedData(malformedFlag)).rejects.toThrow(
      /equipLevelVariable/,
    );

    const incompleteBonus = makeMinimalPayload(generatedPayload);
    Object.assign(incompleteBonus.gears[0]!, { itemSpecialBonus: 11 });
    await expect(encodeGeneratedData(incompleteBonus)).rejects.toThrow(
      /ItemSpecialBonus 字段不完整/,
    );

    const unsupportedBonus = makeMinimalPayload(generatedPayload);
    Object.assign(unsupportedBonus.gears[0]!, {
      itemSpecialBonus: 12,
      itemSpecialBonusParam: 0,
      specialStats: {},
    });
    await expect(encodeGeneratedData(unsupportedBonus)).rejects.toThrow(
      /只支持 11/,
    );

    const missingGearIcon = makeMinimalPayload(generatedPayload);
    Reflect.deleteProperty(missingGearIcon.gears[0]!, "icon");
    await expect(encodeGeneratedData(missingGearIcon)).rejects.toThrow(
      /缺少有效 icon/,
    );

    const missingFoodIcon = makeMinimalPayload(generatedPayload);
    Reflect.deleteProperty(missingFoodIcon.foods[0]!, "icon");
    await expect(encodeGeneratedData(missingFoodIcon)).rejects.toThrow(
      /食物缺少有效 icon/,
    );
  }, 300_000);

  it("keeps sync and ItemLevel cap metadata validation strict", async () => {
    const invalidSyncFloor = makeMinimalPayload(generatedPayload);
    invalidSyncFloor.sync.levels[0]!.minItemLevel = 89;
    await expect(encodeGeneratedData(invalidSyncFloor)).rejects.toThrow(
      /同步等级下界/,
    );

    const invalidSyncTarget = makeMinimalPayload(generatedPayload);
    invalidSyncTarget.sync.groups[0]!.options[0]!.target = {
      kind: "itemLevel",
      value: 89,
    };
    await expect(encodeGeneratedData(invalidSyncTarget)).rejects.toThrow(
      /低于 90/,
    );

    const uncappedSyncTarget = makeMinimalPayload(generatedPayload);
    uncappedSyncTarget.sync.groups[0]!.options[0]!.target = {
      kind: "itemLevel",
      value: 65535,
    };
    await expect(encodeGeneratedData(uncappedSyncTarget)).rejects.toThrow(
      /缺少属性上限/,
    );

    const legacySyncFields = makeMinimalPayload(generatedPayload);
    Object.assign(legacySyncFields, { syncLevelDuties: {} });
    await expect(encodeGeneratedData(legacySyncFields)).rejects.toThrow(
      /旧同步数据字段|未定义字段/,
    );

    const missingColumn = makeMinimalPayload(generatedPayload);
    Reflect.deleteProperty(missingColumn.levelCaps, "CRT");
    await expect(encodeGeneratedData(missingColumn)).rejects.toThrow(
      /缺少 ItemLevel 属性上限列 CRT/,
    );

    const truncatedColumn = makeMinimalPayload(generatedPayload);
    truncatedColumn.levelCaps.CRT!.pop();
    await expect(encodeGeneratedData(truncatedColumn)).rejects.toThrow(
      /CRT 缺失、截断/,
    );

    const negativeCap = makeMinimalPayload(generatedPayload);
    negativeCap.levelCaps.CRT![0] = -1;
    await expect(encodeGeneratedData(negativeCap)).rejects.toThrow(
      /CRT 缺失、截断/,
    );

    const sparseColumn = makeMinimalPayload(generatedPayload);
    Reflect.deleteProperty(sparseColumn.levelCaps.CRT!, "0");
    await expect(encodeGeneratedData(sparseColumn)).rejects.toThrow(
      /CRT 缺失、截断/,
    );

    const duplicateGroups = makeMinimalPayload(generatedPayload);
    duplicateGroups.sync.groups.push(
      structuredClone(duplicateGroups.sync.groups[0]!),
    );
    await expect(encodeGeneratedData(duplicateGroups)).rejects.toThrow(
      /大分类结构无效或重复/,
    );
  }, 300_000);
});
