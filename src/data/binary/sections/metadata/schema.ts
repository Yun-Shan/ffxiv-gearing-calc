import { wire } from "../../shared/schema.ts";

export const metadataSchema = wire.struct([
  ["version", wire.string],
  ["provenance", wire.struct([
    ["repository", wire.string],
    ["commit", wire.string],
    ["importedAt", wire.string],
  ])],
]);
