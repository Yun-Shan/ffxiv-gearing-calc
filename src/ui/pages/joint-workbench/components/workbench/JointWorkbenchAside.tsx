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
              <h2>职业选择</h2>
              <SideRows
                rows={[
                  {
                    label: "已选择",
                    value: String(selected.length) + " 个职业",
                  },
                  {
                    label: "有效性",
                    value: controller.selectionState?.valid
                      ? "可继续"
                      : "需选择同组职业",
                  },
                ]}
              />
            </SidePanel.Section>
            <SidePanel.Section>
              <p>请选择同一装备分组中的职业。搜索在本地浏览器运行。</p>
            </SidePanel.Section>
          </SidePanel.Content>
          <SidePanel.Status
            status={controller.selectionState?.valid ? "valid" : "pending"}
          >
            {controller.selectionState?.valid
              ? "职业选择有效。"
              : controller.selectionState?.invalidReason === "mixed-gear-groups"
                ? "所选职业跨越多个装备分组。"
                : "请选择至少两个同组职业。"}
          </SidePanel.Status>
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
    const sharedRows = jointSharedSummaryRows(config);
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
            {controller.currentValidation.status === "valid"
              ? "条件验证通过。"
              : controller.currentValidation.status === "pending"
                ? "正在分析可行 GCD 档位。"
                : (controller.currentValidation.issues[0]?.message ??
                  "请修正无效条件。")}
          </SidePanel.Status>
          <SidePanel.Actions>
            <button type="button" onClick={controller.returnToSelection}>
              返回职业选择
            </button>
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
            {controller.cancelPending
              ? "正在等待搜索任务结束…"
              : "搜索将在本地运行。"}
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
            )}
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
            <SidePanel.Section>
              <h2>结果来源</h2>
              <SideRows
                rows={[
                  {
                    label: "开始时间",
                    value: phase.snapshot.startedAtISO
                      ? new Date(phase.snapshot.startedAtISO).toLocaleString(
                          "zh-CN",
                        )
                      : "未记录",
                  },
                  {
                    label: "耗时",
                    value: (phase.durationMs / 1000).toFixed(1) + " 秒",
                  },
                  { label: "数据版本", value: phase.snapshot.dataVersion },
                ]}
              />
            </SidePanel.Section>
          </SidePanel.Content>
          <SidePanel.Actions>
            <button
              type="button"
              onClick={() => void controller.adjustConditions()}
            >
              调整条件
            </button>
            <button type="button" onClick={controller.returnToSelection}>
              重新选择职业
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
