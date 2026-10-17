import { createContext, useContext, type ReactNode } from "react";
import type { JobId } from "@/domain";
import type {
  JobConditionDraft,
  JobConditionRuntime,
  JobValidation,
} from "./types";

export type JobConditionDraftChange =
  JobConditionDraft | ((current: JobConditionDraft) => JobConditionDraft);

export interface JobConditionScopeValue {
  jobId: JobId;
  draft: JobConditionDraft;
  runtime: JobConditionRuntime;
  validation?: JobValidation;
  readOnly: boolean;
  foodDisabled: boolean;
  updateDraft(change: JobConditionDraftChange): void;
}

const JobConditionScopeContext = createContext<
  JobConditionScopeValue | undefined
>(undefined);

export function JobConditionScopeProvider({
  jobId,
  draft,
  onChange,
  runtime,
  validation,
  readOnly = false,
  foodDisabled = false,
  children,
}: {
  jobId: JobId;
  draft: JobConditionDraft;
  onChange: (change: JobConditionDraftChange) => void;
  runtime: JobConditionRuntime;
  validation?: JobValidation;
  readOnly?: boolean;
  foodDisabled?: boolean;
  children: ReactNode;
}) {
  return (
    <JobConditionScopeContext.Provider
      value={{
        jobId,
        draft,
        runtime,
        validation,
        readOnly,
        foodDisabled,
        updateDraft: onChange,
      }}
    >
      {children}
    </JobConditionScopeContext.Provider>
  );
}

export function SingleJobConditionScope(props: {
  jobId: JobId;
  draft: JobConditionDraft;
  onChange: (change: JobConditionDraftChange) => void;
  runtime: JobConditionRuntime;
  validation?: JobValidation;
  readOnly?: boolean;
  foodDisabled?: boolean;
  children: ReactNode;
}) {
  return <JobConditionScopeProvider {...props} />;
}

export function JointJobConditionScope(props: {
  jobId: JobId;
  draft: JobConditionDraft;
  onChange: (change: JobConditionDraftChange) => void;
  runtime: JobConditionRuntime;
  validation?: JobValidation;
  readOnly?: boolean;
  foodDisabled?: boolean;
  children: ReactNode;
}) {
  return <JobConditionScopeProvider {...props} />;
}

export function useJobConditionScope(): JobConditionScopeValue {
  const scope = useContext(JobConditionScopeContext);
  if (!scope)
    throw new Error(
      "JobCondition sections must be rendered inside a JobConditionScope.",
    );
  return scope;
}
