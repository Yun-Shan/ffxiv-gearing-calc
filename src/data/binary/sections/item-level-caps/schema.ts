import { wire } from "../../shared/schema.ts";

export const CAP_COLUMNS = [
  "STR",
  "DEX",
  "VIT",
  "INT",
  "MND",
  "PIE",
  "GP",
  "CP",
  "PDMG",
  "MDMG",
  "TEN",
  "DHT",
  "CRT",
  "DET",
  "SKS",
  "SPS",
  "CMS",
  "CRL",
  "GTH",
  "PCP",
] as const;

/**
 * Wire representation: the sorted level list, a dictionary of unique cap
 * columns, and one dictionary reference per business column in CAP_COLUMNS.
 */
export const itemLevelCapsSectionSchema = wire.struct([
  ["levels", wire.array(wire.u16)],
  ["columns", wire.array(wire.array(wire.u16))],
  ["references", wire.array(wire.u8)],
]);
