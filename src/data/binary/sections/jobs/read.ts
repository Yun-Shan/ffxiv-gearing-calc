import type { GeneratedDataInput } from "../../types.ts";
import { decodeSection } from "../../shared/schema-read.ts";
import { jobsSchema } from "./schema.ts";

type Jobs = Pick<GeneratedDataInput, "jobs" | "jobSchemas">;

export function readSection(bytes: Uint8Array): Jobs {
  return decodeSection<Jobs>(jobsSchema, bytes, "JOBS_BINARY");
}
