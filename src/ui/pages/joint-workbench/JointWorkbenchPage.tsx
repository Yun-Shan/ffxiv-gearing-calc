import { useEffect, useMemo, useRef, useState } from "react";
import {
  foods,
  jobSchemas,
  optimizeJoint,
  slotsForJob,
  type GearSlot,
  type JobId,
  type JointOptimizationConfig,
  type JointOptimizationResult,
  type OptimizationConfig,
} from "../../../domain/index";
import type {
  JointSearchPhase,
  JointSearchProgressState,
  JointSearchStats,
  JointSearchSummary,
} from "./components/search-progress/JointSearchProgress";
import { JointSearchProgress } from "./components/search-progress/JointSearchProgress";
import { JointConditionsScreen } from "./components/conditions-screen/JointConditionsScreen";
import { JointJobSelection } from "./components/job-selection/JointJobSelection";
import { JointResultsScreen } from "./components/results-screen/JointResultsScreen";
import { JointCommonGearSection, commonSlotLabels } from "./components/common-gear-section/JointCommonGearSection";
import { JointProfessionResult } from "./components/profession-result/JointProfessionResult";
import { ConfigSnapshot } from "../../components/config-snapshot/ConfigSnapshot";
import { JobConfigFields } from "../../components/job-config/job-config-fields/JobConfigFields";
import { CheckControl } from "../../components/job-config/fields/fields";
import { GearTable } from "../../components/results/gear-table/GearTable";
import { gearSlotLabels, statName, statValue } from "../../services/labels";
import styles from "./JointWorkbenchPage.module.css";
import { displayedDataVersion, defaultCommonSlots, defaultJobLevel, makeConfig, type CommonSlot } from "../../services/app-config";
import { searchMessageText } from "../../services/search-message";
import { SearchHistory } from "../../components/search-history/SearchHistory";
import { createSearchHistory, finishSearchHistory } from "../../services/search-history";
import type { SearchHistoryRecord } from "../../services/search-history";

type JointView = "selection" | "conditions" | "progress" | "result";
const slotLabels = gearSlotLabels;

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
export function JointWorkbenchPage() {
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
      {historyError && <p role="alert">{historyError}</p>}
    </>
  );
  const sharedSlotControls = (
    <>
      {(["weapon", "offhand", "head", "earrings", "body", "necklace", "hands", "bracelet", "legs", "ring", "feet", "ring2"] as GearSlot[])
        .filter((slot) => slotOptions.includes(slot))
        .map((slot) => (
          <div className={styles.sharedSlotControl} data-slot={slot} key={slot}>
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
        <details className={styles.jobConfigCard} data-job-config-card key={jobId} open>
          <summary>
            <span>
              <strong>{jobSchemas[jobId].name}</strong>
              <small>{jointJobSummary(jobConfig)}</small>
            </span>
            <span className={styles.summaryChevron}>⌄</span>
          </summary>
          <div className={styles.jobConfigCardBody} data-job-config-card-body>
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
        <div className={styles.jointSegmentField}>
          <span>食物策略</span>
          <div className={styles.jointSegment} role="group" aria-label="食物策略">
            <button type="button" aria-pressed={foodStrategy === "shared"} onClick={() => setFoodStrategy("shared")}>全职业共用</button>
            <button type="button" aria-pressed={foodStrategy === "independent"} onClick={() => setFoodStrategy("independent")}>各职业独立</button>
          </div>
        </div>
      }
      objectiveControl={
        <div className={styles.jointSegmentField}>
          <span>优化目标</span>
          <div className={styles.jointSegment} role="group" aria-label="优化目标">
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
