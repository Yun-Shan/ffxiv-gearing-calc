import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { createPortal } from "react-dom";
import { foods, getGearById, jobSchemas, type Gear, type GearSlot, type OptimizationConfig, type OptimizationResult } from "@/domain";
import type { SingleGcdMode } from "@/ui/services/types";
import { gearSlotLabels } from "@/ui/services/labels";
import styles from "./SingleConditionSummary.module.scss";

type SingleSummaryView = "workbench" | "progress" | "result";

function SingleRestrictionPopover({
  label,
  count,
  emptyText,
  children,
}: {
  label: string;
  count: number;
  emptyText: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const detailsList = useRef<HTMLDivElement>(null);
  const [panelPosition, setPanelPosition] = useState<{
    left: number;
    top: number;
    width: number;
    maxHeight: number;
  }>();

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !container.current?.contains(event.target) &&
        !panel.current?.contains(event.target)
      ) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) {
      setPanelPosition(undefined);
      return;
    }
    const updatePosition = () => {
      const triggerRect = trigger.current?.getBoundingClientRect();
      if (!triggerRect) return;
      const viewportPadding = 8;
      const gap = 10;
      const width = Math.min(350, Math.max(0, window.innerWidth - viewportPadding * 2));
      const maxHeight = Math.max(0, window.innerHeight - viewportPadding * 2);
      const panelHeight = Math.min(
        panel.current?.getBoundingClientRect().height ?? Math.min(430, maxHeight),
        maxHeight,
      );
      const left = Math.max(
        viewportPadding,
        Math.min(triggerRect.left - gap - width, window.innerWidth - width - viewportPadding),
      );
      const top = Math.max(
        viewportPadding,
        Math.min(triggerRect.top - 2, window.innerHeight - panelHeight - viewportPadding),
      );
      setPanelPosition((current) =>
        current &&
        Math.abs(current.left - left) < 0.5 &&
        Math.abs(current.top - top) < 0.5 &&
        Math.abs(current.width - width) < 0.5 &&
        Math.abs(current.maxHeight - maxHeight) < 0.5
          ? current
          : { left, top, width, maxHeight },
      );
    };
    updatePosition();
    detailsList.current?.focus({ preventScroll: true });
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    const resizeObserver = typeof ResizeObserver === "undefined"
      ? undefined
      : new ResizeObserver(updatePosition);
    if (panel.current) resizeObserver?.observe(panel.current);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      resizeObserver?.disconnect();
    };
  }, [open]);

  const panelStyle: CSSProperties = panelPosition ?? {
    position: "fixed",
    left: 8,
    top: 8,
    width: Math.min(350, Math.max(0, window.innerWidth - 16)),
    maxHeight: Math.max(0, window.innerHeight - 16),
  };

  return (
    <div className={styles.popover} ref={container}>
      <button
        ref={trigger}
        type="button"
        className={styles.popoverTrigger}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
      >
        <span>{label}</span>
        <strong>{count ? `${count} 项` : "不限"}</strong>
      </button>
      {open && createPortal(<div
        ref={panel}
        className={styles.popoverPanel}
        role="dialog"
        aria-label={label}
        style={panelStyle}
      >
        <h3 className={styles.popoverHeading}>{label}</h3>
        <div
          ref={detailsList}
          className={styles.popoverList}
          role="region"
          aria-label={`${label}详情`}
          tabIndex={0}
        >
          {count ? children : <p>{emptyText}</p>}
        </div>
      </div>, document.body)}
    </div>
  );
}
export function SingleConditionSummary({
  config,
  view,
  gcdMode,
  result,
  startedAtISO,
  dataVersion,
}: {
  config: OptimizationConfig;
  view: SingleSummaryView;
  gcdMode?: SingleGcdMode;
  result?: OptimizationResult;
  startedAtISO?: string;
  dataVersion?: string;
}) {
  const job = jobSchemas[config.jobId];
  const customSpeedHasBounds = config.speedMin !== undefined || config.speedMax !== undefined;
  const customSpeedActive = gcdMode === "speed" || customSpeedHasBounds;
  const gcd = customSpeedActive
    ? customSpeedHasBounds
      ? "自定义速度范围"
      : "不限"
    : config.gcdChoices !== undefined
      ? config.gcdChoices.length ? config.gcdChoices.map((value) => `${value.toFixed(2)} 秒`).join("、") : "未选择档位"
      : "不限";
  const speedName = job.role === "healer" || job.role === "int" ? "咏速" : "技速";
  const speed = config.speedMin === undefined && config.speedMax === undefined
    ? "不限"
    : `${config.speedMin ?? "不限"}–${config.speedMax ?? "不限"}`;
  const food = config.foodId === 0
    ? "自动选择"
    : foods.find((item) => item.id === config.foodId)?.name ?? `食物编号 ${config.foodId}`;
  const forced = Object.entries(config.forcedGear)
    .filter((entry): entry is [string, number] => entry[1] !== undefined)
    .map(([slot, id]) => ({ slot: slot as GearSlot, id, gear: getGearById(id) }));
  const excluded = (config.excludedGearIds ?? [])
    .map((id) => getGearById(id))
    .filter((gear): gear is Gear => gear !== undefined);
  const target = ({ damage: "每威力伤害期望", dps: "每秒每威力伤害期望" } as const)[config.objective!];

  return (
      <div className={`${styles.root} ${view === "workbench" ? styles.workbench : view === "progress" ? styles.progress : styles.result}`}>
      <header className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>{view === "result" ? "最优结果" : view === "progress" ? "搜索条件" : "条件摘要"}</p>
          <h2 className={styles.jobName}>{job.name}</h2>
        </div>
      </header>

      {view === "result" && result && <section className={styles.section}>
        <h3 className={styles.sectionTitle}>伤害与防御</h3>
        <div className={styles.effects}>
          <div><span>暴击伤害</span><strong>{(result.effects.crtDamage * 100).toFixed(1)}%</strong></div>
          <div><span>信念加成</span><strong>{(result.effects.detDamage * 100).toFixed(2)}%</strong></div>
          <div><span>坚韧伤害加成</span><strong>{(result.effects.tenDamage * 100).toFixed(2)}%</strong></div>
          <div><span>坚韧减伤</span><strong>{(result.effects.tenMitigation * 100).toFixed(2)}%</strong></div>
          <div className={styles.effectsLife}><span>生命值</span><strong>{result.effects.hp.toLocaleString()}</strong></div>
        </div>
      </section>}

      <section className={`${styles.section} ${styles.conditions}`}>
        <h3 className={styles.sectionTitle}>{view === "result" ? "搜索条件与限制" : "搜索条件"}</h3>
        <dl className={styles.rows}>
          <div><dt>优化指标</dt><dd>{target}</dd></div>
          <div><dt>装备品级</dt><dd>{config.minItemLevel}–{config.maxItemLevel}</dd></div>
          <div><dt>同步品级</dt><dd>{config.syncLevel === undefined ? "未启用" : config.syncLevel}</dd></div>
          <div><dt>GCD</dt><dd>{gcd}</dd></div>
          <div><dt>{speedName}范围</dt><dd>{speed}</dd></div>
          <div><dt>坚韧约束</dt><dd>{config.maximizeTenacity
            ? "候选范围内最高坚韧"
            : config.toughnessMinPercent !== undefined
              ? `最低减伤 ${config.toughnessMinPercent}%`
              : config.minTenacity !== undefined
                ? `最低坚韧 ${config.minTenacity}`
                : "不限"}</dd></div>
          <div><dt>食物</dt><dd>{food}</dd></div>
        </dl>
        <div className={styles.restrictions}>
          <SingleRestrictionPopover label="来源限制" count={config.excludedSources.length} emptyText="没有排除来源。">
            {config.excludedSources.map((source) => <div className={styles.popoverRow} key={source}><span>{source}</span><small>已排除</small></div>)}
          </SingleRestrictionPopover>
          <SingleRestrictionPopover label="强制装备" count={forced.length} emptyText="没有强制装备。">
            {forced.map(({ slot, id, gear: item }) => <div className={styles.popoverRow} key={slot}><span>{item?.name ?? `装备 ${id}`}</span><small>{gearSlotLabels[slot]}</small></div>)}
          </SingleRestrictionPopover>
          <SingleRestrictionPopover label="排除装备" count={excluded.length} emptyText="没有排除装备。">
            {excluded.map((item) => <div className={styles.popoverRow} key={item.id}><span>{item.name}</span><small>{gearSlotLabels[item.slot]} · {item.source ?? "上游未标注"}</small></div>)}
          </SingleRestrictionPopover>
        </div>
        {view === "result" && <dl className={`${styles.rows} ${styles.metadata}`}>
          <div><dt>数据版本</dt><dd>{dataVersion ?? "—"}</dd></div>
          <div><dt>搜索时间</dt><dd>{startedAtISO ? new Date(startedAtISO).toLocaleString("zh-CN") : "—"}</dd></div>
        </dl>}
        {view === "progress" && <p className={styles.note}>食物、装备候选、属性上限与计算规则均来自当前项目数据。</p>}
      </section>
    </div>
  );
}
