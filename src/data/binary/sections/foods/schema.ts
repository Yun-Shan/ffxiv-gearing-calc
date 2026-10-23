import type { Stat } from "../../../../domain/types.ts";
import { wire } from "../../shared/schema.ts";

const STAT_NAMES = [
  "STR",
  "DEX",
  "INT",
  "MND",
  "VIT",
  "CRT",
  "DET",
  "DHT",
  "SKS",
  "SPS",
  "TEN",
  "PIE",
  "PDMG",
  "MDMG",
  "DLY",
] as const satisfies readonly Stat[];
const statSchema = wire.enum(STAT_NAMES);

const foodSchema = wire.struct([
  ["id", wire.u32],
  ["icon", wire.u32],
  ["name", wire.string],
  ["level", wire.u16],
  ["stats", wire.map(statSchema, wire.u16)],
  ["statRates", wire.map(statSchema, wire.u8)],
  ["best", wire.optional(wire.bool)],
]);

export const foodsSchema = wire.struct([["foods", wire.array(foodSchema)]]);
