import { useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import {
  ArrowRight,
  Check,
  CircleHelp,
  Play,
  Plus,
  RotateCcw,
  Sparkles,
  X,
} from "lucide-react";
import {
  combatSlots,
  combatStats,
  dataProvenance,
  findFeasibleGcds,
  foods,
  gears,
  gameData,
  gearOptionsFor,
  isGearBaseStatAtCap,
  jobIds,
  jobSchemas,
  optimize,
  optimizeJoint,
  type Gear,
  type GearSlot,
  type JobId,
  type JointOptimizationConfig,
  type JointOptimizationResult,
  type OptimizationConfig,
  type OptimizationResult,
  type Stat,
} from "./domain";

const displayedDataVersion = dataProvenance.sources?.find((source) => source.kind === "mcp" && source.gameVersion)?.gameVersion ?? dataProvenance.commit.slice(0, 12);

type Page = "single" | "joint";
type CommonSlot = GearSlot;

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
  ring: "戒指1",
  ring2: "戒指2",
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

function searchMessageText(message: string): string {
  let text = message;
  const statuses = [
    ["Primal infeasible or unbounded", "无可行方案或有效边界"],
    ["Bound on objective reached", "达到目标边界"],
    ["Target for objective reached", "达到目标值"],
    ["Iteration limit reached", "达到迭代上限"],
    ["Time limit reached", "达到搜索时限"],
    ["Postsolve error", "结果还原失败"],
    ["Presolve error", "搜索预处理失败"],
    ["Model error", "搜索模型无效"],
    ["Solve error", "搜索失败"],
    ["Load error", "加载失败"],
    ["Not Set", "未初始化"],
    ["Infeasible", "无可行方案"],
    ["Unbounded", "无有效边界"],
    ["Optimal", "最优"],
    ["Unknown", "未知状态"],
    ["Empty", "没有候选"],
  ] as const;
  for (const [status, label] of statuses) text = text.replaceAll(status, label);
  for (const jobId of jobIds) {
    text = text.replace(new RegExp(`\\b${jobId}\\b`, "g"), jobSchemas[jobId].name);
  }
  for (const [stat, name] of Object.entries(statNames)) {
    text = text.replace(new RegExp(`\\b${stat}\\b`, "g"), name);
  }
  return text
    .replace(/V3/g, "联合搜索")
    .replace(/MIP|HiGHS/g, "求解器")
    .replace(/incumbent/g, "当前最优方案")
    .replace(/surrogate/g, "内部评分")
    .replace(/DPS|dps/g, "按 GCD 折算")
    .replace(/damage/g, "每威力伤害期望")
    .replace(/RSS/g, "内存")
    .replace(/maxSearchMs/g, "搜索时限")
    .replace(/cacheLimit/g, "缓存数量")
    .replace(/NaN/g, "无效数值")
    .replace(/Infinity/g, "无穷值");
}

function searchProgressText(message: string): string {
  if (message.includes("基线")) {
    const jobId = jobIds.find((id) => new RegExp(`\\b${id}\\b`).test(message));
    return `正在计算${jobId ? jobSchemas[jobId].name : "各职业"}的单独最优配装…`;
  }
  if (message.includes("最高坚韧")) return "正在优化最高坚韧方案…";
  if (message.includes("GCD") || message.includes("档位")) return searchMessageText(message);
  if (message.includes("incumbent")) return "已找到候选配装，正在确认最优结果…";
  return "正在核验候选配装与约束…";
}

const bounds = gears.reduce(
  ([min, max], gear) => [Math.min(min, gear.level), Math.max(max, gear.level)],
  [Number.POSITIVE_INFINITY, 0],
);
const availableFoods = foods.filter((food) => food.best && food.stats.VIT);
const defaultJobLevel = 100;
const defaultCommonSlots: CommonSlot[] = [
  "head",
  "body",
  "hands",
  "legs",
  "feet",
  "earrings",
  "necklace",
  "bracelet",
  "ring",
  "ring2",
];

function makeConfig(jobId: JobId): OptimizationConfig {
  return {
    jobId,
    minItemLevel: jobSchemas[jobId].defaultItemLevel?.[0] ?? Math.max(bounds[0], bounds[1] - 15),
    maxItemLevel: jobSchemas[jobId].defaultItemLevel?.[1] ?? bounds[1],
    jobLevel: jobSchemas[jobId].maxJobLevel ?? defaultJobLevel,
    syncLevel: undefined,
    gcdTarget: undefined,
    gcdChoices: undefined,
    speedMin: undefined,
    speedMax: undefined,
    minTenacity: undefined,
    toughnessMinPercent: undefined,
    maximizeTenacity: false,
    objective: "damage",
    excludedSources: [],
    excludedGearIds: [],
    forcedGear: {},
    sharedSlots: [],
    foodId: 0,
  };
}

function currentPage(): Page {
  return window.location.hash === "#/joint" ? "joint" : "single";
}

function statName(stat: string): string {
  return statNames[stat as Stat] ?? "未知属性";
}

function statValue(stat: string, value: number): string {
  return stat === "DLY" ? (value / 1000).toFixed(2) : value.toLocaleString();
}

function slotsForJob(jobId: JobId): GearSlot[] {
  return jobId === "PLD"
    ? combatSlots
    : combatSlots.filter((slot) => slot !== "offhand");
}

function setConfigPatch(
  setConfig: Dispatch<SetStateAction<OptimizationConfig>>,
  patch: Partial<OptimizationConfig>,
) {
  setConfig((current) => ({ ...current, ...patch }));
}

function Header({
  page,
  onReset,
}: {
  page: Page;
  onReset: () => void;
}) {
  return (
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
      <nav className="page-nav" aria-label="搜索页面">
        <a
          href="#/single"
          className={page === "single" ? "active" : ""}
          aria-current={page === "single" ? "page" : undefined}
        >
          单职业搜索
        </a>
        <a
          href="#/joint"
          className={page === "joint" ? "active" : ""}
          aria-current={page === "joint" ? "page" : undefined}
        >
          多职业联合搜索
        </a>
      </nav>
      <div className="topbar-meta">
        <span className="status-dot" />
        <span>数据版本 {displayedDataVersion}</span>
        <span className="vertical-rule" />
        <button
          className="icon-button"
          aria-label="重置当前页面配置"
          title="重置当前页面配置"
          onClick={onReset}
        >
          <RotateCcw size={17} />
        </button>
      </div>
    </header>
  );
}

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  unit,
  placeholder,
}: {
  label: string;
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  placeholder?: string;
}) {
  return (
    <label className="number-field">
      <span>{label}</span>
      <span className="number-input-wrap">
        <input
          type="number"
          value={value ?? ""}
          min={min}
          max={max}
          step={step}
          placeholder={placeholder}
          onChange={(event) =>
            onChange(event.target.value === "" ? undefined : Number(event.target.value))
          }
        />
        {unit && <em>{unit}</em>}
      </span>
    </label>
  );
}

function CheckControl({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="check-row">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="check-indicator">
        {checked && <Check size={12} strokeWidth={3} />}
      </span>
      <span>{children}</span>
    </label>
  );
}

function SelectField({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="config-field">
      <span className="field-label">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {children}
      </select>
    </label>
  );
}

function JobConfigFields({
  config,
  setConfig,
  showFood,
}: {
  config: OptimizationConfig;
  setConfig: Dispatch<SetStateAction<OptimizationConfig>>;
  showFood: boolean;
}) {
  const [sourceQuery, setSourceQuery] = useState("");
  const [equipmentQuery, setEquipmentQuery] = useState("");
  const [forcedSearch, setForcedSearch] = useState("");
  const [gcdChoicesText, setGcdChoicesText] = useState(
    config.gcdChoices?.join(", ") ?? "",
  );
  const [gcdChoicesDirty, setGcdChoicesDirty] = useState(false);
  const [feasibleGcds, setFeasibleGcds] = useState<number[]>();
  const [feasibleGcdsKey, setFeasibleGcdsKey] = useState<string>();
  const [findingGcds, setFindingGcds] = useState(false);
  const [gcdProgress, setGcdProgress] = useState("");
  const [gcdError, setGcdError] = useState<string>();
  const gcdAbortController = useRef<AbortController | undefined>(undefined);
  const [forcedSlot, setForcedSlot] = useState<GearSlot>(
    slotsForJob(config.jobId)[0] ?? "weapon",
  );

  useEffect(() => {
    if (!gcdChoicesDirty) setGcdChoicesText(config.gcdChoices?.join(", ") ?? "");
  }, [config.gcdChoices, gcdChoicesDirty]);
  useEffect(() => () => {
    gcdAbortController.current?.abort();
  }, []);

  const jobGears = useMemo(
    () => [...new Map(slotsForJob(config.jobId).flatMap(slot =>
      gearOptionsFor({ ...config, excludedSources: [], excludedGearIds: [], forcedGear: {} }, slot),
    ).map(gear => [gear.id, gear])).values()],
    [config],
  );
  const sourceOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const gear of jobGears) {
      if (gear.source) counts.set(gear.source, (counts.get(gear.source) ?? 0) + 1);
    }
    return [...counts.entries()]
      .filter(([source]) => source.toLowerCase().includes(sourceQuery.toLowerCase()))
      .sort((first, second) => second[1] - first[1]);
  }, [jobGears, sourceQuery]);

  const activeGears = useMemo(
    () =>
      jobGears.filter(
        (gear) =>
          !config.excludedSources.some((source) => gear.source?.startsWith(source)),
      ),
    [jobGears, config.excludedSources],
  );
  const forceSuggestions = activeGears
    .filter((gear) => gear.slot === (forcedSlot === "ring2" ? "ring" : forcedSlot))
    .filter((gear) => {
      const query = forcedSearch.trim().toLowerCase();
      return (
        !query ||
        gear.name.toLowerCase().includes(query) ||
        String(gear.id).includes(query)
      );
    })
    .slice(0, 8);
  const excludeSuggestions = activeGears
    .filter((gear) => {
      const query = equipmentQuery.trim().toLowerCase();
      return (
        !query ||
        gear.name.toLowerCase().includes(query) ||
        String(gear.id).includes(query)
      );
    })
    .filter((gear) => !(config.excludedGearIds ?? []).includes(gear.id))
    .slice(0, 8);
  const forcedGearEntries = Object.entries(config.forcedGear)
    .filter(([, id]) => id !== undefined)
    .map(([slot, id]) => ({
      slot: slot as GearSlot,
      id: id as number,
      gear: gears.find((item) => item.id === id),
    }));
  const excludedGears = (config.excludedGearIds ?? [])
    .map((id) => gears.find((gear) => gear.id === id))
    .filter((gear): gear is Gear => gear !== undefined);
  const availableSlots = slotsForJob(config.jobId);
  const gcdMode = config.gcdChoices !== undefined
    ? "multiple"
    : config.gcdTarget === undefined
      ? "any"
      : "single";
  const gcdQueryKey = JSON.stringify({
    ...config,
    gcdTarget: undefined,
    gcdChoices: undefined,
  });
  const gcdSelectionReady =
    feasibleGcdsKey === gcdQueryKey && feasibleGcds !== undefined;
  const speedStatName =
    jobSchemas[config.jobId].role === "healer" ||
    jobSchemas[config.jobId].role === "int"
      ? "咏速"
      : "技速";

  function update<K extends keyof OptimizationConfig>(
    key: K,
    value: OptimizationConfig[K],
  ) {
    setConfig((current) => ({ ...current, [key]: value }));
  }

  function setGcdMode(mode: string) {
    if (mode === "any") {
      setConfigPatch(setConfig, { gcdTarget: undefined, gcdChoices: undefined });
      setGcdChoicesText("");
      setGcdChoicesDirty(false);
    } else if (mode === "single") {
      setConfigPatch(setConfig, {
        gcdTarget: config.gcdChoices?.[0] ?? 2.5,
        gcdChoices: undefined,
      });
      setGcdChoicesText("");
      setGcdChoicesDirty(false);
    } else {
      setConfigPatch(setConfig, {
        gcdTarget: undefined,
        gcdChoices: config.gcdTarget === undefined ? [2.5] : [config.gcdTarget],
      });
      setGcdChoicesText(
        config.gcdTarget === undefined ? "2.5" : String(config.gcdTarget),
      );
      setGcdChoicesDirty(false);
    }
  }

  function setGcdChoices(text: string) {
    setGcdChoicesText(text);
    setGcdChoicesDirty(true);
    const choices = [...new Set(
      text
        .split(",")
        .map((value) => Number(value.trim()))
        .filter((value) => Number.isFinite(value) && value > 0),
    )];
    update("gcdChoices", choices);
  }

  async function calculateFeasibleGcds() {
    gcdAbortController.current?.abort();
    const controller = new AbortController();
    gcdAbortController.current = controller;
    setFindingGcds(true);
    setGcdProgress("正在查询可行档位…");
    setGcdError(undefined);
    try {
      const choices = await findFeasibleGcds(config, {
        signal: controller.signal,
        onProgress: (message) => setGcdProgress(searchProgressText(message)),
      });
      setFeasibleGcds(choices);
      setFeasibleGcdsKey(gcdQueryKey);
      setGcdProgress("查询完成。");
    } catch (caught) {
      if (controller.signal.aborted) {
        setGcdProgress("查询已取消。");
      } else {
        setGcdError(searchMessageText(caught instanceof Error ? caught.message : String(caught)));
        setGcdProgress("");
      }
    } finally {
      if (gcdAbortController.current === controller) {
        gcdAbortController.current = undefined;
      }
      setFindingGcds(false);
    }
  }

  function selectSingleFeasibleGcd(gcd: number) {
    setConfigPatch(setConfig, { gcdTarget: gcd, gcdChoices: undefined });
    setGcdChoicesText("");
    setGcdChoicesDirty(false);
  }

  function toggleFeasibleGcd(gcd: number, checked: boolean) {
    const choices = new Set(config.gcdChoices ?? []);
    if (checked) choices.add(gcd);
    else choices.delete(gcd);
    const sorted = [...choices].sort((first, second) => second - first);
    setConfigPatch(setConfig, {
      gcdTarget: undefined,
      gcdChoices: sorted,
    });
    setGcdChoicesText(sorted.join(", "));
    setGcdChoicesDirty(false);
  }

  function forceGear(gear: Gear) {
    setConfig((current) => ({
      ...current,
      forcedGear: { ...current.forcedGear, [forcedSlot]: gear.id },
      excludedGearIds: (current.excludedGearIds ?? []).filter((id) => id !== gear.id),
    }));
    setForcedSearch("");
  }

  function excludeGear(gear: Gear) {
    setConfig((current) => {
      const forcedGear = { ...current.forcedGear };
      for (const [slot, id] of Object.entries(forcedGear)) {
        if (id === gear.id) delete forcedGear[slot as GearSlot];
      }
      return {
        ...current,
        forcedGear,
        excludedGearIds: [...(current.excludedGearIds ?? []), gear.id],
      };
    });
    setEquipmentQuery("");
  }

  return (
    <div className="job-fields">
      <div className="field-grid two">
        <SelectField
          label="职业等级"
          value={String(config.jobLevel ?? jobSchemas[config.jobId].maxJobLevel ?? defaultJobLevel)}
          onChange={(value) => update("jobLevel", Number(value))}
        >
          {Object.keys(gameData.jobLevelModifiers).map(Number).filter(level => level <= (jobSchemas[config.jobId].maxJobLevel ?? 100)).sort((a, b) => a - b).map(level => <option key={level} value={level}>{level} 级</option>)}
        </SelectField>
        <NumberField
          label="同步品级"
          value={config.syncLevel}
          min={1}
          max={bounds[1]}
          placeholder="不启用"
          onChange={(value) => update("syncLevel", value)}
        />
      </div>
      <div className="field-grid two">
        <NumberField
          label="最低装备品级"
          value={config.minItemLevel}
          min={bounds[0]}
          max={config.maxItemLevel}
          onChange={(value) =>
            update("minItemLevel", Math.min(value ?? bounds[0], config.maxItemLevel))
          }
        />
        <NumberField
          label="最高装备品级"
          value={config.maxItemLevel}
          min={config.minItemLevel}
          max={bounds[1]}
          onChange={(value) =>
            update("maxItemLevel", Math.max(value ?? bounds[1], config.minItemLevel))
          }
        />
      </div>

      {jobSchemas[config.jobId].ignoreWeaponItemLevel && <p className="field-hint">武器不按装备品级区间筛选，仍须满足职业与穿戴等级限制。</p>}
      <div className="config-section">
        <div className="field-label with-help">
          <span>GCD 约束</span>
          <span title="可以接受一个 GCD 档位，也可以给出多个可接受档位。">
            <CircleHelp size={14} />
          </span>
        </div>
        <select
          aria-label="GCD 约束类型"
          value={gcdMode}
          onChange={(event) => setGcdMode(event.target.value)}
        >
          <option value="any">不限</option>
          <option value="single">指定一个档位</option>
          <option value="multiple">接受多个档位</option>
        </select>
        {gcdMode === "single" && (
          <NumberField
            label="目标 GCD"
            value={config.gcdTarget}
            min={1}
            max={5}
            step={0.01}
            unit="秒"
            onChange={(value) => update("gcdTarget", value)}
          />
        )}
        {gcdMode === "multiple" && (
          <label className="number-field">
            <span>可接受的 GCD 档位</span>
            <input
              type="text"
              value={gcdChoicesText}
              placeholder="例如 2.48, 2.50"
              onChange={(event) => setGcdChoices(event.target.value)}
            />
            <small>使用逗号分隔，每个档位都作为独立约束参与搜索。</small>
          </label>
        )}
        <button
          type="button"
          className="gcd-calculate-button"
          onClick={findingGcds ? () => gcdAbortController.current?.abort() : calculateFeasibleGcds}
        >
          {findingGcds ? <X size={14} /> : <CircleHelp size={14} />}
          {findingGcds ? "取消查询" : "计算可行 GCD 档位"}
        </button>
        {gcdProgress && <span className="gcd-result-note">{gcdProgress}</span>}
        {gcdError && <span className="gcd-query-error">{gcdError}</span>}
        {gcdSelectionReady && (
          <div className="feasible-gcd-panel">
            <div className="feasible-gcd-heading">
              <span>找到 {feasibleGcds.length} 个可行档位</span>
              {feasibleGcds.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    const sorted = [...feasibleGcds].sort((first, second) => second - first);
                    setConfigPatch(setConfig, { gcdTarget: undefined, gcdChoices: sorted });
                    setGcdChoicesText(sorted.join(", "));
                    setGcdChoicesDirty(false);
                  }}
                >
                  全部设为多档
                </button>
              )}
            </div>
            {feasibleGcds.length > 0 ? (
              <div className="feasible-gcd-list">
                {feasibleGcds.map((gcd) => (
                  <div className="feasible-gcd-option" key={gcd}>
                    <button
                      type="button"
                      className={config.gcdTarget === gcd ? "selected" : ""}
                      onClick={() => selectSingleFeasibleGcd(gcd)}
                    >
                      {gcd.toFixed(2)} 秒
                    </button>
                    <CheckControl
                      checked={(config.gcdChoices ?? []).includes(gcd)}
                      onChange={(checked) => toggleFeasibleGcd(gcd, checked)}
                    >
                      <span className="sr-only">加入多档</span>
                    </CheckControl>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted">当前约束下没有可行 GCD 档位。</p>
            )}
          </div>
        )}
      </div>

      <div className="config-section">
        <div className="field-label">{speedStatName}范围</div>
        <div className="field-grid two">
          <NumberField
            label={"最低" + speedStatName}
            value={config.speedMin}
            min={0}
            onChange={(value) => update("speedMin", value)}
          />
          <NumberField
            label={"最高" + speedStatName}
            value={config.speedMax}
            min={0}
            onChange={(value) => update("speedMax", value)}
          />
        </div>
      </div>

      <div className="config-section">
        <div className="field-label">魔晶石规则</div>
        <p className="field-hint">
          所有可用孔位均会镶满；可禁断装备按规则搜索满五孔方案，等级同步时遵循同步后的孔位限制。
        </p>
      </div>

      {jobSchemas[config.jobId].role === "tank" && <div className="config-section">
        <div className="field-label">坚韧约束</div>
        <div className="field-grid two">
          <NumberField
            label="最低坚韧值"
            value={config.minTenacity}
            min={0}
            onChange={(value) => update("minTenacity", value)}
          />
          <NumberField
            label="最低减伤"
            value={config.toughnessMinPercent}
            min={0}
            max={100}
            step={0.1}
            unit="%"
            onChange={(value) => update("toughnessMinPercent", value)}
          />
        </div>
        <CheckControl
          checked={config.maximizeTenacity}
          onChange={(checked) => update("maximizeTenacity", checked)}
        >
          达到当前候选范围内的最高坚韧值
        </CheckControl>
      </div>}

      {showFood && (
        <SelectField
          label="食物"
          value={String(config.foodId)}
          onChange={(value) => update("foodId", Number(value))}
        >
          <option value="0">自动选择</option>
          {availableFoods.map((food) => (
            <option key={food.id} value={food.id}>
              {food.name}
            </option>
          ))}
        </SelectField>
      )}

      <details className="restriction-details">
        <summary>
          来源限制
          <span>{config.excludedSources.length} 项已排除</span>
        </summary>
        <input
          type="search"
          value={sourceQuery}
          placeholder="搜索装备来源"
          onChange={(event) => setSourceQuery(event.target.value)}
        />
        <div className="source-options">
          {sourceOptions.map(([source, count]) => (
            <CheckControl
              key={source}
              checked={config.excludedSources.includes(source)}
              onChange={(checked) =>
                update(
                  "excludedSources",
                  checked
                    ? [...config.excludedSources, source]
                    : config.excludedSources.filter((item) => item !== source),
                )
              }
            >
              <span>{source}</span>
              <em>{count}</em>
            </CheckControl>
          ))}
          {!sourceOptions.length && <p className="muted">没有匹配的来源。</p>}
        </div>
      </details>

      <details className="restriction-details">
        <summary>
          装备限制
          <span>
            {forcedGearEntries.length} 件强制 · {excludedGears.length} 件排除
          </span>
        </summary>
        <div className="restriction-block">
          <strong>强制使用装备</strong>
          <div className="picker-row">
            <select
              aria-label="选择装备部位"
              value={forcedSlot}
              onChange={(event) => {
                setForcedSlot(event.target.value as GearSlot);
                setForcedSearch("");
              }}
            >
              {availableSlots.map((slot) => (
                <option key={slot} value={slot}>
                  {slotLabels[slot]}
                </option>
              ))}
            </select>
            <input
              type="search"
              value={forcedSearch}
              placeholder="按名称或编号搜索"
              onChange={(event) => setForcedSearch(event.target.value)}
            />
          </div>
          {forcedSearch && (
            <div className="suggestions">
              {forceSuggestions.map((gear) => (
                <button type="button" key={gear.id} onClick={() => forceGear(gear)}>
                  <span>{gear.name}</span>
                  <small>品级 {gear.level} · 编号 {gear.id}</small>
                </button>
              ))}
              {!forceSuggestions.length && <p>没有匹配装备。</p>}
            </div>
          )}
          <div className="restriction-tags">
            {forcedGearEntries.map(({ slot, id, gear }) => (
              <span className="restriction-tag" key={slot}>
                {slotLabels[slot]} · {gear?.name ?? "装备 " + id}
                <button
                  type="button"
                  aria-label={"移除强制装备 " + (gear?.name ?? id)}
                  onClick={() =>
                    setConfig((current) => {
                      const forcedGear = { ...current.forcedGear };
                      delete forcedGear[slot];
                      return { ...current, forcedGear };
                    })
                  }
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        </div>
        <div className="restriction-block">
          <strong>排除具体装备</strong>
          <input
            type="search"
            value={equipmentQuery}
            placeholder="按名称或编号搜索"
            onChange={(event) => setEquipmentQuery(event.target.value)}
          />
          {equipmentQuery && (
            <div className="suggestions">
              {excludeSuggestions.map((gear) => (
                <button type="button" key={gear.id} onClick={() => excludeGear(gear)}>
                  <span>{gear.name}</span>
                  <small>{slotLabels[gear.slot]} · 品级 {gear.level}</small>
                </button>
              ))}
              {!excludeSuggestions.length && <p>没有匹配装备。</p>}
            </div>
          )}
          <div className="restriction-tags">
            {excludedGears.map((gear) => (
              <span className="restriction-tag" key={gear.id}>
                {gear.name}
                <button
                  type="button"
                  aria-label={"恢复装备 " + gear.name}
                  onClick={() =>
                    update(
                      "excludedGearIds",
                      (config.excludedGearIds ?? []).filter((id) => id !== gear.id),
                    )
                  }
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        </div>
      </details>
    </div>
  );
}

function StatusPanel({
  running,
  progress,
  error,
  message,
  onCancel,
}: {
  running: boolean;
  progress: string;
  error?: string;
  message?: string;
  onCancel: () => void;
}) {
  if (!running && !error && !message) return null;
  return (
    <div
      className={"search-status " + (error ? "has-error" : running ? "is-running" : "")}
      role={error ? "alert" : "status"}
      aria-live="polite"
    >
      <div className="search-status-copy">
        <span className="status-dot" />
        <div>
          <strong>{error ? "搜索失败" : running ? "正在搜索" : "搜索状态"}</strong>
          <p>{error ?? (running ? progress : message ?? progress)}</p>
        </div>
      </div>
      {running && (
        <button className="cancel-button" onClick={onCancel}>
          <X size={14} />
          取消搜索
        </button>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className={"stat-pill " + (accent ? "accent" : "")}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function GearTable({
  result,
  config,
}: {
  result: OptimizationResult;
  config: OptimizationConfig;
}) {
  const displaySlots: GearSlot[] = [
    "weapon", "offhand", "head", "body", "hands", "legs", "feet",
    "earrings", "necklace", "bracelet", "ring", "ring2",
  ];
  return (
    <div className="gear-table">
      <div className="gear-table-head">
        <span>部位</span>
        <span>装备</span>
        <span>实际属性</span>
        <span>魔晶石</span>
        <span>来源</span>
        <span>品级</span>
      </div>
      {displaySlots.map((slot) => {
        const item = result.gear.find((gear) => gear.slot === slot);
        if (!item) return null;
        const isForced = config.forcedGear[item.slot] === item.id;
        return (
          <div className="gear-row" key={item.slot + "-" + item.id}>
            <div className="slot-cell">
              <span className="slot-icon">{slotLabels[item.slot].slice(0, 1)}</span>
              <span>{slotLabels[item.slot]}</span>
            </div>
            <strong>{item.name}</strong>
            <div className="gear-stats">
              {Object.entries(item.finalStats)
                .filter(([, value]) => value !== undefined && value > 0)
                .map(([stat, value]) => {
                  const isCapped =
                    combatStats.includes(stat as (typeof combatStats)[number]) &&
                    isGearBaseStatAtCap(item, stat as Stat);
                  return (
                    <span
                      key={stat}
                      className={"gear-stat" + (isCapped ? " at-cap" : "")}
                    >
                      {statName(stat)} {statValue(stat, value)}
                    </span>
                  );
                })}
            </div>
            <div className="melds">
              {item.melds.length ? (
                item.melds.map((meld, index) => (
                  <span className="meld" key={meld.stat + "-" + index}>
                    {statName(meld.stat)} +{meld.value}
                  </span>
                ))
              ) : (
                <span className="muted">无镶嵌</span>
              )}
              {isForced && <span className="locked">已锁定</span>}
            </div>
            <span className="source-text">{item.source ?? "上游未标注"}</span>
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
            .map(([key, value]) => statName(key) + " " + value)
            .join(" · ")}
        </div>
        <div className="melds">
          <span className="food-bonus">食物加成</span>
        </div>
        <span className="source-text">上游食物数据</span>
        <span className="level-tag">{result.food.level}</span>
      </div>
    </div>
  );
}

function ResultPanel({
  result,
  config,
  baseline,
  attempted = false,
  failed = false,
}: {
  result?: OptimizationResult;
  config: OptimizationConfig;
  baseline?: OptimizationResult;
  attempted?: boolean;
  failed?: boolean;
}) {
  if (!result) {
    return (
      <div className="empty-state">
        <div className="empty-icon">
          {attempted ? <X size={19} /> : <Play size={19} />}
        </div>
        <h2>{failed ? "搜索未完成" : attempted ? "没有可行配装" : "尚未搜索"}</h2>
        <p>
          {failed
            ? "请查看上方错误信息，修正条件后重新搜索。"
            : attempted
              ? "当前约束下没有可行结果，请放宽限制后重试。"
              : "设置搜索条件后，点击“开始搜索”生成结果。"}
        </p>
      </div>
    );
  }
  const damagePerSecond =
    result.damagePerSecond ?? result.effects.damage / result.effects.gcd;
  const ratio =
    baseline && baseline.score > 0
      ? ((result.score / baseline.score) * 100).toFixed(4) + "%"
      : undefined;
  return (
    <>
      <div className="metric-strip">
        <Metric
          label="每威力伤害期望"
          value={result.effects.damage.toFixed(7)}
          accent
        />
        <Metric label="GCD" value={result.effects.gcd.toFixed(2) + " 秒"} />
        <Metric label="暴击率" value={(result.effects.crtChance * 100).toFixed(1) + "%"} />
        <Metric label="直击率" value={(result.effects.dhtChance * 100).toFixed(1) + "%"} />
        <Metric label="按 GCD 折算" value={damagePerSecond.toFixed(7)} />
      </div>
      <div className="result-toolbar">
        <div>
          <h2>推荐配装</h2>
          <span className="muted">
            目标值 {result.score.toFixed(7)}
            {ratio ? " · 单职业基线比例 " + ratio : ""}
            {" · " + result.searchedCandidates.toLocaleString() + " 个候选 · "}
            {result.durationMs.toFixed(0)} 毫秒
          </span>
        </div>
        {result.maximumTenacity !== undefined && (
          <span className="compute-chip">
            最高坚韧 {result.maximumTenacity.toLocaleString()}
          </span>
        )}
      </div>
      <GearTable result={result} config={config} />

      <div className="result-section">
        <div className="result-toolbar">
          <div>
            <h2>配装总属性</h2>
            <span className="muted">已计入食物比例加成与装备魔晶石</span>
          </div>
        </div>
        <div className="stats-grid">
          {Object.entries(result.stats)
            .filter(([, value]) => value && value > 0)
            .map(([stat, value]) => (
              <div className="stat-card" key={stat}>
                <span>{statName(stat)}</span>
                <strong>{statValue(stat, value)}</strong>
                <div className="stat-bar">
                  <i style={{ width: Math.min(100, Number(value) / 35) + "%" }} />
                </div>
              </div>
            ))}
        </div>
        <div className="effect-summary">
          <div>
            <span>坚韧伤害</span>
            <strong>{(result.effects.tenDamage * 100).toFixed(2)}%</strong>
          </div>
          <div>
            <span>坚韧减伤</span>
            <strong>{(result.effects.tenMitigation * 100).toFixed(2)}%</strong>
          </div>
          <div>
            <span>生命值</span>
            <strong>{result.effects.hp.toLocaleString()}</strong>
          </div>
          <div>
            <span>每3秒魔力恢复</span>
            <strong>{result.effects.mp.toLocaleString()}</strong>
          </div>
        </div>
      </div>
    </>
  );
}

function SearchButton({
  running,
  onSearch,
  onCancel,
}: {
  running: boolean;
  onSearch: () => void;
  onCancel: () => void;
}) {
  return (
    <button
      className={"run-button " + (running ? "is-running" : "")}
      onClick={running ? onCancel : onSearch}
      disabled={false}
    >
      {running ? <X size={16} /> : <Play size={16} fill="currentColor" />}
      {running ? "取消搜索" : "开始搜索"}
      {!running && <span className="run-shortcut">↵</span>}
    </button>
  );
}

function SinglePage() {
  const [config, setConfig] = useState<OptimizationConfig>(() => makeConfig("SAM"));
  const [result, setResult] = useState<OptimizationResult>();
  const [resultConfig, setResultConfig] = useState<OptimizationConfig>();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string>();
  const [statusMessage, setStatusMessage] = useState<string>();
  const [resultKey, setResultKey] = useState<string>();
  const [hasAttempted, setHasAttempted] = useState(false);
  const abortController = useRef<AbortController | undefined>(undefined);
  const currentKey = JSON.stringify(config);
  const stale = result !== undefined && resultKey !== currentKey;
  const job = jobSchemas[config.jobId];

  useEffect(() => () => {
    abortController.current?.abort();
  }, []);

  async function runSearch() {
    abortController.current?.abort();
    const controller = new AbortController();
    abortController.current = controller;
    setRunning(true);
    setProgress("正在准备候选装备…");
    setError(undefined);
    setStatusMessage(undefined);
    setHasAttempted(true);
    setResult(undefined);
    setResultKey(undefined);
    try {
      const searchResult = await optimize(config, {
        signal: controller.signal,
        onProgress: (message) => setProgress(searchProgressText(message)),
      });
      setResult(searchResult);
      if (searchResult) { setResultKey(currentKey); setResultConfig(config); }
      setStatusMessage(
        searchResult
          ? "搜索已完成。"
          : "当前约束下没有可行配装，请调整条件后重试。",
      );
    } catch (caught) {
      if (controller.signal.aborted) {
        setHasAttempted(false);
        setStatusMessage("搜索已取消。");
      } else {
        setError(searchMessageText(caught instanceof Error ? caught.message : String(caught)));
      }
    } finally {
      if (abortController.current === controller) abortController.current = undefined;
      setRunning(false);
      setProgress("");
    }
  }

  function cancelSearch() {
    abortController.current?.abort();
  }

  function reset() {
    cancelSearch();
    setConfig(makeConfig("SAM"));
    setResult(undefined);
    setError(undefined);
    setStatusMessage(undefined);
    setResultKey(undefined);
    setHasAttempted(false);
  }

  return (
    <main className="workspace">
      <aside className="sidebar">
        <div className="section-kicker">单职业搜索</div>
        <div className="sidebar-title">优化配置</div>
        <SelectField
          label="职业"
          value={config.jobId}
          onChange={(value) => setConfig(makeConfig(value as JobId))}
        >
          {jobIds.map((id) => (
            <option key={id} value={id}>
              {jobSchemas[id].name}
            </option>
          ))}
        </SelectField>
        <JobConfigFields config={config} setConfig={setConfig} showFood />
        <SelectField
          label="优化目标"
          value={config.objective ?? "damage"}
          onChange={(value) =>
            setConfig((current) => ({
              ...current,
              objective: value as "damage" | "dps",
            }))
          }
        >
          <option value="damage">每威力伤害期望</option>
          <option value="dps">按 GCD 折算</option>
        </SelectField>
        <SearchButton running={running} onSearch={runSearch} onCancel={cancelSearch} />
      </aside>

      <section className="main-panel">
        <div className="content-head">
          <div>
            <div className="section-kicker">单职业优化结果</div>
            <h1>{job.name} · 配装搜索</h1>
            <p className="head-caption">
              {config.minItemLevel} — {config.maxItemLevel} 品级
              {config.syncLevel ? " · 同步品级 " + config.syncLevel : ""}
              {" · 等级 " + config.jobLevel}
            </p>
          </div>
          <div className="head-actions">
            <span className="compute-chip">
              <span className="status-dot" />
              {running ? "搜索中" : "手动启动"}
            </span>
          </div>
        </div>
        {stale && (
          <div className="stale-notice">
            配置已修改，当前显示的是上一组配置的结果。点击“开始搜索”更新。
          </div>
        )}
        <StatusPanel
          running={running}
          progress={progress}
          error={error}
          message={statusMessage}
          onCancel={cancelSearch}
        />
        {!running && <ResultPanel
          result={result}
          config={resultConfig ?? config}
          attempted={hasAttempted}
          failed={error !== undefined}
        />}
        <footer className="footer">
          <span>搜索规则 · {job.name}</span>
          <span>纯前端计算 · 可离线运行</span>
          <span>数据版本 {displayedDataVersion}</span>
        </footer>
      </section>
    </main>
  );
}

function JointPage() {
  const [jobConfigs, setJobConfigs] = useState<Record<string, OptimizationConfig>>({
    RDM: makeConfig("RDM"),
    BLM: makeConfig("BLM"),
  });
  const [jobList, setJobList] = useState<JobId[]>(["RDM", "BLM"]);
  const [commonSlots, setCommonSlots] = useState<CommonSlot[]>(defaultCommonSlots);
  const [foodStrategy, setFoodStrategy] = useState<"shared" | "independent">("shared");
  const [objective, setObjective] = useState<"damage" | "dps">("damage");
  const [addingJob, setAddingJob] = useState<JobId>("WHM");
  const [result, setResult] = useState<JointOptimizationResult>();
  const [resultConfig, setResultConfig] = useState<JointOptimizationConfig>();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string>();
  const [statusMessage, setStatusMessage] = useState<string>();
  const [resultKey, setResultKey] = useState<string>();
  const [hasAttempted, setHasAttempted] = useState(false);
  const abortController = useRef<AbortController | undefined>(undefined);
  const currentConfig: JointOptimizationConfig = {
    jobs: jobList.map((jobId) => ({
      ...(jobConfigs[jobId] ?? makeConfig(jobId)),
      objective,
    })),
    commonSlots,
    foodStrategy,
    objective,
  };
  const currentKey = JSON.stringify(currentConfig);
  const stale = result !== undefined && resultKey !== currentKey;
  const slotOptions = useMemo(() => {
    if (!jobList.length) return [];
    const supported = new Set(slotsForJob(jobList[0]));
    for (const jobId of jobList.slice(1)) {
      const current = new Set(slotsForJob(jobId));
      for (const slot of supported) if (!current.has(slot)) supported.delete(slot);
    }
    return [
      ...supported,
    ];
  }, [jobList]);
  const availableJobs = jobIds.filter((jobId) => !jobList.includes(jobId));

  useEffect(() => () => {
    abortController.current?.abort();
  }, []);

  function addJob() {
    if (jobList.includes(addingJob)) return;
    const nextJobs = [...jobList, addingJob];
    setJobList(nextJobs);
    setAddingJob(jobIds.find((jobId) => !nextJobs.includes(jobId)) ?? nextJobs[0]);
    setJobConfigs((current) => ({
      ...current,
      [addingJob]: current[addingJob] ?? makeConfig(addingJob),
    }));
    const supported = new Set(slotsForJob(addingJob));
    setCommonSlots((current) =>
      current.filter((slot) => supported.has(slot)),
    );
  }

  function removeJob(jobId: JobId) {
    if (jobList.length <= 2) return;
    const nextJobs = jobList.filter((item) => item !== jobId);
    setJobList(nextJobs);
    const supported = new Set(slotsForJob(nextJobs[0]));
    for (const nextJob of nextJobs.slice(1)) {
      const current = new Set(slotsForJob(nextJob));
      for (const slot of supported) if (!current.has(slot)) supported.delete(slot);
    }
    setCommonSlots((current) =>
      current.filter((slot) => supported.has(slot)),
    );
  }

  function updateJobConfig(jobId: JobId, next: OptimizationConfig) {
    setJobConfigs((current) => ({ ...current, [jobId]: next }));
  }

  function toggleCommonSlot(slot: CommonSlot) {
    setCommonSlots((current) =>
      current.includes(slot)
        ? current.filter((item) => item !== slot)
        : [...current, slot],
    );
  }

  async function runSearch() {
    if (jobList.length < 2) {
      setError("联合搜索至少需要选择两个职业。");
      return;
    }
    abortController.current?.abort();
    const controller = new AbortController();
    abortController.current = controller;
    setRunning(true);
    setProgress("正在准备所有职业的候选装备…");
    setError(undefined);
    setStatusMessage(undefined);
    setHasAttempted(true);
    setResult(undefined);
    setResultKey(undefined);
    try {
      const searchResult = await optimizeJoint(currentConfig, {
        signal: controller.signal,
        onProgress: (message) => setProgress(searchProgressText(message)),
      });
      setResult(searchResult);
      if (searchResult) { setResultKey(currentKey); setResultConfig(currentConfig); }
      setStatusMessage(
        searchResult
          ? "联合搜索已完成。"
          : "当前约束下没有满足条件的联合配装，请调整条件后重试。",
      );
    } catch (caught) {
      if (controller.signal.aborted) {
        setHasAttempted(false);
        setStatusMessage("联合搜索已取消。");
      } else {
        setError(searchMessageText(caught instanceof Error ? caught.message : String(caught)));
      }
    } finally {
      if (abortController.current === controller) abortController.current = undefined;
      setRunning(false);
      setProgress("");
    }
  }

  function cancelSearch() {
    abortController.current?.abort();
  }

  function reset() {
    cancelSearch();
    setJobList(["RDM", "BLM"]);
    setJobConfigs({ RDM: makeConfig("RDM"), BLM: makeConfig("BLM") });
    setCommonSlots(defaultCommonSlots);
    setFoodStrategy("shared");
    setObjective("damage");
    setResult(undefined);
    setError(undefined);
    setStatusMessage(undefined);
    setResultKey(undefined);
    setHasAttempted(false);
  }

  const jointCompleted = result?.proof?.complete === true;
  const commonGear = result?.commonGear ?? {};

  return (
    <main className="workspace joint-workspace">
      <aside className="sidebar joint-sidebar">
        <div className="section-kicker">多职业联合搜索</div>
        <div className="sidebar-title">联合配置</div>
        <div className="field-label">参与职业</div>
        <div className="selected-jobs">
          {jobList.map((jobId) => (
            <span className="job-chip" key={jobId}>
              {jobSchemas[jobId].name}
              <button
                type="button"
                disabled={jobList.length <= 2}
                aria-label={"移除" + jobSchemas[jobId].name}
                onClick={() => removeJob(jobId)}
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
        <div className="picker-row job-adder">
          <select
            value={addingJob}
            onChange={(event) => setAddingJob(event.target.value as JobId)}
            aria-label="添加职业"
          >
            {availableJobs.map((jobId) => (
              <option key={jobId} value={jobId}>
                {jobSchemas[jobId].name}
              </option>
            ))}
          </select>
          <button type="button" className="small-action" onClick={addJob} disabled={!availableJobs.length}>
            <Plus size={14} />
            添加职业
          </button>
        </div>

        <div className="config-section">
          <div className="field-label">公共共享部位</div>
          <p className="field-hint">相同部位必须使用同一装备及属性方案。</p>
          <div className="shared-slot-list">
            {(["weapon", "offhand", "head", "earrings", "body", "necklace", "hands", "bracelet", "legs", "ring", "feet", "ring2"] as GearSlot[]).map((slot) => (
              <div key={slot} aria-hidden={slotOptions.includes(slot) ? undefined : true}>
                {slotOptions.includes(slot) && (
                  <CheckControl
                    checked={commonSlots.includes(slot)}
                    onChange={() => toggleCommonSlot(slot)}
                  >
                    {slotLabels[slot]}
                  </CheckControl>
                )}
              </div>
            ))}
          </div>
        </div>

        <SelectField
          label="食物策略"
          value={foodStrategy}
          onChange={(value) => setFoodStrategy(value as "shared" | "independent")}
        >
          <option value="shared">全职业共用食物</option>
          <option value="independent">各职业独立选择食物</option>
        </SelectField>
        <SelectField
          label="联合目标"
          value={objective}
          onChange={(value) => setObjective(value as "damage" | "dps")}
        >
          <option value="damage">每威力伤害期望</option>
          <option value="dps">按 GCD 折算</option>
        </SelectField>
        <SearchButton running={running} onSearch={runSearch} onCancel={cancelSearch} />
      </aside>

      <section className="main-panel">
        <div className="content-head">
          <div>
            <div className="section-kicker">完整候选联合搜索</div>
            <h1>多职业联合配装</h1>
            <p className="head-caption">
              每个职业单独配置等级、限制和目标档位；联合搜索同时计算各职业基线。
            </p>
          </div>
          {result && (
            <div className="head-actions">
              <span className={"completion-chip " + (jointCompleted ? "complete" : "incomplete")}>
                <span className="status-dot" />
                {jointCompleted ? "搜索已完成" : "未完成证明"}
              </span>
            </div>
          )}
        </div>

        {stale && (
          <div className="stale-notice">
            配置已修改，当前结果对应上一组设置。点击“开始搜索”更新。
          </div>
        )}
        <StatusPanel
          running={running}
          progress={progress}
          error={error}
          message={statusMessage}
          onCancel={cancelSearch}
        />

        <div className="job-config-list">
          {jobList.map((jobId, index) => (
            <details className="job-config-card" key={jobId} open={index === 0}>
              <summary>
                <span>
                  <strong>{jobSchemas[jobId].name}</strong>
                  <small>
                    等级 {jobConfigs[jobId]?.jobLevel ?? defaultJobLevel} · 品级{" "}
                    {jobConfigs[jobId]?.minItemLevel ?? bounds[0]}–{jobConfigs[jobId]?.maxItemLevel ?? bounds[1]}
                  </small>
                </span>
                <span className="summary-chevron">⌄</span>
              </summary>
              <div className="job-config-card-body">
                <JobConfigFields
                  config={jobConfigs[jobId] ?? makeConfig(jobId)}
                  setConfig={(action) =>
                    setJobConfigs((current) => ({
                      ...current,
                      [jobId]:
                        typeof action === "function"
                          ? action(current[jobId] ?? makeConfig(jobId))
                          : action,
                    }))
                  }
                  showFood={true}
                />
              </div>
            </details>
          ))}
        </div>

        {result && (
          <>
            <div className="joint-score-card">
              <div>
                <div className="section-kicker">联合总分</div>
                <strong>{result.value.approximate.toFixed(8)}</strong>
                <span>
                  有理数 {result.value.numerator} / {result.value.denominator}
                </span>
              </div>
              <div className="joint-score-meta">
                <span>{jointCompleted ? "候选空间搜索已完成" : "搜索未完成"}</span>
                <span>
                  {result.statistics.elapsedMs.toFixed(0)} 毫秒 ·{" "}
                  {result.statistics.completeNodes.toLocaleString()} 个完成节点
                </span>
                <span>
                  结果范围限于当前候选与约束；数值优化结果不构成形式化证明。
                </span>
              </div>
            </div>

            {Object.keys(commonGear).length > 0 && (
              <section className="common-gear-section">
                <div className="result-toolbar">
                  <div>
                    <h2>公共共享部位</h2>
                    <span className="muted">所有参与职业使用相同装备和属性方案</span>
                  </div>
                </div>
                <div className="common-gear-list">
                  {Object.entries(commonGear).flatMap(([slot, items]) => {
                    if (slot === "rings") {
                      return (items ?? []).map((item, index) => (
                        <div className="common-gear-row" key={`ring-${index}-${item.id}`}>
                          <span>{`戒指${index + 1}`}</span>
                          <div><strong>{item.name}</strong></div>
                        </div>
                      ));
                    }
                    return [(
                      <div className="common-gear-row" key={slot}>
                        <span>{slotLabels[slot as GearSlot]}</span>
                        <div>
                          {items?.map((item) => (
                            <strong key={item.id}>{item.name}</strong>
                          ))}
                        </div>
                      </div>
                    )];
                  })}
                </div>
                {result.commonFood && (
                  <p className="common-food-note">共用食物：{result.commonFood.name}</p>
                )}
              </section>
            )}

            {(resultConfig?.jobs.map((job) => job.jobId) ?? jobList).map((jobId) => (
              <section className="joint-job-result" key={jobId}>
                <div className="joint-job-heading">
                  <div>
                    <div className="section-kicker">职业完整结果</div>
                    <h2>{jobSchemas[jobId].name}</h2>
                  </div>
                  <div className="baseline-summary">
                    <span>
                      单职业基线{" "}
                      {(result.optima[jobId]?.score ?? 0).toFixed(7)}
                    </span>
                    <strong>
                      基线比例{" "}
                      {result.optima[jobId]?.score
                        ? (
                            ((result.jobResults[jobId]?.score ?? 0) /
                              result.optima[jobId]!.score) *
                            100
                          ).toFixed(4) + "%"
                        : "—"}
                    </strong>
                  </div>
                </div>
                <ResultPanel
                  result={result.jobResults[jobId]}
                  baseline={result.optima[jobId]}
                  config={(resultConfig ?? currentConfig).jobs.find((item) => item.jobId === jobId) ?? makeConfig(jobId)}
                />
              </section>
            ))}
          </>
        )}

        {!result && !running && (
          <div className="empty-state joint-empty-state">
            <div className="empty-icon">
              {hasAttempted ? <X size={19} /> : <ArrowRight size={20} />}
            </div>
            <h2>
              {error
                ? "搜索未完成"
                : hasAttempted
                  ? "没有可行联合方案"
                  : "准备联合搜索"}
            </h2>
            <p>
              {error
                ? "请查看上方错误信息，修正条件后重新搜索。"
                : hasAttempted
                  ? "当前联合约束下没有可行方案，请调整职业或限制后重试。"
                  : "配置参与职业、公共部位和各职业约束后手动开始搜索。"}
            </p>
          </div>
        )}
        <footer className="footer">
          <span>多职业联合目标 · {objective === "damage" ? "每威力伤害期望" : "按 GCD 折算"}</span>
          <span>纯前端计算 · 可离线运行</span>
          <span>数据版本 {displayedDataVersion}</span>
        </footer>
      </section>
    </main>
  );
}

export function App() {
  const [page, setPage] = useState<Page>(() => currentPage());
  const [resetVersion, setResetVersion] = useState(0);

  useEffect(() => {
    if (!window.location.hash) window.history.replaceState(null, "", "#/single");
    const updatePage = () => setPage(currentPage());
    window.addEventListener("hashchange", updatePage);
    return () => window.removeEventListener("hashchange", updatePage);
  }, []);

  return (
    <div className="app-shell">
      <Header page={page} onReset={() => setResetVersion((version) => version + 1)} />
      {page === "joint" ? (
        <JointPage key={"joint-" + resetVersion} />
      ) : (
        <SinglePage key={"single-" + resetVersion} />
      )}
    </div>
  );
}
