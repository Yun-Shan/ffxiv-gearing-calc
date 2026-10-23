import type { JobId, Stat } from "../../../../domain/types.ts";
import { wire } from "../../shared/schema.ts";

export const JOB_IDS = [
  "PLD",
  "WAR",
  "DRK",
  "GNB",
  "WHM",
  "SCH",
  "AST",
  "SGE",
  "MNK",
  "DRG",
  "NIN",
  "SAM",
  "RPR",
  "VPR",
  "BRD",
  "MCH",
  "DNC",
  "BLM",
  "BLU",
  "SMN",
  "RDM",
  "PCT",
  "BST",
] as const satisfies readonly JobId[];

export const STAT_NAMES = [
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

export const SECONDARY_STATS = ["SKS", "SPS", "TEN", "PIE", "DHT"] as const;
export const PRIMARY_STATS = ["STR", "DEX", "INT", "MND"] as const;

const jobIdSchema = wire.enum(JOB_IDS);
const statSchema = wire.enum(STAT_NAMES);
const mainStatSchema = wire.enum(PRIMARY_STATS);
const statModifierSchema = wire.struct([
  ["STR", wire.optional(wire.f64)],
  ["DEX", wire.optional(wire.f64)],
  ["INT", wire.optional(wire.f64)],
  ["MND", wire.optional(wire.f64)],
  ["VIT", wire.optional(wire.f64)],
  ["CRT", wire.optional(wire.f64)],
  ["DET", wire.optional(wire.f64)],
  ["DHT", wire.optional(wire.f64)],
  ["SKS", wire.optional(wire.f64)],
  ["SPS", wire.optional(wire.f64)],
  ["TEN", wire.optional(wire.f64)],
  ["PIE", wire.optional(wire.f64)],
  ["PDMG", wire.optional(wire.f64)],
  ["MDMG", wire.optional(wire.f64)],
  ["DLY", wire.optional(wire.f64)],
  ["hp", wire.optional(wire.f64)],
  ["gcd", wire.optional(wire.f64)],
  ["gcdReason", wire.optional(wire.string)],
]);

const generatedJobSchema = wire.struct([
  ["id", wire.u32],
  ["name", wire.string],
  ["abbreviation", jobIdSchema],
]);

const jobSchema = wire.struct([
  ["id", jobIdSchema],
  ["name", wire.string],
  ["isLimitedJob", wire.bool],
  ["role", wire.enum(["tank", "healer", "str", "dex", "int"] as const)],
  ["mainStat", mainStatSchema],
  ["secondaryStat", wire.enum(SECONDARY_STATS)],
  ["stats", wire.array(statSchema)],
  ["statModifiers", statModifierSchema],
  ["partyBonus", wire.optional(wire.f64)],
  ["gcdModifier", wire.f64],
  ["traitDamageMultiplier", wire.f64],
  ["defaultItemLevel", wire.optional(wire.array(wire.u16))],
  ["maxJobLevel", wire.optional(wire.u16)],
  ["ignoreWeaponItemLevel", wire.optional(wire.bool)],
]);

export const jobsSchema = wire.struct([
  ["jobs", wire.map(jobIdSchema, generatedJobSchema)],
  ["jobSchemas", wire.map(jobIdSchema, jobSchema)],
]);
