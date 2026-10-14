import { foods, getGearById, jobSchemas, type OptimizationConfig } from "@/domain";
import styles from "@/ui/components/config-snapshot/ConfigSnapshot.module.scss";

export function ConfigSnapshot({ config, onEdit }: {
  config: OptimizationConfig;
  onEdit?: () => void;
}) {
  const speedName = ["healer", "int"].includes(jobSchemas[config.jobId].role) ? "咏速" : "技速";
  const equipmentName = (id: number) => getGearById(id)?.name ?? `装备编号 ${id}`;
  const rows: [string, string][] = [
    ["职业与等级", `${jobSchemas[config.jobId].name} · ${config.jobLevel ?? jobSchemas[config.jobId].maxJobLevel} 级`],
    ["优化目标", ({ damage: "每威力伤害期望", dps: "按 GCD 折算" } as const)[config.objective!]],
    ["装备品级", `${config.minItemLevel}–${config.maxItemLevel}`],
    ["同步品级", config.syncLevel === undefined ? "未启用" : String(config.syncLevel)],
    ["GCD", config.gcdChoices !== undefined
      ? config.gcdChoices.length ? config.gcdChoices.map((gcd) => `${gcd.toFixed(2)} 秒`).join("、") : "未选择档位"
      : config.gcdTarget === undefined ? "不限" : `${config.gcdTarget.toFixed(2)} 秒`],
    [speedName + "范围", config.speedMin === undefined && config.speedMax === undefined
      ? "不限" : `${config.speedMin ?? "不限"}–${config.speedMax ?? "不限"}`],
    ["食物选择", config.foodId === 0 ? "自动选择" : foods.find((food) => food.id === config.foodId)?.name ?? `食物编号 ${config.foodId}`],
    ["排除来源", config.excludedSources.join("、") || "无"],
    ["强制装备", Object.values(config.forcedGear).filter((id): id is number => id !== undefined).map(equipmentName).join("、") || "无"],
    ["排除装备", (config.excludedGearIds ?? []).map(equipmentName).join("、") || "无"],
  ];
  if (jobSchemas[config.jobId].role === "tank") rows.push(["坚韧条件", [
    config.minTenacity !== undefined || config.toughnessMin !== undefined ? `最低坚韧 ${config.minTenacity ?? config.toughnessMin}` : "",
    config.toughnessMinPercent !== undefined ? `最低减伤 ${config.toughnessMinPercent}%` : "",
    config.maximizeTenacity ? "候选范围内最高坚韧" : "",
  ].filter(Boolean).join(" · ") || "无额外条件"]);

  return (
    <section className={styles.root} data-config-snapshot aria-label="本次结果的搜索条件">
      <div className="result-toolbar">
        <div>
          <h2>本次搜索条件</h2>
          <span className="muted">与这份结果绑定；修改当前设置不会改变以下记录。</span>
        </div>
        {onEdit && <button type="button" className={styles.textButton} onClick={onEdit}>编辑当前条件</button>}
      </div>
      <dl className={styles.rows} data-config-rows>
        {rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
      </dl>
    </section>
  );
}
