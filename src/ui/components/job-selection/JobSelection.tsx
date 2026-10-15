import type { JobId } from "@/domain";
import { JobButton } from './components/job-button/JobButton.tsx';
import { useState, useMemo } from 'react';
import styles from './JobSelection.module.scss';

// 由于职业基本上每一年半到两年左右才会变一次，因此没必要每次都读数据。
// 这里选择硬编码职业列表，在变化之后手动更新即可。
// 同时这边的颜色也是硬编码且不使用全局css变量(因为只有这里使用)
type JobGroup = {
  key: string;
  label: string;
  color?: string;
  jobs?: JobId[];
  subGroups?: JobGroup[];
};

// 按角色分组
const roleGroups: JobGroup[] = [
  { key: "tank", label: "防护职业", color: "#e8f0f7", jobs: ["PLD", "WAR", "DRK", "GNB"] },
  { key: "healer", label: "治疗职业", color: "#eaf2e6", jobs: ["WHM", "SCH", "AST", "SGE"] },
  { key: "melee", label: "近战物理职业", color: "#f5eae5", jobs: ["MNK", "DRG", "NIN", "SAM", "RPR", "VPR"] },
  { key: "ranged", label: "远程物理职业", color: "#f6f0e4", jobs: ["BRD", "MCH", "DNC"] },
  { key: "caster", label: "远程魔法职业", color: "#f0ecf5", jobs: ["BLM", "SMN", "RDM", "PCT"] },
  { key: "limited", label: "设限特职", color: "#e7f1ef", jobs: ["BLU", "BST"] },
];

// 按装备通用性分组，其中T/H各一组，DPS按主属性分组，力量和灵巧属性下面又根据装备通用性分组
// 目前游戏内二级分组都是二级分组内全通用(除主副手)，大分组内只有首饰通用
const gearGroups: JobGroup[] = [
  { key: "tank", label: "防护职业", color: "#e8f0f7", jobs: ["PLD", "WAR", "DRK", "GNB"] },
  { key: "healer", label: "治疗职业", color: "#eaf2e6", jobs: ["WHM", "SCH", "AST", "SGE"] },
  {
    key: "stat-str", label: "力量DPS", color: "#f5eae5",
    subGroups: [
      { key: "stat-str-maiming", label: "近战-制敌", jobs: ["DRG", "RPR"] },
      { key: "stat-str-striking", label: "近战-强袭", jobs: ["MNK", "SAM"] }
    ],
  },
  {
    key: "stat-dex", label: "灵巧DPS", color: "#f6f0e4",
    subGroups: [
      { key: "stat-dex-scouting", label: "近战-游击", jobs: ["NIN", "VPR"] },
      { key: "stat-dex-aiming", label: "远敏-精准", jobs: ["BRD", "MCH", "DNC"] }
    ],
  },
  { key: "stat-int", label: "智力DPS", color: "#f0ecf5", jobs: ["BLM", "SMN", "RDM", "PCT"] },
];

function JobGroupNode(
  {
    jobGroup,
    isSubGroup = false,
    selectJobs,
    onClickJob,
    allowJobs
  }: {
    jobGroup: JobGroup,
    isSubGroup?: boolean,
    selectJobs: Set<JobId>,
    onClickJob?: (jobId: JobId) => void,
    allowJobs?: Set<JobId>
  }) {
  return (
    <section className={`${styles.group} ${isSubGroup ? styles.sub : ''}`} style={{ backgroundColor: jobGroup.color }}>
      <div className={styles.title}>{jobGroup.label}</div>
      {
        jobGroup.subGroups ? (
          <div className={styles.subGroups}>
            {jobGroup.subGroups.map(subGroup => {
              return (<JobGroupNode key={subGroup.key} jobGroup={subGroup} isSubGroup={true} selectJobs={selectJobs} allowJobs={allowJobs} onClickJob={onClickJob} />)
            })}
          </div>
        ) : (
          <div className={styles.cards}>
            {jobGroup.jobs?.map(jobId => {
              return (<JobButton key={jobId} jobId={jobId} selected={selectJobs.has(jobId)} disabled={allowJobs && !allowJobs.has(jobId)} onClick={onClickJob ? () => onClickJob(jobId) : undefined} />)
            })}
          </div>
        )
      }
    </section>
  );
}

export function JobSelection({ groupType, onSelectJob, onSelectJobChange }: { groupType: 'role' | 'gear', onSelectJob?: (jobId: JobId) => void, onSelectJobChange?: (jobIds: Set<JobId>) => void }) {
  const [selectJobs, setSelectJobs] = useState(new Set<JobId>());
  const jobGroups = groupType === "role" ? roleGroups : gearGroups;
  const jobId2GroupKey = useMemo(() => {
    const mapGroups = (groups: JobGroup[], parentKey?: string): [JobId, string][] => {
      return groups.flatMap(group => {
        if (group.jobs) {
          return group.jobs.map((jobId) => [jobId, parentKey ?? group.key]);
        } else if (group.subGroups) {
          return mapGroups(group.subGroups, group.key);
        }
        return [];
      });
    }
    return Object.fromEntries(mapGroups(jobGroups));
  }, [groupType]);
  const allowJobs = useMemo(() => {
    if (selectJobs.size === 0) return;
    const groupKey = jobId2GroupKey[selectJobs.values().next().value as JobId];
    return new Set(
      Object.entries(jobId2GroupKey)
        .filter(it => it[1] === groupKey)
        .map(it => it[0] as JobId)
    );
  }, [selectJobs]);
  const handleClickJob = (jobId: JobId) => {
    let isAdd = false;
    if (selectJobs.has(jobId)) {
      selectJobs.delete(jobId);
    } else {
      isAdd = true;
      selectJobs.add(jobId);
    }
    const newSet = new Set([...selectJobs]);
    setSelectJobs(newSet);
    if (isAdd && onSelectJob) onSelectJob(jobId);
    if (onSelectJobChange) onSelectJobChange(newSet);
  }
  return (
    <div className={styles.groups}>
      {jobGroups.map(group => (<JobGroupNode key={group.key} jobGroup={group} allowJobs={allowJobs} selectJobs={selectJobs} onClickJob={handleClickJob} />))}
    </div>
  );
}
