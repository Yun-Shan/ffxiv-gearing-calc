import { useMemo, useState } from "react";
import * as Checkbox from "@radix-ui/react-checkbox";
import * as Dialog from "@radix-ui/react-dialog";
import * as Label from "@radix-ui/react-label";
import * as Select from "@radix-ui/react-select";
import * as Separator from "@radix-ui/react-separator";
import * as Slider from "@radix-ui/react-slider";
import * as Tooltip from "@radix-ui/react-tooltip";
import {
  Check,
  ChevronDown,
  CircleHelp,
  Calculator,
  ExternalLink,
  LockKeyhole,
  Pencil,
  Play,
  RotateCcw,
  Settings2,
  Sparkles,
  X,
} from "lucide-react";
import {
  combatSlots,
  combatStats,
  dataProvenance,
  foods,
  gears,
  gearOptionsFor,
  findFeasibleGcds,
  isGearBaseStatAtCap,
  jobIds,
  jobSchemas,
  optimize,
  type GearSlot,
  type JobId,
  type OptimizationConfig,
  type OptimizationResult,
  type Stat,
} from "./domain";

const slotLabels: Record<GearSlot, string> = {
  weapon: "武器",
  offhand: "盾牌",
  head: "头部",
  body: "身体",
  hands: "手部",
  legs: "腿部",
  feet: "脚部",
  earrings: "耳饰",
  necklace: "项链",
  bracelet: "手镯",
  ring: "戒指 1",
  ring2: "戒指 2",
};
const statNames: Record<Stat, string> = {
  STR: "力量",
  DEX: "灵巧",
  INT: "智力",
  MND: "精神",
  VIT: "耐力",
  CRT: "暴击",
  DET: "信念",
  DHT: "直击",
  SKS: "技速",
  SPS: "咏速",
  TEN: "坚韧",
  PIE: "信仰",
  PDMG: "物理基本性能",
  MDMG: "魔法基本性能",
  DLY: "攻击间隔",
};

function getStatName(stat: string): string {
  return statNames[stat as Stat] ?? "未知属性";
}

function formatStatValue(stat: string, value: number): string {
  return stat === "DLY" ? (value / 1000).toFixed(2) : value.toLocaleString();
}

function isHighlightedGearStat(stat: string): boolean {
  return combatStats.includes(stat as (typeof combatStats)[number]);
}

const itemLevelBounds = gears.reduce(
  ([min, max], gear) => [Math.min(min, gear.level), Math.max(max, gear.level)],
  [Number.POSITIVE_INFINITY, 0],
);
const bestCombatFoods = foods.filter((food) => food.best && food.stats.VIT);
const initialConfig: OptimizationConfig = {
  jobId: "SAM",
  minItemLevel: Math.max(itemLevelBounds[0], itemLevelBounds[1] - 15),
  maxItemLevel: itemLevelBounds[1],
  maximizeTenacity: false,
  excludedSources: [],
  forcedGear: {},
  sharedSlots: [],
  foodId: 0,
};

function SelectBox({
  value,
  onValueChange,
  children,
  ariaLabel,
}: {
  value: string;
  onValueChange: (value: string) => void;
  children: React.ReactNode;
  ariaLabel: string;
}) {
  return (
    <Select.Root value={value} onValueChange={onValueChange}>
      <Select.Trigger className="select-trigger" aria-label={ariaLabel}>
        <Select.Value />{" "}
        <Select.Icon>
          <ChevronDown size={15} />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content className="select-content">
          <Select.Viewport>{children}</Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}

function SelectItem({
  value,
  children,
}: {
  value: string;
  children: React.ReactNode;
}) {
  return (
    <Select.Item value={value} className="select-item">
      <Select.ItemText>{children}</Select.ItemText>
      <Select.ItemIndicator>
        <Check size={14} />
      </Select.ItemIndicator>
    </Select.Item>
  );
}

function CheckControl({
  checked,
  onCheckedChange,
  label,
  subtle = false,
}: {
  checked: boolean;
  onCheckedChange: (value: boolean) => void;
  label: React.ReactNode;
  subtle?: boolean;
}) {
  return (
    <label className={`check-row ${subtle ? "subtle" : ""}`}>
      <Checkbox.Root
        className="checkbox"
        checked={checked}
        onCheckedChange={(value) => onCheckedChange(value === true)}
      >
        <Checkbox.Indicator>
          <Check size={13} strokeWidth={3} />
        </Checkbox.Indicator>
      </Checkbox.Root>
      <span>{label}</span>
    </label>
  );
}

function StatPill({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className={`stat-pill ${accent ? "accent" : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function App() {
  const [config, setConfig] = useState<OptimizationConfig>(initialConfig);
  const [result, setResult] = useState<OptimizationResult | undefined>(() =>
    optimize(initialConfig),
  );
  const [running, setRunning] = useState(false);
  const [findingGcds, setFindingGcds] = useState(false);
  const [feasibleGcds, setFeasibleGcds] = useState<number[] | undefined>();
  const [feasibleGcdsKey, setFeasibleGcdsKey] = useState<string | undefined>();
  const job = jobSchemas[config.jobId];
  const gearSourceCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const slot of combatSlots.filter((item) => item !== "ring2"))
      for (const gear of gearOptionsFor(config, slot))
        if (gear.source)
          counts.set(gear.source, (counts.get(gear.source) ?? 0) + 1);
    return [...counts]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([source, count]) => ({ source, count }));
  }, [config]);
  const gcdSearchKey = useMemo(
    () =>
      JSON.stringify({
        jobId: config.jobId,
        minItemLevel: config.minItemLevel,
        maxItemLevel: config.maxItemLevel,
        minTenacity: config.minTenacity,
        maximizeTenacity: config.maximizeTenacity,
        excludedSources: config.excludedSources,
        forcedGear: config.forcedGear,
        foodId: config.foodId,
      }),
    [
      config.jobId,
      config.minItemLevel,
      config.maxItemLevel,
      config.minTenacity,
      config.maximizeTenacity,
      config.excludedSources,
      config.forcedGear,
      config.foodId,
    ],
  );
  const gcdSelectionReady =
    feasibleGcdsKey === gcdSearchKey && feasibleGcds !== undefined;

  const runSearch = () => {
    setRunning(true);
    window.setTimeout(() => {
      setResult(optimize(config));
      setRunning(false);
    }, 40);
  };
  const calculateFeasibleGcds = () => {
    setFindingGcds(true);
    window.setTimeout(() => {
      const possible = findFeasibleGcds(config);
      const selected =
        config.gcdTarget === undefined
          ? undefined
          : possible.find((gcd) => Math.abs(gcd - config.gcdTarget!) < 0.001);
      setConfig((current) => ({ ...current, gcdTarget: selected }));
      setFeasibleGcds(possible);
      setFeasibleGcdsKey(gcdSearchKey);
      setFindingGcds(false);
    }, 40);
  };
  const switchToManualGcd = () => setFeasibleGcdsKey(undefined);
  const setConfigValue = <K extends keyof OptimizationConfig>(
    key: K,
    value: OptimizationConfig[K],
  ) => setConfig((current) => ({ ...current, [key]: value }));
  const reset = () => {
    setConfig(initialConfig);
    setResult(optimize(initialConfig));
    setFeasibleGcds(undefined);
    setFeasibleGcdsKey(undefined);
  };
  const toggleSource = (source: string) =>
    setConfigValue(
      "excludedSources",
      config.excludedSources.includes(source)
        ? config.excludedSources.filter((item) => item !== source)
        : [...config.excludedSources, source],
    );
  const toggleShared = (slot: GearSlot) =>
    setConfigValue(
      "sharedSlots",
      config.sharedSlots.includes(slot)
        ? config.sharedSlots.filter((item) => item !== slot)
        : [...config.sharedSlots, slot],
    );
  const setForced = (slot: GearSlot, value: string) =>
    setConfigValue("forcedGear", {
      ...config.forcedGear,
      ...(value === "none" ? { [slot]: undefined } : { [slot]: Number(value) }),
    });

  return (
    <Tooltip.Provider delayDuration={250}>
      <div className="app-shell">
        <header className="topbar">
          <div className="brand">
            <div className="brand-mark">
              <Sparkles size={18} />
            </div>
            <div>
              <div className="brand-name">配装工坊</div>
              <div className="brand-sub">最终幻想 14 配装实验室</div>
            </div>
          </div>
          <div className="topbar-meta">
            <span className="status-dot" />
            数据版本 {dataProvenance.commit.slice(0, 12)}{" "}
            <Separator.Root
              decorative
              orientation="vertical"
              className="vertical-rule"
            />
            <button
              className="icon-button"
              aria-label="重置配置"
              onClick={reset}
            >
              <RotateCcw size={17} />
            </button>
            <Dialog.Root>
              <Dialog.Trigger asChild>
                <button className="icon-button" aria-label="打开设置">
                  <Settings2 size={18} />
                </button>
              </Dialog.Trigger>
              <Dialog.Portal>
                <Dialog.Overlay className="dialog-overlay" />
                <Dialog.Content className="dialog-content">
                  <div className="dialog-heading">
                    <div>
                      <Dialog.Title>计算设置</Dialog.Title>
                      <Dialog.Description>
                        控制搜索策略与结果精度。
                      </Dialog.Description>
                    </div>
                    <Dialog.Close asChild>
                      <button className="icon-button">
                        <X size={16} />
                      </button>
                    </Dialog.Close>
                  </div>
                  <Separator.Root className="rule" />
                  <div className="dialog-setting">
                    <span>候选保留数量</span>
                    <strong>1,800</strong>
                  </div>
                  <div className="dialog-setting">
                    <span>规则等级</span>
                    <strong>等级 100</strong>
                  </div>
                  <p className="dialog-note">
                    纯逻辑计算在浏览器内执行，数据可通过项目脚本更新。
                  </p>
                </Dialog.Content>
              </Dialog.Portal>
            </Dialog.Root>
          </div>
        </header>

        <main className="workspace">
          <aside className="sidebar">
            <div className="section-kicker">优化设置</div>
            <div className="sidebar-title">优化配置</div>
            <div className="field">
              <Label.Root className="field-label" htmlFor="job">
                职业
              </Label.Root>
              <SelectBox
                value={config.jobId}
                onValueChange={(value) =>
                  setConfigValue("jobId", value as JobId)
                }
                ariaLabel="职业"
              >
                {jobIds.map((id) => (
                  <SelectItem key={id} value={id}>
                    {jobSchemas[id].name}
                  </SelectItem>
                ))}
              </SelectBox>
            </div>
            <div className="field">
              <div className="field-label with-value">
                <span>品级范围</span>
                <span className="range-value">
                  {config.minItemLevel} — {config.maxItemLevel}
                </span>
              </div>
              <Slider.Root
                className="slider"
                min={itemLevelBounds[0]}
                max={itemLevelBounds[1]}
                step={1}
                value={[config.minItemLevel, config.maxItemLevel]}
                onValueChange={([min, max]) =>
                  setConfig((current) => ({
                    ...current,
                    minItemLevel: min,
                    maxItemLevel: max,
                  }))
                }
              >
                <Slider.Track className="slider-track">
                  <Slider.Range className="slider-range" />
                </Slider.Track>
                <Slider.Thumb className="slider-thumb" aria-label="最低品级" />
                <Slider.Thumb className="slider-thumb" aria-label="最高品级" />
              </Slider.Root>
            </div>
            <div className="field">
              <Label.Root className="field-label" htmlFor="food">
                食物
              </Label.Root>
              <SelectBox
                value={String(config.foodId)}
                onValueChange={(value) =>
                  setConfigValue("foodId", Number(value))
                }
                ariaLabel="食物"
              >
                <SelectItem value="0">自动选择最优</SelectItem>
                {bestCombatFoods.map((food) => (
                  <SelectItem key={food.id} value={String(food.id)}>
                    {food.name}
                  </SelectItem>
                ))}
              </SelectBox>
            </div>
            <Separator.Root className="rule" />
            <div className="field">
              <div className="field-label with-help">
                <span>GCD 目标</span>
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <CircleHelp size={14} />
                  </Tooltip.Trigger>
                  <Tooltip.Portal>
                    <Tooltip.Content className="tooltip">
                      只保留达到指定 GCD 档位的配装
                      <Tooltip.Arrow className="tooltip-arrow" />
                    </Tooltip.Content>
                  </Tooltip.Portal>
                </Tooltip.Root>
              </div>
              {gcdSelectionReady ? (
                <div className="gcd-control-row">
                  <SelectBox
                    value={
                      config.gcdTarget === undefined
                        ? "any"
                        : String(config.gcdTarget)
                    }
                    onValueChange={(value) =>
                      setConfigValue(
                        "gcdTarget",
                        value === "any" ? undefined : Number(value),
                      )
                    }
                    ariaLabel="GCD 目标"
                  >
                    <SelectItem value="any">不限</SelectItem>
                    {feasibleGcds?.map((gcd) => (
                      <SelectItem key={gcd} value={String(gcd)}>
                        {gcd.toFixed(2)} 秒
                      </SelectItem>
                    ))}
                  </SelectBox>
                  <Tooltip.Root>
                    <Tooltip.Trigger asChild>
                      <button
                        className="icon-button bordered"
                        aria-label="改为手动输入 GCD"
                        onClick={switchToManualGcd}
                      >
                        <Pencil size={15} />
                      </button>
                    </Tooltip.Trigger>
                    <Tooltip.Portal>
                      <Tooltip.Content className="tooltip">
                        改为手动输入
                        <Tooltip.Arrow className="tooltip-arrow" />
                      </Tooltip.Content>
                    </Tooltip.Portal>
                  </Tooltip.Root>
                </div>
              ) : (
                <div className="number-input-wrap">
                  <input
                    id="gcd-target"
                    type="number"
                    step="any"
                    value={config.gcdTarget ?? ""}
                    onChange={(event) =>
                      setConfigValue(
                        "gcdTarget",
                        event.target.value === ""
                          ? undefined
                          : Number(event.target.value),
                      )
                    }
                    aria-label="GCD 目标"
                  />
                  <span>秒</span>
                </div>
              )}
              <button
                className="gcd-calculate-button"
                onClick={calculateFeasibleGcds}
                disabled={findingGcds}
              >
                <Calculator size={14} />
                {findingGcds
                  ? "计算可行 GCD…"
                  : gcdSelectionReady
                    ? "重新计算可行 GCD"
                    : "计算可行 GCD"}
              </button>
              {gcdSelectionReady && (
                <span className="gcd-result-note">
                  {feasibleGcds?.length
                    ? `已找到 ${feasibleGcds.length} 个可行档位`
                    : "当前约束下没有可行档位"}
                </span>
              )}
            </div>
            {job.role === "tank" && (
              <div className="field">
                <Label.Root className="field-label" htmlFor="tenacity">
                  最低坚韧
                </Label.Root>
                <div className="number-input-wrap">
                  <input
                    id="tenacity"
                    type="number"
                    min={0}
                    value={config.minTenacity ?? 0}
                    onChange={(event) =>
                      setConfigValue("minTenacity", Number(event.target.value))
                    }
                  />
                  <span>坚韧</span>
                </div>
                <CheckControl
                  checked={config.maximizeTenacity}
                  onCheckedChange={(checked) =>
                    setConfigValue("maximizeTenacity", checked)
                  }
                  label="优先最大坚韧"
                  subtle
                />
              </div>
            )}
            <Separator.Root className="rule" />
            <div className="section-kicker small">排除来源</div>
            <div className="source-list">
              {gearSourceCounts.map(({ source, count }) => (
                <CheckControl
                  key={source}
                  checked={config.excludedSources.includes(source)}
                  onCheckedChange={() => toggleSource(source)}
                  label={
                    <>
                      <span>{source}</span>
                      <em>{count}</em>
                    </>
                  }
                  subtle
                />
              ))}
            </div>
            <button
              className={`run-button ${running ? "is-running" : ""}`}
              onClick={runSearch}
              disabled={running || findingGcds}
            >
              <Play size={16} fill="currentColor" />
              {running ? "计算中…" : "开始优化"}
              <span className="run-shortcut">↵</span>
            </button>
          </aside>

          <section className="main-panel">
            <div className="content-head">
              <div>
                <div className="section-kicker">优化结果</div>
                <h1>
                  {job.name} ·{" "}
                  {job.secondaryStat === "TEN" ? "坚韧构筑" : "输出构筑"}
                </h1>
                <p className="head-caption">
                  基于 {config.minItemLevel} — {config.maxItemLevel}{" "}
                  品级范围，已为 {job.name} 计算可行解
                </p>
              </div>
              <div className="head-actions">
                <span className="compute-chip">
                  <span className="status-dot" />
                  已就绪
                </span>
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <button
                      className="icon-button bordered"
                      aria-label="查看数据来源"
                    >
                      <ExternalLink size={16} />
                    </button>
                  </Tooltip.Trigger>
                  <Tooltip.Portal>
                    <Tooltip.Content className="tooltip">
                      {dataProvenance.repository} @{" "}
                      {dataProvenance.commit.slice(0, 12)}
                      <Tooltip.Arrow className="tooltip-arrow" />
                    </Tooltip.Content>
                  </Tooltip.Portal>
                </Tooltip.Root>
              </div>
            </div>
            {result ? (
              <>
                <div className="metric-strip">
                  <StatPill
                    label="每威力伤害期望"
                    value={result.effects.damage.toFixed(7)}
                    accent
                  />
                  <StatPill
                    label="GCD"
                    value={`${result.effects.gcd.toFixed(2)} 秒`}
                  />
                  <StatPill
                    label="暴击率"
                    value={`${(result.effects.crtChance * 100).toFixed(1)}%`}
                  />
                  <StatPill
                    label="直击率"
                    value={`${(result.effects.dhtChance * 100).toFixed(1)}%`}
                  />
                  <StatPill
                    label="搜索候选"
                    value={result.searchedCandidates.toLocaleString()}
                  />
                </div>
                <div className="result-toolbar">
                  <div>
                    <h2>推荐配装</h2>
                    <span className="muted">
                      总伤害评分 {result.score.toFixed(7)} ·{" "}
                      {result.durationMs.toFixed(0)} 毫秒
                    </span>
                  </div>
                  <button className="text-button" onClick={runSearch}>
                    <RotateCcw size={15} />
                    重新计算
                  </button>
                </div>
                <div className="gear-table">
                  <div className="gear-table-head">
                    <span>部位</span>
                    <span>装备</span>
                    <span>属性</span>
                    <span>魔晶石</span>
                    <span>来源</span>
                    <span>等级</span>
                  </div>
                  {result.gear.map((item) => {
                    const isForced = config.forcedGear[item.slot] === item.id;
                    return (
                      <div className="gear-row" key={`${item.slot}-${item.id}`}>
                        <div className="slot-cell">
                          <span className="slot-icon">
                            {slotLabels[item.slot].slice(0, 1)}
                          </span>
                          <span>{slotLabels[item.slot]}</span>
                        </div>
                        <strong>{item.name}</strong>
                        <div className="gear-stats">
                          {Object.entries(item.finalStats)
                            .filter(
                              ([, value]) => value !== undefined && value > 0,
                            )
                            .map(([stat, value]) => {
                              const isCapped =
                                isHighlightedGearStat(stat) &&
                                isGearBaseStatAtCap(item, stat as Stat);
                              return (
                                <span
                                  key={stat}
                                  className={`gear-stat${isCapped ? " at-cap" : ""}`}
                                >
                                  {getStatName(stat)}{" "}
                                  {formatStatValue(stat, value)}
                                </span>
                              );
                            })}
                        </div>
                        <div className="melds">
                          {item.melds.length ? (
                            item.melds.map((meld, index) => (
                              <span
                                key={`${meld.stat}-${index}`}
                                className="meld"
                              >
                                {getStatName(meld.stat)} +{meld.value}
                              </span>
                            ))
                          ) : (
                            <span className="muted">无镶嵌</span>
                          )}
                          {isForced && (
                            <span className="locked">
                              <LockKeyhole size={13} />
                              已锁定
                            </span>
                          )}
                        </div>
                        <span className="source-text">
                          {item.source ?? "上游未标注"}
                        </span>
                        <span className="level-tag">{item.level}</span>
                      </div>
                    );
                  })}
                  <div className="food-row">
                    <div className="slot-cell">
                      <span className="slot-icon food">食</span>
                      <span>食物</span>
                    </div>
                    <strong>{result.food.name}</strong>
                    <div className="gear-stats">
                      {Object.entries(result.food.stats)
                        .map(([key, value]) => `${getStatName(key)} ${value}`)
                        .join(" · ")}
                    </div>
                    <div className="melds">
                      <span className="food-bonus">食物加成</span>
                    </div>
                    <span className="source-text">上游食品数据</span>
                    <span className="level-tag">高品质</span>
                  </div>
                </div>

                <div className="result-section">
                  <div className="result-toolbar">
                    <div>
                      <h2>配装总属性</h2>
                      <span className="muted">
                        已计入食物比例加成与装备魔晶石
                      </span>
                    </div>
                  </div>
                  <div className="stats-grid">
                    {Object.entries(result.stats)
                      .filter(([, value]) => value && value > 0)
                      .map(([stat, value]) => (
                        <div className="stat-card" key={stat}>
                          <span>{getStatName(stat)}</span>
                          <strong>{formatStatValue(stat, value)}</strong>
                          <div className="stat-bar">
                            <i
                              style={{
                                width: `${Math.min(100, Number(value) / 35)}%`,
                              }}
                            />
                          </div>
                        </div>
                      ))}
                  </div>
                  <div className="effect-summary">
                    <div>
                      <span>坚韧伤害</span>
                      <strong>
                        {(result.effects.tenDamage * 100).toFixed(2)}%
                      </strong>
                    </div>
                    <div>
                      <span>坚韧减伤</span>
                      <strong>
                        {(result.effects.tenMitigation * 100).toFixed(2)}%
                      </strong>
                    </div>
                    <div>
                      <span>生命值</span>
                      <strong>{result.effects.hp.toLocaleString()}</strong>
                    </div>
                    <div>
                      <span>魔力值</span>
                      <strong>{result.effects.mp.toLocaleString()}</strong>
                    </div>
                  </div>
                </div>

                <div className="result-section">
                  <div className="result-toolbar">
                    <div>
                      <h2>约束与共享部位</h2>
                      <span className="muted">
                        用于多职业方案的统一部位约束
                      </span>
                    </div>
                  </div>
                  <div className="constraint-grid">
                    {combatSlots
                      .filter(
                        (slot) => slot !== "offhand" || config.jobId === "PLD",
                      )
                      .map((slot) => (
                        <div className="constraint-row" key={slot}>
                          <span>{slotLabels[slot]}</span>
                          <SelectBox
                            value={
                              config.forcedGear[slot]
                                ? String(config.forcedGear[slot])
                                : "none"
                            }
                            onValueChange={(value) => setForced(slot, value)}
                            ariaLabel={`${slotLabels[slot]}强制装备`}
                          >
                            <SelectItem value="none">自动选择</SelectItem>
                            {gearOptionsFor(config, slot).map((gear) => (
                              <SelectItem key={gear.id} value={String(gear.id)}>
                                {gear.name}
                              </SelectItem>
                            ))}
                          </SelectBox>
                          <CheckControl
                            checked={config.sharedSlots.includes(slot)}
                            onCheckedChange={() => toggleShared(slot)}
                            label="共享"
                            subtle
                          />
                        </div>
                      ))}
                  </div>
                </div>
              </>
            ) : (
              <div className="empty-state">
                <div className="empty-icon">
                  <X size={22} />
                </div>
                <h2>没有找到可行配装</h2>
                <p>请放宽品级、GCD 或来源限制后重新计算。</p>
                <button className="text-button" onClick={reset}>
                  <RotateCcw size={15} />
                  恢复默认配置
                </button>
              </div>
            )}
            <footer className="footer">
              <span>规则引擎 · 等级 100</span>
              <span>纯前端计算 · 可离线运行</span>
              <span>数据更新于 2026.09</span>
            </footer>
          </section>
        </main>
      </div>
    </Tooltip.Provider>
  );
}
