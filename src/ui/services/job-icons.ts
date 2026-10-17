import type { JobId } from "@/domain";
import generated from "./generated/job-icons.json";
import { iconUrl } from "./icon-url";

export function jobIconUrl(jobId: JobId): string {
  return iconUrl(generated.icons[jobId]);
}
