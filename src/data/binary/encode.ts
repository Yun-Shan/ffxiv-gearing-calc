import { writeSection as write1 } from "./sections/metadata/write.ts";
import { writeSection as write2 } from "./sections/jobs/write.ts";
import { writeSection as write3 } from "./sections/foods/write.ts";
import { writeSection as write4 } from "./sections/materia/write.ts";
import { writeSection as write5 } from "./sections/sync/write.ts";
import { writeSection as write6 } from "./sections/item-level-caps/write.ts";
import { writeSection as write7 } from "./sections/equipment-caps/write.ts";
import { writeSection as write8 } from "./sections/character-stats/write.ts";
import { writeSection as write9 } from "./sections/level-formulas/write.ts";
import { encodeGearCatalog } from "./sections/gear-catalog/write.ts";
import { writeContainer } from "./container/write.ts";
import { SECTION_NAMES, type SectionName } from "./schema.ts";
import { validateGameDataMetadata } from "./validate.ts";
import { fail } from "./shared/bytes.ts";
import type { GeneratedDataInput } from "./types.ts";

export async function encodeGeneratedData(payload: GeneratedDataInput) {
  validateGameDataMetadata(payload, "运行时快照");
  if (!Array.isArray(payload.gears) || !payload.gears.length)
    fail("装备目录为空");
  const allowed = new Set([
    "version",
    "provenance",
    "jobs",
    "jobSchemas",
    "foods",
    "materias",
    "materiaGradeRequiredLevels",
    "materiaGradeIsRestricted",
    "sync",
    "levelCaps",
    "slotCaps",
    "roleCaps",
    "baseStats",
    "clanStats",
    "jobLevelModifiers",
    "bluMdmgAdditions",
    "gears",
  ]);
  for (const key of Object.keys(payload))
    if (!allowed.has(key)) fail(`运行时快照含未定义字段 ${key}`);
  const catalog = encodeGearCatalog(payload.gears, payload.jobSchemas);
  const sections = new Map<number, Uint8Array>([
    [1, write1({ version: payload.version, provenance: payload.provenance })],
    [2, write2({ jobs: payload.jobs, jobSchemas: payload.jobSchemas })],
    [3, write3({ foods: payload.foods })],
    [
      4,
      write4({
        materias: payload.materias,
        materiaGradeRequiredLevels: payload.materiaGradeRequiredLevels,
        materiaGradeIsRestricted: payload.materiaGradeIsRestricted,
      }),
    ],
    [5, write5({ sync: payload.sync })],
    [6, write6({ levelCaps: payload.levelCaps })],
    [7, write7({ slotCaps: payload.slotCaps, roleCaps: payload.roleCaps })],
    [8, write8({ baseStats: payload.baseStats, clanStats: payload.clanStats })],
    [
      9,
      write9({
        jobLevelModifiers: payload.jobLevelModifiers,
        bluMdmgAdditions: payload.bluMdmgAdditions,
      }),
    ],
    [10, catalog.bytes],
  ]);
  return {
    bytes: writeContainer(sections),
    gearCount: catalog.gears.length,
    physicalGroupCounts: Object.fromEntries(
      Object.entries(catalog.gearPhysicalGroupRanges).map(([group, range]) => [
        group,
        range.count,
      ]),
    ),
    mainStatIndexCounts: catalog.groupCounts,
    mainStatIndexBytes: catalog.mainStatIndexBytes,
    sectionSizes: Object.fromEntries(
      SECTION_NAMES.map((name, index) => [
        name,
        sections.get(index + 1)!.length,
      ]),
    ) as Record<SectionName, number>,
  };
}
