import styles from "./JointWorkbench.module.scss";
import { formatSharedSlots } from "@/ui/services/labels";
import { jobSchemas, type JobId } from "@/domain";
import { SidePanel } from "@/ui/components/side-panel/SidePanel";
import { makeConfig } from "@/ui/services/app-config";
import {
  effectiveConfigRows,
  jointJobSummaryRows,
  jointSharedSummaryRows,
  objectiveLabel,
} from "../../joint-workbench-model";
import { HistoryDialog, SideFooter, SideRows } from "./JointWorkbenchMain";
import { useJointWorkbench } from "../../useJointWorkbenchController";

const jointSearchNotices = [
  {
    type: "warning",
    message: "目前联合搜索算法还有待优化，部分高压力条件可能耗时较长",
  },
  {
    type: "warning",
    message:
      "目前非共享槽位的唯一装备可能被多个职业同时选用，导致实际使用时较为麻烦(需要通过陆行鸟背包或者雇员来回交换)",
  },
  {
    type: "info",
    message:
      "联合搜索暂不支持职业优先级设置，目前联合搜索目标为每个职业亏损之和最小",
  },
  {
    type: "info",
    message:
      "联合搜索暂不支持不同职业设置不同的GCD类型，目前只能都选单个GCD或者都选多个GCD(不建议选择多个GCD)",
  },
] as const;

function HistoryOverlayView() {
  const controller = useJointWorkbench();
  return (
    <HistoryDialog
      open={controller.historyOpen}
      onOpenChange={controller.setHistoryOpen}
      onLoadConfig={controller.historyProps.onLoadConfig}
      onLoadResult={controller.historyProps.onLoadResult}
    />
  );
}

export function JointWorkbenchAside() {
  const controller = useJointWorkbench();
  const { phase } = controller;

  if (phase.phase === "selection") {
    const selected = controller.selectionState?.jobs ?? controller.selectedJobs;
    return (
      <>
        <SidePanel>
          <SidePanel.Header subtitle="实验室" title="联合搜索" />
          <SidePanel.Content>
            <SidePanel.Section>
              {jointSearchNotices.map((notice) => (
                <p key={notice.message} className={`${styles.notice} ${styles[notice.type]}`}>{notice.message}</p>
              ))}
            </SidePanel.Section>
          </SidePanel.Content>
          <SidePanel.Footer />
        </SidePanel>
        <HistoryOverlayView />
      </>
    );
  }

  if (phase.phase === "conditions" && controller.currentValidation) {
    const selectedJob =
      controller.editorTarget === "shared"
        ? undefined
        : controller.editorTarget;
    const config = controller.currentConfig!;
    const sharedRows = jointSharedSummaryRows(config).map(row => row.label === "共享部位"
      ? { ...row, value: formatSharedSlots(config.commonSlots) }
      : row);
    return (
      <>
        <SidePanel>
          <SidePanel.Header subtitle="条件设置" title="联合搜索" />
          <SidePanel.Content>
            {selectedJob === undefined ? (
              <SidePanel.Section>
                <h2>共享条件</h2>
                <SideRows rows={sharedRows} />
              </SidePanel.Section>
            ) : (
              <SidePanel.Section>
                <h2>{jobSchemas[selectedJob].name} 条件</h2>
                <SideRows
                  rows={jointJobSummaryRows(
                    phase.draft,
                    config.jobs.find((job) => job.jobId === selectedJob)!,
                  )}
                />
              </SidePanel.Section>
            )}
            <SidePanel.Section>
              <h2>参与职业</h2>
              <SideRows
                rows={phase.draft.jobs.map((jobId) => ({
                  label: jobSchemas[jobId].name,
                  value: jobId,
                }))}
              />
            </SidePanel.Section>
          </SidePanel.Content>
          <SidePanel.Status status={controller.currentValidation.status}>
            {controller.currentValidation.issues.length ? "存在无效的条件设置，请检查所有条件约束" : "已就绪，可以开始搜索"}
          </SidePanel.Status>
          <SidePanel.Actions>
            <button
              type="button"
              disabled={!controller.currentValidation.valid}
              onClick={controller.startSearch}
            >
              开始联合搜索
            </button>
          </SidePanel.Actions>
          <SideFooter onHistory={() => controller.setHistoryOpen(true)} />
        </SidePanel>
        <HistoryOverlayView />
      </>
    );
  }

  if (phase.phase === "progress") {
    const config = phase.snapshot.config;
    const selectedJob =
      controller.editorTarget === "shared"
        ? undefined
        : config.jobs.find((job) => job.jobId === controller.editorTarget);
    const sharedRows = [
      { label: "优化目标", value: objectiveLabel(config.objective) },
      ...jointSharedSummaryRows(config),
    ];
    return (
      <>
        <SidePanel>
          <SidePanel.Header subtitle="搜索进行中" title="联合搜索" />
          <SidePanel.Content>
            <SidePanel.Section>
              <h2>冻结的条件快照</h2>
              {selectedJob ? (
                <>
                  <h3>{jobSchemas[selectedJob.jobId].name}</h3>
                  <SideRows rows={effectiveConfigRows(selectedJob)} />
                </>
              ) : (
                <SideRows rows={sharedRows} />
              )}
            </SidePanel.Section>
          </SidePanel.Content>
          <SidePanel.Status
            status={controller.cancelPending ? "cancelling" : "running"}
          >
            已就绪，可以开始搜索
          </SidePanel.Status>
          <SidePanel.Actions>
            <button
              type="button"
              disabled={controller.cancelPending}
              onClick={controller.cancelSearch}
            >
              {controller.cancelPending ? "正在取消…" : "取消搜索"}
            </button>
          </SidePanel.Actions>
          <SideFooter onHistory={() => controller.setHistoryOpen(true)} />
        </SidePanel>
        <HistoryOverlayView />
      </>
    );
  }

  if (phase.phase === "result") {
    const jobConfigFor = (jobId: JobId) =>
      phase.snapshot.config.jobs.find((job) => job.jobId === jobId) ??
      makeConfig(jobId);
    const resultContent =
      controller.resultTab === "shared" ? (
        <SidePanel.Section>
          <h2>共享条件</h2>
          <SideRows
            rows={jointSharedSummaryRows(
              phase.snapshot.config,
              phase.result.commonFood?.name,
            ).map(row => row.label === "共享部位"
              ? { ...row, value: formatSharedSlots(phase.snapshot.config.commonSlots) }
              : row)}
          />
        </SidePanel.Section>
      ) : (
        <SidePanel.Section>
          <h2>
            {jobSchemas[controller.resultTab as JobId]?.name ??
              controller.resultTab}{" "}
            实际生效条件
          </h2>
          <SideRows
            rows={effectiveConfigRows(
              jobConfigFor(controller.resultTab as JobId),
              phase.result.jobResults[controller.resultTab as JobId]
                ?.calculationLevel,
            )}
          />
        </SidePanel.Section>
      );
    return (
      <>
        <SidePanel>
          <SidePanel.Header subtitle="结果" title="联合配装" />
          <SidePanel.Content>
            {resultContent}
          </SidePanel.Content>
          <SidePanel.Status>数据版本 {phase.snapshot.dataVersion}</SidePanel.Status>
          <SidePanel.Actions>
            <button
              type="button"
              onClick={() => void controller.adjustConditions()}
            >
              调整条件
            </button>
          </SidePanel.Actions>
          <SideFooter onHistory={() => controller.setHistoryOpen(true)} />
        </SidePanel>
        <HistoryOverlayView />
      </>
    );
  }

  return (
    <SidePanel>
      <SidePanel.Header title="联合搜索" />
    </SidePanel>
  );
}
