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
  "GP",
  "CP",
  "CMS",
  "CRL",
  "GTH",
  "PCP",
] as const;
const MAIN_STATS = ["STR", "DEX", "VIT", "INT", "MND"] as const;

export const characterStatsSchema = wire.struct([
  ["baseStats", wire.map(wire.enum(STAT_NAMES), wire.baseStat)],
  ["clanStats", wire.map(wire.enum(MAIN_STATS), wire.array(wire.i16))],
]);
