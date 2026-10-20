import {
  calculateFixedGearset,
  defaultDataVersion,
  getGearById,
} from "@/domain";
import type { ResolveImportedGearset } from "@/ui/features/gear-comparison/types";
import { parseReferenceGearset } from "./reference-gearset-share";

/** Recalculate the complete linked loadout using the current game data. */
export const resolveImportedGearset: ResolveImportedGearset = async (url) => {
  const parsed = parseReferenceGearset(url);
  if (parsed.foodId === undefined) {
    throw new Error("链接未包含可识别的食物，请使用完整配装分享链接。");
  }
  // Unknown equipment represents an empty slot, which rejects the whole import.
  if (parsed.gears.some(({ id }) => getGearById(id) === undefined)) {
    throw new Error("配装槽位不完整：链接包含当前数据中不存在的装备，按空槽处理。");
  }
  return {
    snapshot: calculateFixedGearset({
      jobId: parsed.job,
      jobLevel: parsed.jobLevel,
      ...(parsed.syncLevel === undefined
        ? {}
        : { syncLevel: parsed.syncLevel }),
      gears: parsed.gears,
      foodId: parsed.foodId,
    }),
    dataVersion: defaultDataVersion,
  };
};
