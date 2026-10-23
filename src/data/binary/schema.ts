import { wire } from "./shared/schema.ts";

export const MAGIC = new TextEncoder().encode("FFXIVGDB");
export const FORMAT_VERSION = 12;
export const SECTION_NAMES = [
  "METADATA",
  "JOBS",
  "FOODS",
  "MATERIA",
  "SYNC",
  "ITEM_LEVEL_CAPS",
  "EQUIPMENT_CAPS",
  "CHARACTER_STATS",
  "LEVEL_FORMULAS",
  "GEAR_CATALOG",
] as const;
export type SectionName = (typeof SECTION_NAMES)[number];
export const SECTION_IDS = SECTION_NAMES.map((_, index) => index + 1);
export const DIRECTORY_ENTRY_BYTES = 12;
export const HEADER_BYTES = 16 + SECTION_NAMES.length * DIRECTORY_ENTRY_BYTES;

export const containerHeaderSchema = wire.struct([
  ["version", wire.u16],
  ["flags", wire.u16],
  ["sectionCount", wire.u16],
  ["headerBytes", wire.u16],
]);
export const containerEntrySchema = wire.struct([
  ["id", wire.u16],
  ["codec", wire.u8],
  ["reserved", wire.u8],
  ["offset", wire.u32],
  ["length", wire.u32],
]);
export interface ContainerHeader {
  version: number;
  flags: number;
  sectionCount: number;
  headerBytes: number;
}
export interface ContainerEntry {
  id: number;
  codec: number;
  reserved: number;
  offset: number;
  length: number;
}
