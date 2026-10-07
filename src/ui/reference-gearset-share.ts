import type { JobId, JobSchema, Stat, Stats } from "../domain/types";

const JOB_INDEX: Partial<Record<JobId, number>> = {
  PLD: 0, WAR: 1, DRK: 2, GNB: 3, WHM: 4, SCH: 5, AST: 6, SGE: 7,
  MNK: 8, DRG: 9, NIN: 10, SAM: 11, RPR: 12, VPR: 13, BRD: 14,
  MCH: 15, DNC: 16, BLM: 17, SMN: 18, RDM: 19, PCT: 20, BLU: 21,
  // Asvel share v6 places BST after the omitted crafting and gathering job codes.
  BST: 33,
};

const JOB_LEVELS = [50, 60, 70, 80, 90, 100] as const;
const MATERIA_STATS: Record<JobSchema["role"], readonly Stat[]> = {
  tank: ["CRT", "DET", "DHT", "SKS", "TEN"],
  healer: ["CRT", "DET", "DHT", "SPS", "PIE"],
  str: ["CRT", "DET", "DHT", "SKS"],
  dex: ["CRT", "DET", "DHT", "SKS"],
  int: ["CRT", "DET", "DHT", "SPS"],
};

export interface ReferenceGearsetGear {
  id: number;
  materias: readonly (readonly [Stat, number])[];
  customStats?: Stats;
}

export interface ReferenceGearset {
  job: JobId;
  role: JobSchema["role"];
  jobLevel: number;
  syncLevel?: number;
  gears: readonly ReferenceGearsetGear[];
}

function base62Encode(value: bigint): string {
  const charset = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let remaining = value;
  let encoded = "";
  do {
    encoded = charset[Number(remaining % 62n)] + encoded;
    remaining /= 62n;
  } while (remaining > 0n);
  return encoded;
}

/** Encodes the compatible Asvel gearset share format while preserving job and sync levels. */
export function stringifyReferenceGearset(gearset: ReferenceGearset): string | undefined {
  const jobIndex = JOB_INDEX[gearset.job] ?? -1;
  const shareVersion = gearset.job === "BST" ? 6 : 5;
  const jobRange = shareVersion === 6 ? 34 : 33;
  const jobLevelIndex = JOB_LEVELS.indexOf(gearset.jobLevel as (typeof JOB_LEVELS)[number]);
  const statDecode = MATERIA_STATS[gearset.role];
  if (jobIndex < 0 || jobLevelIndex < 0 || gearset.gears.length === 0) return undefined;
  if (gearset.syncLevel !== undefined && (!Number.isInteger(gearset.syncLevel) || gearset.syncLevel < 0 || gearset.syncLevel >= 800)) return undefined;
  if (gearset.gears.some(({ id, materias, customStats }) =>
    !Number.isSafeInteger(id) || id <= 0 || id >= 60000 ||
    (customStats !== undefined && Object.values(customStats).some((value) => !Number.isInteger(value) || value < 0 || value > 1000)) ||
    materias.length > 5 || materias.some(([stat, grade]) => !statDecode.includes(stat) || !Number.isInteger(grade) || grade < 1 || grade > 12),
  )) return undefined;

  const gearTypeEncode: number[] = [];
  const materiaEncode: number[][] = [];
  materiaEncode[12] = [];
  for (const gear of gearset.gears) {
    if (gear.customStats !== undefined) {
      gearTypeEncode[7] = 1;
      continue;
    }
    gearTypeEncode[gear.materias.length] = 1;
    for (const [stat, grade] of gear.materias) {
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
      if (materiaEncode[grade][statIndex] !== undefined) materiaEncode[grade][statIndex] = materiaRange++;
    }
  }

  let minMateriaGrade = 0;
  while (materiaEncode[minMateriaGrade] === undefined) minMateriaGrade++;

  const gearCodes = gearset.gears.map(({ id, materias, customStats }) => ({
    id,
    materias: customStats === undefined
      ? materias.map(([stat, grade]) => materiaEncode[grade]![statDecode.indexOf(stat)]!)
      : [],
    customStats,
  }));

  let ringIndex = gearCodes.length - 1;
  while (gearCodes[ringIndex]?.materias.length === 0) ringIndex--;
  const ringsInversed = ringIndex > 0 && gearCodes[ringIndex - 1]!.id > gearCodes[ringIndex]!.id;
  gearCodes.sort((left, right) => left.id - right.id);

  let gearIdDeltaRange = 0;
  for (let i = 1; i < gearCodes.length; i++) {
    gearIdDeltaRange = Math.max(gearIdDeltaRange, gearCodes[i]!.id - gearCodes[i - 1]!.id);
  }
  gearIdDeltaRange += 1;

  let gearIdDeltaDirection = 1;
  if (gearCodes.length > 1) {
    if (gearIdDeltaRange >= gearCodes[0]!.id ||
      gearCodes[1]!.id - gearCodes[0]!.id < gearCodes[gearCodes.length - 1]!.id - gearCodes[gearCodes.length - 2]!.id) {
      gearIdDeltaDirection = -1;
      gearCodes.reverse();
    }
    if (gearCodes[gearCodes.length - 1]!.id - gearCodes[gearCodes.length - 2]!.id ===
      gearIdDeltaDirection * (gearIdDeltaRange - 1)) gearIdDeltaRange++;
  }

  let result = 0n;
  const write = (value: number, range: number) => {
    if (!Number.isSafeInteger(value) || !Number.isSafeInteger(range) || range <= 0) throw new Error("无法生成配装分享链接。");
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
      for (let materiaIndex = gear.materias.length - 1; materiaIndex >= 0; materiaIndex--) {
        write(gear.materias[materiaIndex]!, materiaRange);
      }
    }
    write(gearTypeEncode[gear.customStats === undefined ? gear.materias.length : 7]!, gearTypeRange);
  }

  for (let grade = minMateriaGrade; grade <= 12; grade++) {
    if (grade === 0) continue;
    for (let statIndex = statDecode.length - 1; statIndex >= 0; statIndex--) {
      writeBoolean(materiaEncode[grade]?.[statIndex] !== undefined);
    }
  }
  write(minMateriaGrade, 13);
  for (let type = 7; type >= 0; type--) writeBoolean(gearTypeEncode[type] !== undefined);

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
