import { jobSchemas, type JobId } from "@/domain";
import { GameIcon } from "@/ui/components/game-icon/GameIcon";
import { SyncIcon } from "@/ui/components/sync-icon/SyncIcon";
import { EquipmentOptionRow } from "@/ui/components/equipment-option-row/EquipmentOptionRow";
import { useState, type CSSProperties } from "react";
import { Popover } from "@base-ui/react/popover";
import { statName, statValue, gearSlotLabels } from "@/ui/services/labels";
import type { GearTableGearItem, GearTableRow } from "./types";
import styles from "./GearTable.module.scss";
import { ItemName } from "./components/item-name/ItemName";

export const gearTableStatOrder = [
  "STR",
  "DEX",
  "INT",
  "MND",
  "VIT",
  "CRT",
  "DET",
  "DHT",
  "SKS",
  "SPS",
  "TEN",
  "PIE",
  "PDMG",
  "MDMG",
  "DLY",
] as const;

type GearTableGearRow = Extract<GearTableRow, { item: GearTableGearItem }>;

function isGearRow(row: GearTableRow): row is GearTableGearRow {
  return row.item.kind === "gear";
}

export function collectGearTableStatColumns(rows: readonly GearTableRow[]) {
  const weaponPerformanceStats = new Set(["PDMG", "MDMG", "DLY"]);
  const present = new Set<string>();
  for (const row of rows) {
    const stats =
      row.item.kind === "food"
        ? { ...row.item.stats, ...row.item.actualStats }
        : row.item.stats;
    for (const stat of Object.keys(stats)) {
      if (!weaponPerformanceStats.has(stat)) present.add(stat);
    }
  }
  return gearTableStatOrder.filter((stat) => present.has(stat));
}

function ReplacementPopover({
  item,
  replacements,
  onSelect,
}: {
  item: GearTableGearItem;
  replacements: readonly GearTableGearItem[];
  onSelect: (replacement: GearTableGearItem) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger className={styles.replacementTrigger}>
        可替换 {replacements.length}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          className={styles.replacementPositioner}
          sideOffset={5}
          align="start"
        >
          <Popover.Popup
            className={styles.replacementPopup}
            aria-label={`${item.name}的可替换装备`}
          >
            <ul>
              {replacements.map((replacement) => (
                <li key={replacement.key}>
                  <button
                    type="button"
                    className={[
                      styles.replacementOption,
                      replacement.replacementSelected
                        ? styles.replacementOptionSelected
                        : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    aria-pressed={replacement.replacementSelected ?? false}
                    title={[
                      replacement.source,
                      replacement.melds
                        .map(({ stat, value }) => `${statName(stat)}+${value}`)
                        .join(" · "),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                    disabled={replacement.replacementDisabled}
                    onClick={() => {
                      onSelect(replacement);
                      setOpen(false);
                    }}
                  >
                    <EquipmentOptionRow
                      slot={replacement.slot}
                      name={replacement.name}
                      level={replacement.level}
                      source={replacement.source}
                      itemId={replacement.itemId}
                      selected={replacement.replacementSelected}
                      nameSuffix={
                        replacement.replacementDisabled ? (
                          <span className={styles.conflictBadge}>
                            唯一性冲突
                          </span>
                        ) : undefined
                      }
                    />
                  </button>
                </li>
              ))}
            </ul>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

function StatCells({
  stats,
  statColumns,
  emphasized,
  cappedStats,
}: {
  stats: Readonly<Record<string, number | undefined>>;
  statColumns: readonly string[];
  emphasized?: boolean;
  cappedStats?: readonly string[];
}) {
  return (
    <>
      {statColumns.map((stat) => {
        const value = stats[stat];
        const capped = cappedStats?.includes(stat) ?? false;
        return (
          <td
            className={[
              styles.statCell,
              capped ? styles.atCap : "",
              emphasized &&
              (stat === "CRT" ||
                stat === "SKS" ||
                stat === "SPS" ||
                stat === "VIT")
                ? styles.emphasizedStat
                : "",
            ]
              .filter(Boolean)
              .join(" ")}
            aria-label={`${statName(stat)} ${value === undefined ? "无" : statValue(stat, value)}`}
            key={stat}
          >
            {value === undefined ? "—" : statValue(stat, value)}
          </td>
        );
      })}
    </>
  );
}

export function GearTableView({
  rows,
  jobId,
  presentation = "interactive",
}: {
  rows: readonly GearTableRow[];
  jobId: JobId;
  presentation?: "interactive" | "image";
}) {
  const job = jobSchemas[jobId];
  const statColumns = [
    job.mainStat,
    "CRT",
    "DET",
    "DHT",
    job.role === "healer" || job.role === "int" ? "SPS" : "SKS",
    ...(job.role === "tank" ? ["TEN"] : []),
    "VIT",
  ];

  const hasReplacements =
    presentation === "interactive" &&
    rows.some(
      (row) =>
        isGearRow(row) &&
        (row.replacements?.length ?? 0) > 1 &&
        row.onReplacementSelect !== undefined,
    );
  return (
    <div
      className={`${styles.wrap} ${presentation === "image" ? styles.image : ""}`}
      style={
        {
          "--gear-row-count": rows.length,
          "--gear-stat-count": statColumns.length,
          "--gear-columns": `max-content max-content ${hasReplacements ? "max-content " : ""}max-content max-content minmax(10em, 1fr) ${statColumns.length ? `repeat(${statColumns.length}, max-content)` : "max-content"}`,
        } as CSSProperties
      }
    >
      <table className={styles.table}>
        <caption className={styles.caption}>装备与属性</caption>
        <thead>
          <tr className={styles.header}>
            <th scope="col">部位</th>
            <th scope="col">装备名称</th>
            {hasReplacements && <th scope="col" aria-label="替换装备" />}
            <th scope="col">来源</th>
            <th scope="col">品级</th>
            <th scope="col">魔晶石</th>
            {statColumns.map((stat) => (
              <th className={styles.statHeading} scope="col" key={stat}>
                {statName(stat)}
              </th>
            ))}
            {statColumns.length === 0 && <th aria-hidden="true" />}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const item = row.item;
            const gearRow = isGearRow(row) ? row : undefined;
            const defaultClass =
              item.kind === "food"
                ? styles.foodRow
                : item.kind === "summary"
                  ? styles.summaryRow
                  : styles.row;
            const rowClass = [defaultClass, row.className]
              .filter(Boolean)
              .join(" ");
            return (
              <tr className={rowClass} key={row.key}>
                <th scope="row">
                  <span className={styles.slotCell}>{row.slotLabel ?? ""}</span>
                  {row.marker !== undefined && (
                    <span className={styles.marker}>{row.marker}</span>
                  )}
                </th>
                <td>
                  {item.kind === "summary" ? null : (
                    <div className={styles.itemCell}>
                      <GameIcon
                        itemId={item.itemId}
                        className={styles.equipmentIcon}
                        loading={presentation === "image" ? "eager" : undefined}
                      />
                      <div className={styles.itemText}>
                        {presentation === "image" ? (
                          <strong
                            className={item.kind === "food" ? styles.foodName : styles.itemName}
                          >
                            {item.name}
                          </strong>
                        ) : (
                          <ItemName
                            name={item.name}
                            itemId={item.itemId}
                            className={item.kind === "food" ? styles.foodName : styles.itemName}
                          />
                        )}
                        {gearRow?.item.weaponPerformance && (
                          <small className={styles.weaponPerformance}>
                            {gearRow.item.weaponPerformance}
                          </small>
                        )}
                        {item.kind === "food" && item.statsMeaning && (
                          <small
                            className={styles.foodStatsMeaning}
                            title="实际生效属性总和占食物加成上限总和的比例"
                          >
                            {`利用率 ${item.utilization}%`}
                          </small>
                        )}
                      </div>
                    </div>
                  )}
                </td>
                {hasReplacements && (
                  <td>
                    {gearRow?.replacements &&
                      gearRow.replacements.length > 1 &&
                      gearRow.onReplacementSelect && (
                        <ReplacementPopover
                          item={gearRow.item}
                          replacements={gearRow.replacements}
                          onSelect={gearRow.onReplacementSelect}
                        />
                      )}
                  </td>
                )}
                <td className={styles.source}>
                  {item.kind === "summary"
                    ? ""
                    : item.kind === "food"
                      ? "生产制作"
                      : (item.source ?? "上游未标注")}
                </td>
                <td>
                  <span className={styles.level}>
                    {item.kind === "summary"
                      ? (item.itemLevel ?? "—")
                      : (item.level ?? "—")}
                  </span>
                </td>
                <td>
                  {item.kind === "gear" && (item.melds.length > 0 || item.materiaSync) && (
                    <div className={styles.melds}>
                      {item.materiaSync && <SyncIcon className={styles.syncIcon}
                        aria-label={item.materiaSync === "disabled" ? "品级同步后魔晶石不生效" : "自定义属性因同步被截断"} />}
                      {item.materiaSync !== "disabled" && item.melds.map(({ stat, value, isOvermeld }, index) => (
                        <span
                          className={`${styles.meld} ${isOvermeld ? styles.overmeld : ""}`}
                          title={isOvermeld ? "禁忌镶嵌" : undefined}
                          key={`${stat}-${value}-${index}`}
                        >
                          {statName(stat)}+{value}
                        </span>
                      ))}
                    </div>
                  )}
                </td>
                <StatCells
                  stats={item.kind === "food" ? item.actualStats : item.stats}
                  statColumns={statColumns}
                  emphasized={item.kind === "summary"}
                  cappedStats={
                    item.kind === "gear" ? item.cappedStats : undefined
                  }
                />
                {statColumns.length === 0 && <td aria-hidden="true" />}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
