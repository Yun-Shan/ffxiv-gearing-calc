import type { Dispatch, SetStateAction } from "react";
import type { OptimizationConfig, OptimizationResult } from "@/domain";
import type { SingleGcdFeasibility } from "@/ui/components/job-config/types";
import type { SingleGcdMode } from "@/ui/services/types";
import { JobConfigFields } from "@/ui/components/job-config/job-config-fields/JobConfigFields";
import { ResultPanel, StatusPanel } from "../result-panel/single-result-panel/SingleResultPanel";
import { SingleWorkbenchMain } from "../main/single-workbench-main/SingleWorkbenchMain";
import styles from "./SingleWorkbenchConditionScreen.module.scss";

const roleNames = {
  tank: "防护职业",
  healer: "治疗职业",
  str: "力量职业",
  dex: "灵巧职业",
  int: "智力职业",
} as const;

export function SingleWorkbenchConditionScreen({
  jobName,
  jobRole,
  config,
  setConfig,
  singleGcdMode,
  onSingleGcdModeChange,
  onSingleGcdFeasibilityChange,
  objectiveLabel,
  customGcdError,
  historyError,
  error,
  statusMessage,
  hasAttempted,
  result,
  onCancelSearch,
  onChangeJob,
  onEdited,
}: {
  jobName: string;
  jobRole: keyof typeof roleNames;
  config: OptimizationConfig;
  setConfig: Dispatch<SetStateAction<OptimizationConfig>>;
  singleGcdMode: SingleGcdMode;
  onSingleGcdModeChange: Dispatch<SetStateAction<SingleGcdMode>>;
  onSingleGcdFeasibilityChange: Dispatch<SetStateAction<SingleGcdFeasibility | undefined>>;
  objectiveLabel: string;
  customGcdError?: string;
  historyError?: string;
  error?: string;
  statusMessage?: string;
  hasAttempted: boolean;
  result?: OptimizationResult;
  onCancelSearch: () => void;
  onChangeJob: () => void;
  onEdited: () => void;
}) {
  return (
    <SingleWorkbenchMain
        roleLabel={jobRole === "tank" ? "坦克" : roleNames[jobRole]}
        jobName={jobName}
        onChangeJob={onChangeJob}
        notices={<>
          {customGcdError && <p className={styles.gcdError} role="alert">{customGcdError}</p>}
          {historyError && <p role="alert">{historyError}</p>}
        </>}
        status={!result && <StatusPanel
          running={false}
          progress=""
          error={error}
          message={statusMessage}
          onCancel={onCancelSearch}
        />}
        fields={<JobConfigFields
          config={config}
          setConfig={setConfig}
          showFood
          step="all"
          singleWorkbench
          singleGcdMode={singleGcdMode}
          onSingleGcdModeChange={onSingleGcdModeChange}
          onSingleGcdFeasibilityChange={onSingleGcdFeasibilityChange}
          singleObjectiveLabel={objectiveLabel}
          onEdited={onEdited}
        />}
        outcome={hasAttempted && (error || statusMessage) && !result && <ResultPanel
          config={config}
          attempted={hasAttempted}
          failed={error !== undefined}
          statusMessage={statusMessage}
        />}
      />
  );
}
