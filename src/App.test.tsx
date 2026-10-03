// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type MockHistoryRecord = {
  id: string;
  kind: "single" | "joint";
  config: unknown;
  dataVersion: string;
  status: "running" | "completed" | "cancelled" | "no-result" | "failed" | "interrupted";
  startedAtISO: string;
  finishedAtISO?: string;
  error?: string;
  result?: unknown;
};

type MockHistoryOutcome =
  | { status: "completed"; result: unknown }
  | { status: "failed"; error: string }
  | { status: "cancelled" | "no-result" | "interrupted"; error?: string };

const { optimizeMock, optimizeJointMock, historyStore } = vi.hoisted(() => ({
  optimizeMock: vi.fn(),
  optimizeJointMock: vi.fn(),
  historyStore: { records: [] as MockHistoryRecord[], nextId: 0 },
}));

vi.mock("./domain", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./domain")>()),
  optimize: optimizeMock,
  optimizeJoint: optimizeJointMock,
}));

vi.mock("./ui/search-history", () => ({
  createSearchHistory: vi.fn(async (input: { kind: "single" | "joint"; config: unknown; dataVersion: string }) => {
    historyStore.nextId += 1;
    const startedAtISO = new Date(Date.UTC(2026, 9, 3, 0, 0, historyStore.nextId)).toISOString();
    const record: MockHistoryRecord = {
      ...structuredClone(input),
      id: `history-${historyStore.nextId}`,
      startedAtISO,
      status: "running",
    };
    historyStore.records.push(record);
    return structuredClone(record);
  }),
  finishSearchHistory: vi.fn(async (id: string, outcome: MockHistoryOutcome) => {
    const record = historyStore.records.find((item) => item.id === id);
    if (!record) throw new Error(`找不到测试搜索记录 ${id}`);
    record.status = outcome.status;
    record.finishedAtISO = new Date(Date.parse(record.startedAtISO) + 1_000).toISOString();
    delete record.result;
    delete record.error;
    if (outcome.status === "completed") record.result = structuredClone(outcome.result);
    if (outcome.status === "failed" || outcome.status === "interrupted") record.error = outcome.error;
    return structuredClone(record);
  }),
  listSearchHistory: vi.fn(async (kind?: "single" | "joint") =>
    historyStore.records
      .filter((record) => kind === undefined || record.kind === kind)
      .sort((left, right) => Date.parse(right.startedAtISO) - Date.parse(left.startedAtISO) || right.id.localeCompare(left.id))
      .map((record) => structuredClone(record)),
  ),
}));

import { App } from "./App";
import {
  dataProvenance,
  foods,
  gameData,
  jobIds,
  jobSchemas,
  type JobId,
  type JointOptimizationConfig,
  type JointOptimizationResult,
  type OptimizationConfig,
  type OptimizationResult,
} from "./domain";

let host: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  optimizeMock.mockReset();
  optimizeJointMock.mockReset();
  historyStore.records.length = 0;
  historyStore.nextId = 0;
  host = document.createElement("div");
  document.body.append(host);
  window.history.replaceState(null, "", "#/single");
  root = createRoot(host);
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  act(() => root.render(<App />));
  await settleApp();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function normalizedText(element: Element): string {
  return element.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

function buttonNamed(name: string): HTMLButtonElement {
  const button = [...host.querySelectorAll("button")].find(
    (item) => normalizedText(item) === name || item.getAttribute("aria-label") === name,
  );
  if (!button) throw new Error(`找不到按钮「${name}」`);
  return button;
}

function buttonContaining(text: string): HTMLButtonElement {
  const button = [...host.querySelectorAll("button")].find((item) =>
    normalizedText(item).includes(text),
  );
  if (!button) throw new Error(`找不到包含「${text}」的按钮`);
  return button;
}

function click(button: HTMLButtonElement): void {
  act(() => button.click());
}

function textField(labelText: string): HTMLInputElement | HTMLSelectElement {
  const label = [...host.querySelectorAll("label")].find(
    (item) => normalizedText(item).startsWith(labelText),
  );
  const control = label?.querySelector("input, select");
  if (!(control instanceof HTMLInputElement || control instanceof HTMLSelectElement)) {
    throw new Error(`找不到「${labelText}」输入项`);
  }
  return control;
}

function selectValue(label: string, value: string): void {
  const select = textField(label);
  if (!(select instanceof HTMLSelectElement)) throw new Error(`「${label}」不是下拉框`);
  act(() => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function selectAriaValue(ariaLabel: string, value: string): void {
  const select = host.querySelector<HTMLSelectElement>(`select[aria-label="${ariaLabel}"]`);
  if (!select) throw new Error(`找不到「${ariaLabel}」下拉框`);
  act(() => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function inputValue(label: string, value: string): void {
  const input = textField(label);
  if (!(input instanceof HTMLInputElement)) throw new Error(`「${label}」不是输入框`);
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function currentStep(): string | undefined {
  return host.querySelector('[aria-current="step"]')?.getAttribute("aria-label") ?? undefined;
}

function progressStep(step: number): HTMLButtonElement {
  const button = [...host.querySelector('[aria-label="配装设置进度"]')!.querySelectorAll("button")]
    .find((item) => item.getAttribute("aria-label")?.startsWith(`${step}.`));
  if (!button) throw new Error(`找不到第 ${step} 步进度按钮`);
  return button;
}

function editSummaryRow(label: string): void {
  const row = [...host.querySelectorAll(".summary-row")].find((item) =>
    normalizedText(item.querySelector("span") ?? item) === label,
  );
  if (!row) throw new Error(`找不到「${label}」条件摘要`);
  const edit = row.querySelector("button");
  if (!edit) throw new Error(`「${label}」没有编辑入口`);
  click(edit);
}

function detailsNamed(text: string): HTMLDetailsElement {
  const details = [...host.querySelectorAll("details")].find((item) =>
    normalizedText(item.querySelector("summary") ?? item).includes(text),
  );
  if (!details) throw new Error(`找不到「${text}」折叠区`);
  return details;
}

function snapshotValue(label: string, ariaLabel = "本次结果的搜索条件"): string {
  const snapshot = host.querySelector(`[aria-label="${ariaLabel}"]`);
  if (!snapshot) throw new Error("找不到本次结果的搜索条件快照");
  const row = [...snapshot.querySelectorAll("dl > div")].find(
    (item) => normalizedText(item.querySelector("dt") ?? item) === label,
  );
  const value = row?.querySelector("dd");
  if (!value) throw new Error(`找不到结果快照中的「${label}」`);
  return normalizedText(value);
}

function openDetails(details: HTMLDetailsElement): void {
  if (details.open) return;
  const summary = details.querySelector("summary");
  if (!summary) throw new Error("折叠区缺少标题");
  act(() => summary.click());
}

function chooseJob(jobId: keyof typeof jobSchemas): void {
  const jobName = jobSchemas[jobId].name;
  click(buttonNamed(jobName));
}

function confirmStep(): void {
  click(buttonNamed("确认并继续"));
}

function advanceToReview(jobId: keyof typeof jobSchemas = "SAM"): void {
  chooseJob(jobId);
  confirmStep();
  confirmStep();
  confirmStep();
}

function mockAbortableSearch(): void {
  optimizeMock.mockImplementation((_config: unknown, options: { signal: AbortSignal }) =>
    new Promise((_resolve, reject) => {
      options.signal.addEventListener(
        "abort",
        () => reject(new DOMException("Search cancelled", "AbortError")),
        { once: true },
      );
    }),
  );
}

function sampleResult(): OptimizationResult {
  return {
    gear: [],
    food: foods[0],
    stats: {},
    effects: {
      crtChance: 0,
      crtDamage: 0,
      detDamage: 0,
      dhtChance: 0,
      tenDamage: 0,
      tenMitigation: 0,
      damage: 1,
      gcd: 2.5,
      hp: 1,
      mp: 1,
    },
    score: 1,
    objective: "damage",
    damagePerSecond: 1,
    gcdTier: 0,
    searchedCandidates: 1,
    durationMs: 1,
  };
}

function currentDataVersion(): string {
  return dataProvenance.sources?.find((source) => source.kind === "mcp" && source.gameVersion)?.gameVersion
    ?? dataProvenance.commit.slice(0, 12);
}

async function settleApp(milliseconds = 0): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  });
}

async function startSearchAndSettle(): Promise<void> {
  await act(async () => {
    buttonContaining("开始搜索").click();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

function openSearchHistory(): void {
  openDetails(detailsNamed("搜索记录"));
}

function historyCardContaining(text: string): HTMLLIElement {
  const card = [...host.querySelectorAll<HTMLLIElement>(".search-history-record")]
    .find((item) => normalizedText(item).includes(text));
  if (!card) {
    const available = [...host.querySelectorAll<HTMLLIElement>(".search-history-record")]
      .map(normalizedText)
      .join(" | ");
    throw new Error(`找不到包含「${text}」的搜索记录；当前记录：${available || "无"}`);
  }
  return card;
}

function summaryRowValue(label: string): string {
  const row = [...host.querySelectorAll(".config-summary .summary-row")]
    .find((item) => normalizedText(item.querySelector("span") ?? item) === label);
  if (!row) throw new Error(`找不到「${label}」条件摘要`);
  return normalizedText(row.querySelector("strong") ?? row);
}

function remountApp(hash = "#/single"): void {
  act(() => root.unmount());
  host.remove();
  host = document.createElement("div");
  document.body.append(host);
  window.history.replaceState(null, "", hash);
  root = createRoot(host);
  act(() => root.render(<App />));
}

function navigateToJoint(): void {
  act(() => {
    window.history.replaceState(null, "", "#/joint");
    window.dispatchEvent(new Event("hashchange"));
  });
}

function testJobConfig(jobId: JobId): OptimizationConfig {
  const job = jobSchemas[jobId];
  return {
    jobId,
    minItemLevel: job.defaultItemLevel?.[0] ?? 1,
    maxItemLevel: job.defaultItemLevel?.[1] ?? 999,
    jobLevel: job.maxJobLevel ?? 100,
    maximizeTenacity: false,
    objective: "damage",
    excludedSources: [],
    forcedGear: {},
    sharedSlots: [],
    foodId: 0,
  };
}

function testJointConfig(jobs: JobId[]): JointOptimizationConfig {
  return {
    jobs: jobs.map(testJobConfig),
    commonSlots: [],
    foodStrategy: "shared",
    objective: "damage",
  };
}

function sampleJointResult(config: JointOptimizationConfig): JointOptimizationResult {
  const perJobResults = Object.fromEntries(config.jobs.map(({ jobId }) => [jobId, sampleResult()]));
  return {
    jobResults: perJobResults,
    optima: perJobResults,
    commonGear: {},
    objective: "damage",
    value: { numerator: "1", denominator: "1", approximate: 1 },
    proof: {
      complete: true,
      objective: "damage",
      optimalityScope: "test-only candidate set",
      outerBound: "1",
      innerSolverStatus: "Optimal",
      formalCertificate: false,
      numericalLimitation: "Synthetic result isolated to this test.",
      terminationReason: "test fixture",
    },
    statistics: {
      elapsedMs: 1,
      timeLimitMs: 1,
      outerNodes: 1,
      completeNodes: 1,
      upperBoundPrunes: 0,
      relaxedOptimaAttained: 0,
      innerSolves: 1,
      parentResultReuses: 0,
      cacheHits: 0,
      cacheMisses: 1,
      cacheEntries: 0,
      cacheLimit: 0,
    },
  };
}

function seedCompletedJointHistory(config: JointOptimizationConfig): void {
  const startedAtISO = new Date(Date.UTC(2026, 9, 2, 12, 0, 0)).toISOString();
  historyStore.records.push({
    id: "saved-joint-result",
    kind: "joint",
    config: structuredClone(config),
    dataVersion: currentDataVersion(),
    status: "completed",
    startedAtISO,
    finishedAtISO: new Date(Date.parse(startedAtISO) + 1_000).toISOString(),
    result: structuredClone(sampleJointResult(config)),
  });
}

function mockDelayedAbortableJointSearch(): void {
  optimizeJointMock.mockImplementation((_config: unknown, options: { signal: AbortSignal }) =>
    new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => {
        window.setTimeout(() => reject(new DOMException("Joint search cancelled", "AbortError")), 25);
      }, { once: true });
    }),
  );
}

describe("单职业四步配装向导", () => {
  it("开始时不预选职业；职业与等级确认前不能继续或启动搜索", () => {
    expect(host.querySelector('[aria-label="配装设置进度"]')).not.toBeNull();
    for (const jobId of jobIds) {
      expect(buttonNamed(jobSchemas[jobId].name).getAttribute("aria-pressed")).toBe("false");
    }
    expect(buttonNamed("确认并继续").disabled).toBe(true);
    expect(() => buttonNamed("开始搜索")).toThrow();
    expect(optimizeMock).not.toHaveBeenCalled();

    chooseJob("SAM");
    expect(buttonNamed(jobSchemas.SAM.name).getAttribute("aria-pressed")).toBe("true");
    expect((textField("职业等级") as HTMLSelectElement).value).toBe(
      String(jobSchemas.SAM.maxJobLevel),
    );
    expect(buttonNamed("确认并继续").disabled).toBe(false);
    expect(optimizeMock).not.toHaveBeenCalled();
  });

  it("要求逐步确认，锁住未到步骤；只有第四步手动开始才调用正式优化", async () => {
    mockAbortableSearch();
    chooseJob("SAM");

    const progress = host.querySelector('[aria-label="配装设置进度"]');
    expect(progress).not.toBeNull();
    const futureStep = progressStep(3);
    expect(futureStep?.disabled).toBe(true);
    click(buttonNamed("确认并继续"));
    expect(currentStep()).toContain("选择目标");
    expect(futureStep.disabled).toBe(true);
    expect(optimizeMock).not.toHaveBeenCalled();

    confirmStep();
    expect(currentStep()).toContain("设置候选范围");
    expect(optimizeMock).not.toHaveBeenCalled();

    confirmStep();
    expect(currentStep()).toContain("检查并开始");
    expect(buttonContaining("开始搜索").disabled).toBe(false);
    expect(optimizeMock).not.toHaveBeenCalled();

    await act(async () => {
      buttonContaining("开始搜索").click();
      await Promise.resolve();
    });
    expect(optimizeMock).toHaveBeenCalledTimes(1);
    expect(optimizeMock.mock.calls[0][0]).toMatchObject({ jobId: "SAM" });
  });

  it("返回时保留目标限制和候选范围；高级选项折叠时仍显示摘要", () => {
    chooseJob("SAM");
    confirmStep();

    const advanced = detailsNamed("GCD、速度与坚韧条件");
    expect(advanced.open).toBe(false);
    expect(normalizedText(advanced.querySelector("summary")!)).toContain("GCD 不限");
    openDetails(advanced);

    inputValue("最低技速", "1234");
    expect(normalizedText(advanced.querySelector("summary")!)).toContain("技速 1234");
    confirmStep();
    expect(currentStep()).toContain("设置候选范围");

    const lower = textField("最低装备品级");
    const customMin = String(Number((lower as HTMLInputElement).value) - 1);
    inputValue("最低装备品级", customMin);
    confirmStep();
    expect(currentStep()).toContain("检查并开始");

    editSummaryRow("技速范围");
    expect(currentStep()).toContain("选择目标");
    openDetails(detailsNamed("GCD、速度与坚韧条件"));
    expect((textField("最低技速") as HTMLInputElement).value).toBe("1234");
    confirmStep();
    confirmStep();
    editSummaryRow("装备品级");
    expect(currentStep()).toContain("设置候选范围");
    expect((textField("最低装备品级") as HTMLInputElement).value).toBe(customMin);
  });

  it("职业改变后只出现对应的速度属性和坦克限制", () => {
    chooseJob("WAR");
    confirmStep();

    const tankAdvanced = detailsNamed("GCD、速度与坚韧条件");
    openDetails(tankAdvanced);
    expect(textField("最低技速")).toBeDefined();
    expect(textField("最低坚韧值")).toBeDefined();

    click(progressStep(1));
    chooseJob("WHM");
    confirmStep();
    const healerAdvanced = detailsNamed("GCD、速度与坚韧条件");
    openDetails(healerAdvanced);
    expect(textField("最低咏速")).toBeDefined();
    expect(() => textField("最低技速")).toThrow();
    expect(() => textField("最低坚韧值")).toThrow();
  });

  it("搜索进度只在运行时显示，保留候选计数，并在等待求解时不宣告完成", async () => {
    advanceToReview();
    expect(host.querySelector('[aria-label="搜索进度"]')).toBeNull();

    const rawMessage = "候选准备完成；装备方案=120；食物候选=4；正在求解配装";
    optimizeMock.mockImplementation(
      (_config: unknown, options: { signal: AbortSignal; onProgress?: (message: string) => void }) => {
        options.onProgress?.(rawMessage);
        return new Promise((_resolve, reject) => {
          options.signal.addEventListener(
            "abort",
            () => reject(new DOMException("Search cancelled", "AbortError")),
            { once: true },
          );
        });
      },
    );

    await act(async () => {
      buttonContaining("开始搜索").click();
      await Promise.resolve();
    });
    expect(host.querySelector('[aria-label="搜索进度"]')).not.toBeNull();
    expect(host.textContent).toContain("已准备 120 个装备方案 · 4 个食物候选");
    expect(host.textContent).toContain("候选总数尚未确定");

    const progressBar = host.querySelector<HTMLElement>('[role="progressbar"][aria-label="估算搜索进度"]');
    expect(progressBar).not.toBeNull();
    expect(Number(progressBar!.getAttribute("aria-valuemax"))).toBe(100);
    expect(Number(progressBar!.getAttribute("aria-valuenow"))).toBeLessThan(100);

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 1100));
    });
    expect(Number(progressBar!.getAttribute("aria-valuenow"))).toBeLessThan(100);

    click(buttonNamed("取消搜索"));
    await act(async () => { await Promise.resolve(); });
    expect(host.querySelector('[aria-label="搜索进度"]')).toBeNull();
    expect(host.textContent).toContain("搜索已取消");
  });

  it("再次点选当前职业时保留已经输入的等级、目标、速度和品级范围", () => {
    chooseJob("SAM");
    const lowerLevel = Object.keys(gameData.jobLevelModifiers)
      .map(Number)
      .filter((level) => level < jobSchemas.SAM.maxJobLevel!)
      .sort((left, right) => right - left)[0];
    expect(lowerLevel).toBeDefined();
    selectValue("职业等级", String(lowerLevel));
    confirmStep();

    const dpsRadio = host.querySelector<HTMLInputElement>('input[name="single-objective"][value="dps"]');
    expect(dpsRadio).not.toBeNull();
    act(() => dpsRadio!.click());
    openDetails(detailsNamed("GCD、速度与坚韧条件"));
    inputValue("最低技速", "1234");
    confirmStep();

    const lowerItemLevel = textField("最低装备品级") as HTMLInputElement;
    const selectedMinItemLevel = String(Number(lowerItemLevel.value) + 1);
    inputValue("最低装备品级", selectedMinItemLevel);
    confirmStep();
    expect(currentStep()).toContain("检查并开始");

    click(progressStep(1));
    chooseJob("SAM");
    expect((textField("职业等级") as HTMLSelectElement).value).toBe(String(lowerLevel));
    confirmStep();
    expect(host.querySelector<HTMLInputElement>('input[name="single-objective"][value="dps"]')?.checked).toBe(true);
    openDetails(detailsNamed("GCD、速度与坚韧条件"));
    expect((textField("最低技速") as HTMLInputElement).value).toBe("1234");
    confirmStep();
    expect(currentStep()).toContain("设置候选范围");
    expect((textField("最低装备品级") as HTMLInputElement).value).toBe(selectedMinItemLevel);
  });

  it("编辑已有结果后隐藏旧配装，只检查当前条件且不自动开始新搜索", async () => {
    advanceToReview();
    optimizeMock.mockResolvedValueOnce(sampleResult());
    await startSearchAndSettle();
    expect(snapshotValue("优化目标")).toBe("每威力伤害期望");
    expect(snapshotValue("职业与等级")).toContain("武士");

    click(buttonNamed("编辑当前条件"));
    confirmStep();
    expect(currentStep()).toContain("选择目标");
    expect(host.querySelector(".result-workspace")).toBeNull();
    openDetails(detailsNamed("GCD、速度与坚韧条件"));
    selectAriaValue("GCD 约束类型", "single");
    inputValue("目标 GCD", "2.4");
    confirmStep();

    const rangeField = textField("最低装备品级") as HTMLInputElement;
    const newMinimum = Number(rangeField.value) + 1;
    inputValue("最低装备品级", String(newMinimum));
    confirmStep();
    expect(currentStep()).toContain("检查并开始");
    expect(host.querySelector(".result-workspace")).toBeNull();
    expect(host.querySelector('[aria-label="本次结果的搜索条件"]')).toBeNull();
    expect(summaryRowValue("GCD")).toBe("2.40 秒");
    expect(summaryRowValue("装备品级")).toBe(`${newMinimum}–${rangeField.max}`);
    expect(optimizeMock).toHaveBeenCalledTimes(1);
    expect(buttonContaining("开始搜索")).toBeDefined();
  });

  it("为每次搜索保存终态，并在重新挂载后载入指定结果或只载入条件", async () => {
    const firstLevel = jobSchemas.SAM.maxJobLevel ?? 100;
    const lowerLevel = Object.keys(gameData.jobLevelModifiers)
      .map(Number)
      .filter((level) => level < firstLevel)
      .sort((left, right) => right - left)[0];
    expect(lowerLevel).toBeDefined();

    advanceToReview();
    optimizeMock.mockResolvedValueOnce(sampleResult());
    await startSearchAndSettle();
    expect(historyStore.records).toHaveLength(1);
    expect(historyStore.records[0]).toMatchObject({
      kind: "single",
      status: "completed",
      config: { jobId: "SAM", jobLevel: firstLevel },
    });

    click(buttonNamed("编辑当前条件"));
    selectValue("职业等级", String(lowerLevel));
    confirmStep();
    confirmStep();
    confirmStep();
    optimizeMock.mockResolvedValueOnce(sampleResult());
    await startSearchAndSettle();
    expect(historyStore.records).toHaveLength(2);
    expect(historyStore.records.map((record) => record.status)).toEqual(["completed", "completed"]);
    expect(historyStore.records.map((record) => (record.config as OptimizationConfig).jobLevel)).toEqual([
      firstLevel,
      lowerLevel,
    ]);

    click(buttonNamed("编辑当前条件"));
    remountApp();
    await settleApp();
    openSearchHistory();
    await settleApp();
    expect(normalizedText(detailsNamed("搜索记录"))).toContain("2 次");
    expect(historyCardContaining(`${jobSchemas.SAM.name} · ${firstLevel} 级`)).toBeDefined();
    expect(historyCardContaining(`${jobSchemas.SAM.name} · ${lowerLevel} 级`)).toBeDefined();

    const firstRecord = historyCardContaining(`${jobSchemas.SAM.name} · ${firstLevel} 级`);
    const loadFirstResult = firstRecord.querySelector<HTMLButtonElement>(".search-history-load-result");
    expect(loadFirstResult?.disabled).toBe(false);
    click(loadFirstResult!);
    expect(currentStep()).toContain("检查并开始");
    expect(host.querySelector(".result-workspace")).not.toBeNull();
    expect(snapshotValue("职业与等级")).toContain(`${firstLevel} 级`);
    expect(optimizeMock).toHaveBeenCalledTimes(2);

    click(buttonNamed("编辑当前条件"));
    await settleApp();
    openSearchHistory();
    const lowerRecord = historyCardContaining(`${jobSchemas.SAM.name} · ${lowerLevel} 级`);
    click(lowerRecord.querySelector<HTMLButtonElement>(".search-history-load-config")!);
    expect(currentStep()).toContain("选择职业");
    expect((textField("职业等级") as HTMLSelectElement).value).toBe(String(lowerLevel));
    expect(host.querySelector(".result-workspace")).toBeNull();
    expect(buttonNamed("确认并继续").disabled).toBe(false);

    confirmStep();
    expect(currentStep()).toContain("选择目标");
    confirmStep();
    confirmStep();
    expect(currentStep()).toContain("检查并开始");
    expect(optimizeMock).toHaveBeenCalledTimes(2);
  });

  it("取消、无解和失败都会保存独立的搜索历史状态", async () => {
    mockAbortableSearch();
    advanceToReview();
    await startSearchAndSettle();
    click(buttonNamed("取消搜索"));
    await settleApp();
    expect(host.textContent).toContain("搜索已取消");

    optimizeMock.mockResolvedValueOnce(null);
    await startSearchAndSettle();
    expect(host.textContent).toContain("没有可行配装");

    optimizeMock.mockRejectedValueOnce(new Error("Solve error"));
    await startSearchAndSettle();
    expect(host.textContent).toContain("搜索失败");

    expect(historyStore.records.map((record) => record.status)).toEqual([
      "cancelled",
      "no-result",
      "failed",
    ]);
    expect(historyStore.records[2]?.error).toContain("搜索失败");

    click(progressStep(1));
    await settleApp();
    openSearchHistory();
    await settleApp();
    const recordsText = normalizedText(detailsNamed("搜索记录"));
    expect(recordsText).toContain("已取消");
    expect(recordsText).toContain("无可行结果");
    expect(recordsText).toContain("搜索失败");
  });

  it("载入含白魔法师的联合条件后，职业添加器选择首个未选职业", async () => {
    seedCompletedJointHistory(testJointConfig(["RDM", "WHM"]));
    navigateToJoint();
    await settleApp();
    openSearchHistory();
    await settleApp();
    const record = historyCardContaining(`${jobSchemas.RDM.name} ${jobSchemas.RDM.maxJobLevel} 级、${jobSchemas.WHM.name}`);
    click(record.querySelector<HTMLButtonElement>(".search-history-load-config")!);
    await settleApp();

    const expectedNextJob = jobIds.find((jobId) => jobId !== "RDM" && jobId !== "WHM");
    const adder = host.querySelector<HTMLSelectElement>('select[aria-label="添加职业"]');
    expect(expectedNextJob).toBeDefined();
    expect(adder?.value).toBe(expectedNextJob);
    click(buttonNamed("添加职业"));
    expect(normalizedText(host.querySelector(".selected-jobs")!)).toContain(jobSchemas[expectedNextJob!].name);
  });

  it("联合搜索取消后迟到回调不会覆盖已载入的历史结果", async () => {
    const savedConfig = testJointConfig(["RDM", "WHM"]);
    seedCompletedJointHistory(savedConfig);
    navigateToJoint();
    await settleApp();
    openSearchHistory();
    await settleApp();

    mockDelayedAbortableJointSearch();
    await startSearchAndSettle();
    expect(optimizeJointMock).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("正在准备所有职业的候选装备");

    const savedRecord = historyCardContaining(`${jobSchemas.RDM.name} ${jobSchemas.RDM.maxJobLevel} 级、${jobSchemas.WHM.name}`);
    click(savedRecord.querySelector<HTMLButtonElement>(".search-history-load-result")!);
    expect(host.querySelector(".joint-score-card")).not.toBeNull();
    expect(host.textContent).toContain("已加载该次联合搜索结果。");

    await settleApp(40);
    expect(host.querySelector(".joint-score-card")).not.toBeNull();
    expect(host.textContent).toContain("已加载该次联合搜索结果。");
    const canceledAttempt = historyStore.records.find((record) => record.kind === "joint" && record.id !== "saved-joint-result");
    expect(canceledAttempt?.status).toBe("cancelled");
    expect(optimizeJointMock).toHaveBeenCalledTimes(1);
  });

  it("修改已载入联合结果的食物策略后隐藏旧结果并回到准备状态", async () => {
    seedCompletedJointHistory(testJointConfig(["RDM", "WHM"]));
    navigateToJoint();
    await settleApp();
    openSearchHistory();
    await settleApp();

    const savedRecord = historyCardContaining(`${jobSchemas.RDM.name} ${jobSchemas.RDM.maxJobLevel} 级、${jobSchemas.WHM.name}`);
    click(savedRecord.querySelector<HTMLButtonElement>(".search-history-load-result")!);
    expect(host.querySelector(".joint-score-card")).not.toBeNull();
    expect(host.textContent).toContain("搜索已完成");

    selectValue("食物策略", "independent");

    expect(host.querySelector(".joint-score-card")).toBeNull();
    expect(host.querySelector('[aria-label="本次联合结果的共享条件"]')).toBeNull();
    expect(host.textContent).toContain("准备联合搜索");
    expect(host.textContent).not.toContain("搜索已完成");
    expect(host.textContent).not.toContain("没有可行联合方案");
    expect(host.textContent).not.toContain("已加载该次联合搜索结果。");
    expect(optimizeJointMock).not.toHaveBeenCalled();
  });
});
