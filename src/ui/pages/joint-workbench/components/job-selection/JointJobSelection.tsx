import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { jobIds, jobSchemas } from "@/domain/jobs";
import type { JobId } from "@/domain/types";
import styles from "./JointJobSelection.module.scss";
import { JobButton } from '@/ui/components/job-button/JobButton.tsx';

type JobGroupTone = "tank" | "healer" | "str" | "dex" | "int";

interface JobGroup {
  id: string;
  tone: JobGroupTone;
  label: string;
  jobs?: JobId[];
  subgroups?: Array<{ id: string; label: string; jobs: JobId[] }>;
}

const dexMeleeJobs = new Set<JobId>(["NIN", "VPR"]);

function createJobGroups(): JobGroup[] {
  const tankJobs = jobIds.filter((jobId) => jobSchemas[jobId].role === "tank");
  const healerJobs = jobIds.filter((jobId) => jobSchemas[jobId].role === "healer");
  const strengthJobs = jobIds.filter((jobId) => jobSchemas[jobId].role === "str");
  const dexterityJobs = jobIds.filter((jobId) => jobSchemas[jobId].role === "dex");
  const intelligenceJobs = jobIds.filter((jobId) => jobSchemas[jobId].role === "int");

  const groups: JobGroup[] = [
    { id: "tank", tone: "tank", label: "防护职业", jobs: tankJobs },
    { id: "healer", tone: "healer", label: "治疗职业", jobs: healerJobs },
    { id: "strength", tone: "str", label: "力量 DPS", jobs: strengthJobs },
    {
      id: "dexterity",
      tone: "dex",
      label: "灵巧 DPS",
      subgroups: [
        {
          id: "dexterity-melee",
          label: "近战物理职业",
          jobs: dexterityJobs.filter((jobId) => dexMeleeJobs.has(jobId)),
        },
        {
          id: "dexterity-ranged",
          label: "远程物理职业",
          jobs: dexterityJobs.filter((jobId) => !dexMeleeJobs.has(jobId)),
        },
      ],
    },
    { id: "intelligence", tone: "int", label: "智力 DPS", jobs: intelligenceJobs },
  ];

  return groups.filter((group) =>
    group.jobs ? group.jobs.length > 0 : group.subgroups?.some((subgroup) => subgroup.jobs.length > 0),
  );
}

const jobGroups = createJobGroups();

export interface JointJobSelectionProps {
  selectedJobs: JobId[];
  onToggleJob: (jobId: JobId) => void;
  onContinue: () => void;
  canContinue: boolean;
  dataVersion: string;
  onReset?: () => void;
  selectionMessage?: string;
  errorMessage?: string;
  history?: ReactNode;
}

export function JointJobSelection({
  selectedJobs,
  onToggleJob,
  onContinue,
  canContinue,
  dataVersion,
  onReset,
  selectionMessage,
  errorMessage,
  history,
}: JointJobSelectionProps) {
  const statusMessage = selectionMessage ?? errorMessage ?? (
    canContinue
      ? `已选择 ${selectedJobs.length} 个职业，可以继续设置条件。`
      : "请选择同一分组内的至少两个职业。"
  );
  const renderJobCard = (jobId: JobId) => {
    return (<JobButton jobId={jobId} onClick={() => onToggleJob(jobId)} selectable/>);
  };

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <div className={styles.content}>
          <header className={styles.heading}>
            <p className={styles.kicker}>多职业联合搜索 · 第 1 步</p>
            <h1>选择参与联合搜索的职业</h1>
            <p className={styles.description}>请选择同一分组内的至少两个职业。</p>
          </header>

          <div className={styles.groups} aria-label="按职业分组选择">
            {jobGroups.map((group) => {
              const headingId = `joint-job-group-${group.id}`;
              return (
                <section
                  className={styles.group}
                  data-tone={group.tone}
                  key={group.id}
                  aria-labelledby={headingId}
                >
                  <div className={styles.groupLabel}>
                    <h2 id={headingId}>{group.label}</h2>
                  </div>
                  {group.subgroups ? (
                    <div className={styles.subgroups} role="group" aria-labelledby={headingId}>
                      {group.subgroups.map((subgroup) => (
                        <div className={styles.subgroup} key={subgroup.id}>
                          <h3>{subgroup.label}</h3>
                          <div className={styles.jobCards}>
                            {subgroup.jobs.map(renderJobCard)}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className={styles.jobCards} role="group" aria-labelledby={headingId}>
                      {group.jobs?.map(renderJobCard)}
                    </div>
                  )}
                </section>
              );
            })}
          </div>

          <footer className={styles.actions}>
            <p className={`${styles.selectionMessage} ${errorMessage || selectionMessage ? styles.selectionError : ""}`} role={errorMessage ? "alert" : "status"}>{statusMessage}</p>
            <button
              className={styles.continueButton}
              type="button"
              disabled={!canContinue}
              onClick={onContinue}
            >
              前往条件设置
              <ArrowRight size={16} aria-hidden="true" />
            </button>
          </footer>
        </div>
      </main>

      <aside className={styles.rail} aria-label="联合搜索说明">
        <div className={styles.railHeading}>
          <h2>联合搜索说明</h2>
        </div>

        <section className={styles.selectionRule} aria-labelledby="joint-selection-rule-title">
          <h3 id="joint-selection-rule-title">选择职业</h3>
          <div className={styles.ruleCard}>
            <strong>至少选择 2 个职业</strong>
            <p>请选择同一分组的职业，再设置各职业条件与共享部位。</p>
          </div>
        </section>

        <div className={styles.railFooter}>
          <div className={styles.version}>
            <span>当前数据版本</span>
            <strong>{dataVersion}</strong>
          </div>
          <span className={styles.offlineNote}>纯前端计算 · 可离线运行</span>
          {(history !== undefined || onReset !== undefined) && (
            <details className={styles.advanced}>
              <summary>高级设置</summary>
              <div className={styles.historyContent}>
                {onReset && (
                  <button className={styles.resetButton} type="button" onClick={onReset}>
                    重置当前页面配置
                  </button>
                )}
                {history}
              </div>
            </details>
          )}
        </div>
      </aside>
    </div>
  );
}
