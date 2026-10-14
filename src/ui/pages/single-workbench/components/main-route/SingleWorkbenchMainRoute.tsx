import type { Dispatch, SetStateAction } from "react";
import { jobSchemas, type JobId, type OptimizationConfig } from "@/domain";
import type { SingleGcdFeasibility } from "@/ui/components/job-config/types";
import type { SingleGcdMode } from "@/ui/services/types";
import { SingleSearchProgress } from "../search-progress/SingleSearchProgress";
import { SingleWorkbenchSelectionScreen } from "../selection-screen/SingleWorkbenchSelectionScreen";
import { SingleWorkbenchConditionScreen } from "../workbench-screen/SingleWorkbenchConditionScreen";
import { SingleWorkbenchResultScreen } from "../result-screen/SingleWorkbenchResultScreen";
import type { useSingleWorkbenchGcd } from "../../hooks/useSingleWorkbenchGcd.ts";
import type { useSingleWorkbenchSearch } from "../../hooks/useSingleWorkbenchSearch.ts";
import { useSingleWorkbenchStore } from "../../single-workbench-store";

export function SingleWorkbenchMainRoute({
  selectedJob,
  config,
  setConfig,
  singleGcdMode,
  onSingleGcdModeChange,
  onSingleGcdFeasibilityChange,
  gcd,
  search,
  onChooseJob,
}: {
  selectedJob: JobId | null;
  config: OptimizationConfig;
  setConfig: Dispatch<SetStateAction<OptimizationConfig>>;
  singleGcdMode: SingleGcdMode;
  onSingleGcdModeChange: Dispatch<SetStateAction<SingleGcdMode>>;
  onSingleGcdFeasibilityChange: Dispatch<SetStateAction<SingleGcdFeasibility | undefined>>;
  gcd: ReturnType<typeof useSingleWorkbenchGcd>;
  search: ReturnType<typeof useSingleWorkbenchSearch>;
  onChooseJob: (jobId: JobId) => void;
}) {
  const view = useSingleWorkbenchStore((state) => state.mainRoute);
  const setView = useSingleWorkbenchStore((state) => state.setMainRoute);
  const job = selectedJob ? jobSchemas[selectedJob] : undefined;
  const objectiveLabel = gcd.displayObjective === "dps" ? "每秒每威力伤害期望" : "每威力伤害期望";
  const currentKey = selectedJob ? JSON.stringify(config) : "";
  // 条件编辑后不展示旧配置的结果，直到重新搜索或恢复对应历史结果。
  const stale = search.result !== undefined && search.resultKey !== currentKey;

  switch (view) {
    case "choose":
      return <SingleWorkbenchSelectionScreen selectedJob={selectedJob} onChooseJob={onChooseJob} />;
    case "workbench":
      return selectedJob && job ? <SingleWorkbenchConditionScreen
        jobName={job.name}
        jobRole={job.role}
        config={config}
        setConfig={setConfig}
        singleGcdMode={singleGcdMode}
        onSingleGcdModeChange={onSingleGcdModeChange}
        onSingleGcdFeasibilityChange={onSingleGcdFeasibilityChange}
        objectiveLabel={objectiveLabel}
        customGcdError={gcd.customGcdError}
        historyError={search.historyError}
        error={search.error}
        statusMessage={search.statusMessage}
        hasAttempted={search.hasAttempted}
        result={search.result}
        onCancelSearch={search.cancelSearch}
        onChangeJob={() => setView("choose")}
        onEdited={search.clearOutcomeMessages}
      /> : null;
    case "progress":
      return search.activeSearchConfig && selectedJob ? <SingleSearchProgress
        jobName={jobSchemas[selectedJob].name}
        progress={search.searchProgress}
      /> : null;
    case "result":
      return search.result && !stale ? <SingleWorkbenchResultScreen
        result={search.result}
        config={search.resultConfig ?? config}
      /> : null;
  }
}
