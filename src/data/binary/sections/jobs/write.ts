import type { GeneratedDataInput } from "../../types.ts";
import { encodeSection } from "../../shared/schema-write.ts";
import { jobsSchema } from "./schema.ts";

type Jobs = Pick<GeneratedDataInput, "jobs" | "jobSchemas">;

export function writeSection(value: Jobs): Uint8Array {
  return encodeSection(jobsSchema, value, "JOBS_BINARY");
}
