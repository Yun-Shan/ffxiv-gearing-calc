import { jobIds, jobSchemas, type JobId } from "@/domain";
import styles from '@/ui/pages/single-workbench/components/job-selection/wizard-navigation/WizardNavigation.module.scss';
import { JobButton } from '@/ui/components/job-button/JobButton.tsx';

// 由于职业基本上每一年半到两年左右才会变一次，因此没必要每次都读数据。
// 这里选择硬编码职业列表，在变化之后手动更新即可。
type JobGroup = {
  key: string;
  label: string;
  color?: string;
  jobs?: JobId[];
  subGroups?: JobGroup[];
};

// 按角色分组
const roleGroups: JobGroup[] = [
  { key: "tank", label: "防护职业", color: "#637d69", jobs: ["PLD", "WAR", "DRK", "GNB"] },
  { key: "healer", label: "治疗职业", color: "#758a59", jobs: ["WHM", "SCH", "AST", "SGE"] },
  { key: "melee", label: "近战物理职业", color: "#997354", jobs: ["MNK", "DRK", "NIN", "SAM", "RPR", "VPR"] },
  { key: "ranged", label: "远程物理职业", color: "#8a7951", jobs: ["BRD", "MCH", "DNC"] },
  { key: "caster", label: "远程魔法职业", color: "#7b6d92", jobs: ["BLM", "SMN", "RDM", "PCT"] },
  { key: "limited", label: "设限特职", color: "#638781", jobs: ["BLU", "BST"] },
];

// 按装备通用性分组，其中T/H各一组，DPS按主属性分组，力量和灵巧属性下面又根据装备通用性分组
// 目前游戏内二级分组都是二级分组内全通用(除主副手)，大分组内只有首饰通用
const gearGroups: JobGroup[] = [
  { key: "tank", label: "防护职业", color: "#637d69", jobs: ["PLD", "WAR", "DRK", "GNB"] },
  { key: "healer", label: "治疗职业", color: "#758a59", jobs: ["WHM", "SCH", "AST", "SGE"] },
  {
    key: "stat-str", label: "力量DPS", color: "#997354",
    subGroups: [
      { key: "stat-str-maiming", label: "近战-制敌", jobs: ["DRG", "RPR"] },
      { key: "stat-str-striking", label: "近战-强袭", jobs: ["MNK", "SAM"] }
    ],
  },
  {
    key: "stat-dex", label: "灵巧DPS", color: "#8a7951",
    subGroups: [
      { key: "stat-dex-scouting", label: "近战-游击", jobs: ["NIN", "VPR"] },
      { key: "stat-dex-aiming", label: "远敏-精准", jobs: ["BRD", "MCH", "DNC"] }
    ],
  },
  { key: "stat-int", label: "智力DPS", color: "#7b6d92", jobs: ["BLM", "SMN", "RDM", "PCT"] },
];

function JobGroupNode() {
  return (
    <section className={styles.jobGroup}>
      <h2 className={styles.jobGroupTitle} id={`job-group-${id}`}>{label}</h2>
      <div className={styles.jobCards}>
        {jobs.map((jobId) => {
          return (<JobButton key={jobId} jobId={jobId} onClick={() => onChange(jobId)}/>)
        })}
      </div>
    </section>
  );
}

