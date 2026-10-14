import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { Check, CircleHelp, X } from "lucide-react";
import {
  findFeasibleGcds,
  gameData,
  jobSchemas,
  type OptimizationConfig,
} from "../../../../domain/index";
import { bounds, defaultJobLevel, availableFoods } from "../../../services/app-config";
import { searchMessageText, searchProgressText } from "../../../services/search-message";
import { SingleCombatSpeedSection } from "./components/single-combat-speed-section/SingleCombatSpeedSection";
import { SingleEquipmentRangeSection } from "./components/single-equipment-range-section/SingleEquipmentRangeSection";
import { EquipmentRestrictionFields } from "./components/equipment-restriction-fields/EquipmentRestrictionFields";
import { CheckControl, NumberField, SelectField, SyncLevelField } from "../fields/fields";
import type { SingleGcdFeasibility, WizardStep } from "../types";
import type { SingleGcdMode } from "../../../services/types";
import styles from "./JobConfigFields.module.scss";

function setConfigPatch(
  setConfig: Dispatch<SetStateAction<OptimizationConfig>>,
  patch: Partial<OptimizationConfig>,
) {
  setConfig((current) => ({ ...current, ...patch }));
}
export function JobConfigFields({
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

  useEffect(() => {
    if (!gcdChoicesDirty) setGcdChoicesText(config.gcdChoices?.join(", ") ?? "");
  }, [config.gcdChoices, gcdChoicesDirty]);
  useEffect(() => () => {
    gcdAbortController.current?.abort();
  }, []);

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

  return (
    <div className={`job-fields ${styles.jobFields}`}>
      {(step === 1 || (step === "all" && !singleWorkbench)) && <div className={`${styles.fieldGrid} job-level-field`}>
        <SelectField
          label="职业等级"
          value={String(config.jobLevel ?? jobSchemas[config.jobId].maxJobLevel ?? defaultJobLevel)}
          onChange={(value) => update("jobLevel", Number(value))}
        >
          {Object.keys(gameData.jobLevelModifiers).map(Number).filter(level => level <= (jobSchemas[config.jobId].maxJobLevel ?? 100)).sort((a, b) => a - b).map(level => <option key={level} value={level}>{level} 级</option>)}
        </SelectField>
      </div>}

      {(step === "all" || step === 3) && !singleWorkbench && <div className="candidate-range-group">
        <div className={styles.fieldGrid}>
          <SyncLevelField
            value={config.syncLevel}
            inactiveLabel="不启用"
            onChange={(value) => update("syncLevel", value)}
          />
        </div>
        <div className={`${styles.fieldGrid} ${styles.fieldGridTwo}`}>
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
              <label><span className={styles.srOnly}>最低{speedStatName}</span><input type="number" min={0} value={config.speedMin ?? ""} placeholder="最低" onChange={(event) => update("speedMin", event.target.value === "" ? undefined : Number(event.target.value))} /></label>
              <span className="single-speed-separator">–</span>
              <label><span className={styles.srOnly}>最高{speedStatName}</span><input type="number" min={0} value={config.speedMax ?? ""} placeholder="最高" onChange={(event) => update("speedMax", event.target.value === "" ? undefined : Number(event.target.value))} /></label>
            </div>}
          </div>
          {singleObjectiveLabel && <section className="single-objective-display" aria-label="自动选择的搜索指标">
            <span>当前优化指标</span>
            <strong>{singleObjectiveLabel}</strong>
          </section>}
          {gcdError && <span className={`gcd-query-error ${styles.gcdQueryError}`} role="alert">
            {gcdError}
            {singleGcdMode === "tiers" && <button type="button" className="single-gcd-query-retry" onClick={() => setGcdQueryAttempt((attempt) => attempt + 1)}>重新查询</button>}
          </span>}
        </> : <>
          <div className={`field-label ${styles.withHelp}`}>
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
          className={styles.gcdCalculateButton}
          onClick={findingGcds ? () => gcdAbortController.current?.abort() : calculateFeasibleGcds}
        >
          {findingGcds ? <X size={14} /> : <CircleHelp size={14} />}
          {findingGcds ? "取消查询" : "计算可行 GCD 档位"}
        </button>}
        {!singleWorkbench && gcdProgress && <span className={styles.gcdResultNote}>{gcdProgress}</span>}
        {!singleWorkbench && gcdError && <span className={`gcd-query-error ${styles.gcdQueryError}`}>{gcdError}</span>}
        {!singleWorkbench && gcdSelectionReady && (
          <div className={styles.feasibleGcdPanel}>
            <div className={styles.feasibleGcdHeading}>
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
              <div className={styles.feasibleGcdList}>
                {feasibleGcds.map((gcd) => (
                  <div className={styles.feasibleGcdOption} key={gcd}>
                    <button
                      type="button"
                      className={config.gcdTarget === gcd ? styles.feasibleGcdSelected : ""}
                      onClick={() => selectSingleFeasibleGcd(gcd)}
                    >
                      {gcd.toFixed(2)} 秒
                    </button>
                    <CheckControl
                      checked={(config.gcdChoices ?? []).includes(gcd)}
                      onChange={(checked) => toggleFeasibleGcd(gcd, checked)}
                    >
                      <span className={styles.srOnly}>加入多档</span>
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
        <div className={`${styles.fieldGrid} ${styles.fieldGridTwo}`}>
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
        <div className={`${styles.fieldGrid} ${styles.fieldGridTwo}`}>
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

      <EquipmentRestrictionFields config={config} setConfig={setConfig} singleWorkbench={singleWorkbench} onEdited={onEdited} />
      </>}
    </div>
  );
}
