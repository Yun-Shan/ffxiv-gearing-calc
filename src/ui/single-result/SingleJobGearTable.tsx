import type { Gear, GearSlot, OptimizationResult, Stat } from "../../domain";
import styles from "./SingleJobGearTable.module.css";

const displaySlots: GearSlot[] = [
  "weapon", "offhand", "head", "body", "hands", "legs", "feet",
  "earrings", "necklace", "bracelet", "ring", "ring2",
];

export function SingleJobGearTable({
  result,
  foodStats,
  statColumns,
  weaponDamageStat,
  slotLabels,
  statName,
  statValue,
  isStatAtCap,
}: {
  result: OptimizationResult;
  foodStats: Partial<Record<Stat, number>>;
  statColumns: Stat[];
  weaponDamageStat: Stat;
  slotLabels: Record<GearSlot, string>;
  statName: (stat: Stat) => string;
  statValue: (stat: Stat, value: number) => string;
  isStatAtCap: (gear: Gear, stat: Stat) => boolean;
}) {
  const averageItemLevel = result.gear.length > 0
    ? Math.round(result.gear.reduce((sum, gear) => sum + gear.level, 0) / result.gear.length)
    : undefined;
  const denseRows = result.gear.length > 11;

  return (
    <div className={styles.wrap}>
      <table className={`${styles.table}${denseRows ? ` ${styles.denseRows}` : ""}`}>
        <caption className={styles.caption}>推荐配装装备属性表</caption>
        <colgroup>
          <col className={styles.slotColumn} />
          <col className={styles.nameColumn} />
          <col className={styles.sourceColumn} />
          <col className={styles.levelColumn} />
          <col className={styles.meldColumn} />
          {statColumns.map((stat) => <col className={styles.statColumn} key={stat} />)}
          <col className={styles.spacerColumn} aria-hidden="true" />
        </colgroup>
        <thead>
          <tr className={styles.header}>
            <th scope="col">部位</th>
            <th scope="col">装备名称</th>
            <th scope="col">来源</th>
            <th scope="col">品级</th>
            <th scope="col">魔晶石 / 生效属性</th>
            {statColumns.map((stat) => (
              <th className={styles.statHeading} scope="col" key={stat}>{statName(stat)}</th>
            ))}
            <th aria-hidden="true" />
          </tr>
        </thead>
        <tbody>
          {displaySlots.map((slot) => {
            const item = result.gear.find((gear) => gear.slot === slot);
            if (!item) return null;
            const itemSlotLabel = item.slot === "earrings" ? "耳坠" : slotLabels[item.slot];
            const weaponDamage = item.finalStats[weaponDamageStat] ?? item.weaponDamage;
            const weaponDelay = item.finalStats.DLY;
            const weaponPerformance = item.slot === "weapon"
              ? [
                  weaponDamage === undefined ? undefined : `${statName(weaponDamageStat)} ${statValue(weaponDamageStat, weaponDamage)}`,
                  weaponDelay === undefined || weaponDelay <= 0 ? undefined : `${statName("DLY")} ${statValue("DLY", weaponDelay)}`,
                ].filter((value): value is string => value !== undefined).join(" · ")
              : "";

            return (
              <tr className={styles.row} key={`${item.slot}-${item.id}`}>
                <th scope="row"><span className={styles.slotCell}>{itemSlotLabel}</span></th>
                <td>
                  <strong className={styles.itemName}>{item.name}</strong>
                  {weaponPerformance && <small className={styles.weaponPerformance}>{weaponPerformance}</small>}
                </td>
                <td className={styles.source}>{item.source ?? "上游未标注"}</td>
                <td><span className={styles.level}>{item.level}</span></td>
                <td>
                  <div className={styles.melds}>
                    {item.melds.map((meld, index) => (
                      <span className={styles.meld} key={`${meld.stat}-${index}`}>
                        {statName(meld.stat)}+{meld.value}
                      </span>
                    ))}
                  </div>
                </td>
                {statColumns.map((stat) => {
                  const value = item.finalStats[stat];
                  const atCap = value !== undefined && value > 0 && isStatAtCap(item, stat);
                  return (
                    <td
                      className={`${styles.statCell}${atCap ? ` ${styles.atCap}` : ""}`}
                      aria-label={`${statName(stat)} ${value === undefined ? "无" : statValue(stat, value)}`}
                      key={stat}
                    >
                      {value !== undefined && value > 0 ? statValue(stat, value) : "—"}
                    </td>
                  );
                })}
                <td aria-hidden="true" />
              </tr>
            );
          })}
          <tr className={styles.foodRow}>
            <th scope="row"><span className={styles.slotCell}>食物</span></th>
            <td><strong className={styles.foodName}>{result.food.name}</strong></td>
            <td className={styles.source}>上游食物数据</td>
            <td><span className={styles.level}>{result.food.level}</span></td>
            <td />
            {statColumns.map((stat) => {
              const value = foodStats[stat];
              const hasEffect = value !== undefined && value > 0;
              return (
                <td
                  className={`${styles.statCell}${hasEffect ? ` ${styles.foodEffect}` : ""}`}
                  aria-label={`${statName(stat)} ${value === undefined ? "无加成" : statValue(stat, value)}`}
                  key={stat}
                >
                  {value === undefined ? "—" : statValue(stat, value)}
                </td>
              );
            })}
            <td aria-hidden="true" />
          </tr>
        </tbody>
          <tfoot>
            <tr className={styles.totalRow}>
              <th scope="row"><span className={styles.slotCell}>总属性</span></th>
              <td />
              <td />
              <td><span className={styles.level}>{averageItemLevel ?? "—"}</span></td>
              <td />
              {statColumns.map((stat) => {
                const value = result.stats[stat];
                const emphasized = stat === "CRT" || stat === "SKS" || stat === "SPS" || stat === "VIT";
                return (
                  <td
                    className={`${styles.totalStatCell}${emphasized ? ` ${styles.totalEmphasis}` : ""}`}
                    key={stat}
                  >
                    {value === undefined ? "—" : statValue(stat, value)}
                  </td>
                );
              })}
              <td aria-hidden="true" />
            </tr>
          </tfoot>
      </table>
    </div>
  );
}
