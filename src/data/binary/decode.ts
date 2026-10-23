import { readSection as read1 } from "./sections/metadata/read.ts";
import { readSection as read2 } from "./sections/jobs/read.ts";
import { readSection as read3 } from "./sections/foods/read.ts";
import { readSection as read4 } from "./sections/materia/read.ts";
import { readSection as read5 } from "./sections/sync/read.ts";
import { readSection as read6 } from "./sections/item-level-caps/read.ts";
import { readSection as read7 } from "./sections/equipment-caps/read.ts";
import { readSection as read8 } from "./sections/character-stats/read.ts";
import { readSection as read9 } from "./sections/level-formulas/read.ts";
import { decodeGearCatalog } from "./sections/gear-catalog/read.ts";
import { readContainer } from "./container/read.ts";
import { validateGameDataMetadata } from "./validate.ts";
import {
  timingStart,
  reportTiming,
  type TimingCallback,
} from "./shared/timing.ts";
import type { DecodedGeneratedData } from "./types.ts";
import type { JobId } from "../../domain/types.ts";

export async function decodeGeneratedData(
  input: Uint8Array | ArrayBuffer,
  options?: { onTiming?: TimingCallback },
): Promise<DecodedGeneratedData> {
  const onTiming = options?.onTiming;
  const start = timingStart(onTiming);
  const sections = readContainer(input, onTiming);
  const metadataStart = timingStart(onTiming);
  const data = {
    ...read1(sections.get(1)!),
    ...read2(sections.get(2)!),
    ...read3(sections.get(3)!),
    ...read4(sections.get(4)!),
    ...read5(sections.get(5)!),
    ...read6(sections.get(6)!),
    ...read7(sections.get(7)!),
    ...read8(sections.get(8)!),
    ...read9(sections.get(9)!),
  };
  validateGameDataMetadata(data, "运行时快照");
  reportTiming(onTiming, "nonGearDataBinaryMs", metadataStart);
  const catalogStart = timingStart(onTiming);
  const catalog = decodeGearCatalog(
    sections.get(10)!,
    Object.keys(data.jobSchemas) as JobId[],
    onTiming,
  );
  reportTiming(onTiming, "gearCatalogDirectoryAndIndexesMs", catalogStart);
  reportTiming(onTiming, "initializationTotalMs", start);
  return { ...data, ...catalog };
}
