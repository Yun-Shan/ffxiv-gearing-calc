import {
  foods,
  gameData,
  getGearById,
  effectiveGearSyncLevel,
  jobLevelFor,
  jobSchemas,
  type JobId,
  type GearSlot,
  type JobSchema,
  type OptimizationConfig,
  type OptimizationResult,
  type Stat,
  type Stats,
} from "@/domain";

const JOB_INDEX: Partial<Record<JobId, number>> = {
  PLD: 0,
  WAR: 1,
  DRK: 2,
  GNB: 3,
  WHM: 4,
  SCH: 5,
  AST: 6,
  SGE: 7,
  MNK: 8,
  DRG: 9,
  NIN: 10,
  SAM: 11,
  RPR: 12,
  VPR: 13,
  BRD: 14,
  MCH: 15,
  DNC: 16,
  BLM: 17,
  SMN: 18,
  RDM: 19,
  PCT: 20,
  BLU: 21,
  // Asvel 分享格式第 6 版将 BST 排在省略的生产与采集职业代码之后。
  BST: 33,
};

const JOB_LEVELS = [50, 60, 70, 80, 90, 100] as const;
const BASE62 = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
const SPECIAL_GEAR_IDS = [
  10337, 10338, 10339, 10340, 10341, 10342, 10343, 10344, 17726,
] as const;
const MATERIA_STATS: Record<JobSchema["role"], readonly Stat[]> = {
  tank: ["CRT", "DET", "DHT", "SKS", "TEN"],
  healer: ["CRT", "DET", "DHT", "SPS", "PIE"],
  str: ["CRT", "DET", "DHT", "SKS"],
  dex: ["CRT", "DET", "DHT", "SKS"],
  int: ["CRT", "DET", "DHT", "SPS"],
};

export interface ReferenceGearsetGear {
  id: number;
  slot?: GearSlot;
  materias: readonly (readonly [Stat, number] | null)[];
  customStats?: Stats;
}

export interface ReferenceGearset {
  job: JobId;
  role: JobSchema["role"];
  jobLevel: number;
  syncLevel?: number;
  gears: readonly ReferenceGearsetGear[];
  foodId?: number;
}

/**
 * Builds the upstream fixed-gear URL from a completed result snapshot.
 * Food is encoded as a regular gear entry, as supported by Asvel's format.
 */
export function resultReferenceUrl(
  result: OptimizationResult,
  config: OptimizationConfig,
): string | undefined {
  const calculationLevel = result.calculationLevel;
  if (!Number.isSafeInteger(calculationLevel) || calculationLevel! <= 0)
    return undefined;
  const job = jobSchemas[config.jobId];
  const gears = result.gear.map((gear) => {
    const synced =
      effectiveGearSyncLevel(gear, jobLevelFor(config), config.syncLevel) !==
      undefined;
    const customStats =
      gear.customParameters?.length || gear.resistanceWeaponAdjust !== undefined
        ? Object.fromEntries(
            [
              ...new Set(
                gear.customParameters?.map(({ stat }) => stat) ??
                  gear.resistanceWeaponAdjust!.stats,
              ),
            ]
              .map(
                (stat) =>
                  [
                    stat,
                    (gear.stats[stat] ?? 0) +
                      gear.melds
                        .filter(
                          (meld) => meld.stat === stat && meld.grade === 0,
                        )
                        .reduce((sum, meld) => sum + meld.value, 0),
                  ] as const,
              )
              .filter(([, value]) => value > 0),
          )
        : undefined;
    const materias: (readonly [Stat, number] | null)[] = [];
    if (customStats === undefined && !synced) {
      // Search melds are grouped by stat, rather than assigned to physical holes.
      // Explicit imported positions must remain unchanged, including empty holes.
      const melds = gear.melds.some((meld) => meld.slotIndex !== undefined)
        ? gear.melds
        : gear.melds.toSorted(
            (left, right) =>
              Number(gameData.materiaGradeIsRestricted[right.grade] !== false) -
              Number(gameData.materiaGradeIsRestricted[left.grade] !== false),
          );
      for (let index = 0; index < melds.length; index++) {
        const meld = melds[index]!;
        const slot = meld.slotIndex ?? index;
        while (materias.length <= slot) materias.push(null);
        materias[slot] = [meld.stat, meld.grade];
      }
    }
    return {
      id: gear.id,
      slot: gear.slot,
      materias,
      ...(customStats ? { customStats } : {}),
    };
  });
  const share = stringifyReferenceGearset({
    job: config.jobId,
    role: job.role,
    jobLevel: calculationLevel!,
    ...(config.syncLevel === undefined ? {} : { syncLevel: config.syncLevel }),
    gears,
    foodId: result.food.id,
  });
  return share ? `https://asvel.github.io/ffxiv-gearing/?${share}` : undefined;
}

function base62Encode(value: bigint): string {
  let remaining = value;
  let encoded = "";
  do {
    encoded = BASE62[Number(remaining % 62n)] + encoded;
    remaining /= 62n;
  } while (remaining > 0n);
  return encoded;
}

function referencePayload(input: string): string {
  const trimmed = input.trim();
  let payload = trimmed;
  if (!/^[0-9a-zA-Z]+$/.test(trimmed)) {
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      throw new Error("请输入有效的 Asvel 配装分享链接。");
    }
    if (
      url.protocol !== "https:" ||
      url.hostname !== "asvel.github.io" ||
      !url.pathname.startsWith("/ffxiv-gearing/")
    ) {
      throw new Error("该链接不是受支持的 Asvel 配装分享链接。");
    }
    try {
      payload = decodeURIComponent(url.search.slice(1));
    } catch {
      throw new Error("分享链接编码无效。");
    }
  }
  if (
    payload.length === 0 ||
    payload.length > 512 ||
    ![...payload].every((character) => BASE62.includes(character))
  ) {
    throw new Error("分享链接内容无效。");
  }
  return payload;
}

/**
 * Decodes the current Asvel v5/v6 gearset format. Food is recognized from the
 * current food catalog because the share format stores it as a gear entry.
 */
export function parseReferenceGearset(input: string): ReferenceGearset {
  const payload = referencePayload(input);
  const base62Values = new Map(
    [...BASE62].map((character, index) => [character, BigInt(index)]),
  );
  let encoded = 0n;
  for (const character of payload) {
    encoded = encoded * 62n + base62Values.get(character)!;
  }

  const read = (range: number): number => {
    if (!Number.isSafeInteger(range) || range <= 0) {
      throw new Error("分享链接字段范围无效。");
    }
    const base = BigInt(range);
    const value = Number(encoded % base);
    encoded /= base;
    return value;
  };
  const readBoolean = () => read(2) === 1;

  const version = read(77);
  if (version !== 5 && version !== 6) {
    throw new Error(`不支持 Asvel 分享格式版本 ${version}。`);
  }
  const jobRange = version === 6 ? 34 : 33;
  const jobIndex = read(jobRange);
  const job = (Object.keys(JOB_INDEX) as JobId[]).find(
    (jobId) => JOB_INDEX[jobId] === jobIndex,
  );
  if (!job) throw new Error("分享链接中的职业无效或当前不支持。");
  const role = jobSchemas[job].role;
  const statDecode = MATERIA_STATS[role];

  const synced = readBoolean();
  let jobLevel: number = 100;
  let syncLevel: number | undefined;
  if (synced) {
    const jobLevelIndex = read(JOB_LEVELS.length);
    const decodedLevel = JOB_LEVELS[jobLevelIndex];
    if (decodedLevel === undefined) throw new Error("分享链接职业等级无效。");
    jobLevel = decodedLevel;
    syncLevel = read(800) || undefined;
  }

  const gearTypeDecode: number[] = [];
  for (let type = 0; type < 8; type++) {
    if (readBoolean()) gearTypeDecode.push(type);
  }
  if (gearTypeDecode.length === 0) throw new Error("分享链接中没有装备。");

  const minMateriaGrade = read(13);
  const materiaDecode: (readonly [Stat, number] | null)[] = [];
  for (let grade = 12; grade >= minMateriaGrade; grade--) {
    if (grade === 0) continue;
    for (let statIndex = 0; statIndex < statDecode.length; statIndex++) {
      if (readBoolean()) materiaDecode.push([statDecode[statIndex]!, grade]);
    }
  }
  if (minMateriaGrade === 0) materiaDecode.push(null);

  let gearIdDeltaRange = 0;
  let gearIdDeltaDirection = 0;
  let ringsInversed = false;
  let id = -1;
  const decodedGears: ReferenceGearsetGear[] = [];
  while (encoded !== 0n) {
    if (decodedGears.length >= 64) throw new Error("分享链接包含过多装备。");
    const typeCode = gearTypeDecode[read(gearTypeDecode.length)];
    if (typeCode === undefined) throw new Error("分享链接装备类型无效。");

    if (typeCode === 6) {
      const specialId = SPECIAL_GEAR_IDS[read(SPECIAL_GEAR_IDS.length)];
      if (specialId === undefined) throw new Error("分享链接装备编号无效。");
      decodedGears.push({ id: specialId, materias: [] });
      continue;
    }

    const materias: (readonly [Stat, number] | null)[] = [];
    let customStats: Stats | undefined;
    if (typeCode === 7) {
      customStats = {};
      for (const stat of statDecode) {
        const value = read(1001);
        if (value > 0) customStats[stat] = value;
      }
    } else {
      if (typeCode > 0 && materiaDecode.length === 0) {
        throw new Error("分享链接魔晶石数据无效。");
      }
      for (let index = 0; index < typeCode; index++) {
        const materia = materiaDecode[read(materiaDecode.length)];
        if (materia === undefined) throw new Error("分享链接魔晶石编号无效。");
        materias.push(materia);
      }
    }

    if (id === -1) {
      id = read(60000);
      if (id <= 0) throw new Error("分享链接装备编号无效。");
      gearIdDeltaRange = read(id);
      if (gearIdDeltaRange <= 0) throw new Error("分享链接装备顺序无效。");
      gearIdDeltaDirection = readBoolean() ? 1 : -1;
      ringsInversed = readBoolean();
    } else {
      id +=
        (read(gearIdDeltaRange) - (encoded === 0n ? 1 : 0)) *
        gearIdDeltaDirection;
      if (id <= 0 || id >= 60000) throw new Error("分享链接装备编号无效。");
    }
    decodedGears.push({
      id,
      materias,
      ...(customStats === undefined ? {} : { customStats }),
    });
  }

  if (ringsInversed !== (gearIdDeltaDirection === -1)) decodedGears.reverse();
  const foodIds = new Set(foods.map(({ id: foodId }) => foodId));
  const foodEntries = decodedGears.filter(({ id: gearId }) =>
    foodIds.has(gearId),
  );
  if (foodEntries.length > 1) throw new Error("分享链接包含多个食物。");
  const food = foodEntries[0];
  if (food && (food.materias.length > 0 || food.customStats !== undefined)) {
    throw new Error("分享链接中的食物条目无效。");
  }

  return {
    job,
    role,
    jobLevel,
    ...(syncLevel === undefined ? {} : { syncLevel }),
    gears: decodedGears.filter(({ id: gearId }) => gearId !== food?.id),
    ...(food ? { foodId: food.id } : {}),
  };
}

/** 按 Asvel 配装分享格式编码，并保留职业等级与同步品级。 */
export function stringifyReferenceGearset(
  gearset: ReferenceGearset,
): string | undefined {
  const jobIndex = JOB_INDEX[gearset.job] ?? -1;
  const shareVersion = gearset.job === "BST" ? 6 : 5;
  const jobRange = shareVersion === 6 ? 34 : 33;
  const jobLevelIndex = JOB_LEVELS.indexOf(
    gearset.jobLevel as (typeof JOB_LEVELS)[number],
  );
  const statDecode = MATERIA_STATS[gearset.role];
  if (
    jobIndex < 0 ||
    jobLevelIndex < 0 ||
    (gearset.gears.length === 0 && gearset.foodId === undefined)
  )
    return undefined;
  if (
    gearset.syncLevel !== undefined &&
    (!Number.isInteger(gearset.syncLevel) ||
      gearset.syncLevel < 0 ||
      gearset.syncLevel >= 800)
  )
    return undefined;
  if (
    gearset.foodId !== undefined &&
    (!Number.isSafeInteger(gearset.foodId) ||
      gearset.foodId <= 0 ||
      gearset.foodId >= 60000)
  )
    return undefined;
  const gears = [
    ...gearset.gears,
    ...(gearset.foodId === undefined
      ? []
      : [{ id: gearset.foodId, materias: [] }]),
  ];
  if (
    gears.some(
      ({ id, materias, customStats }) =>
        !Number.isSafeInteger(id) ||
        id <= 0 ||
        id >= 60000 ||
        (customStats !== undefined &&
          Object.values(customStats).some(
            (value) => !Number.isInteger(value) || value < 0 || value > 1000,
          )) ||
        materias.length > 5 ||
        materias.some(
          (materia) =>
            materia !== null &&
            (!statDecode.includes(materia[0]) ||
              !Number.isInteger(materia[1]) ||
              materia[1] < 1 ||
              materia[1] > 12),
        ),
    )
  )
    return undefined;

  const gearTypeEncode: number[] = [];
  const materiaEncode: number[][] = [];
  materiaEncode[12] = [];
  for (const gear of gears) {
    if (gear.customStats !== undefined) {
      gearTypeEncode[7] = 1;
      continue;
    }
    gearTypeEncode[gear.materias.length] = 1;
    for (const materia of gear.materias) {
      if (materia === null) {
        materiaEncode[0] = [];
        continue;
      }
      const [stat, grade] = materia;
      const statIndex = statDecode.indexOf(stat);
      materiaEncode[grade] ??= [];
      materiaEncode[grade][statIndex] = 1;
    }
  }

  let gearTypeRange = 0;
  for (let i = 0; i < 8; i++) {
    if (gearTypeEncode[i] !== undefined) gearTypeEncode[i] = gearTypeRange++;
  }

  let materiaRange = 0;
  for (let grade = 12; grade >= 1; grade--) {
    if (materiaEncode[grade] === undefined) continue;
    for (let statIndex = 0; statIndex < statDecode.length; statIndex++) {
      if (materiaEncode[grade][statIndex] !== undefined)
        materiaEncode[grade][statIndex] = materiaRange++;
    }
  }

  const emptyMateriaCode =
    materiaEncode[0] !== undefined ? materiaRange++ : undefined;
  let minMateriaGrade = 0;
  while (materiaEncode[minMateriaGrade] === undefined) minMateriaGrade++;

  const gearCodes = gears.map(({ id, materias, customStats }) => ({
    id,
    materias:
      customStats === undefined
        ? materias.map((materia) =>
            materia === null
              ? emptyMateriaCode!
              : materiaEncode[materia[1]]![statDecode.indexOf(materia[0])]!,
          )
        : [],
    customStats,
  }));

  // Preserve the input ring positions before sorting or appending food.
  const rings = gearset.gears.filter((gear) => {
    const slot = gear.slot ?? getGearById(gear.id)?.slot;
    return slot === "ring" || slot === "ring2";
  });
  const firstRing = rings.find((gear) => gear.slot === "ring") ?? rings[0];
  const secondRing = rings.find((gear) => gear.slot === "ring2") ?? rings[1];
  const ringsInversed = rings.length === 2 && firstRing!.id > secondRing!.id;
  gearCodes.sort((left, right) => left.id - right.id);

  let gearIdDeltaRange = 0;
  for (let i = 1; i < gearCodes.length; i++) {
    gearIdDeltaRange = Math.max(
      gearIdDeltaRange,
      gearCodes[i]!.id - gearCodes[i - 1]!.id,
    );
  }
  gearIdDeltaRange += 1;

  let gearIdDeltaDirection = 1;
  if (gearCodes.length > 1) {
    if (
      gearIdDeltaRange >= gearCodes[0]!.id ||
      gearCodes[1]!.id - gearCodes[0]!.id <
        gearCodes[gearCodes.length - 1]!.id -
          gearCodes[gearCodes.length - 2]!.id
    ) {
      gearIdDeltaDirection = -1;
      gearCodes.reverse();
    }
    if (
      gearCodes[gearCodes.length - 1]!.id -
        gearCodes[gearCodes.length - 2]!.id ===
      gearIdDeltaDirection * (gearIdDeltaRange - 1)
    )
      gearIdDeltaRange++;
  }

  let result = 0n;
  const write = (value: number, range: number) => {
    if (
      !Number.isSafeInteger(value) ||
      !Number.isSafeInteger(range) ||
      range <= 0
    )
      throw new Error("无法生成配装分享链接。");
    result = result * BigInt(range) + BigInt(value < range ? value : range - 1);
  };
  const writeBoolean = (value: boolean) => write(value ? 1 : 0, 2);

  for (let i = gearCodes.length - 1; i >= 0; i--) {
    const gear = gearCodes[i]!;
    if (i > 0) {
      const delta = (gear.id - gearCodes[i - 1]!.id) * gearIdDeltaDirection;
      write(delta + (i === gearCodes.length - 1 ? 1 : 0), gearIdDeltaRange);
    } else {
      writeBoolean(ringsInversed);
      writeBoolean(gearIdDeltaDirection === 1);
      write(gearIdDeltaRange, gear.id);
      write(gear.id, 60000);
    }
    if (gear.customStats !== undefined) {
      for (let statIndex = statDecode.length - 1; statIndex >= 0; statIndex--) {
        write(gear.customStats[statDecode[statIndex]!] ?? 0, 1001);
      }
    } else {
      for (
        let materiaIndex = gear.materias.length - 1;
        materiaIndex >= 0;
        materiaIndex--
      ) {
        write(gear.materias[materiaIndex]!, materiaRange);
      }
    }
    write(
      gearTypeEncode[
        gear.customStats === undefined ? gear.materias.length : 7
      ]!,
      gearTypeRange,
    );
  }

  for (let grade = minMateriaGrade; grade <= 12; grade++) {
    if (grade === 0) continue;
    for (let statIndex = statDecode.length - 1; statIndex >= 0; statIndex--) {
      writeBoolean(materiaEncode[grade]?.[statIndex] !== undefined);
    }
  }
  write(minMateriaGrade, 13);
  for (let type = 7; type >= 0; type--)
    writeBoolean(gearTypeEncode[type] !== undefined);

  if (gearset.syncLevel !== undefined || gearset.jobLevel !== 100) {
    write(gearset.syncLevel ?? 0, 800);
    write(jobLevelIndex, 6);
    writeBoolean(true);
  } else {
    writeBoolean(false);
  }
  write(jobIndex, jobRange);
  write(shareVersion, 77);
  return base62Encode(result);
}
