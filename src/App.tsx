import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, Dispatch, SetStateAction } from "react";
import { createPortal } from "react-dom";
import {
  ArrowRight,
  Check,
  ChevronDown,
  CircleHelp,
  Compass,
  Play,
  Plus,
  RotateCcw,
  Search,
  X,
} from "lucide-react";
import {
  addStats,
  applyFood,
  combatSlots,
  combatStats,
  calculateBaseStats,
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
  type SearchCandidateCounts,
  type Stat,
} from "./domain";
import type { LinearMipProgress } from "./domain/search/linear-mip";
import {
  InstructionRail,
  JobPicker,
  WizardProgress,
} from "./ui/WizardNavigation";
import { SearchProgress } from "./ui/SearchProgress";
import { ConfigSnapshot } from "./ui/ConfigSnapshot";
import { SearchHistory } from "./ui/SearchHistory";
import { SingleSearchProgress } from "./ui/SingleSearchProgress";
import type {
  SingleSearchCurrentModelMetrics,
  SingleSearchProgressState,
  SingleSearchSecondRoundVerification,
  SingleSearchSlotCandidateCount,
} from "./ui/SingleSearchProgress";
import { createSearchHistory, finishSearchHistory, type SearchHistoryRecord } from "./ui/search-history";
import type { WizardStep } from "./ui/WizardNavigation";

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
  if (message.includes("候选准备完成")) return "候选准备完成，正在求解配装…";
  if (message.includes("还原并复核")) return "正在还原并复核结果…";
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
          <Compass size={20} />
        </div>
        <div>
          <div className="brand-name">青瓷分析台</div>
          <div className="brand-sub">最终幻想14 配装优化工具</div>
        </div>
      </div>
      <nav className="page-nav" aria-label="搜索页面">
        <a
          href="#/single"
          className={page === "single" ? "active" : ""}
          aria-current={page === "single" ? "page" : undefined}
        >
          单职业配装
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
  disabled = false,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="config-field">
      <span className="field-label">{label}</span>
      <select disabled={disabled} value={value} onChange={(event) => onChange(event.target.value)}>
        {children}
      </select>
    </label>
  );
}

function SearchableDropdown({
  label,
  placeholder,
  query,
  onQueryChange,
  open,
  onOpenChange,
  selectedLabel,
  children,
}: {
  label: string;
  placeholder: string;
  query: string;
  onQueryChange: (query: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedLabel?: string;
  children: React.ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelPosition, setPanelPosition] = useState<{
    left: number;
    width: number;
    maxHeight: number;
    opensUp: boolean;
    edge: number;
  }>();

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !panelRef.current?.contains(target)) onOpenChange(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open, onOpenChange]);

  useLayoutEffect(() => {
    if (!open) {
      setPanelPosition(undefined);
      return;
    }
    const updatePosition = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const gap = 5;
      const viewportPadding = 8;
      const desiredHeight = 244;
      const spaceBelow = Math.max(0, window.innerHeight - rect.bottom - gap - viewportPadding);
      const spaceAbove = Math.max(0, rect.top - gap - viewportPadding);
      const opensUp = spaceBelow < desiredHeight && spaceAbove > spaceBelow;
      const availableSpace = opensUp ? spaceAbove : spaceBelow;
      const width = Math.min(Math.max(rect.width, 260), window.innerWidth - viewportPadding * 2);
      setPanelPosition({
        left: Math.min(Math.max(viewportPadding, rect.left), window.innerWidth - width - viewportPadding),
        width,
        maxHeight: Math.min(desiredHeight, availableSpace),
        opensUp,
        edge: opensUp ? window.innerHeight - rect.top + gap : rect.bottom + gap,
      });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  const panelStyle = panelPosition ? {
    position: "fixed",
    left: panelPosition.left,
    width: panelPosition.width,
    maxHeight: panelPosition.maxHeight,
    top: panelPosition.opensUp ? undefined : panelPosition.edge,
    bottom: panelPosition.opensUp ? panelPosition.edge : undefined,
  } as CSSProperties : undefined;

  return (
    <div className="single-searchable-dropdown" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="single-searchable-dropdown-trigger"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
      >
        <Search size={15} aria-hidden="true" />
        <span>{selectedLabel || placeholder}</span>
        <ChevronDown size={15} aria-hidden="true" />
      </button>
      {open && panelPosition && createPortal(<div
        ref={panelRef}
        className={`single-searchable-dropdown-panel${panelPosition.opensUp ? " opens-up" : ""}`}
        role="dialog"
        aria-label={`${label}筛选列表`}
        style={panelStyle}
      >
        <label className="single-searchable-dropdown-search">
          <Search size={14} aria-hidden="true" />
          <input
            type="search"
            autoFocus
            aria-label={`搜索${label}`}
            placeholder={placeholder}
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
          />
        </label>
        <div className="single-searchable-dropdown-options">{children}</div>
      </div>, document.body)}
    </div>
  );
}

function VirtualGearOptions({
  items,
  query,
  onSelect,
  selectedId,
}: {
  items: Gear[];
  query: string;
  onSelect: (gear: Gear) => void;
  selectedId?: number;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const rowHeight = 36;
  const viewportHeight = Math.min(180, items.length * rowHeight);
  const firstIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - 2);
  const lastIndex = Math.min(items.length, firstIndex + Math.ceil(viewportHeight / rowHeight) + 5);

  useEffect(() => {
    if (viewportRef.current) viewportRef.current.scrollTop = 0;
    setScrollTop(0);
  }, [query]);

  return <div
    ref={viewportRef}
    role="listbox"
    aria-label="装备候选"
    className="single-virtual-options-viewport"
    tabIndex={0}
    style={{ height: viewportHeight }}
    onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
  >
    <div className="single-virtual-options-track" style={{ height: items.length * rowHeight }}>
      {items.slice(firstIndex, lastIndex).map((gear, offset) => {
        const index = firstIndex + offset;
        return <button
          type="button"
          role="option"
          aria-selected={gear.id === selectedId}
          aria-posinset={index + 1}
          aria-setsize={items.length}
          className="single-searchable-dropdown-option"
          key={gear.id}
          style={{ top: index * rowHeight, height: rowHeight }}
          onClick={() => onSelect(gear)}
        >
          <span>{gear.name}</span>
          <small>{slotLabels[gear.slot]} · 品级 {gear.level}</small>
        </button>;
      })}
    </div>
  </div>;
}

function JobConfigFields({
  config,
  setConfig,
  showFood,
  step = "all",
  singleWorkbench = false,
  singleObjectiveLabel,
  singleObjectiveDescription,
  onEdited,
}: {
  config: OptimizationConfig;
  setConfig: Dispatch<SetStateAction<OptimizationConfig>>;
  showFood: boolean;
  step?: WizardStep | "all";
  singleWorkbench?: boolean;
  singleObjectiveLabel?: string;
  singleObjectiveDescription?: string;
  onEdited?: () => void;
}) {
  const [sourceQuery, setSourceQuery] = useState("");
  const [equipmentQuery, setEquipmentQuery] = useState("");
  const [forcedSearch, setForcedSearch] = useState("");
  const [sourceDropdownOpen, setSourceDropdownOpen] = useState(false);
  const [equipmentDropdownOpen, setEquipmentDropdownOpen] = useState(false);
  const [forcedDropdownOpen, setForcedDropdownOpen] = useState(false);
  const [forcedGearSelection, setForcedGearSelection] = useState<number>();
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
    });
  const excludeSuggestions = activeGears
    .filter((gear) => {
      const query = equipmentQuery.trim().toLowerCase();
      return (
        !query ||
        gear.name.toLowerCase().includes(query) ||
        String(gear.id).includes(query)
      );
    })
    .filter((gear) => !(config.excludedGearIds ?? []).includes(gear.id));
  const forcedGearEntries = Object.entries(config.forcedGear)
    .filter(([, id]) => id !== undefined)
    .map(([slot, id]) => ({
      slot: slot as GearSlot,
      id: id as number,
      gear: gears.find((item) => item.id === id),
    }));
  const selectedForcedGear = forcedGearSelection === undefined
    ? undefined
    : jobGears.find((gear) => gear.id === forcedGearSelection);
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
    onEdited?.();
    setConfig((current) => {
      const next = { ...current, [key]: value };
      if (singleWorkbench) {
        if (key === "gcdTarget") {
          next.gcdChoices = undefined;
          next.speedMin = undefined;
          next.speedMax = undefined;
          next.objective = "damage";
        } else if (key === "gcdChoices") {
          next.gcdTarget = undefined;
          next.speedMin = undefined;
          next.speedMax = undefined;
          next.objective = Array.isArray(value) && value.length === 1 ? "damage" : "dps";
        } else if (key === "speedMin" || key === "speedMax") {
          next.gcdTarget = undefined;
          next.gcdChoices = undefined;
        } else if (key === "minTenacity") {
          next.toughnessMinPercent = undefined;
          next.maximizeTenacity = false;
        } else if (key === "toughnessMinPercent") {
          next.minTenacity = undefined;
          next.maximizeTenacity = false;
        }
      }
      return next;
    });
  }

  function setGcdMode(mode: string) {
    onEdited?.();
    if (mode === "any") {
      setConfigPatch(setConfig, {
        gcdTarget: undefined,
        gcdChoices: undefined,
        ...(singleWorkbench ? { speedMin: undefined, speedMax: undefined, objective: "dps" as const } : {}),
      });
      setGcdChoicesText("");
      setGcdChoicesDirty(false);
    } else if (mode === "single") {
      setConfigPatch(setConfig, {
        gcdTarget: config.gcdChoices?.[0] ?? 2.5,
        gcdChoices: undefined,
        ...(singleWorkbench ? { speedMin: undefined, speedMax: undefined, objective: "damage" as const } : {}),
      });
      setGcdChoicesText("");
      setGcdChoicesDirty(false);
    } else {
      setConfigPatch(setConfig, {
        gcdTarget: undefined,
        gcdChoices: config.gcdTarget === undefined ? [2.5] : [config.gcdTarget],
        ...(singleWorkbench ? { speedMin: undefined, speedMax: undefined, objective: "damage" as const } : {}),
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
    if (singleWorkbench) update("gcdTarget", gcd);
    else {
      onEdited?.();
      setConfigPatch(setConfig, { gcdTarget: gcd, gcdChoices: undefined });
    }
    setGcdChoicesText("");
    setGcdChoicesDirty(false);
  }

  function toggleFeasibleGcd(gcd: number, checked: boolean) {
    const choices = new Set(config.gcdChoices ?? []);
    if (checked) choices.add(gcd);
    else choices.delete(gcd);
    const sorted = [...choices].sort((first, second) => second - first);
    if (singleWorkbench) update("gcdChoices", sorted);
    else {
      onEdited?.();
      setConfigPatch(setConfig, { gcdTarget: undefined, gcdChoices: sorted });
    }
    setGcdChoicesText(sorted.join(", "));
    setGcdChoicesDirty(false);
  }

  function forceGear(gear: Gear) {
    onEdited?.();
    setConfig((current) => ({
      ...current,
      forcedGear: { ...current.forcedGear, [forcedSlot]: gear.id },
      excludedGearIds: (current.excludedGearIds ?? []).filter((id) => id !== gear.id),
    }));
    setForcedSearch("");
  }

  function excludeGear(gear: Gear) {
    onEdited?.();
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
      {(step === 1 || (step === "all" && !singleWorkbench)) && <div className="field-grid one job-level-field">
        <SelectField
          label="职业等级"
          value={String(config.jobLevel ?? jobSchemas[config.jobId].maxJobLevel ?? defaultJobLevel)}
          onChange={(value) => update("jobLevel", Number(value))}
        >
          {Object.keys(gameData.jobLevelModifiers).map(Number).filter(level => level <= (jobSchemas[config.jobId].maxJobLevel ?? 100)).sort((a, b) => a - b).map(level => <option key={level} value={level}>{level} 级</option>)}
        </SelectField>
      </div>}

      {(step === "all" || step === 3) && !singleWorkbench && <div className="candidate-range-group">
        <div className="field-grid one">
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
      </div>}

      {singleWorkbench && <h2 className="single-workbench-section-heading single-workbench-combat-heading">战斗速度与目标</h2>}
      {(step === "all" || step === 2) && <details className={`advanced-section${singleWorkbench ? " single-combat-conditions" : ""}`} open={singleWorkbench ? true : undefined}>
      <summary>
        <span>{singleWorkbench ? "战斗速度与目标" : "GCD、速度与坚韧条件"}</span>
        <span className="advanced-summary">
          {config.gcdChoices?.length
            ? config.gcdChoices.map((gcd) => gcd.toFixed(2)).join("、") + " 秒"
            : config.gcdTarget !== undefined
              ? config.gcdTarget.toFixed(2) + " 秒 GCD"
              : "GCD 不限"}
          {config.speedMin !== undefined || config.speedMax !== undefined
            ? ` · ${speedStatName} ${config.speedMin ?? "不限"}–${config.speedMax ?? "不限"}`
            : ""}
          {jobSchemas[config.jobId].role === "tank"
            ? ` · 坚韧条件 ${Number(config.minTenacity !== undefined) + Number(config.toughnessMinPercent !== undefined) + Number(config.maximizeTenacity)}`
            : ""}
        </span>
      </summary>
      <div className={singleWorkbench ? "config-section single-gcd-section" : "config-section"}>
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
        {singleWorkbench && singleObjectiveLabel && <section className="single-objective-display" aria-label="自动选择的搜索指标">
          <span>当前优化指标</span>
          <strong>{singleObjectiveLabel}</strong>
          <p>{singleObjectiveDescription}</p>
        </section>}
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
        {(!singleWorkbench || gcdMode !== "any") && <button
          type="button"
          className="gcd-calculate-button"
          onClick={findingGcds ? () => gcdAbortController.current?.abort() : calculateFeasibleGcds}
        >
          {findingGcds ? <X size={14} /> : <CircleHelp size={14} />}
          {findingGcds ? "取消查询" : "计算可行 GCD 档位"}
        </button>}
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
                    if (singleWorkbench) update("gcdChoices", sorted);
                    else {
                      onEdited?.();
                      setConfigPatch(setConfig, { gcdTarget: undefined, gcdChoices: sorted });
                    }
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

      {singleWorkbench ? <details className="single-custom-speed">
        <summary>
          <span>高级自定义速度范围</span>
          <span className="single-custom-speed-status">
            {config.speedMin !== undefined || config.speedMax !== undefined ? "已启用" : "未启用"}
          </span>
          <span className="single-custom-speed-help" title="自定义速度范围与 GCD 档位互斥，并按范围内可行档位自动选择指标。" aria-label="自定义速度范围说明">
            <CircleHelp size={14} aria-hidden="true" />
          </span>
        </summary>
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
      </details> : <div className="config-section">
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
      </div>}

      {jobSchemas[config.jobId].role === "tank" && <div className="config-section">
        <div className="field-label">坚韧约束</div>
        {singleWorkbench ? (() => {
          const toughnessMode = config.maximizeTenacity
            ? "maximum"
            : config.toughnessMinPercent !== undefined
              ? "mitigation"
              : config.minTenacity !== undefined
                ? "minimum"
                : "none";
          return <>
            <label className="config-field">
              <span className="field-label">坚韧方式</span>
              <select
                aria-label="坚韧方式"
                value={toughnessMode}
                onChange={(event) => {
                  onEdited?.();
                  const mode = event.target.value;
                  setConfig((current) => ({
                    ...current,
                    minTenacity: mode === "minimum" ? current.minTenacity ?? 0 : undefined,
                    toughnessMinPercent: mode === "mitigation" ? current.toughnessMinPercent ?? 0 : undefined,
                    maximizeTenacity: mode === "maximum",
                  }));
                }}
              >
                <option value="none">不限</option>
                <option value="minimum">最低坚韧值</option>
                <option value="mitigation">最低减伤比例</option>
                <option value="maximum">候选范围内最高坚韧</option>
              </select>
            </label>
            {toughnessMode === "minimum" && <NumberField
              label="最低坚韧值"
              value={config.minTenacity}
              min={0}
              onChange={(value) => update("minTenacity", value)}
            />}
            {toughnessMode === "mitigation" && <NumberField
              label="最低减伤比例"
              value={config.toughnessMinPercent}
              min={0}
              max={100}
              step={0.1}
              unit="%"
              onChange={(value) => update("toughnessMinPercent", value)}
            />}
            {toughnessMode === "maximum" && <p className="field-hint">使用当前候选范围内能够达到的最高坚韧值。</p>}
          </>;
        })() : <>
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
        </>}
      </div>}
      </details>}

      {(step === "all" || step === 3) && singleWorkbench && <section className="single-workbench-range">
        <h2 className="single-workbench-section-heading">装备范围与食物</h2>
        <div className="candidate-range-group">
          <NumberField
            label="同步品级"
            value={config.syncLevel}
            min={1}
            max={bounds[1]}
            placeholder="不限"
            onChange={(value) => update("syncLevel", value)}
          />
          <div className="single-item-level-range">
            <span className="field-label">装备品级</span>
            <div className="single-item-level-values">
              <NumberField
                label="最低装备品级"
                value={config.minItemLevel}
                min={bounds[0]}
                max={config.maxItemLevel}
                onChange={(value) => update("minItemLevel", Math.min(value ?? bounds[0], config.maxItemLevel))}
              />
              <span aria-hidden="true">–</span>
              <NumberField
                label="最高装备品级"
                value={config.maxItemLevel}
                min={config.minItemLevel}
                max={bounds[1]}
                onChange={(value) => update("maxItemLevel", Math.max(value ?? bounds[1], config.minItemLevel))}
              />
            </div>
          </div>
          {showFood && <SelectField
            label="食物"
            value={String(config.foodId)}
            onChange={(value) => update("foodId", Number(value))}
          >
            <option value="0">自动选择</option>
            {availableFoods.map((food) => <option key={food.id} value={food.id}>{food.name}</option>)}
          </SelectField>}
        </div>
        {jobSchemas[config.jobId].ignoreWeaponItemLevel && <p className="field-hint">武器不按装备品级区间筛选，仍须满足职业与穿戴等级限制。</p>}
      </section>}

      {(step === "all" || step === 3) && <>
      {!singleWorkbench && jobSchemas[config.jobId].ignoreWeaponItemLevel && <p className="field-hint">武器不按装备品级区间筛选，仍须满足职业与穿戴等级限制。</p>}
      {!singleWorkbench && <div className="config-section">
        <div className="field-label">魔晶石规则</div>
        <p className="field-hint">
          所有可用孔位均会镶满；可禁断装备按规则搜索满五孔方案，等级同步时遵循同步后的孔位限制。
        </p>
      </div>}

      {showFood && !singleWorkbench && (
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

      {singleWorkbench && <h2 className="single-workbench-section-heading single-workbench-restrictions-heading">装备限制</h2>}
      {singleWorkbench ? <div className="single-restriction-columns">
        <section className="single-restriction-column single-restriction-left" aria-label="来源与排除装备">
          <div className="single-restriction-editor">
            <div className="single-restriction-editor-heading">
              <h3>来源限制</h3>
              <span>{config.excludedSources.length ? `${config.excludedSources.length} 项` : "可选"}</span>
            </div>
            <SearchableDropdown
              label="选择来源限制"
              placeholder="搜索装备来源"
              query={sourceQuery}
              onQueryChange={setSourceQuery}
              open={sourceDropdownOpen}
              onOpenChange={setSourceDropdownOpen}
            >
              {sourceOptions
                .filter(([source]) => !config.excludedSources.includes(source))
                .map(([source, count]) => (
                  <button
                    type="button"
                    role="option"
                    aria-selected="false"
                    className="single-searchable-dropdown-option"
                    key={source}
                    onClick={() => update("excludedSources", [...config.excludedSources, source])}
                  >
                    <span>{source}</span>
                    <small>{count} 件装备</small>
                    <Plus size={14} aria-hidden="true" />
                  </button>
                ))}
              {!sourceOptions.some(([source]) => !config.excludedSources.includes(source)) && <p className="single-searchable-dropdown-note">没有匹配的来源。</p>}
            </SearchableDropdown>
            <div className="single-restriction-selected-list" aria-label="已排除来源">
              {config.excludedSources.map((source) => (
                <div className="single-restriction-row" key={source}>
                  <span>{source}</span>
                  <span className="single-restriction-row-detail">来源</span>
                  <button type="button" aria-label={`恢复来源 ${source}`} onClick={() => update("excludedSources", config.excludedSources.filter((item) => item !== source))}><X size={14} /></button>
                </div>
              ))}
            </div>
          </div>

          <div className="single-restriction-editor">
            <div className="single-restriction-editor-heading">
              <h3>排除指定装备</h3>
              <span>{excludedGears.length ? `${excludedGears.length} 件` : "可选"}</span>
            </div>
            <SearchableDropdown
              label="选择排除装备"
              placeholder="按名称或编号搜索装备"
              query={equipmentQuery}
              onQueryChange={setEquipmentQuery}
              open={equipmentDropdownOpen}
              onOpenChange={setEquipmentDropdownOpen}
            >
              {excludeSuggestions.length > 0 ? <VirtualGearOptions
                items={excludeSuggestions}
                query={equipmentQuery}
                onSelect={(gear) => {
                  excludeGear(gear);
                  setEquipmentDropdownOpen(false);
                }}
              /> : <p className="single-searchable-dropdown-note">没有匹配装备。</p>}
            </SearchableDropdown>
            <div className="single-restriction-selected-list" aria-label="已排除装备">
              {excludedGears.map((gear) => (
                <div className="single-restriction-row" key={gear.id}>
                  <span>{gear.name}</span>
                  <span className="single-restriction-row-detail">{slotLabels[gear.slot]} · {gear.source ?? "上游未标注"}</span>
                  <button type="button" aria-label={`恢复装备 ${gear.name}`} onClick={() => update("excludedGearIds", (config.excludedGearIds ?? []).filter((id) => id !== gear.id))}><X size={14} /></button>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="single-restriction-column single-forced-gear" aria-label="强制使用装备">
          <div className="single-restriction-editor-heading">
            <h3>强制使用装备</h3>
            <span>{forcedGearEntries.length ? `${forcedGearEntries.length} 件` : "可选"}</span>
          </div>
          <div className="picker-row">
            <select
              aria-label="选择装备部位"
              value={forcedSlot}
              onChange={(event) => {
                setForcedSlot(event.target.value as GearSlot);
                setForcedSearch("");
                setForcedGearSelection(undefined);
                setForcedDropdownOpen(false);
              }}
            >
              {availableSlots.map((slot) => <option key={slot} value={slot}>{slotLabels[slot]}</option>)}
            </select>
            <SearchableDropdown
              label="选择强制装备"
              placeholder={`搜索${slotLabels[forcedSlot]}装备`}
              query={forcedSearch}
              onQueryChange={setForcedSearch}
              open={forcedDropdownOpen}
              onOpenChange={setForcedDropdownOpen}
              selectedLabel={selectedForcedGear?.name}
            >
              {forceSuggestions.length > 0 ? <VirtualGearOptions
                items={forceSuggestions}
                query={forcedSearch}
                selectedId={forcedGearSelection}
                onSelect={(gear) => {
                  setForcedGearSelection(gear.id);
                  setForcedDropdownOpen(false);
                }}
              /> : <p className="single-searchable-dropdown-note">没有匹配装备。</p>}
            </SearchableDropdown>
            <button
              type="button"
              className="single-restriction-add"
              disabled={!selectedForcedGear}
              onClick={() => {
                if (selectedForcedGear) forceGear(selectedForcedGear);
                setForcedGearSelection(undefined);
              }}
            >添加</button>
          </div>
          <div className="single-restriction-selected-list" aria-label="已强制使用装备">
            {forcedGearEntries.map(({ slot, id, gear }) => (
              <div className="single-restriction-row" key={slot}>
                <span>{gear?.name ?? `装备 ${id}`}</span>
                <span className="single-restriction-row-detail">{slotLabels[slot]}</span>
                <button type="button" aria-label={`移除强制装备 ${gear?.name ?? id}`} onClick={() => {
                  onEdited?.();
                  setConfig((current) => {
                    const forcedGear = { ...current.forcedGear };
                    delete forcedGear[slot];
                    return { ...current, forcedGear };
                  });
                }}><X size={14} /></button>
              </div>
            ))}
          </div>
        </section>
      </div> : <details className="advanced-section">
        <summary>
          <span>来源与装备限制</span>
          <span className="advanced-summary">
            来源排除 {config.excludedSources.length} 项 · 强制 {forcedGearEntries.length} 件 · 排除 {excludedGears.length} 件
          </span>
        </summary>
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
                  onClick={() => {
                    onEdited?.();
                    setConfig((current) => {
                      const forcedGear = { ...current.forcedGear };
                      delete forcedGear[slot];
                      return { ...current, forcedGear };
                    });
                  }}
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
      </details>}
      </>}
    </div>
  );
}

function StatusPanel({
  running,
  progress,
  rawProgress,
  error,
  message,
  onCancel,
}: {
  running: boolean;
  progress: string;
  rawProgress?: string;
  error?: string;
  message?: string;
  onCancel: () => void;
}) {
  if (!running && !error && !message) return null;
  return (
    <div
      className={"search-status result-status " + (error ? "has-error is-failed" : running ? "is-running" : message?.includes("取消") ? "is-cancelled" : message?.includes("没有") ? "is-empty" : "is-complete")}
      role={error ? "alert" : "status"}
      aria-live="polite"
    >
      <div className="search-status-copy">
        <span className="status-dot" />
        <div>
          <strong>{error ? "搜索失败" : running ? "正在搜索" : message?.includes("取消") ? "搜索已取消" : message?.includes("没有") ? "没有可行配装" : message?.includes("完成") ? "搜索已完成" : "搜索状态"}</strong>
          <p>{error ?? (running ? progress : message ?? progress)}</p>
        </div>
      </div>
      {running && (
        <>
          <SearchProgress message={rawProgress ?? progress} />
          <button className="cancel-button" onClick={onCancel}>
            <X size={14} />
            取消搜索
          </button>
        </>
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

function appliedFoodStats(
  result: OptimizationResult,
  config: OptimizationConfig,
): Partial<Record<Stat, number>> {
  const job = jobSchemas[config.jobId];
  const level = config.jobLevel ?? job.maxJobLevel ?? defaultJobLevel;
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

function GearTable({
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
  const preferredStatOrder: Stat[] = [job.mainStat, "VIT", "CRT", "DET", "DHT", "TEN", "SKS", "SPS", "PIE"];
  const statColumns = compact
    ? [
        ...preferredStatOrder.filter((stat, index) =>
          job.stats.includes(stat) && preferredStatOrder.indexOf(stat) === index,
        ),
        ...job.stats.filter((stat) => !preferredStatOrder.includes(stat)),
      ]
    : [];
  const tableGridStyle = compact
    ? {
        gridTemplateColumns: [
          "72px",
          "minmax(126px, 0.85fr)",
          ...statColumns.map(() => "24px"),
          "minmax(260px, 2fr)",
          "minmax(100px, 0.85fr)",
          "36px",
        ].join(" "),
      }
    : undefined;
  const displaySlots: GearSlot[] = [
    "weapon", "offhand", "head", "body", "hands", "legs", "feet",
    "earrings", "necklace", "bracelet", "ring", "ring2",
  ];
  return (
    <div className="equipment-table-wrap">
    <div className="gear-table equipment-table">
      <div className="gear-table-head" style={tableGridStyle}>
        <span>部位</span>
        <span>装备</span>
        {compact
          ? statColumns.map((stat) => <span className="single-job-stat-heading" key={stat}>{statName(stat)}</span>)
          : <span>实际属性</span>}
        <span>魔晶石</span>
        <span>来源</span>
        <span>品级</span>
      </div>
      {displaySlots.map((slot) => {
        const item = result.gear.find((gear) => gear.slot === slot);
        if (!item) return null;
        const isForced = config.forcedGear[item.slot] === item.id;
        return (
          <div className="gear-row" key={item.slot + "-" + item.id} style={tableGridStyle}>
            <div className="slot-cell">
              <span className="slot-icon">{slotLabels[item.slot].slice(0, 1)}</span>
              <span>{slotLabels[item.slot]}</span>
            </div>
            <strong>{item.name}</strong>
            {compact
              ? statColumns.map((stat) => {
                  const value = item.finalStats[stat];
                  const isCapped =
                    value !== undefined && value > 0 &&
                    combatStats.includes(stat as (typeof combatStats)[number]) &&
                    isGearBaseStatAtCap(item, stat);
                  return (
                    <span
                      key={stat}
                      className={"single-job-stat-cell" + (isCapped ? " at-cap" : "")}
                      aria-label={`${statName(stat)} ${value === undefined ? "无" : statValue(stat, value)}`}
                      title={statName(stat)}
                    >
                      {value !== undefined && value > 0 ? statValue(stat, value) : "—"}
                    </span>
                  );
                })
              : <div className="gear-stats">
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
                </div>}
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
      <div className="food-row" style={tableGridStyle}>
        <div className="slot-cell">
          <span className="slot-icon food">食</span>
          <span>食物</span>
        </div>
        <strong>{result.food.name}</strong>
        {compact
          ? statColumns.map((stat) => {
              const value = actualFoodStats[stat];
              return (
                <span
                  key={stat}
                  className="single-job-stat-cell"
                  aria-label={`${statName(stat)} ${value === undefined ? "无加成" : statValue(stat, value)}`}
                  title={statName(stat)}
                >
                  {value === undefined ? "—" : statValue(stat, value)}
                </span>
              );
            })
          : <div className="gear-stats">
              {Object.entries(actualFoodStats)
                .map(([key, value]) => statName(key) + " " + value)
                .join(" · ") || "无属性加成"}
            </div>}
        <div className="melds">
          <span className="food-bonus">实际生效</span>
        </div>
        <span className="source-text">上游食物数据</span>
        <span className="level-tag">{result.food.level}</span>
      </div>
    </div>
    </div>
  );
}

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
    <div className="single-summary-popover" ref={container}>
      <button
        ref={trigger}
        type="button"
        className="single-summary-popover-trigger"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
      >
        <span>{label}</span>
        <strong>{count ? `${count} 项` : "无限制"}</strong>
      </button>
      {open && createPortal(<div
        ref={panel}
        className="single-summary-popover-panel"
        role="dialog"
        aria-label={label}
        style={panelStyle}
      >
        <h3>{label}</h3>
        <div
          ref={detailsList}
          className="single-summary-popover-list"
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

function SingleConditionSummary({
  config,
  view,
  result,
  startedAtISO,
  dataVersion,
  onEdit,
}: {
  config: OptimizationConfig;
  view: SingleSummaryView;
  result?: OptimizationResult;
  startedAtISO?: string;
  dataVersion?: string;
  onEdit?: () => void;
}) {
  const job = jobSchemas[config.jobId];
  const gcd = config.gcdChoices !== undefined
    ? config.gcdChoices.length ? config.gcdChoices.map((value) => `${value.toFixed(2)} 秒`).join("、") : "未选择档位"
    : config.gcdTarget === undefined ? "不限" : `${config.gcdTarget.toFixed(2)} 秒`;
  const speedName = job.role === "healer" || job.role === "int" ? "咏速" : "技速";
  const speed = config.speedMin === undefined && config.speedMax === undefined
    ? "不限"
    : `${config.speedMin ?? "不限"}–${config.speedMax ?? "不限"}`;
  const food = config.foodId === 0
    ? "自动选择"
    : foods.find((item) => item.id === config.foodId)?.name ?? `食物编号 ${config.foodId}`;
  const forced = Object.entries(config.forcedGear)
    .filter((entry): entry is [string, number] => entry[1] !== undefined)
    .map(([slot, id]) => ({ slot: slot as GearSlot, id, gear: gears.find((item) => item.id === id) }));
  const excluded = (config.excludedGearIds ?? [])
    .map((id) => gears.find((item) => item.id === id))
    .filter((gear): gear is Gear => gear !== undefined);
  const target = config.objective === "dps" ? "每秒每威力伤害期望" : "每威力伤害期望";

  return (
    <div className={`single-condition-summary is-${view}`}>
      <header className="single-condition-summary-heading">
        <div>
          <p>{view === "result" ? "配装结果" : view === "progress" ? "搜索条件" : "条件摘要"}</p>
          <h2>{job.name}</h2>
        </div>
        {view === "result" && onEdit && <button type="button" className="text-button" onClick={onEdit}>修改条件</button>}
      </header>

      {view === "result" && <section className="single-summary-section" aria-label="结果身份">
        <h3>结果身份</h3>
        <dl className="single-summary-identity">
          <div><dt>搜索时间</dt><dd>{startedAtISO ? new Date(startedAtISO).toLocaleString("zh-CN") : "—"}</dd></div>
          <div><dt>数据版本</dt><dd>{dataVersion ?? "—"}</dd></div>
        </dl>
      </section>}

      {view === "result" && result && <section className="single-summary-section">
        <h3>配装总属性</h3>
        <div className="single-result-total-stats">
          {Object.entries(result.stats).filter(([, value]) => value && value > 0).map(([stat, value]) => (
            <div key={stat}><span>{statName(stat)}</span><strong>{statValue(stat, value)}</strong></div>
          ))}
        </div>
      </section>}

      {view === "result" && result && <section className="single-summary-section">
        <h3>伤害与防御</h3>
        <div className="single-result-effects">
          <div><span>暴击伤害</span><strong>{(result.effects.crtDamage * 100).toFixed(1)}%</strong></div>
          <div><span>信念加成</span><strong>{(result.effects.detDamage * 100).toFixed(2)}%</strong></div>
          <div><span>坚韧伤害</span><strong>{(result.effects.tenDamage * 100).toFixed(2)}%</strong></div>
          <div><span>坚韧减伤</span><strong>{(result.effects.tenMitigation * 100).toFixed(2)}%</strong></div>
          <div><span>生命值</span><strong>{result.effects.hp.toLocaleString()}</strong></div>
          <div><span>每 3 秒魔力恢复</span><strong>{result.effects.mp.toLocaleString()}</strong></div>
        </div>
      </section>}

      <section className="single-summary-section single-summary-conditions">
        <h3>搜索条件</h3>
        <dl className="single-summary-rows">
          <div><dt>优化指标</dt><dd>{target}</dd></div>
          <div><dt>装备品级</dt><dd>{config.minItemLevel}–{config.maxItemLevel}</dd></div>
          <div><dt>同步品级</dt><dd>{config.syncLevel === undefined ? "未启用" : config.syncLevel}</dd></div>
          <div><dt>GCD</dt><dd>{gcd}</dd></div>
          <div><dt>{speedName}范围</dt><dd>{speed}</dd></div>
          {job.role === "tank" && <div><dt>坚韧方式</dt><dd>{config.maximizeTenacity
            ? "候选范围内最高坚韧"
            : config.toughnessMinPercent !== undefined
              ? `最低减伤 ${config.toughnessMinPercent}%`
              : config.minTenacity !== undefined
                ? `最低坚韧 ${config.minTenacity}`
                : "不限"}</dd></div>}
          <div><dt>食物</dt><dd>{food}</dd></div>
        </dl>
        <div className="single-summary-restrictions">
          <SingleRestrictionPopover label="来源限制" count={config.excludedSources.length} emptyText="没有排除来源。">
            {config.excludedSources.map((source) => <div className="single-summary-popover-row" key={source}><span>{source}</span><small>已排除</small></div>)}
          </SingleRestrictionPopover>
          <SingleRestrictionPopover label="强制装备" count={forced.length} emptyText="没有强制装备。">
            {forced.map(({ slot, id, gear: item }) => <div className="single-summary-popover-row" key={slot}><span>{item?.name ?? `装备 ${id}`}</span><small>{slotLabels[slot]}</small></div>)}
          </SingleRestrictionPopover>
          <SingleRestrictionPopover label="排除装备" count={excluded.length} emptyText="没有排除装备。">
            {excluded.map((item) => <div className="single-summary-popover-row" key={item.id}><span>{item.name}</span><small>{slotLabels[item.slot]} · {item.source ?? "上游未标注"}</small></div>)}
          </SingleRestrictionPopover>
        </div>
        {view !== "result" && <p className="single-summary-note">食物、装备候选、属性上限与计算规则均来自当前项目数据。</p>}
      </section>
    </div>
  );
}

function ResultPanel({
  result,
  config,
  baseline,
  attempted = false,
  failed = false,
  statusMessage,
  stale = false,
  onEditConfig,
  compact = false,
  currentReview,
  searchStartedAt,
  resultDataVersion,
}: {
  result?: OptimizationResult;
  config: OptimizationConfig;
  baseline?: OptimizationResult;
  attempted?: boolean;
  failed?: boolean;
  statusMessage?: string;
  stale?: boolean;
  onEditConfig?: () => void;
  compact?: boolean;
  currentReview?: React.ReactNode;
  searchStartedAt?: string;
  resultDataVersion?: string;
}) {
  if (!result) {
    const cancelled = statusMessage?.includes("取消") ?? false;
    return (
      <div className="empty-state result-status result-empty-state">
        <div className="empty-icon">
          {attempted || cancelled || failed ? <X size={19} /> : <Play size={19} />}
        </div>
        <h2>{failed ? "搜索未完成" : cancelled ? "搜索已取消" : attempted ? "没有可行配装" : "尚未搜索"}</h2>
        <p>
          {failed
            ? "请查看上方错误信息，修正条件后重新搜索。"
            : cancelled
              ? "本次搜索已停止，当前没有新的推荐结果；确认条件后可以重新开始。"
            : attempted
                ? "当前约束下没有可行结果，请调整条件后重试。"
                : "设置搜索条件后，点击“开始搜索”生成结果。"}
        </p>
      </div>
    );
  }
  const ratio =
    baseline && baseline.score > 0
      ? ((result.score / baseline.score) * 100).toFixed(4) + "%"
      : undefined;
  return (
    <div className={"result-workspace" + (compact ? " single-result-workspace" : "")}>
      <div className={compact ? "single-result-main" : undefined}>
      <div className="result-completion" role="status">
        <Check size={18} aria-hidden="true" />
        <div>
          <strong>{stale ? "历史搜索已完成 · 当前条件待更新" : "搜索已完成"}</strong>
          <p>
            求解与结果复核已完成；最优结果限于本次候选与约束。
            {compact && <> 目标值 {result.score.toFixed(7)}（{result.objective === "dps" ? "每秒每威力伤害期望" : "每威力伤害期望"}） · 用时 {(result.durationMs / 1000).toFixed(1)} 秒</>}
          </p>
        </div>
      </div>
      {stale && <div className="stale-notice result-stale-note" role="status">
        条件已修改，以下配装对应上一组条件，不代表当前设置的推荐结果。
      </div>}
      <div className="metric-strip result-conclusion">
        <Metric
          label="每威力伤害期望"
          value={result.effects.damage.toFixed(7)}
          accent
        />
        <Metric label="GCD" value={result.effects.gcd.toFixed(2) + " 秒"} />
        <Metric label="暴击率" value={(result.effects.crtChance * 100).toFixed(1) + "%"} />
        <Metric label="直击率" value={(result.effects.dhtChance * 100).toFixed(1) + "%"} />
        <Metric
          label={compact ? "每秒每威力伤害期望" : "按 GCD 折算"}
          value={result.damagePerSecond.toFixed(7)}
        />
      </div>
      {!compact && <div className="result-toolbar">
        <div>
          <h2>推荐配装</h2>
          <span className="muted">
            {`目标值 ${result.score.toFixed(7)}${ratio ? " · 单职业基线比例 " + ratio : ""} · ${result.searchedCandidates.toLocaleString()} 个候选 · ${result.durationMs.toFixed(0)} 毫秒`}
          </span>
        </div>
        {result.maximumTenacity !== undefined && (
          <span className="compute-chip">
            最高坚韧 {result.maximumTenacity.toLocaleString()}
          </span>
        )}
      </div>}
      <GearTable result={result} config={config} compact={compact} />
      </div>
      <div className={compact ? "single-result-aside" : undefined}>
      {compact && <SingleConditionSummary
        config={config}
        view="result"
        result={result}
        startedAtISO={searchStartedAt}
        dataVersion={resultDataVersion}
        onEdit={onEditConfig}
      />}
      {!compact && <div className="result-section result-attributes">
        <div className="result-toolbar">
          <div>
            <h2>配装总属性</h2>
            <span className="muted">已计入食物比例加成与装备魔晶石</span>
          </div>
        </div>
        <div className="stats-grid stat-summary-grid">
          {Object.entries(result.stats)
            .filter(([, value]) => value && value > 0)
            .map(([stat, value]) => (
              <div className="stat-card" key={stat}>
                <span>{statName(stat)}</span>
                <strong>{statValue(stat, value)}</strong>
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
      </div>}
      {!compact && <ConfigSnapshot config={config} onEdit={onEditConfig} />}
      </div>
    </div>
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
      type="button"
      className={"run-button " + (running ? "is-running" : "")}
      onClick={running ? onCancel : onSearch}
      disabled={false}
    >
      {running ? <X size={16} /> : <Play size={16} fill="currentColor" />}
      {running ? "取消搜索" : "开始搜索"}
    </button>
  );
}

const roleNames = {
  tank: "防护职业",
  healer: "治疗职业",
  str: "力量职业",
  dex: "灵巧职业",
  int: "智力职业",
} as const;

function SummaryRow({
  label,
  value,
  onEdit,
}: {
  label: string;
  value: React.ReactNode;
  onEdit: () => void;
}) {
  return (
    <div className="summary-row">
      <span>{label}</span>
      <strong>{value}</strong>
      <button type="button" className="summary-edit-button" onClick={onEdit}>编辑</button>
    </div>
  );
}

function safeProgressCount(value: string | undefined): number | undefined {
  if (value === undefined || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function candidateSlotLabel(slot: string): string {
  if (slot === "rings") return "戒指组合";
  if (slot === "weapon") return "主手";
  return slotLabels[slot as GearSlot] ?? slot;
}

function singleProgressStatus(message: string): string {
  if (message.includes("候选准备完成")) return "候选与搜索模型已准备完成";
  if (message.includes("最高坚韧")) return "正在确定候选范围内的最高坚韧";
  if (message.includes("签名带")) return "正在检查是否还有更优候选";
  if (message.includes("还原并复核") || message.includes("精确候选已核验")) return "正在核验候选方案";
  return "正在搜索配装";
}

function SinglePage() {
  const [selectedJob, setSelectedJob] = useState<JobId | null>(null);
  const [config, setConfig] = useState<OptimizationConfig>(() => makeConfig("SAM"));
  const [view, setView] = useState<"choose" | "workbench" | "progress" | "result">("choose");
  const [result, setResult] = useState<OptimizationResult>();
  const [resultConfig, setResultConfig] = useState<OptimizationConfig>();
  const [resultStartedAt, setResultStartedAt] = useState<string>();
  const [resultDataVersion, setResultDataVersion] = useState<string>();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string>();
  const [statusMessage, setStatusMessage] = useState<string>();
  const [resultKey, setResultKey] = useState<string>();
  const [hasAttempted, setHasAttempted] = useState(false);
  const [historyRefresh, setHistoryRefresh] = useState(0);
  const [historyError, setHistoryError] = useState<string>();
  const [searchProgress, setSearchProgress] = useState<SingleSearchProgressState>({
    phase: "prepare",
    statusMessage: "",
    startedAt: Date.now(),
    hasFeasibleCandidate: false,
  });
  const [activeSearchConfig, setActiveSearchConfig] = useState<OptimizationConfig>();
  const [customGcdCoverage, setCustomGcdCoverage] = useState<{ key: string; tiers: number[] }>();
  const [customGcdError, setCustomGcdError] = useState<string>();
  const abortController = useRef<AbortController | undefined>(undefined);
  const verifiedCombinationCount = useRef<number | undefined>(undefined);

  const currentKey = selectedJob ? JSON.stringify(config) : "";
  const stale = result !== undefined && resultKey !== currentKey;
  const job = selectedJob ? jobSchemas[selectedJob] : undefined;
  const customSpeedActive = config.speedMin !== undefined || config.speedMax !== undefined;
  const gcdSelectionActive = config.gcdTarget !== undefined || config.gcdChoices !== undefined;
  const hasLegacyGcdSpeedConflict = customSpeedActive && gcdSelectionActive;
  const customGcdQueryKey = JSON.stringify({
    ...config,
    objective: undefined,
    gcdTarget: undefined,
    gcdChoices: undefined,
  });
  const customGcdQueryConfig = useMemo<OptimizationConfig>(
    () => ({ ...config, objective: "damage", gcdTarget: undefined, gcdChoices: undefined }),
    [customGcdQueryKey],
  );
  const currentGcdCoverage =
    customGcdCoverage?.key === customGcdQueryKey ? customGcdCoverage.tiers : undefined;
  const derivedObjective = hasLegacyGcdSpeedConflict
    ? undefined
    : customSpeedActive
      ? currentGcdCoverage === undefined
        ? undefined
        : currentGcdCoverage.length === 1 ? "damage" : "dps"
      : config.gcdTarget !== undefined || (config.gcdChoices?.length ?? 0) === 1
        ? "damage"
        : "dps";
  const displayObjective = derivedObjective ?? config.objective ?? "damage";
  const canStartSearch =
    selectedJob !== null &&
    !hasLegacyGcdSpeedConflict &&
    (!customSpeedActive || (currentGcdCoverage !== undefined && currentGcdCoverage.length > 0)) &&
    !running;

  useEffect(() => () => {
    abortController.current?.abort();
  }, []);

  useEffect(() => {
    if (view !== "workbench" || !selectedJob || !customSpeedActive || gcdSelectionActive) {
      setCustomGcdCoverage(undefined);
      setCustomGcdError(undefined);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setCustomGcdError(undefined);
      findFeasibleGcds(customGcdQueryConfig, { signal: controller.signal })
        .then((tiers) => {
          if (controller.signal.aborted) return;
          setCustomGcdCoverage({ key: customGcdQueryKey, tiers });
          const objective = tiers.length === 1 ? "damage" : "dps";
          setConfig((current) => current.objective === objective ? current : { ...current, objective });
        })
        .catch((caught: unknown) => {
          if (!controller.signal.aborted) {
            setCustomGcdError(searchMessageText(caught instanceof Error ? caught.message : String(caught)));
          }
        });
    }, 280);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [view, selectedJob, customSpeedActive, gcdSelectionActive, customGcdQueryKey, customGcdQueryConfig]);

  useEffect(() => {
    if (view !== "workbench" || !selectedJob || customSpeedActive || hasLegacyGcdSpeedConflict || !derivedObjective) return;
    setConfig((current) => current.objective === derivedObjective
      ? current
      : { ...current, objective: derivedObjective });
  }, [view, selectedJob, customSpeedActive, hasLegacyGcdSpeedConflict, derivedObjective]);

  function cancelSearch() {
    abortController.current?.abort();
  }

  function clearOutcomeMessages() {
    setError(undefined);
    setStatusMessage(undefined);
  }

  function chooseJob(jobId: JobId) {
    if (selectedJob === jobId) {
      setView("workbench");
      clearOutcomeMessages();
      return;
    }
    if (running) cancelSearch();
    setSelectedJob(jobId);
    setConfig(makeConfig(jobId));
    setResult(undefined);
    setResultConfig(undefined);
    setResultStartedAt(undefined);
    setResultDataVersion(undefined);
    setResultKey(undefined);
    setHasAttempted(false);
    setView("workbench");
    clearOutcomeMessages();
  }

  function loadHistoryConfig(record: SearchHistoryRecord) {
    if (record.kind !== "single") return;
    abortController.current?.abort();
    setRunning(false);
    setSelectedJob(record.config.jobId);
    setConfig({
      ...record.config,
      jobLevel: jobSchemas[record.config.jobId].maxJobLevel ?? defaultJobLevel,
    });
    setResult(undefined);
    setResultConfig(undefined);
    setResultStartedAt(undefined);
    setResultDataVersion(undefined);
    setResultKey(undefined);
    setHasAttempted(false);
    setView("workbench");
    clearOutcomeMessages();
  }

  function loadHistoryResult(record: SearchHistoryRecord) {
    if (record.kind !== "single" || !record.result || record.dataVersion !== displayedDataVersion) return;
    abortController.current?.abort();
    setRunning(false);
    setSelectedJob(record.config.jobId);
    setConfig(record.config);
    setResult(record.result);
    setResultConfig(record.config);
    setResultStartedAt(record.startedAtISO);
    setResultDataVersion(record.dataVersion);
    setResultKey(JSON.stringify(record.config));
    setHasAttempted(true);
    setView("result");
    setStatusMessage("已载入该次搜索结果。");
    setError(undefined);
  }

  async function saveHistoryOutcome(id: string, outcome: Parameters<typeof finishSearchHistory>[1]) {
    try { await finishSearchHistory(id, outcome); }
    catch (caught) { setHistoryError("搜索记录保存失败：" + searchMessageText(caught instanceof Error ? caught.message : String(caught))); }
    setHistoryRefresh((value) => value + 1);
  }

  async function runSearch() {
    if (!selectedJob || !canStartSearch) return;
    const searchConfig = { ...config, jobId: selectedJob, objective: displayObjective };
    const searchKey = JSON.stringify(searchConfig);
    abortController.current?.abort();
    const controller = new AbortController();
    abortController.current = controller;
    const startedAt = Date.now();
    verifiedCombinationCount.current = undefined;
    setActiveSearchConfig(searchConfig);
    setSearchProgress({
      phase: "prepare",
      statusMessage: "正在准备候选与搜索模型",
      startedAt,
      hasFeasibleCandidate: false,
    });
    setRunning(true);
    setView("progress");
    setError(undefined);
    setStatusMessage(undefined);
    setHasAttempted(true);
    setResult(undefined);
    setResultConfig(undefined);
    setResultStartedAt(undefined);
    setResultDataVersion(undefined);
    setResultKey(undefined);
    setHistoryError(undefined);
    let historyId: string | undefined;
    let historyStartedAt = new Date(startedAt).toISOString();

    try {
      const record = await createSearchHistory({
        kind: "single",
        config: searchConfig,
        dataVersion: displayedDataVersion,
      });
      historyId = record.id;
      historyStartedAt = record.startedAtISO;
      setSearchProgress((current) => ({ ...current, startedAt: Date.parse(record.startedAtISO) }));
      setHistoryRefresh((value) => value + 1);
      if (controller.signal.aborted) throw new Error("搜索已取消。");

      const searchResult = await optimize(searchConfig, {
        signal: controller.signal,
        onProgress: (message) => {
          if (controller.signal.aborted || abortController.current !== controller) return;
          const verifiedMatch = message.match(/精确候选已核验\s+(\d+)\s+个/);
          if (verifiedMatch) verifiedCombinationCount.current = Number(verifiedMatch[1]);
          const verificationStarted =
            message.includes("还原并复核") ||
            message.includes("精确候选已核验") ||
            message.includes("签名带");
          setSearchProgress((current) => ({
            ...current,
            phase: verificationStarted ? "verify" : current.phase === "prepare" ? "solve" : current.phase,
            statusMessage: singleProgressStatus(message),
          hasFeasibleCandidate: current.hasFeasibleCandidate || message.includes("精确候选已核验"),
          }));
        },
        onCandidateCounts: (counts: SearchCandidateCounts) => {
          if (controller.signal.aborted || abortController.current !== controller) return;
          const order = new Map(["weapon", "offhand", "head", "body", "hands", "legs", "feet", "earrings", "necklace", "bracelet", "rings"].map((slot, index) => [slot, index]));
          const slotCandidateCounts: SingleSearchSlotCandidateCount[] = counts.slots
            .map(({ slot, count }) => ({ label: candidateSlotLabel(slot), slot, count }))
            .sort((left, right) => (order.get(left.slot) ?? 99) - (order.get(right.slot) ?? 99))
            .map(({ label, count }) => ({ label, count }));
          setSearchProgress((current) => ({
            ...current,
            phase: "solve",
            statusMessage: "候选与搜索模型已准备完成",
            slotCandidateCounts,
            foodCandidateCount: counts.foodCount,
          }));
        },
        onSolverProgress: (event: LinearMipProgress) => {
          if (controller.signal.aborted || abortController.current !== controller) return;
          const secondRoundModel = event.model === "exact_damage_band_feasibility";
          const foundObjectiveCandidate =
            event.kind === "incumbent" && event.model.startsWith("exact_damage_");
          const model: SingleSearchCurrentModelMetrics = {
            model: event.model,
            status: event.status,
            completed: event.completed,
            primalBound: event.objectiveValue,
            dualBound: event.bestBound,
            gap: event.gap,
            nodes: safeProgressCount(event.nodes),
            lpIterations: safeProgressCount(event.totalLpIterations),
            variables: event.variableCount,
            constraints: event.rowCount,
          };
          setSearchProgress((current) => {
            let secondRoundVerification: SingleSearchSecondRoundVerification | undefined;
            if (secondRoundModel) {
              const prior = current.secondRoundVerification;
              const newRoundStarted = current.currentModel?.model === event.model && current.currentModel.completed === true;
              const round = prior === undefined ? 2 : newRoundStarted ? prior.round + 1 : prior.round;
              secondRoundVerification = {
                round,
                ...(verifiedCombinationCount.current === undefined
                  ? {}
                  : { verifiedCombinations: verifiedCombinationCount.current }),
              };
            }
            return {
              ...current,
              phase: secondRoundModel ? "verify" : current.phase === "prepare" ? "solve" : current.phase,
              statusMessage: secondRoundModel ? "正在核验候选方案" : current.statusMessage,
              hasFeasibleCandidate: current.hasFeasibleCandidate || foundObjectiveCandidate,
              currentModel: model,
              ...(secondRoundModel ? { secondRoundVerification } : {}),
            };
          });
        },
      });

      await saveHistoryOutcome(
        historyId,
        searchResult ? { status: "completed", result: searchResult } : { status: "no-result" },
      );
      if (controller.signal.aborted || abortController.current !== controller) return;
      setResult(searchResult);
      if (searchResult) {
        setResultKey(searchKey);
        setResultConfig(searchConfig);
        setResultStartedAt(historyStartedAt);
        setResultDataVersion(displayedDataVersion);
        setView("result");
        setStatusMessage(undefined);
      } else {
        setView("workbench");
        setStatusMessage("当前条件下没有可行配装，请调整条件后重新搜索。");
      }
    } catch (caught) {
      if (historyId) {
        await saveHistoryOutcome(
          historyId,
          controller.signal.aborted
            ? { status: "cancelled" }
            : { status: "failed", error: searchMessageText(caught instanceof Error ? caught.message : String(caught)) },
        );
      }
      if (abortController.current !== controller) return;
      setView("workbench");
      if (controller.signal.aborted || caught instanceof Error && caught.name === "AbortError") {
        setStatusMessage("搜索已取消。本次搜索已立即停止，可以调整条件后重新开始。");
      } else {
        setError(searchMessageText(caught instanceof Error ? caught.message : String(caught)));
      }
    } finally {
      if (abortController.current === controller) {
        abortController.current = undefined;
        setRunning(false);
      }
    }
  }

  const customGcdSummary = customSpeedActive
    ? currentGcdCoverage === undefined
      ? customGcdError ? "暂时无法确定可行 GCD 档位" : "正在查询自定义速度范围覆盖的 GCD 档位…"
      : currentGcdCoverage.length === 0
        ? "没有可行 GCD 档位"
        : "覆盖 " + currentGcdCoverage.length + " 个可行 GCD 档位"
    : config.gcdChoices?.length
      ? config.gcdChoices.map((value) => value.toFixed(2) + " 秒").join("、")
      : config.gcdTarget === undefined ? "不限" : config.gcdTarget.toFixed(2) + " 秒";
  const objectiveLabel = displayObjective === "dps" ? "每秒每威力伤害期望" : "每威力伤害期望";
  const objectiveDescription = customSpeedActive
    ? customGcdSummary + "，指标按可行档位自动选择。"
    : config.gcdTarget !== undefined
      ? "只允许一个 GCD 档位，使用每威力伤害期望。"
      : "不限 GCD 或允许多个档位，使用每秒每威力伤害期望。";

  function keepGcdAndClearSpeed() {
    const objective = config.gcdTarget !== undefined || (config.gcdChoices?.length ?? 0) === 1 ? "damage" : "dps";
    setConfig((current) => ({ ...current, speedMin: undefined, speedMax: undefined, objective }));
    setCustomGcdCoverage(undefined);
    clearOutcomeMessages();
  }

  function keepSpeedAndClearGcd() {
    setConfig((current) => ({ ...current, gcdTarget: undefined, gcdChoices: undefined }));
    setCustomGcdCoverage(undefined);
    clearOutcomeMessages();
  }

  const searchHistory = (
    <SearchHistory
      kind="single"
      currentDataVersion={displayedDataVersion}
      refreshKey={historyRefresh}
      onLoadConfig={loadHistoryConfig}
      onLoadResult={loadHistoryResult}
    />
  );

  return (
    <main className="single-flow">
      {view === "choose" && <section className="single-job-selection">
        <header className="single-workbench-heading">
          <div>
            <p className="single-section-kicker">单职业配装</p>
            <h1>选择职业</h1>
            <p>选择一个职业后，集中设置该职业的搜索条件。</p>
          </div>
        </header>
        <JobPicker value={selectedJob} onChange={chooseJob} />
        {selectedJob && <div className="single-job-selection-actions">
          <span>{jobSchemas[selectedJob].name} · {roleNames[jobSchemas[selectedJob].role]} 已选择</span>
          <button type="button" className="run-button" onClick={() => setView("workbench")}>继续配置</button>
        </div>}
        {searchHistory}
        <footer className="footer single-page-footer">
          <span>纯前端计算 · 可离线运行</span>
          <span>数据版本 {displayedDataVersion}</span>
        </footer>
      </section>}

      {view === "workbench" && selectedJob && job && <div className="single-workbench-layout">
        <section className="single-workbench-main" aria-label="单职业搜索参数">
          <header className="single-workbench-heading">
            <div>
              <p className="single-section-kicker">单职业配装 · {roleNames[job.role]}</p>
              <h1>{job.name} 搜索条件</h1>
              <p>所有条件在同一工作台内持续生效；选择完成后即可开始搜索。</p>
            </div>
            <button type="button" className="text-button" onClick={() => setView("choose")}>更换职业</button>
          </header>

          {hasLegacyGcdSpeedConflict && <section className="single-config-warning" role="alert">
            <strong>这组历史条件同时设置了 GCD 档位和自定义速度范围。</strong>
            <p>新工作台要求两者互斥，请选择保留其中一项后再搜索。</p>
            <div>
              <button type="button" onClick={keepGcdAndClearSpeed}>保留 GCD 档位</button>
              <button type="button" onClick={keepSpeedAndClearGcd}>保留自定义速度</button>
            </div>
          </section>}

          {customGcdError && <p className="single-gcd-error" role="alert">{customGcdError}</p>}
          {historyError && <p role="alert" className="history-error">{historyError}</p>}
          {!result && <StatusPanel
            running={false}
            progress=""
            error={error}
            message={statusMessage}
            onCancel={cancelSearch}
          />}

          <div className="single-workbench-settings">
            <JobConfigFields
              config={{ ...config, objective: displayObjective }}
              setConfig={setConfig}
              showFood
              step="all"
              singleWorkbench
              singleObjectiveLabel={objectiveLabel}
              singleObjectiveDescription={objectiveDescription}
              onEdited={clearOutcomeMessages}
            />
          </div>

          {hasAttempted && (error || statusMessage) && !result && <ResultPanel
            config={config}
            attempted={hasAttempted}
            failed={error !== undefined}
            statusMessage={statusMessage}
          />}

          <div className="single-workbench-history">{searchHistory}</div>
          <footer className="footer single-page-footer">
            <span>纯前端计算 · 可离线运行</span>
            <span>数据版本 {displayedDataVersion}</span>
          </footer>
        </section>

        <aside className="single-workbench-aside" aria-label="当前搜索条件摘要">
          <SingleConditionSummary
            config={{ ...config, objective: displayObjective }}
            view="workbench"
          />
          <div className="single-workbench-actionbar">
            <span>
              {customSpeedActive && currentGcdCoverage === undefined
                ? "正在计算速度范围覆盖的 GCD 档位…"
                : hasLegacyGcdSpeedConflict
                  ? "请先选择 GCD 条件或自定义速度范围。"
                  : customSpeedActive && currentGcdCoverage?.length === 0
                    ? "当前速度范围没有可行 GCD 档位。"
                    : "已就绪 · 搜索结果将严格满足以上条件"}
            </span>
            <button type="button" className="run-button" disabled={!canStartSearch} onClick={runSearch}>
              <Play size={16} fill="currentColor" />
              开始搜索
            </button>
          </div>
        </aside>
      </div>}

      {view === "progress" && activeSearchConfig && selectedJob && <SingleSearchProgress
        jobName={jobSchemas[selectedJob].name}
        progress={searchProgress}
        rightSummary={<SingleConditionSummary config={activeSearchConfig} view="progress" />}
        onCancel={cancelSearch}
      />}

      {view === "result" && result && !stale && <ResultPanel
        result={result}
        config={resultConfig ?? config}
        compact
        searchStartedAt={resultStartedAt}
        resultDataVersion={resultDataVersion}
        onEditConfig={() => {
          setConfig((current) => ({
            ...current,
            jobLevel: jobSchemas[current.jobId].maxJobLevel ?? defaultJobLevel,
          }));
          setView("workbench");
          clearOutcomeMessages();
        }}
      />}
    </main>
  );
}


function jointJobSummary(config: OptimizationConfig): string {
  const job = jobSchemas[config.jobId];
  const speedStatName = job.role === "healer" || job.role === "int" ? "咏速" : "技速";
  const gcd = config.gcdChoices?.length
    ? config.gcdChoices.map((value) => value.toFixed(2)).join("、") + " 秒"
    : config.gcdTarget === undefined
      ? "GCD 不限"
      : config.gcdTarget.toFixed(2) + " 秒 GCD";
  const speed = config.speedMin === undefined && config.speedMax === undefined
    ? "速度不限"
    : speedStatName + " " + String(config.speedMin ?? "不限") + "–" + String(config.speedMax ?? "不限");
  const food = config.foodId === 0
    ? "自动食物"
    : foods.find((item) => item.id === config.foodId)?.name ?? "食物 " + config.foodId;
  const restrictionCount = config.excludedSources.length +
    (config.excludedGearIds?.length ?? 0) +
    Object.values(config.forcedGear).filter((id) => id !== undefined).length;
  const tankConditionCount = [
    config.minTenacity !== undefined,
    config.toughnessMinPercent !== undefined,
    config.maximizeTenacity,
  ].filter(Boolean).length;
  const tankConditions = job.role === "tank"
    ? " · 坚韧条件 " + tankConditionCount + " 项"
    : "";
  return `${config.jobLevel ?? job.maxJobLevel ?? defaultJobLevel} 级 · 品级 ${config.minItemLevel}–${config.maxItemLevel} · ${food} · ${gcd} · ${speed} · 限制 ${restrictionCount} 项${tankConditions}`;
}

function JointPage() {
  const [historyRefresh, setHistoryRefresh] = useState(0);
  const [historyError, setHistoryError] = useState<string>();
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
  const [rawProgress, setRawProgress] = useState("");
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

  function loadJointHistoryConfig(record: SearchHistoryRecord) {
    if (record.kind !== "joint") return false;
    if (record.config.commonSlots.includes("rings")) {
      setError("该记录使用当前界面不支持的合并戒指共享方式，无法载入。");
      return false;
    }
    const previous = abortController.current;
    abortController.current = undefined;
    previous?.abort();
    setRunning(false);
    setProgress("");
    setRawProgress("");
    setJobList(record.config.jobs.map((config) => config.jobId));
    setAddingJob(jobIds.find((jobId) => !record.config.jobs.some((config) => config.jobId === jobId)) ?? jobIds[0]!);
    setJobConfigs(Object.fromEntries(record.config.jobs.map((config) => [config.jobId, config])));
    setCommonSlots(record.config.commonSlots.filter((slot): slot is CommonSlot => slot !== "rings"));
    setFoodStrategy(record.config.foodStrategy);
    setObjective(record.config.objective ?? "damage");
    setResult(undefined);
    setResultConfig(undefined);
    setResultKey(undefined);
    setHasAttempted(false);
    setError(undefined);
    setStatusMessage(undefined);
    return true;
  }

  function loadJointHistoryResult(record: SearchHistoryRecord) {
    if (record.kind !== "joint" || !record.result || record.dataVersion !== displayedDataVersion) return;
    if (!loadJointHistoryConfig(record)) return;
    setResult(record.result);
    setResultConfig(record.config);
    setResultKey(JSON.stringify(record.config));
    setHasAttempted(true);
    setStatusMessage("已加载该次联合搜索结果。");
  }

  async function saveHistoryOutcome(id: string, outcome: Parameters<typeof finishSearchHistory>[1]) {
    try { await finishSearchHistory(id, outcome); }
    catch (caught) { setHistoryError("搜索记录保存失败：" + searchMessageText(caught instanceof Error ? caught.message : String(caught))); }
    setHistoryRefresh((value) => value + 1);
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
    setRawProgress("正在准备所有职业的候选装备…");
    setError(undefined);
    setStatusMessage(undefined);
    setHasAttempted(true);
    setResult(undefined);
    setResultKey(undefined);
    setHistoryError(undefined);
    let historyId: string | undefined;
    try {
      const record = await createSearchHistory({ kind: "joint", config: currentConfig, dataVersion: displayedDataVersion });
      historyId = record.id;
      setHistoryRefresh((value) => value + 1);
      if (controller.signal.aborted) throw new Error("联合搜索已取消。");
      const searchResult = await optimizeJoint(currentConfig, {
        signal: controller.signal,
        onProgress: (message) => {
          if (controller.signal.aborted || abortController.current !== controller) return;
          setRawProgress(message);
          setProgress(searchProgressText(message));
        },
      });
      await saveHistoryOutcome(historyId, searchResult ? { status: "completed", result: searchResult } : { status: "no-result" });
      if (controller.signal.aborted || abortController.current !== controller) return;
      setResult(searchResult);
      if (searchResult) { setResultKey(currentKey); setResultConfig(currentConfig); }
      setStatusMessage(
        searchResult
          ? "联合搜索已完成。"
          : "当前约束下没有满足条件的联合配装，请调整条件后重试。",
      );
    } catch (caught) {
      if (historyId) await saveHistoryOutcome(historyId, controller.signal.aborted ? { status: "cancelled" } : { status: "failed", error: searchMessageText(caught instanceof Error ? caught.message : String(caught)) });
      if (abortController.current !== controller) return;
      if (controller.signal.aborted) {
        setHasAttempted(false);
        setStatusMessage("联合搜索已取消。");
      } else {
        setError(searchMessageText(caught instanceof Error ? caught.message : String(caught)));
      }
    } finally {
      if (abortController.current === controller) {
        abortController.current = undefined;
        setRunning(false);
        setProgress("");
        setRawProgress("");
      }
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
        {historyError && <p role="alert" className="history-error">{historyError}</p>}
        <SearchHistory kind="joint" currentDataVersion={displayedDataVersion} refreshKey={historyRefresh} onLoadConfig={loadJointHistoryConfig} onLoadResult={loadJointHistoryResult} />
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
          {result && !stale && (
            <div className="head-actions">
              <span className={"completion-chip " + (jointCompleted ? "complete" : "incomplete")}>
                <span className="status-dot" />
                {jointCompleted ? "搜索已完成" : "未完成证明"}
              </span>
            </div>
          )}
        </div>

        <StatusPanel
          running={running}
          progress={progress}
          rawProgress={rawProgress}
          error={error}
          message={stale ? undefined : statusMessage}
          onCancel={cancelSearch}
        />

        <div className="job-config-list">
          {jobList.map((jobId) => {
            const jobConfig = jobConfigs[jobId] ?? makeConfig(jobId);
            return (
            <details className="job-config-card" key={jobId}>
              <summary>
                <span>
                  <strong>{jobSchemas[jobId].name}</strong>
                  <small className="job-config-summary">{jointJobSummary(jobConfig)}</small>
                </span>
                <span className="summary-chevron">⌄</span>
              </summary>
              <div className="job-config-card-body">
                <JobConfigFields
                  config={jobConfig}
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
            );
          })}
        </div>

        <section className="joint-condition-review" aria-label="联合搜索条件检查">
          <h2>开始前检查</h2>
          <p>参与职业：{jobList.map((id) => jobSchemas[id].name).join("、")}；目标：{objective === "damage" ? "每威力伤害期望" : "按 GCD 折算"}。</p>
          <p>共享部位：{commonSlots.map((slot) => slotLabels[slot]).join("、") || "不共享"}；食物：{foodStrategy === "shared" ? "所有职业共用" : "各职业独立选择"}。各职业已启用的限制显示在上方折叠摘要中。</p>
        </section>

        {result && !stale && (
          <>
            <section className="result-config-snapshot" aria-label="本次联合结果的共享条件">
              <h2>本次联合搜索条件</h2>
              <p className="field-hint">以下记录绑定本次结果；各职业完整条件在对应结果末尾展示。</p>
              <dl className="snapshot-rows">
                <div><dt>参与职业</dt><dd>{(resultConfig ?? currentConfig).jobs.map((config) => jobSchemas[config.jobId].name).join("、")}</dd></div>
                <div><dt>联合目标</dt><dd>{(resultConfig ?? currentConfig).objective === "dps" ? "按 GCD 折算" : "每威力伤害期望"}</dd></div>
                <div><dt>共享部位</dt><dd>{(resultConfig ?? currentConfig).commonSlots.map((slot) => slot === "rings" ? "两个戒指" : slotLabels[slot]).join("、") || "不共享"}</dd></div>
                <div><dt>食物策略</dt><dd>{(resultConfig ?? currentConfig).foodStrategy === "shared" ? "所有职业共用" : "各职业独立选择"}</dd></div>
              </dl>
            </section>
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

        {(!result || stale) && !running && (
          <div className="empty-state joint-empty-state">
            <div className="empty-icon">
              {hasAttempted && !stale ? <X size={19} /> : <ArrowRight size={20} />}
            </div>
            <h2>
              {error
                ? "搜索未完成"
                : hasAttempted && !stale
                  ? "没有可行联合方案"
                  : "准备联合搜索"}
            </h2>
            <p>
              {error
                ? "请查看上方错误信息，修正条件后重新搜索。"
                : hasAttempted && !stale
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
