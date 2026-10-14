import { jobIds, jobSchemas } from "@/domain";
import type { JobId } from "@/domain";
import styles from "./WizardNavigation.module.scss";
import { JobButton } from '@/ui/components/job-button/JobButton.tsx';

const roleGroups = [
  { role: "tank", label: "防护职业" },
  { role: "healer", label: "治疗职业" },
  { role: "str", label: "近战物理职业" },
  { role: "dex", label: "远程物理职业" },
  { role: "int", label: "远程魔法职业" },
] as const;

// 忍者的主属性是 DEX，但职业选择器按近战职业分组。
const pickerRoleOverrides: Partial<Record<JobId, (typeof roleGroups)[number]["role"]>> = {
  NIN: "str",
  VPR: "str",
};

export function JobPicker({
  value,
  onChange,
}: {
  value: JobId | null;
  onChange: (jobId: JobId) => void;
}) {
  const groups = [
    ...roleGroups.map(({ role, label }) => ({
      id: role,
      label,
      jobs: jobIds.filter((jobId) =>
        (pickerRoleOverrides[jobId] ?? jobSchemas[jobId].role) === role && !jobSchemas[jobId].isLimitedJob,
      ),
    })),
    {
      id: "limited",
      label: "限制特职",
      jobs: jobIds.filter((jobId) => jobSchemas[jobId].isLimitedJob),
    },
  ];

  return (
    <div className={styles.jobGroups} aria-label="按职业角色选择">
      {groups.map(({ id, label, jobs }) => {
        if (jobs.length === 0) return null;
        return (
          <section className={styles.jobGroup} data-role={id} key={id} aria-labelledby={`job-group-${id}`}>
            <h2 className={styles.jobGroupTitle} id={`job-group-${id}`}>{label}</h2>
            <div className={styles.jobCards}>
              {jobs.map((jobId) => {
                return (<JobButton key={jobId} jobId={jobId} onClick={() => onChange(jobId)}/>)
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
