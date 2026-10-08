import type { GeneratedGameData } from "../domain/data";

type MainStat = "VIT" | "STR" | "DEX" | "MND" | "INT";
type PhysicalGearGroup = MainStat | "SHARED";

export interface GearPhysicalGroupRange {
  start: number;
  count: number;
}

export type GeneratedDataInput = Omit<
  GeneratedGameData,
  | "gearIndexesByMainStat"
  | "gearLevelByRecordIndex"
  | "gearMinLevel"
  | "gearMaxLevel"
  | "gearStatNames"
  | "gearPhysicalGroupRanges"
  | "getGearAtRecordIndex"
  | "getGearById"
>;

export type DecodedGeneratedData = GeneratedGameData & {
  gearPhysicalGroupRanges: Record<PhysicalGearGroup, GearPhysicalGroupRange>;
};

export function encodeGeneratedData(payload: GeneratedDataInput): Promise<{
  bytes: Uint8Array;
  gearCount: number;
  physicalGroupCounts: Record<PhysicalGearGroup, number>;
  mainStatIndexCounts: Record<MainStat, number>;
  mainStatIndexBytes: number;
  sectionSizes: Record<"GAME_DATA_BINARY" | "GEAR_CATALOG_BINARY", number>;
}>;

export function decodeGeneratedData(
  input: Uint8Array | ArrayBuffer,
  options?: {
    onTiming?: (phase: string, milliseconds: number) => void;
  },
): Promise<DecodedGeneratedData>;
