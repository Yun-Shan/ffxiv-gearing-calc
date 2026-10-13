import {
  addStats,
  applyFood,
  combatStats,
  calculateBaseStats,
  isGearBaseStatAtCap,
  jobSchemas,
  type Gear,
  type GearSlot,
  type OptimizationConfig,
  type OptimizationResult,
  type Stat,
} from "../../../../domain/index";
import { defaultJobLevel } from "../../../services/app-config";
import { gearSlotLabels, statName, statValue } from "../../../services/labels";
import { SingleJobGearTable } from "./components/single-job-gear-table/SingleJobGearTable";
import styles from "./GearTable.module.css";

const slotLabels = gearSlotLabels;

function appliedFoodStats(
  result: OptimizationResult,
  config: OptimizationConfig,
): Partial<Record<Stat, number>> {
  const job = jobSchemas[config.jobId];
  const level = result.calculationLevel ?? config.jobLevel ?? job.maxJobLevel ?? defaultJobLevel;
  const allowed = new Set(job.stats);
  const foodStats = Object.fromEntries(
    Object.entries(result.food.stats).filter(([stat, value]) =>
      allowed.has(stat as Stat) && value !== undefined,
    ),
  ) as Partial<Record<Stat, number>>;
  const foodRates = Object.fromEntries(
    Object.entries(result.food.statRates).filter(([stat, value]) =>
      allowed.has(stat as Stat) && value !== undefined,
    ),
  ) as Partial<Record<Stat, number>>;
  const unbuffedStats = addStats(
    calculateBaseStats(job, level),
    ...result.gear.map((gear) => gear.finalStats),
  );
  const withFood = applyFood(unbuffedStats, foodStats, foodRates);
  return Object.fromEntries(
    Object.keys(foodStats)
      .map((stat) => [stat as Stat, (withFood[stat as Stat] ?? 0) - (unbuffedStats[stat as Stat] ?? 0)] as const)
      .filter(([, value]) => value > 0),
  ) as Partial<Record<Stat, number>>;
}
export function GearTable({
  result,
  config,
  compact = false,
}: {
  result: OptimizationResult;
  config: OptimizationConfig;
  compact?: boolean;
}) {
  const actualFoodStats = appliedFoodStats(result, config);
  const job = jobSchemas[config.jobId];
  const speedStat: Stat = job.role === "healer" || job.role === "int" ? "SPS" : "SKS";
  const attackStat: Stat = job.mainStat === "VIT" ? "STR" : job.mainStat;
  const preferredStatOrder: Stat[] = [attackStat, "CRT", "DET", "DHT", speedStat, "VIT"];
  const statColumns = compact
    ? preferredStatOrder.filter((stat, index) =>
        preferredStatOrder.indexOf(stat) === index &&
        (stat === attackStat || job.stats.includes(stat)),
      )
    : [];
  const weaponDamageStat: Stat = job.mainStat === "INT" || job.mainStat === "MND" ? "MDMG" : "PDMG";
  const displaySlots: GearSlot[] = [
    "weapon", "offhand", "head", "body", "hands", "legs", "feet",
    "earrings", "necklace", "bracelet", "ring", "ring2",
  ];
  if (compact) {
    return <SingleJobGearTable
      result={result}
      foodStats={actualFoodStats}
      statColumns={statColumns}
      weaponDamageStat={weaponDamageStat}
      slotLabels={slotLabels}
      statName={statName}
      statValue={statValue}
      isStatAtCap={(gear, stat) => {
        const value = gear.stats[stat];
        return value !== undefined && value > 0 &&
          combatStats.includes(stat as (typeof combatStats)[number]) &&
          isGearBaseStatAtCap(gear, stat);
      }}
    />;
  }
  return (
    <div className={styles.tableWrapper}>
    <div className={styles.table}>
      <div className={styles.header}>
        <span>部位</span>
        <span>装备</span>
        <span>实际属性</span>
        <>
          <span>魔晶石</span>
          <span>来源</span>
          <span>品级</span>
        </>
      </div>
      {displaySlots.map((slot) => {
        const item = result.gear.find((gear) => gear.slot === slot);
        if (!item) return null;
        const isForced = config.forcedGear[item.slot] === item.id;
        return (
          <div className={styles.row} key={item.slot + "-" + item.id}>
            <div className={styles.slotCell}>
              <span className={styles.slotIcon}>{slotLabels[item.slot].slice(0, 1)}</span>
              <span>{slotLabels[item.slot]}</span>
            </div>
            <strong>{item.name}</strong>
            <div className={styles.gearStats}>
              {Object.entries(item.finalStats)
                .filter(([, value]) => value !== undefined && value > 0)
                .map(([stat, value]) => {
                  const isCapped =
                    combatStats.includes(stat as (typeof combatStats)[number]) &&
                    isGearBaseStatAtCap(item, stat as Stat);
                  return (
                    <span
                      key={stat}
                      className={isCapped ? `${styles.gearStat} ${styles.atCap}` : styles.gearStat}
                    >
                      {statName(stat)} {statValue(stat, value)}
                    </span>
                  );
                })}
            </div>
            <div className={styles.melds}>
              {item.melds.length ? (
                item.melds.map((meld, index) => (
                  <span className={styles.meld} key={meld.stat + "-" + index}>
                    {statName(meld.stat)} +{meld.value}
                  </span>
                ))
              ) : (
                <span className="muted">无镶嵌</span>
              )}
              {isForced && <span className={styles.locked}>已锁定</span>}
            </div>
            <>
              <span className={styles.sourceText}>{item.source ?? "上游未标注"}</span>
              <span className={styles.levelTag}>{item.level}</span>
            </>
          </div>
        );
      })}
      <div className={styles.foodRow}>
        <div className={styles.slotCell}>
          <span className={`${styles.slotIcon} ${styles.foodSlotIcon}`}>食</span>
          <span>食物</span>
        </div>
        <strong>{result.food.name}</strong>
        <div className={styles.gearStats}>
          {Object.entries(actualFoodStats)
            .map(([key, value]) => statName(key) + " " + value)
            .join(" · ") || "无属性加成"}
        </div>
        <div className={styles.melds}>
          <span className={styles.foodBonus}>实际生效</span>
        </div>
        <>
          <span className={styles.sourceText}>上游食物数据</span>
          <span className={styles.levelTag}>{result.food.level}</span>
        </>
      </div>
    </div>
    </div>
  );
}
