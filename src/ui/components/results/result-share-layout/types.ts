import type { Effects, JobId } from "@/domain";
import type { GearTableRow } from "../gear-table/types";

export interface ResultShareData {
  jobId: JobId;
  effects: Effects;
  rows: readonly GearTableRow[];
  summaryRows: readonly { label: string; value: string }[];
}
