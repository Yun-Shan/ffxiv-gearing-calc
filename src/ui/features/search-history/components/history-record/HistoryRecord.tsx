import { formatSharedSlots } from "@/ui/services/labels";
import { isSlotShared } from "@/ui/features/equipment/transactions";
import {
  jobSchemas,
  type JobId,
  type GearSlot,
  type JointOptimizationConfig,
  type OptimizationConfig,
} from "@/domain";
import type { SearchHistoryRecord } from "@/ui/services/search-history";
import { jobConditionDraftFromConfig } from "@/ui/features/job-condition/draft";
import {
  formatDraftGcd,
  formatFood,
} from "@/ui/features/job-condition/summary";
import styles from "./HistoryRecord.module.scss";
import { jobIconUrl } from "@/ui/services/icons";
import { clanLabel } from "@/ui/services/clans.ts";
import { tankGroup } from '@/ui/components/job-selection/JobSelection.tsx';

interface HistoryActions {
  deleting: boolean;
  onLoadConfig(): void;
  onLoadResult(): void;
  onDelete(): void;
}
type HistoryRecordProps = HistoryActions & { record: SearchHistoryRecord };
type Condition = { label: string; value: string; className?: string };

function jointSharedEquipmentConfig(
  config: JointOptimizationConfig,
): OptimizationConfig {
  const first = config.jobs[0]!;
  return {
    ...first,
    excludedSources: [
      ...new Set(config.jobs.flatMap((job) => job.excludedSources)),
    ],
    excludedGearIds: (first.excludedGearIds ?? []).filter((id) =>
      config.jobs.every((job) => job.excludedGearIds?.includes(id)),
    ),
    forcedGear: Object.fromEntries(
      Object.entries(first.forcedGear).filter(([slot]) =>
        isSlotShared(slot as GearSlot, config.commonSlots),
      ),
    ),
  };
}

function equipmentRestrictionCondition(config: OptimizationConfig): Condition {
  return {
    label: "装备限制",
    value: `来源排除 ${config.excludedSources.length} 项 · 装备排除 ${config.excludedGearIds?.length ?? 0} 件 · 装备强制 ${Object.keys(config.forcedGear).length} 件`,
  };
}

export function HistoryRecord(props: HistoryRecordProps) {
  return props.record.kind === "single" ? (
    <SingleHistoryRecord {...props} record={props.record} />
  ) : (
    <JointHistoryRecord {...props} record={props.record} />
  );
}

function SingleHistoryRecord(
  props: HistoryActions & {
    record: Extract<SearchHistoryRecord, { kind: "single" }>;
  },
) {
  const { record } = props;
  const config = record.config;
  const result = record.result;
  const objective = record.result.objective;
  const conditions: Condition[] = [
    {
      label: "优化指标",
      value: objective === "damage" ? "每威力期望伤害" : "每秒每威力期望伤害",
    },
    {
      label: "种族",
      value: clanLabel(config.clanIndex),
    },
    {
      label: "GCD约束",
      value: formatDraftGcd(jobConditionDraftFromConfig(config), config.jobId),
    },
    {
      label: "装备品级",
      value: `${config.minItemLevel}–${config.maxItemLevel}${config.sync ? `（${config.sync.kind === "jobLevel" ? `仅同步等级 ${config.sync.value}` : `同步品级 ${config.sync.value}`}）` : ""}`,
    },
    { label: "食物", value: formatFood(config.foodId) },
    equipmentRestrictionCondition(config),
    (
      tankGroup.jobs!.includes(config.jobId)
        ? {
          label: "坚韧减伤",
          value: (result.effects.tenMitigation * 100).toFixed(1) + "%",
        }
        : { label: "", value: "" }
    ),
  ];
  return (
    <HistoryRecordFrame
      {...props}
      jobs={[config.jobId]}
      conditions={conditions}
      objective={objective}
    />
  );
}

function JointHistoryRecord(
  props: HistoryActions & {
    record: Extract<SearchHistoryRecord, { kind: "joint" }>;
  },
) {
  const { record } = props;
  const objective = record.result.objective;
  const firstJob = record.config.jobs[0]!;
  const conditions: Condition[] = [
    {
      label: "优化指标",
      value: objective === "damage" ? "每威力期望伤害" : "每秒每威力期望伤害",
    },
    { label: "种族", value: clanLabel(firstJob.clanIndex ?? 0) },
    {
      label: "装备品级",
      value: `${firstJob.minItemLevel}–${firstJob.maxItemLevel}`,
    },
    {
      label: "同步目标",
      value:
        firstJob.sync === undefined
          ? "未启用"
          : firstJob.sync.kind === "jobLevel"
            ? `仅同步等级 ${firstJob.sync.value}`
            : String(firstJob.sync.value),
    },
    {
      label: "共享部位",
      value: formatSharedSlots(record.config.commonSlots),
    },
    {
      label: "食物策略",
      value:
        record.config.foodStrategy === "shared" ? "所有职业共用" : "各职业独立",
    },
    ...(record.config.foodStrategy === "shared"
      ? [{ label: "共享食物", value: formatFood(firstJob.foodId) }]
      : []),
    equipmentRestrictionCondition(jointSharedEquipmentConfig(record.config)),
  ];
  return (
    <HistoryRecordFrame
      {...props}
      jobs={record.config.jobs.map((job) => job.jobId)}
      conditions={conditions}
      objective={objective}
    />
  );
}

function HistoryRecordFrame({
  record,
  jobs,
  conditions,
  objective,
  deleting,
  onLoadConfig,
  onLoadResult,
  onDelete,
}: HistoryRecordProps & {
  jobs: JobId[];
  conditions: Condition[];
  objective: "damage" | "dps";
}) {
  const duration =
    Math.max(
      0,
      Date.parse(record.finishedAtISO) - Date.parse(record.startedAtISO),
    ) / 1000;
  const started = new Date(record.startedAtISO);
  const timestamp = `${started.getFullYear()}-${String(started.getMonth() + 1).padStart(2, "0")}-${String(started.getDate()).padStart(2, "0")} ${String(started.getHours()).padStart(2, "0")}:${String(started.getMinutes()).padStart(2, "0")}`;
  return (
    <div
      className={`${styles.record} ${record.kind === "joint" ? styles.jointRecord : ""}`}
    >
      <div className={styles.identity}>
        <div className={styles.metadata}>
          <div className={styles.timestamp}>
            <time dateTime={record.startedAtISO}>{timestamp}</time>
          </div>
          <span className={styles.duration}>{duration.toFixed(1)} 秒</span>
        </div>
        <div className={styles.jobIdentities}>
          {jobs.map((jobId) => (
            <div key={jobId} className={styles.jobIdentity}>
              <img
                className={styles.icon}
                src={jobIconUrl(jobId)}
                alt={jobId}
                aria-hidden="true"
              />
              <strong className={styles.job}>{jobSchemas[jobId].name}</strong>
            </div>
          ))}
        </div>
      </div>
      <dl className={styles.conditions}>
        {conditions.map(({ label, value, className }) => (
          <div key={label} className={className}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <div className={styles.result}>
        {record.kind === "single" && (
          <dl className={styles.metrics}>
            <div>
              <dt>每威力期望伤害</dt>
              <dd
                className={
                  objective === "damage" ? styles.highlight : undefined
                }
              >
                {record.result.effects.damage.toFixed(7)}
              </dd>
            </div>
            <div>
              <dt>每秒每威力期望伤害</dt>
              <dd
                className={objective === "dps" ? styles.highlight : undefined}
              >
                {record.result.damagePerSecond.toFixed(7)}
              </dd>
            </div>
          </dl>
        )}
        <div className={styles.actions}>
          <button className={styles.primary} onClick={onLoadResult}>
            查看结果
          </button>
          <button onClick={onLoadConfig}>编辑条件</button>
          <button
            className={styles.delete}
            disabled={deleting}
            onClick={onDelete}
          >
            删除
          </button>
        </div>
      </div>
    </div>
  );
}
