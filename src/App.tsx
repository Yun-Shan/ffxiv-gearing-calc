import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import {
  Check,
  CircleHelp,
  Play,
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
  getGearById,
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
import { AppHeader, type AppPage } from "./ui/app-header/AppHeader";
import { SingleWorkbenchLayout, SingleWorkbenchFlow } from "./ui/single-workbench/layout/SingleWorkbenchLayout";
import { SingleWorkbenchMain } from "./ui/single-workbench/main/SingleWorkbenchMain";
import { SingleWorkbenchSidebar } from "./ui/single-workbench/sidebar/SingleWorkbenchSidebar";
import { SingleConditionSummary } from "./ui/single-workbench/summary/SingleConditionSummary";
import { SingleCombatSpeedSection } from "./ui/single-workbench/combat/SingleCombatSpeedSection";
import { SingleEquipmentRangeSection } from "./ui/single-workbench/range/SingleEquipmentRangeSection";
import { SingleEquipmentRestrictionsSection } from "./ui/single-workbench/restrictions/SingleEquipmentRestrictionsSection";
import { SearchableGearDropdown as SearchableDropdown, VirtualGearOptions } from "./ui/single-workbench/restrictions/SearchableGearDropdown";
import { GearMark } from "./ui/single-workbench/restrictions/GearMark";
import { SearchProgress } from "./ui/SearchProgress";
import { ConfigSnapshot } from "./ui/ConfigSnapshot";
import { SearchHistory } from "./ui/SearchHistory";
import { JobSelectionSidebar } from "./ui/single-workbench/JobSelectionSidebar";
import { SingleSearchProgress } from "./ui/SingleSearchProgress";
import { JointSearchProgress } from "./ui/JointSearchProgress";
import { JointConditionsScreen } from "./ui/joint-workbench/JointConditionsScreen";
import { JointJobSelection } from "./ui/joint-workbench/JointJobSelection";
import { JointResultsScreen } from "./ui/joint-workbench/JointResultsScreen";
import { JointCommonGearSection } from "./ui/joint-workbench/JointCommonGearSection";
import { JointProfessionResult } from "./ui/joint-workbench/JointProfessionResult";
import { SingleJobResultView } from "./ui/single-result/SingleJobResultView";
import { SingleJobGearTable } from "./ui/single-result/SingleJobGearTable";
import { stringifyReferenceGearset } from "./ui/reference-gearset-share";
import type {
  SingleSearchCurrentModelMetrics,
  SingleSearchProgressState,
  SingleSearchSlotCandidateCount,
} from "./ui/SingleSearchProgress";
import type {
  JointSearchPhase,
  JointSearchProgressState,
  JointSearchStats,
  JointSearchSummary,
} from "./ui/JointSearchProgress";
import { createSearchHistory, finishSearchHistory, type SearchHistoryRecord } from "./ui/search-history";
import type { WizardStep } from "./ui/WizardNavigation";

const displayedDataVersion = dataProvenance.sources?.find((source) => source.kind === "mcp" && source.gameVersion)?.gameVersion ?? dataProvenance.commit.slice(0, 12);

type Page = AppPage;
type JointView = "selection" | "conditions" | "progress" | "result";
type SingleGcdMode = "any" | "tiers" | "speed";
type SingleGcdFeasibility = {
  key: string;
  status: "loading" | "ready" | "error";
  tiers: number[];
  error?: string;
};
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

const bounds = [gameData.gearMinLevel, gameData.gearMaxLevel] as const;
const availableFoods = foods.filter((food) => food.best && food.stats.VIT);
const defaultJobLevel = 100;
// Mirrors the entries marked popular in Asvel's sync-level selector.
const popularSyncLevels = [795, 735, 700, 695, 665, 635, 605, 475, 375, 345, 300] as const;
const selectableSyncLevels = popularSyncLevels.filter((level) =>
  gameData.levelCaps.level.includes(level),
);
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

function normalizeSingleWorkbenchConfig(config: OptimizationConfig): OptimizationConfig {
  if (config.gcdChoices !== undefined || config.gcdTarget === undefined) return { ...config };
  return {
    ...config,
    gcdTarget: undefined,
    gcdChoices: [config.gcdTarget],
    objective: "damage",
  };
}

function singleGcdModeForConfig(config: OptimizationConfig): SingleGcdMode {
  if (config.speedMin !== undefined || config.speedMax !== undefined) return "speed";
  return config.gcdTarget !== undefined || config.gcdChoices !== undefined ? "tiers" : "speed";
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
  return jobId === "PLD" || jobId === "BST"
    ? combatSlots
    : combatSlots.filter((slot) => slot !== "offhand");
}

function setConfigPatch(
  setConfig: Dispatch<SetStateAction<OptimizationConfig>>,
  patch: Partial<OptimizationConfig>,
) {
  setConfig((current) => ({ ...current, ...patch }));
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
  className,
}: {
  label: string;
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  placeholder?: string;
  className?: string;
}) {
  return (
    <label className={className ? `number-field ${className}` : "number-field"}>
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
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={className ? `config-field ${className}` : "config-field"}>
      <span className="field-label">{label}</span>
      <select disabled={disabled} value={value} onChange={(event) => onChange(event.target.value)}>
        {children}
      </select>
    </label>
  );
}

function SyncLevelField({
  value,
  onChange,
  inactiveLabel,
  className,
}: {
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  inactiveLabel: string;
  className?: string;
}) {
  return (
    <SelectField
      label="同步品级"
      value={value === undefined ? "" : String(value)}
      className={className}
      onChange={(selected) => onChange(selected === "" ? undefined : Number(selected))}
    >
      <option value="">{inactiveLabel}</option>
      {selectableSyncLevels.map((level) => (
        <option key={level} value={level}>{level}</option>
      ))}
    </SelectField>
  );
}

function JobConfigFields({
  config,
  setConfig,
  showFood,
  step = "all",
  singleWorkbench = false,
  singleGcdMode,
  onSingleGcdModeChange,
  onSingleGcdFeasibilityChange,
  singleObjectiveLabel,
  onEdited,
}: {
  config: OptimizationConfig;
  setConfig: Dispatch<SetStateAction<OptimizationConfig>>;
  showFood: boolean;
  step?: WizardStep | "all";
  singleWorkbench?: boolean;
  singleGcdMode?: SingleGcdMode;
  onSingleGcdModeChange?: (mode: SingleGcdMode) => void;
  onSingleGcdFeasibilityChange?: Dispatch<SetStateAction<SingleGcdFeasibility | undefined>>;
  singleObjectiveLabel?: string;
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
  const [gcdQueryAttempt, setGcdQueryAttempt] = useState(0);
  const [gcdProgress, setGcdProgress] = useState("");
  const [gcdError, setGcdError] = useState<string>();
  const [gcdDropdownOpen, setGcdDropdownOpen] = useState(false);
  const [visibleGcdChipCount, setVisibleGcdChipCount] = useState(Number.MAX_SAFE_INTEGER);
  const gcdChipsRef = useRef<HTMLSpanElement>(null);
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
      gear: getGearById(id),
    }));
  const selectedForcedGear = forcedGearSelection === undefined
    ? undefined
    : jobGears.find((gear) => gear.id === forcedGearSelection);
  const excludedGears = (config.excludedGearIds ?? [])
    .map((id) => getGearById(id))
    .filter((gear): gear is Gear => gear !== undefined);
  const availableSlots = slotsForJob(config.jobId);
  const selectedGcds = config.gcdChoices ?? (config.gcdTarget === undefined ? [] : [config.gcdTarget]);
  const selectedGcdKey = selectedGcds.join(",");
  const gcdMode = singleWorkbench
    ? singleGcdMode === "speed" ? "speed" : singleGcdMode === "tiers" ? "multiple" : "any"
    : config.gcdChoices !== undefined
      ? "multiple"
      : config.gcdTarget === undefined
        ? "any"
        : "single";

  useLayoutEffect(() => {
    const chips = gcdChipsRef.current;
    if (!chips) return;

    const fitVisibleChips = () => {
      const availableWidth = chips.getBoundingClientRect().width;
      if (availableWidth <= 0 || selectedGcds.length === 0) return;

      const measuredChipWidth = chips.querySelector<HTMLElement>(".single-gcd-chip-measure:not(.is-overflow)")
        ?.getBoundingClientRect().width ?? 0;
      const measuredOverflowWidth = chips.querySelector<HTMLElement>(".single-gcd-chip-measure.is-overflow")
        ?.getBoundingClientRect().width ?? 0;
      const chipWidth = measuredChipWidth || 50;
      const overflowWidth = measuredOverflowWidth || 26;
      const gap = Number.parseFloat(getComputedStyle(chips).columnGap) || 0;
      let fittedCount = selectedGcds.length;

      while (fittedCount > 0) {
        const chipRowWidth = fittedCount * chipWidth + Math.max(0, fittedCount - 1) * gap;
        const overflowGap = fittedCount > 0 ? gap : 0;
        const needsOverflow = fittedCount < selectedGcds.length;
        if (chipRowWidth + (needsOverflow ? overflowGap + overflowWidth : 0) <= availableWidth) break;
        fittedCount -= 1;
      }

      if (fittedCount < selectedGcds.length && overflowWidth > availableWidth) fittedCount = 0;
      setVisibleGcdChipCount((current) => current === fittedCount ? current : fittedCount);
    };

    fitVisibleChips();
    const resizeObserver = typeof ResizeObserver === "undefined"
      ? undefined
      : new ResizeObserver(fitVisibleChips);
    resizeObserver?.observe(chips);
    window.addEventListener("resize", fitVisibleChips);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", fitVisibleChips);
    };
  }, [selectedGcdKey, gcdMode]);
  const gcdQueryKey = JSON.stringify({
    ...config,
    objective: undefined,
    gcdTarget: undefined,
    gcdChoices: undefined,
  });
  const gcdQueryConfig = useMemo<OptimizationConfig>(
    () => ({ ...config, objective: "damage", gcdTarget: undefined, gcdChoices: undefined }),
    [gcdQueryKey],
  );
  const gcdSelectionReady =
    feasibleGcdsKey === gcdQueryKey && feasibleGcds !== undefined;
  const unavailableSelectedGcds = gcdSelectionReady
    ? selectedGcds.filter((gcd) => !feasibleGcds?.includes(gcd))
    : [];
  const speedStatName =
    jobSchemas[config.jobId].role === "healer" ||
    jobSchemas[config.jobId].role === "int"
      ? "咏速"
      : "技速";

  useEffect(() => {
    if (!singleWorkbench) return;
    if (singleGcdMode !== "tiers") {
      setFindingGcds(false);
      setGcdProgress("");
      setGcdError(undefined);
      onSingleGcdFeasibilityChange?.(undefined);
      return;
    }
    if (gcdSelectionReady) {
      setFindingGcds(false);
      setGcdProgress("");
      setGcdError(undefined);
      onSingleGcdFeasibilityChange?.((current) => {
        const tiers = feasibleGcds ?? [];
        return current?.key === gcdQueryKey && current.status === "ready" &&
          current.tiers.length === tiers.length && current.tiers.every((tier, index) => tier === tiers[index])
          ? current
          : { key: gcdQueryKey, status: "ready", tiers };
      });
      return;
    }
    gcdAbortController.current?.abort();
    const controller = new AbortController();
    gcdAbortController.current = controller;
    setFindingGcds(true);
    setGcdError(undefined);
    onSingleGcdFeasibilityChange?.((current) =>
      current?.key === gcdQueryKey && current.status === "loading"
        ? current
        : { key: gcdQueryKey, status: "loading", tiers: [] },
    );
    const timer = window.setTimeout(() => {
      findFeasibleGcds(gcdQueryConfig, {
        signal: controller.signal,
        onProgress: (message) => setGcdProgress(searchProgressText(message)),
      }).then((choices) => {
        if (controller.signal.aborted) return;
        setFeasibleGcds(choices);
        setFeasibleGcdsKey(gcdQueryKey);
        onSingleGcdFeasibilityChange?.({ key: gcdQueryKey, status: "ready", tiers: choices });
        setGcdProgress("");
        setFindingGcds(false);
      }).catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        const message = searchMessageText(caught instanceof Error ? caught.message : String(caught));
        setGcdError(message);
        onSingleGcdFeasibilityChange?.({ key: gcdQueryKey, status: "error", tiers: [], error: message });
        setGcdProgress("");
        setFindingGcds(false);
      });
    }, 180);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
      if (gcdAbortController.current === controller) gcdAbortController.current = undefined;
    };
  }, [singleWorkbench, singleGcdMode, gcdSelectionReady, gcdQueryKey, gcdQueryConfig, gcdQueryAttempt, feasibleGcds, onSingleGcdFeasibilityChange]);

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

  function setSingleMode(mode: SingleGcdMode) {
    onEdited?.();
    onSingleGcdModeChange?.(mode);
    setGcdDropdownOpen(false);
    setConfig((current) => {
      if (mode === "any") {
        return { ...current, gcdTarget: undefined, gcdChoices: undefined, speedMin: undefined, speedMax: undefined, objective: "dps" };
      }
      if (mode === "tiers") {
        const choices = current.gcdChoices ?? (current.gcdTarget === undefined ? [] : [current.gcdTarget]);
        return {
          ...current,
          gcdTarget: undefined,
          gcdChoices: choices,
          speedMin: undefined,
          speedMax: undefined,
          objective: choices.length === 1 ? "damage" : "dps",
        };
      }
      return { ...current, gcdTarget: undefined, gcdChoices: undefined, objective: "dps" };
    });
    setGcdChoicesText("");
    setGcdChoicesDirty(false);
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
          <SyncLevelField
            value={config.syncLevel}
            inactiveLabel="不启用"
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

      <SingleCombatSpeedSection enabled={singleWorkbench}>
      {(step === "all" || step === 2) && <details className={`advanced-section${singleWorkbench ? " single-combat-conditions" : ""}`} open={singleWorkbench ? true : undefined}>
      {singleWorkbench && <summary aria-hidden="true" />}
      {!singleWorkbench && <summary>
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
      </summary>}
      <div className={singleWorkbench ? "config-section single-gcd-section" : "config-section"}>
        {singleWorkbench ? <>
          <div className="single-gcd-controls">
            <span className="single-gcd-label">GCD 约束</span>
            <span className="single-gcd-mode-control">
              <select
                aria-label="GCD 约束类型"
                value={gcdMode}
                onChange={(event) => setSingleMode(event.target.value === "multiple" ? "tiers" : event.target.value as SingleGcdMode)}
              >
                <option value="any">不限</option>
                <option value="multiple">指定 GCD 档位</option>
                <option value="speed">自定义速度范围</option>
              </select>
              <span className="single-gcd-mode-caret" aria-hidden="true">⌄</span>
            </span>
            {gcdMode === "multiple" && <div className="single-gcd-choice-control">
              <button
                type="button"
                className="single-gcd-choice-trigger"
                aria-label="选择 GCD 档位"
                aria-expanded={gcdDropdownOpen}
                onClick={() => setGcdDropdownOpen((open) => !open)}
              >
                {selectedGcds.length > 0 ? <span className="single-gcd-chips" ref={gcdChipsRef}>
                  {selectedGcds.slice(0, visibleGcdChipCount).map((gcd) => <span className="single-gcd-chip" key={gcd}>{gcd.toFixed(2)} 秒</span>)}
                  {selectedGcds.length > visibleGcdChipCount && <span className="single-gcd-chip is-overflow">…</span>}
                  <span className="single-gcd-chip single-gcd-chip-measure" aria-hidden="true">0.00 秒</span>
                  <span className="single-gcd-chip is-overflow single-gcd-chip-measure" aria-hidden="true">…</span>
                </span> : <span className="single-gcd-choice-placeholder">
                  {findingGcds ? "正在查询档位" : gcdSelectionReady && feasibleGcds?.length === 0 ? "当前无可行档位" : "选择档位"}
                </span>}
                <span className="single-gcd-choice-caret" aria-hidden="true">⌄</span>
              </button>
              {gcdDropdownOpen && <div className="single-gcd-choice-menu" role="group" aria-label="可行 GCD 档位">
                {!gcdSelectionReady && <p className="single-gcd-choice-empty">{findingGcds ? "正在查询可行档位…" : "等待可行档位查询"}</p>}
                {gcdSelectionReady && feasibleGcds?.length === 0 && <p className="single-gcd-choice-empty">当前条件下没有可行档位。</p>}
                {gcdSelectionReady && feasibleGcds?.map((gcd) => <label className="single-gcd-choice-option" key={gcd}>
                  <input
                    type="checkbox"
                    checked={selectedGcds.includes(gcd)}
                    onChange={(event) => toggleFeasibleGcd(gcd, event.target.checked)}
                  />
                  <span>{gcd.toFixed(2)} 秒</span>
                  {selectedGcds.includes(gcd) && <Check size={14} aria-hidden="true" />}
                </label>)}
                {unavailableSelectedGcds.map((gcd) => <label className="single-gcd-choice-option is-unavailable" key={`unavailable-${gcd}`}>
                  <input
                    type="checkbox"
                    checked
                    onChange={() => toggleFeasibleGcd(gcd, false)}
                  />
                  <span>{gcd.toFixed(2)} 秒 · 当前条件下不可行</span>
                </label>)}
                <p className="single-gcd-choice-note">{gcdSelectionReady ? "档位数量按选择结果自动适配" : "档位按当前职业与搜索条件查询"}</p>
              </div>}
            </div>}
            {gcdMode === "speed" && <div className="single-speed-inline">
              <span>{speedStatName}</span>
              <label><span className="sr-only">最低{speedStatName}</span><input type="number" min={0} value={config.speedMin ?? ""} placeholder="最低" onChange={(event) => update("speedMin", event.target.value === "" ? undefined : Number(event.target.value))} /></label>
              <span className="single-speed-separator">–</span>
              <label><span className="sr-only">最高{speedStatName}</span><input type="number" min={0} value={config.speedMax ?? ""} placeholder="最高" onChange={(event) => update("speedMax", event.target.value === "" ? undefined : Number(event.target.value))} /></label>
            </div>}
          </div>
          {singleObjectiveLabel && <section className="single-objective-display" aria-label="自动选择的搜索指标">
            <span>当前优化指标</span>
            <strong>{singleObjectiveLabel}</strong>
          </section>}
          {gcdError && <span className="gcd-query-error" role="alert">
            {gcdError}
            {singleGcdMode === "tiers" && <button type="button" className="single-gcd-query-retry" onClick={() => setGcdQueryAttempt((attempt) => attempt + 1)}>重新查询</button>}
          </span>}
        </> : <>
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
          {gcdMode === "single" && <NumberField
            label="目标 GCD"
            value={config.gcdTarget}
            min={1}
            max={5}
            step={0.01}
            unit="秒"
            onChange={(value) => update("gcdTarget", value)}
          />}
          {gcdMode === "multiple" && <label className="number-field">
            <span>可接受的 GCD 档位</span>
            <input type="text" value={gcdChoicesText} placeholder="例如 2.48, 2.50" onChange={(event) => setGcdChoices(event.target.value)} />
            <small>使用逗号分隔，每个档位都作为独立约束参与搜索。</small>
          </label>}
        </>}
        {!singleWorkbench && gcdMode !== "any" && <button
          type="button"
          className="gcd-calculate-button"
          onClick={findingGcds ? () => gcdAbortController.current?.abort() : calculateFeasibleGcds}
        >
          {findingGcds ? <X size={14} /> : <CircleHelp size={14} />}
          {findingGcds ? "取消查询" : "计算可行 GCD 档位"}
        </button>}
        {!singleWorkbench && gcdProgress && <span className="gcd-result-note">{gcdProgress}</span>}
        {!singleWorkbench && gcdError && <span className="gcd-query-error">{gcdError}</span>}
        {!singleWorkbench && gcdSelectionReady && (
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

      {!singleWorkbench && <div className="config-section">
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
              <span className="field-label">坚韧约束</span>
              <select
                aria-label="坚韧约束"
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
      </SingleCombatSpeedSection>

      {(step === "all" || step === 3) && singleWorkbench && <SingleEquipmentRangeSection
        note={jobSchemas[config.jobId].ignoreWeaponItemLevel && <p className="field-hint">武器不按装备品级区间筛选，仍须满足职业与穿戴等级限制。</p>}
      >
          <SyncLevelField
            value={config.syncLevel}
            inactiveLabel="不限"
            className="single-range-sync-field"
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
            className="single-range-food-field"
            onChange={(value) => update("foodId", Number(value))}
          >
            <option value="0">自动选择</option>
            {availableFoods.map((food) => <option key={food.id} value={food.id}>{food.name}</option>)}
          </SelectField>}
      </SingleEquipmentRangeSection>}

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

      {singleWorkbench ? <SingleEquipmentRestrictionsSection
      left={<section className="single-restriction-column single-restriction-left" aria-label="来源与排除装备">
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
                    data-option-kind="source"
                    key={source}
                    onClick={() => update("excludedSources", [...config.excludedSources, source])}
                  >
                    <span>{source}</span>
                    <small>{count} 件装备</small>
                  </button>
                ))}
              {!sourceOptions.some(([source]) => !config.excludedSources.includes(source)) && <p>没有匹配的来源。</p>}
            </SearchableDropdown>
            <div className="single-restriction-selected-list" aria-label="已排除来源">
              {config.excludedSources.map((source) => (
                <div className="single-restriction-row single-restriction-row--source" key={source}>
                  <span className="single-restriction-row-main">
                    <span className="single-restriction-row-name">{source}</span>
                    <span className="single-restriction-count">{jobGears.filter((gear) => gear.source?.startsWith(source)).length} 件</span>
                  </span>
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
                slotLabels={slotLabels}
                onSelect={(gear) => {
                  excludeGear(gear);
                  setEquipmentDropdownOpen(false);
                }}
              /> : <p>没有匹配装备。</p>}
            </SearchableDropdown>
            <div className="single-restriction-selected-list" aria-label="已排除装备">
              {excludedGears.map((gear) => (
                <div className="single-restriction-row single-restriction-row--excluded" key={gear.id}>
                  <span className="single-restriction-row-slot">{slotLabels[gear.slot]}</span>
                  <GearMark />
                  <span className="single-restriction-row-name">{gear.name}</span>
                  <span className="single-restriction-row-source">{gear.source ?? "上游未标注"}</span>
                  <button type="button" aria-label={`恢复装备 ${gear.name}`} onClick={() => update("excludedGearIds", (config.excludedGearIds ?? []).filter((id) => id !== gear.id))}><X size={14} /></button>
                </div>
              ))}
            </div>
          </div>
        </section>}
      right={<section className="single-restriction-column single-forced-gear" aria-label="强制使用装备">
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
              className="single-forced-gear-search"
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
                slotLabels={slotLabels}
                onSelect={(gear) => {
                  setForcedGearSelection(gear.id);
                  setForcedDropdownOpen(false);
                }}
              /> : <p>没有匹配装备。</p>}
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
              <div className="single-restriction-row single-restriction-row--forced" key={slot}>
                <span className="single-restriction-row-slot">{slotLabels[slot]}</span>
                <GearMark />
                <span className="single-restriction-row-name">{gear?.name ?? `装备 ${id}`}</span>
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
        </section>}
      /> : <details className="advanced-section">
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
    <div className="equipment-table-wrap">
    <div className="gear-table equipment-table">
      <div className="gear-table-head">
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
            <>
              <span className="source-text">{item.source ?? "上游未标注"}</span>
              <span className="level-tag">{item.level}</span>
            </>
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
          {Object.entries(actualFoodStats)
            .map(([key, value]) => statName(key) + " " + value)
            .join(" · ") || "无属性加成"}
        </div>
        <div className="melds">
          <span className="food-bonus">实际生效</span>
        </div>
        <>
          <span className="source-text">上游食物数据</span>
          <span className="level-tag">{result.food.level}</span>
        </>
      </div>
    </div>
    </div>
  );
}

type SingleSummaryView = "workbench" | "progress" | "result";

function referenceGearsetUrl(result: OptimizationResult, config: OptimizationConfig): string {
  const job = jobSchemas[config.jobId];
  const gears = result.gear.map((gear) => {
    const synced = config.syncLevel !== undefined && gear.level > config.syncLevel;
    const customStats: Partial<Record<Stat, number>> | undefined = gear.customParameters?.length
      ? Object.fromEntries([...new Set(gear.customParameters.map(({ stat }) => stat))]
          .map((stat) => [stat, Math.max(0, (gear.finalStats[stat] ?? 0) - (gear.stats[stat] ?? 0))] as const)
          .filter(([, value]) => value > 0))
      : undefined;
    return {
      id: gear.id,
      materias: customStats || synced ? [] : gear.melds.map(({ stat, grade }) => [stat, grade] as const),
      ...(customStats ? { customStats } : {}),
    };
  });
  const share = stringifyReferenceGearset({
    job: config.jobId,
    role: job.role,
    jobLevel: config.jobLevel ?? job.maxJobLevel ?? defaultJobLevel,
    ...(config.syncLevel === undefined ? {} : { syncLevel: config.syncLevel }),
    gears,
  });
  return share ? `https://asvel.github.io/ffxiv-gearing/?${share}` : "";
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
  if (compact) {
    return <SingleJobResultView
      result={result}
      referenceUrl={referenceGearsetUrl(result, config)}
      table={<GearTable result={result} config={config} compact />}
      summary={<SingleConditionSummary
        config={config}
        view="result"
        result={result}
        startedAtISO={searchStartedAt}
        dataVersion={resultDataVersion}
      />}
      onEditConfig={onEditConfig}
    />;
  }
  return (
    <div className="result-workspace">
      <div>
      <div className="result-completion" role="status">
        <Check size={18} aria-hidden="true" />
        <div>
          <strong>{stale ? "历史搜索已完成 · 当前条件待更新" : "搜索已完成"}</strong>
          <p>求解与结果复核已完成；最优结果限于本次候选与约束。</p>
        </div>
      </div>
      {stale && <div className="stale-notice result-stale-note" role="status">
        条件已修改，以下配装对应上一组条件，不代表当前设置的推荐结果。
      </div>}
      <div className="metric-strip result-conclusion">
        <Metric
          label="每威力伤害期望"
          value={result.effects.damage.toFixed(7)}
        />
        <Metric label="GCD" value={result.effects.gcd.toFixed(2) + " 秒"} />
        <Metric label="暴击率" value={(result.effects.crtChance * 100).toFixed(1) + "%"} />
        <Metric label="直击率" value={(result.effects.dhtChance * 100).toFixed(1) + "%"} />
        <Metric label="按 GCD 折算" value={result.damagePerSecond.toFixed(7)} />
      </div>
      <div className="result-toolbar">
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
      </div>
      <GearTable result={result} config={config} />
      </div>
      <div>
      <div className="result-section result-attributes">
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
            <span>坚韧伤害加成</span>
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
      <ConfigSnapshot config={config} onEdit={onEditConfig} />
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

function SinglePage({ onReset }: { onReset: () => void }) {
  const [selectedJob, setSelectedJob] = useState<JobId | null>(null);
  const [config, setConfig] = useState<OptimizationConfig>(() => makeConfig("PLD"));
  const [singleGcdMode, setSingleGcdMode] = useState<SingleGcdMode>("any");
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
    startedAt: Date.now(),
    hasFeasibleCandidate: false,
  });
  const [activeSearchConfig, setActiveSearchConfig] = useState<OptimizationConfig>();
  const [customGcdCoverage, setCustomGcdCoverage] = useState<{ key: string; tiers: number[] }>();
  const [customGcdError, setCustomGcdError] = useState<string>();
  const [singleGcdFeasibility, setSingleGcdFeasibility] = useState<SingleGcdFeasibility>();
  const abortController = useRef<AbortController | undefined>(undefined);

  const currentKey = selectedJob ? JSON.stringify(config) : "";
  const stale = result !== undefined && resultKey !== currentKey;
  const job = selectedJob ? jobSchemas[selectedJob] : undefined;
  const customSpeedHasBounds = config.speedMin !== undefined || config.speedMax !== undefined;
  const customSpeedActive = singleGcdMode === "speed" || customSpeedHasBounds;
  const gcdSelectionActive = singleGcdMode === "tiers" || config.gcdTarget !== undefined || config.gcdChoices !== undefined;
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
  const currentTierFeasibility =
    singleGcdFeasibility?.key === customGcdQueryKey ? singleGcdFeasibility : undefined;
  const selectedGcds = config.gcdChoices ?? (config.gcdTarget === undefined ? [] : [config.gcdTarget]);
  const selectedGcdsAreFeasible = currentTierFeasibility?.status === "ready" &&
    selectedGcds.length > 0 && selectedGcds.every((gcd) => currentTierFeasibility.tiers.includes(gcd));
  const selectedGcdsIncludeUnavailable = currentTierFeasibility?.status === "ready" &&
    selectedGcds.some((gcd) => !currentTierFeasibility.tiers.includes(gcd));
  const derivedObjective = hasLegacyGcdSpeedConflict
    ? undefined
    : customSpeedActive
      ? !customSpeedHasBounds
        ? "dps"
        : currentGcdCoverage === undefined
          ? undefined
          : currentGcdCoverage.length === 1 ? "damage" : "dps"
      : singleGcdMode === "tiers"
        ? (config.gcdChoices?.length ?? 0) === 1 ? "damage" : "dps"
        : config.gcdTarget !== undefined || (config.gcdChoices?.length ?? 0) === 1
        ? "damage"
        : "dps";
  const displayObjective = derivedObjective ?? config.objective ?? "damage";
  const canStartSearch =
    selectedJob !== null &&
    !hasLegacyGcdSpeedConflict &&
    (singleGcdMode === "tiers"
      ? selectedGcdsAreFeasible
      : customSpeedActive
        ? !customSpeedHasBounds || (currentGcdCoverage !== undefined && currentGcdCoverage.length > 0)
        : true) &&
    !running;
  const singleGcdActionMessage = hasLegacyGcdSpeedConflict
    ? "请先选择 GCD 条件或自定义速度范围。"
    : singleGcdMode === "tiers"
      ? !currentTierFeasibility || currentTierFeasibility.status === "loading"
        ? "正在查询当前条件下的可行 GCD 档位…"
        : currentTierFeasibility.status === "error"
          ? "可行 GCD 档位查询失败，请重新查询。"
          : selectedGcds.length === 0
            ? "请选择至少一个可行 GCD 档位。"
            : selectedGcdsIncludeUnavailable
              ? "请移除当前条件下不可行的已选 GCD 档位。"
              : "已就绪 · 搜索结果将严格满足以上条件"
      : customSpeedActive && customSpeedHasBounds && currentGcdCoverage === undefined
        ? "正在计算速度范围覆盖的 GCD 档位…"
        : customSpeedActive && customSpeedHasBounds && currentGcdCoverage?.length === 0
          ? "当前速度范围没有可行 GCD 档位。"
          : "已就绪 · 搜索结果将严格满足以上条件";

  useEffect(() => () => {
    abortController.current?.abort();
  }, []);

  useEffect(() => {
    if (view !== "workbench" || !selectedJob || !customSpeedActive || !customSpeedHasBounds || gcdSelectionActive) {
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
  }, [view, selectedJob, customSpeedActive, customSpeedHasBounds, gcdSelectionActive, customGcdQueryKey, customGcdQueryConfig]);

  useEffect(() => {
    if (view !== "workbench" || !selectedJob || hasLegacyGcdSpeedConflict || !derivedObjective) return;
    setConfig((current) => current.objective === derivedObjective
      ? current
      : { ...current, objective: derivedObjective });
  }, [view, selectedJob, hasLegacyGcdSpeedConflict, derivedObjective]);

  function cancelSearch() {
    abortController.current?.abort();
  }

  function abortSearchForNavigation() {
    const controller = abortController.current;
    abortController.current = undefined;
    controller?.abort();
    setRunning(false);
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
    setConfig({ ...makeConfig(jobId), objective: "dps" });
    setSingleGcdMode("any");
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
    abortSearchForNavigation();
    setSelectedJob(record.config.jobId);
    const loadedConfig = normalizeSingleWorkbenchConfig({
      ...record.config,
      jobLevel: jobSchemas[record.config.jobId].maxJobLevel ?? defaultJobLevel,
    });
    if (
      singleGcdModeForConfig(loadedConfig) === "speed" &&
      loadedConfig.speedMin === undefined &&
      loadedConfig.speedMax === undefined
    ) {
      loadedConfig.objective = "dps";
    }
    setConfig(loadedConfig);
    setSingleGcdMode(singleGcdModeForConfig(loadedConfig));
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
    abortSearchForNavigation();
    setSelectedJob(record.config.jobId);
    const loadedConfig = normalizeSingleWorkbenchConfig(record.config);
    setConfig(loadedConfig);
    setSingleGcdMode(singleGcdModeForConfig(loadedConfig));
    setResult(record.result);
    setResultConfig(record.config);
    setResultStartedAt(record.startedAtISO);
    setResultDataVersion(record.dataVersion);
    setResultKey(JSON.stringify(loadedConfig));
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
    setActiveSearchConfig(searchConfig);
    setSearchProgress({
      phase: "prepare",
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
          const verificationStarted =
            message.includes("还原并复核") ||
            message.includes("精确候选已核验") ||
            message.includes("签名带");
          setSearchProgress((current) => ({
            ...current,
            phase: verificationStarted ? "verify" : current.phase === "prepare" ? "solve" : current.phase,
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
            return {
              ...current,
              phase: secondRoundModel ? "verify" : current.phase === "prepare" ? "solve" : current.phase,
              hasFeasibleCandidate: current.hasFeasibleCandidate || foundObjectiveCandidate,
              currentModel: model,
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

  const objectiveLabel = displayObjective === "dps" ? "每秒每威力伤害期望" : "每威力伤害期望";

  function keepGcdAndClearSpeed() {
    setConfig((current) => {
      const normalized = normalizeSingleWorkbenchConfig(current);
      const objective = normalized.gcdTarget !== undefined || normalized.gcdChoices?.length === 1 ? "damage" : "dps";
      return { ...normalized, speedMin: undefined, speedMax: undefined, objective };
    });
    const normalized = normalizeSingleWorkbenchConfig(config);
    setSingleGcdMode(normalized.gcdTarget !== undefined || normalized.gcdChoices !== undefined ? "tiers" : "any");
    setCustomGcdCoverage(undefined);
    clearOutcomeMessages();
  }

  function keepSpeedAndClearGcd() {
    setConfig((current) => ({ ...current, gcdTarget: undefined, gcdChoices: undefined }));
    setSingleGcdMode("speed");
    setCustomGcdCoverage(undefined);
    clearOutcomeMessages();
  }

  const searchHistory = (
    <SearchHistory
      kind="single"
      currentDataVersion={displayedDataVersion}
      refreshKey={historyRefresh}
      defaultOpen={view === "choose"}
      hideSummary={view === "choose"}
      onLoadConfig={loadHistoryConfig}
      onLoadResult={loadHistoryResult}
    />
  );

  return (
    <>
    <AppHeader
      page="single"
    />
    <SingleWorkbenchFlow workbench={view === "workbench"}>
      {view === "choose" && <div className="single-selection-layout">
        <section className="single-job-selection" aria-labelledby="single-selection-title">
          <header className="single-selection-heading">
            <p className="single-section-kicker">单职业配装 · 配装流程</p>
            <h1 id="single-selection-title">选择职业</h1>
          </header>
          <JobPicker value={selectedJob} onChange={chooseJob} />
          {searchHistory}
        </section>
        <JobSelectionSidebar dataVersion={displayedDataVersion} onReset={onReset} />
      </div>}

      {view === "workbench" && selectedJob && job && <SingleWorkbenchLayout
        main={<SingleWorkbenchMain
          roleLabel={job.role === "tank" ? "坦克" : roleNames[job.role]}
          jobName={job.name}
          onChangeJob={() => setView("choose")}
          notices={<>
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
          </>}
          status={!result && <StatusPanel
            running={false}
            progress=""
            error={error}
            message={statusMessage}
            onCancel={cancelSearch}
          />}
          fields={<JobConfigFields
            config={{ ...config, objective: displayObjective }}
            setConfig={setConfig}
            showFood
            step="all"
            singleWorkbench
            singleGcdMode={singleGcdMode}
            onSingleGcdModeChange={setSingleGcdMode}
            onSingleGcdFeasibilityChange={setSingleGcdFeasibility}
            singleObjectiveLabel={objectiveLabel}
            onEdited={clearOutcomeMessages}
          />}
          outcome={hasAttempted && (error || statusMessage) && !result && <ResultPanel
            config={config}
            attempted={hasAttempted}
            failed={error !== undefined}
            statusMessage={statusMessage}
          />}
        />}
        sidebar={<SingleWorkbenchSidebar
          summary={<SingleConditionSummary
            config={{ ...config, objective: displayObjective }}
            view="workbench"
            gcdMode={singleGcdMode}
          />}
          status={singleGcdActionMessage}
          canStartSearch={canStartSearch}
          onStartSearch={runSearch}
          onReset={onReset}
          history={searchHistory}
        />}
      />}

      {view === "progress" && activeSearchConfig && selectedJob && <SingleSearchProgress
        jobName={jobSchemas[selectedJob].name}
        progress={searchProgress}
        rightSummary={<SingleConditionSummary config={activeSearchConfig} view="progress" />}
        onCancel={cancelSearch}
        onReset={onReset}
        history={searchHistory}
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
    </SingleWorkbenchFlow>
    </>
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
  const sync = config.syncLevel === undefined
    ? "同步未启用"
    : `同步品级 ${config.syncLevel}`;
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
  return `${config.jobLevel ?? job.maxJobLevel ?? defaultJobLevel} 级 · 品级 ${config.minItemLevel}–${config.maxItemLevel} · ${sync} · ${food} · ${gcd} · ${speed} · 装备限制 ${restrictionCount} 项${tankConditions}`;
}

function cloneJointConfig(config: JointOptimizationConfig): JointOptimizationConfig {
  return {
    ...config,
    commonSlots: [...config.commonSlots],
    jobs: config.jobs.map((job) => ({
      ...job,
      gcdChoices: job.gcdChoices ? [...job.gcdChoices] : undefined,
      excludedSources: [...job.excludedSources],
      excludedGearIds: job.excludedGearIds ? [...job.excludedGearIds] : undefined,
      forcedGear: { ...job.forcedGear },
      sharedSlots: job.sharedSlots ? [...job.sharedSlots] : undefined,
    })),
  };
}

function jointProgressSummary(config: JointOptimizationConfig): JointSearchSummary {
  return {
    jobs: config.jobs.map((job) => {
      const schema = jobSchemas[job.jobId];
      const speedLabel = schema.role === "healer" || schema.role === "int" ? "咏速" : "技速";
      const gcd = job.gcdChoices?.length
        ? job.gcdChoices.map((value) => value.toFixed(2)).join("、") + " 秒"
        : job.gcdTarget === undefined
          ? "不限"
          : job.gcdTarget.toFixed(2) + " 秒";
      const speed = job.speedMin === undefined && job.speedMax === undefined
        ? "不限"
        : `${job.speedMin ?? "不限"}–${job.speedMax ?? "不限"}`;
      const food = job.foodId === 0
        ? "自动食物"
        : foods.find((item) => item.id === job.foodId)?.name ?? `食物 ${job.foodId}`;
      const restrictionCount = job.excludedSources.length +
        (job.excludedGearIds?.length ?? 0) +
        Object.values(job.forcedGear).filter((id) => id !== undefined).length;
      const details = [
        { label: "等级", value: `${job.jobLevel ?? schema.maxJobLevel ?? defaultJobLevel} 级` },
        { label: "品级", value: `${job.minItemLevel}–${job.maxItemLevel}` },
        { label: "同步", value: job.syncLevel === undefined ? "未启用" : String(job.syncLevel) },
        { label: "食物", value: food },
        { label: "GCD", value: gcd },
        { label: speedLabel, value: speed },
        { label: "装备限制", value: `${restrictionCount} 项` },
      ];
      if (job.minTenacity !== undefined) details.push({ label: "最低坚韧", value: String(job.minTenacity) });
      if (job.toughnessMinPercent !== undefined) details.push({ label: "坚韧比例", value: `${job.toughnessMinPercent}%` });
      if (job.maximizeTenacity) details.push({ label: "坚韧目标", value: "尽可能提高" });
      return { jobId: job.jobId, name: schema.name, details };
    }),
    objective: config.objective === "dps" ? "按 GCD 折算" : "每威力伤害期望",
    commonSlots: config.commonSlots.map((slot) => slot === "rings" ? "两个戒指" : slotLabels[slot]),
    foodStrategy: config.foodStrategy === "shared" ? "所有职业共用" : "各职业独立选择",
  };
}

function parseJointProgressStats(message: string): Partial<JointSearchStats> {
  const stats: Partial<JointSearchStats> = {};
  const parseNumber = (pattern: RegExp): number | undefined => {
    const value = pattern.exec(message)?.[1]?.replaceAll(",", "");
    if (!value) return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
  };
  const seedCandidates = parseNumber(/共享候选组合估分\s*([\d,]+)\s*个/);
  const seedLimit = parseNumber(/枚举上限\s*([\d,]+)/);
  const warmStartCandidates = parseNumber(/热启动候选\s*([\d,]+)/);
  const exactAttempts = parseNumber(/精确尝试\s*([\d,]+)/);
  const outerNodes = parseNumber(/外层节点[=:：]\s*([\d,]+)/);
  const completeNodes = parseNumber(/完成[=:：]\s*([\d,]+)/);
  const upperBoundPrunes = parseNumber(/上界剪枝[=:：]\s*([\d,]+)/);
  const innerMipSolves = parseNumber(/内层 MIP[=:：]\s*([\d,]+)/);
  const parentResultReuses = parseNumber(/父结果复用[=:：]\s*([\d,]+)/);
  const objectiveLabel = /归一化目标\s*[=:：]\s*(\d+\s*\/\s*\d+|[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)(?=\s*[;；]|$)/.exec(message)?.[1];
  const objectiveFraction = objectiveLabel && /^(\d+)\s*\/\s*(\d+)$/.exec(objectiveLabel);
  let objectiveValue: number | undefined;
  if (objectiveFraction) {
    const numerator = BigInt(objectiveFraction[1]!);
    const denominator = BigInt(objectiveFraction[2]!);
    if (denominator > 0n) {
      const scale = 10n ** 15n;
      const whole = numerator / denominator;
      const fraction = (numerator % denominator * scale) / denominator;
      const parsed = Number(whole) + Number(fraction) / Number(scale);
      if (Number.isFinite(parsed)) objectiveValue = parsed;
    }
  } else if (objectiveLabel) {
    const parsed = Number(objectiveLabel);
    if (Number.isFinite(parsed) && parsed >= 0) objectiveValue = parsed;
  }
  const incumbent = objectiveValue ?? parseNumber(/incumbent[=:：]\s*([\d,.]+)/i);
  const elapsedMs = parseNumber(/耗时[=:：]\s*([\d,.]+)\s*ms/);
  if (seedCandidates !== undefined) stats.seedCandidates = seedCandidates;
  if (seedLimit !== undefined) stats.seedLimit = seedLimit;
  if (warmStartCandidates !== undefined) stats.warmStartCandidates = warmStartCandidates;
  if (exactAttempts !== undefined) stats.exactAttempts = exactAttempts;
  if (outerNodes !== undefined) stats.outerNodes = outerNodes;
  if (completeNodes !== undefined) stats.completeNodes = completeNodes;
  if (upperBoundPrunes !== undefined) stats.upperBoundPrunes = upperBoundPrunes;
  if (innerMipSolves !== undefined) stats.innerMipSolves = innerMipSolves;
  if (parentResultReuses !== undefined) stats.parentResultReuses = parentResultReuses;
  if (incumbent !== undefined) stats.incumbent = incumbent;
  if (elapsedMs !== undefined) stats.elapsedMs = elapsedMs;
  return stats;
}

function JointPage() {
  const [view, setView] = useState<JointView>("selection");
  const [historyRefresh, setHistoryRefresh] = useState(0);
  const [historyError, setHistoryError] = useState<string>();
  const [selectionMessage, setSelectionMessage] = useState<string>();
  const [jobConfigs, setJobConfigs] = useState<Record<string, OptimizationConfig>>({
    RDM: makeConfig("RDM"),
    BLM: makeConfig("BLM"),
  });
  const [jobList, setJobList] = useState<JobId[]>(["RDM", "BLM"]);
  const [commonSlots, setCommonSlots] = useState<CommonSlot[]>(defaultCommonSlots);
  const [foodStrategy, setFoodStrategy] = useState<"shared" | "independent">("shared");
  const [objective, setObjective] = useState<"damage" | "dps">("damage");
  const [result, setResult] = useState<JointOptimizationResult>();
  const [resultConfig, setResultConfig] = useState<JointOptimizationConfig>();
  const [running, setRunning] = useState(false);
  const [activeProgress, setActiveProgress] = useState<JointSearchProgressState>();
  const [activeConfigSnapshot, setActiveConfigSnapshot] = useState<JointOptimizationConfig>();
  const [error, setError] = useState<string>();
  const [statusMessage, setStatusMessage] = useState<string>();
  const [resultKey, setResultKey] = useState<string>();
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
  const canContinueToConditions = jobList.length >= 2 && jobList.every(
    (jobId) => jobSchemas[jobId].role === jobSchemas[jobList[0]!].role,
  );

  useEffect(() => () => {
    abortController.current?.abort();
  }, []);

  function toggleSelectedJob(jobId: JobId) {
    const nextJobs = jobList.includes(jobId)
      ? jobList.filter((item) => item !== jobId)
      : [...jobList, jobId];
    const nextRole = nextJobs[0] ? jobSchemas[nextJobs[0]].role : undefined;
    if (nextRole && nextJobs.some((item) => jobSchemas[item].role !== nextRole)) {
      setSelectionMessage("联合搜索要求选择同一分组的职业；请先取消当前选择，再选择其他分组。");
      return;
    }
    setSelectionMessage(undefined);
    setJobList(nextJobs);
    setJobConfigs((current) => ({
      ...current,
      [jobId]: current[jobId] ?? makeConfig(jobId),
    }));
    const supported = new Set(nextJobs.length ? slotsForJob(nextJobs[0]!) : []);
    for (const nextJob of nextJobs.slice(1)) {
      const current = new Set(slotsForJob(nextJob));
      for (const slot of supported) if (!current.has(slot)) supported.delete(slot);
    }
    setCommonSlots((current) => current.filter((slot) => supported.has(slot)));
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
    setActiveProgress(undefined);
    setActiveConfigSnapshot(undefined);
    setJobList(record.config.jobs.map((config) => config.jobId));
    setJobConfigs(Object.fromEntries(record.config.jobs.map((config) => [config.jobId, config])));
    setCommonSlots(record.config.commonSlots.filter((slot): slot is CommonSlot => slot !== "rings"));
    setFoodStrategy(record.config.foodStrategy);
    setObjective(record.config.objective ?? "damage");
    setResult(undefined);
    setResultConfig(undefined);
    setResultKey(undefined);
    setView("conditions");
    setSelectionMessage(undefined);
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
    setStatusMessage("已加载该次联合搜索结果。");
    setView("result");
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
    const searchConfig = cloneJointConfig(currentConfig);
    abortController.current = controller;
    setRunning(true);
    setView("progress");
    setActiveConfigSnapshot(searchConfig);
    setActiveProgress({
      phase: "prepare",
      startedAt: Date.now(),
      jobs: searchConfig.jobs.map((job) => ({
        jobId: job.jobId,
        name: `${job.jobId} · ${jobSchemas[job.jobId].name}`,
        prepared: false,
      })),
      jointStats: {},
    });
    setError(undefined);
    setStatusMessage(undefined);
    setResult(undefined);
    setResultKey(undefined);
    setHistoryError(undefined);
    let historyId: string | undefined;
    try {
      const record = await createSearchHistory({ kind: "joint", config: searchConfig, dataVersion: displayedDataVersion });
      historyId = record.id;
      setHistoryRefresh((value) => value + 1);
      if (controller.signal.aborted) throw new Error("联合搜索已取消。");
      const searchResult = await optimizeJoint(searchConfig, {
        signal: controller.signal,
        onProgress: (message) => {
          if (controller.signal.aborted || abortController.current !== controller) return;
          setActiveProgress((current) => {
            if (!current) return current;
            const nextStats = parseJointProgressStats(message);
            const isVerifyMessage = message.includes("还原并复核");
            const isBaselineMessage = message.includes("单职业最优伤害基线");
            const isJointMessage = message.includes("共享候选组合估分")
              || message.includes("V3 搜索进度")
              || message.includes("V3 incumbent 更新");
            const phase: JointSearchPhase = isVerifyMessage
              ? "verify"
              : isJointMessage
                ? "joint"
                : isBaselineMessage
                  ? "baseline"
                  : current.phase;
            return {
              ...current,
              phase,
              verifyMessage: isVerifyMessage ? searchMessageText(message) : current.verifyMessage,
              jointStats: { ...current.jointStats, ...nextStats },
            };
          });
        },
        onCandidateCounts: ({ jobId }) => {
          if (controller.signal.aborted || abortController.current !== controller) return;
          setActiveProgress((current) => current ? {
            ...current,
            jobs: current.jobs.map((job) => job.jobId === jobId ? { ...job, prepared: true } : job),
          } : current);
        },
        onSolverProgress: (event) => {
          if (controller.signal.aborted || abortController.current !== controller) return;
          setActiveProgress((current) => {
            if (!current) return current;
            if (event.model.startsWith("joint:")) {
              const jointSolver = current.jointSolver?.model === event.model
                ? { ...current.jointSolver, ...event }
                : event;
              return { ...current, phase: "joint", jointSolver };
            }
            if (current.phase === "joint" || current.phase === "verify") return current;
            const job = current.jobs.find(({ jobId }) => event.model.startsWith(`${jobId}:`));
            if (!job) return current;
            const solver = job.solver?.model === event.model
              ? { ...job.solver, ...event }
              : event;
            return {
              ...current,
              phase: "baseline",
              jobs: current.jobs.map((entry) => entry.jobId === job.jobId ? { ...entry, solver } : entry),
            };
          });
        },
      });
      await saveHistoryOutcome(historyId, searchResult ? { status: "completed", result: searchResult } : { status: "no-result" });
      if (controller.signal.aborted || abortController.current !== controller) return;
      setResult(searchResult);
      if (searchResult) { setResultKey(JSON.stringify(searchConfig)); setResultConfig(searchConfig); }
      setStatusMessage(
        searchResult
          ? "联合搜索已完成。"
          : "当前约束下没有满足条件的联合配装，请调整条件后重试。",
      );
      setView(searchResult ? "result" : "conditions");
    } catch (caught) {
      if (historyId) await saveHistoryOutcome(historyId, controller.signal.aborted ? { status: "cancelled" } : { status: "failed", error: searchMessageText(caught instanceof Error ? caught.message : String(caught)) });
      if (abortController.current !== controller) return;
      if (controller.signal.aborted) {
        setStatusMessage("联合搜索已取消。");
        setView("conditions");
      } else {
        setError(searchMessageText(caught instanceof Error ? caught.message : String(caught)));
        setView("conditions");
      }
    } finally {
      if (abortController.current === controller) {
        abortController.current = undefined;
        setRunning(false);
        setActiveProgress(undefined);
        setActiveConfigSnapshot(undefined);
      }
    }
  }

  function cancelSearch() {
    abortController.current?.abort();
  }

  function reset() {
    const previous = abortController.current;
    abortController.current = undefined;
    previous?.abort();
    setRunning(false);
    setActiveProgress(undefined);
    setActiveConfigSnapshot(undefined);
    setJobList(["RDM", "BLM"]);
    setJobConfigs({ RDM: makeConfig("RDM"), BLM: makeConfig("BLM") });
    setCommonSlots(defaultCommonSlots);
    setFoodStrategy("shared");
    setObjective("damage");
    setView("selection");
    setSelectionMessage(undefined);
    setResult(undefined);
    setError(undefined);
    setStatusMessage(undefined);
    setResultKey(undefined);
  }

  const summary = jointProgressSummary(currentConfig);
  const history = (
    <>
      <SearchHistory
        kind="joint"
        currentDataVersion={displayedDataVersion}
        refreshKey={historyRefresh}
        onLoadConfig={loadJointHistoryConfig}
        onLoadResult={loadJointHistoryResult}
      />
      {historyError && <p role="alert" className="history-error">{historyError}</p>}
    </>
  );
  const sharedSlotControls = (
    <>
      {(["weapon", "offhand", "head", "earrings", "body", "necklace", "hands", "bracelet", "legs", "ring", "feet", "ring2"] as GearSlot[])
        .filter((slot) => slotOptions.includes(slot))
        .map((slot) => (
          <div className="shared-slot-control" data-slot={slot} key={slot}>
            <CheckControl
              checked={commonSlots.includes(slot)}
              onChange={() => toggleCommonSlot(slot)}
            >
              {slotLabels[slot]}
            </CheckControl>
          </div>
        ))}
    </>
  );
  const professionEditors = jobList.map((jobId) => {
    const jobConfig = jobConfigs[jobId] ?? makeConfig(jobId);
    return {
      jobId,
      editor: (
        <details className="job-config-card" key={jobId} open>
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
              showFood
            />
          </div>
        </details>
      ),
    };
  });

  if (view === "progress" && running && activeProgress && activeConfigSnapshot) {
    return (
      <JointSearchProgress
        progress={activeProgress}
        summary={jointProgressSummary(activeConfigSnapshot)}
        onCancel={cancelSearch}
        onReset={reset}
        history={history}
      />
    );
  }

  if (view === "selection") {
    return (
      <JointJobSelection
        selectedJobs={jobList}
        onToggleJob={toggleSelectedJob}
        onContinue={() => {
          setView("conditions");
          setSelectionMessage(undefined);
          setError(undefined);
          setStatusMessage(undefined);
        }}
        canContinue={canContinueToConditions}
        dataVersion={displayedDataVersion}
        onReset={reset}
        selectionMessage={selectionMessage}
        errorMessage={error}
        history={history}
      />
    );
  }

  if (view === "result" && result && resultConfig && !stale) {
    const resultDetails = (
      <>
        <JointCommonGearSection result={result} />
        {resultConfig.jobs.map((jobConfig) => {
          const { jobId } = jobConfig;
          const jobResult = result.jobResults[jobId];
          return (
            <JointProfessionResult
              key={jobId}
              jobId={jobId}
              result={jobResult}
              baseline={result.optima[jobId]}
              equipment={jobResult ? <GearTable result={jobResult} config={jobConfig} compact /> : undefined}
              configSnapshot={<ConfigSnapshot config={jobConfig} />}
              statName={statName}
              statValue={statValue}
            />
          );
        })}
      </>
    );

    return (
      <JointResultsScreen
        result={result}
        config={resultConfig}
        details={resultDetails}
        onAdjust={() => setView("conditions")}
        dataVersion={displayedDataVersion}
        history={history}
        onReset={reset}
      />
    );
  }

  return (
    <JointConditionsScreen
      summary={summary}
      sharedSlotControls={sharedSlotControls}
      foodStrategyControl={
        <div className="joint-segment-field">
          <span>食物策略</span>
          <div className="joint-segment" role="group" aria-label="食物策略">
            <button type="button" aria-pressed={foodStrategy === "shared"} onClick={() => setFoodStrategy("shared")}>全职业共用</button>
            <button type="button" aria-pressed={foodStrategy === "independent"} onClick={() => setFoodStrategy("independent")}>各职业独立</button>
          </div>
        </div>
      }
      objectiveControl={
        <div className="joint-segment-field">
          <span>优化目标</span>
          <div className="joint-segment" role="group" aria-label="优化目标">
            <button type="button" aria-pressed={objective === "damage"} onClick={() => setObjective("damage")}>每威力伤害期望</button>
            <button type="button" aria-pressed={objective === "dps"} onClick={() => setObjective("dps")}>按 GCD 折算</button>
          </div>
        </div>
      }
      professionEditors={professionEditors}
      canStartSearch={jobList.length >= 2 && canContinueToConditions}
      feedbackMessage={error ?? statusMessage}
      feedbackIsError={error !== undefined}
      history={history}
      dataVersion={displayedDataVersion}
      onReset={reset}
      onBackToSelection={() => {
        setView("selection");
        setError(undefined);
        setStatusMessage(undefined);
      }}
      onStartSearch={runSearch}
    />
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
      {page === "joint" ? (
        <>
          <AppHeader page={page} />
          <JointPage key={"joint-" + resetVersion} />
        </>
      ) : (
        <SinglePage key={"single-" + resetVersion} onReset={() => setResetVersion((version) => version + 1)} />
      )}
    </div>
  );
}
