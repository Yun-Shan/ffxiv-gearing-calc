import { jobSchemas } from "@/domain";
import { SidePanel } from "@/ui/components/side-panel/SidePanel";
import { GearTableView } from "../gear-table/GearTableView";
import { ResultImageHeading } from "./components/result-image-heading/ResultImageHeading";
import { ResultShareMetrics } from "./components/result-share-metrics/ResultShareMetrics";
import type { ResultShareData } from "./types";
import styles from "./ResultShareLayout.module.scss";

export function ResultShareLayout({
  jobId,
  effects,
  rows,
  summaryRows,
}: ResultShareData) {
  return (
    <div className={styles.layout} data-result-share-layout>
      <ResultImageHeading jobId={jobId} damage={effects.damage} />
      <ResultShareMetrics effects={effects} jobId={jobId} />
      <GearTableView rows={rows} jobId={jobId} presentation="image" />
      <SidePanel className={styles.summary}>
        <SidePanel.Header subtitle="条件摘要" title={jobSchemas[jobId].name} />
        <SidePanel.Content>
          <SidePanel.Rows>
            {summaryRows
              .filter(({ label }) => label !== "公式等级")
              .map(({ label, value }) => (
                <SidePanel.Row key={label} label={label}>
                  {value}
                </SidePanel.Row>
              ))}
          </SidePanel.Rows>
        </SidePanel.Content>
      </SidePanel>
    </div>
  );
}
