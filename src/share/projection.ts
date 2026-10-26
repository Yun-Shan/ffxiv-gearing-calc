import { check, equal } from "./binary.ts";
import { patternForItem } from "./patterns.ts";
import {
  SLOT_CODES,
  type ShareDocument,
  type ShareIdentity,
  type ShareInput,
  type ShareJointConfig,
  type ShareConfig,
} from "./types.ts";
import { validateConfigs } from "./validation.ts";

const CONFIG_FIELDS = [
  "jobId",
  "clanIndex",
  "minItemLevel",
  "maxItemLevel",
  "objective",
  "gcdChoices",
  "speedMin",
  "speedMax",
  "sync",
  "syncDuty",
  "minTenacity",
  "toughnessMinPercent",
  "maximizeTenacity",
  "foodId",
  "excludedSources",
  "excludedGearIds",
  "forcedGear",
] as const;
function configSnapshot(config: ShareConfig): ShareConfig {
  // Execution parameters are intentionally excluded from the business snapshot.
  return Object.fromEntries(
    CONFIG_FIELDS.filter((key) => config[key] !== undefined).map((key) => [
      key,
      structuredClone(config[key]),
    ]),
  ) as ShareConfig;
}
export function projectShareInput(input: ShareInput): ShareDocument {
  const joint =
    input.mode === "joint" ? (input.config as ShareJointConfig) : undefined;
  validateConfigs({
    mode: input.mode,
    configs: joint ? joint.jobs : [input.config as ShareConfig],
    commonSlots: joint?.commonSlots ?? [],
    foodStrategy: joint?.foodStrategy ?? "independent",
  });
  const configs = (joint ? joint.jobs : [input.config as ShareConfig]).map(
    configSnapshot,
  );
  check(configs.length === input.results.length, "结果职业数量不一致");
  const identities: ShareIdentity[] = [];
  const rows = input.results.map((result) => ({
    foodId: result.food.id,
    gear: result.gear
      .toSorted(
        (a, b) => SLOT_CODES.indexOf(a.slot) - SLOT_CODES.indexOf(b.slot),
      )
      .map((gear) => {
        const value = {
          itemId: gear.id,
          pattern: patternForItem(gear.id, gear.melds),
        };
        let identity = identities.findIndex((v) => equal(v, value));
        if (identity < 0) {
          identity = identities.length;
          identities.push(value);
        }
        return { slot: gear.slot, identity };
      }),
  }));
  const document: ShareDocument = {
    mode: input.mode,
    dataVersion: input.dataVersion,
    elapsedMs: input.elapsedMs,
    identities,
    configs,
    commonSlots: [...(joint?.commonSlots ?? [])],
    foodStrategy: joint?.foodStrategy ?? "independent",
    rows,
    baselines: [...(input.baselines ?? [])],
    ...(input.jointValue === undefined ? {} : { jointValue: input.jointValue }),
  };
  validateConfigs(document);
  return document;
}
