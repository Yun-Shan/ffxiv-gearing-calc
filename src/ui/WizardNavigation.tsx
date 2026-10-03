import { Check } from "lucide-react";
import { jobIds, jobSchemas } from "../domain";
import type { JobId } from "../domain";
import { jobIcons } from "./job-icons";

export type WizardStep = 1 | 2 | 3 | 4;

const steps: { id: WizardStep; label: string; detail: string }[] = [
  { id: 1, label: "选择职业", detail: "选择职业并设置对应等级。" },
  { id: 2, label: "选择目标", detail: "选择配装目标与可选战斗节奏。" },
  { id: 3, label: "设置候选范围", detail: "设置装备品级、同步和筛选条件。" },
  { id: 4, label: "检查并开始", detail: "检查全部条件，确认后开始搜索。" },
];

const roleGroups = [
  { role: "tank", label: "防护职业" },
  { role: "healer", label: "治疗职业" },
  { role: "str", label: "力量职业" },
  { role: "dex", label: "灵巧职业" },
  { role: "int", label: "智力职业" },
] as const;

export function WizardProgress({
  step,
  confirmedThrough,
  onStep,
}: {
  step: WizardStep;
  confirmedThrough: number;
  onStep: (step: WizardStep) => void;
}) {
  return (
    <nav className="step-progress" aria-label="配装设置进度">
      {steps.map((item, index) => {
        const complete = item.id <= confirmedThrough;
        const current = item.id === step;
        const available = complete && item.id < step;
        return (
          <div className="step-progress-segment" key={item.id}>
            <button
              type="button"
              className={[
                "step-progress-item",
                current ? "is-current" : "",
                complete ? "is-complete" : "",
                !complete && !current ? "is-locked" : "",
              ].filter(Boolean).join(" ")}
              aria-current={current ? "step" : undefined}
              aria-label={`${item.id}. ${item.label}${complete ? "，已确认" : current ? "，当前步骤" : "，尚未确认"}`}
              disabled={!available}
              onClick={() => onStep(item.id)}
            >
              <span className="step-progress-node" aria-hidden="true">
                {complete ? <Check size={15} strokeWidth={2.6} /> : item.id}
              </span>
              <span className="step-progress-label">{item.label}</span>
            </button>
            {index < steps.length - 1 && (
              <span
                className={"step-progress-connector" + (complete ? " is-complete" : "")}
                aria-hidden="true"
              />
            )}
          </div>
        );
      })}
    </nav>
  );
}

export function JobPicker({
  value,
  onChange,
}: {
  value: JobId | null;
  onChange: (jobId: JobId) => void;
}) {
  return (
    <div className="job-groups" aria-label="按职业角色选择">
      {roleGroups.map(({ role, label }) => {
        const jobs = jobIds.filter((jobId) => jobSchemas[jobId].role === role);
        if (jobs.length === 0) return null;
        return (
          <section className="job-group" key={role} aria-labelledby={`job-group-${role}`}>
            <h2 className="job-group-title" id={`job-group-${role}`}>{label}</h2>
            <div className="job-cards">
              {jobs.map((jobId) => {
                const selected = value === jobId;
                return (
                  <button
                    type="button"
                    className={"job-card" + (selected ? " is-selected" : "")}
                    key={jobId}
                    aria-pressed={selected}
                    onClick={() => onChange(jobId)}
                  >
                    <img className="job-card-icon" src={jobIcons[jobId]} width={24} height={24} alt="" aria-hidden="true" />
                    <span>{jobSchemas[jobId].name}</span>
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

export function InstructionRail({
  step,
  confirmedThrough,
}: {
  step: WizardStep;
  confirmedThrough: number;
}) {
  return (
    <aside className="wizard-aside" aria-label="配装流程指引">
      <div className="instruction-rail">
        <h2>配装流程指引</h2>
        <p>确认四个步骤后，即可开始生成配装方案。</p>
        <ol className="instruction-steps">
          {steps.map((item) => {
            const complete = item.id <= confirmedThrough;
            const current = item.id === step;
            return (
              <li
                className={[
                  "instruction-step",
                  current ? "is-current" : "",
                  complete ? "is-complete" : "",
                ].filter(Boolean).join(" ")}
                key={item.id}
                aria-current={current ? "step" : undefined}
              >
                <span className="instruction-step-number">{complete ? <Check size={14} /> : item.id}</span>
                <div>
                  <strong>{item.label}</strong>
                  <p>{item.detail}</p>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </aside>
  );
}
