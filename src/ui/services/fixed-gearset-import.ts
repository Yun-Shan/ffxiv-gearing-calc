import { calculateFixedGearset, defaultDataVersion } from "@/domain";
import type { ResolveImportedGearset } from "@/ui/features/gear-comparison/types";
import { parseReferenceGearset } from "./reference-gearset-share";

/** Recalculate the complete linked loadout using the current game data. */
export const resolveImportedGearset: ResolveImportedGearset = async (url) => {
  const parsed = parseReferenceGearset(url);
  if (parsed.foodId === undefined) {
    throw new Error("链接未包含可识别的食物，请使用完整配装分享链接。");
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
