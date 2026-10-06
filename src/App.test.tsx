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

const { optimizeMock, optimizeJointMock, findFeasibleGcdsMock, historyStore } = vi.hoisted(() => ({
  optimizeMock: vi.fn(),
  optimizeJointMock: vi.fn(),
  findFeasibleGcdsMock: vi.fn(),
  historyStore: { records: [] as MockHistoryRecord[], nextId: 0 },
}));

vi.mock("./domain", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./domain")>()),
  optimize: optimizeMock,
  optimizeJoint: optimizeJointMock,
  findFeasibleGcds: findFeasibleGcdsMock,
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
  gears,
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
  findFeasibleGcdsMock.mockReset();
  findFeasibleGcdsMock.mockResolvedValue([2.5, 2.48]);
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
  const sampleWeapon = gears.find((gear) => gear.slot === "weapon" && gear.jobs.includes("SAM"));
  if (!sampleWeapon) throw new Error("测试需要一件有效的武士武器");
  return {
    gear: [{ ...sampleWeapon, melds: [], finalStats: {} }],
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

describe("单职业连续搜索工作台", () => {
  it("启动时不预选职业；选择职业后直接进入连续工作台", () => {
    expect(host.querySelector('[aria-label="配装设置进度"]')).toBeNull();
    for (const jobId of jobIds) {
      expect(buttonNamed(jobSchemas[jobId].name).getAttribute("aria-pressed")).toBe("false");
    }
    expect(() => buttonNamed("开始搜索")).toThrow();
    expect(optimizeMock).not.toHaveBeenCalled();

    chooseJob("SAM");
    expect(host.querySelector(".single-workbench-heading")?.textContent).toContain(jobSchemas.SAM.name);
    expect(() => textField("职业等级")).toThrow();
    expect(textField("最低装备品级")).toBeDefined();
    expect(textField("同步品级")).toBeDefined();
    expect(textField("食物")).toBeDefined();
    expect(buttonNamed("开始搜索").disabled).toBe(false);
    expect(host.querySelector(".single-workbench-aside")).not.toBeNull();
    expect(optimizeMock).not.toHaveBeenCalled();
  });

  it("按设计稿提供不限、GCD 档位和自定义速度三种互斥状态", async () => {
    chooseJob("WAR");
    const mode = () => host.querySelector<HTMLSelectElement>('select[aria-label="GCD 约束类型"]')!;
    expect([...mode().options].map((option) => [option.value, option.textContent])).toEqual([
      ["any", "不限"],
      ["multiple", "指定 GCD 档位"],
      ["speed", "自定义速度范围"],
    ]);
    expect(mode().value).toBe("speed");
    expect(host.querySelector(".single-objective-display")?.textContent).toContain("每秒每威力伤害期望");
    expect(host.querySelector(".single-gcd-choice-trigger")).toBeNull();
    expect(host.querySelector(".single-speed-inline")).not.toBeNull();
    expect(textField("最低技速").value).toBe("");
    expect(textField("最高技速").value).toBe("");
    expect(host.querySelector(".single-speed-separator")?.textContent).toBe("–");
    expect(buttonNamed("开始搜索").disabled).toBe(false);
    expect(host.querySelector(".single-workbench-actionbar")?.textContent).toContain("已就绪");
    expect(textField("坚韧方式")).toBeDefined();

    selectAriaValue("GCD 约束类型", "multiple");
    expect(host.querySelector(".single-gcd-choice-trigger")?.textContent).toContain("正在查询档位");
    expect(buttonNamed("开始搜索").disabled).toBe(true);
    await settleApp(260);
    expect(findFeasibleGcdsMock).toHaveBeenCalledTimes(1);
    expect(findFeasibleGcdsMock.mock.calls.at(-1)?.[0]).toMatchObject({
      gcdTarget: undefined,
      gcdChoices: undefined,
      speedMin: undefined,
      speedMax: undefined,
    });
    click(buttonNamed("选择 GCD 档位"));
    expect(host.querySelectorAll(".single-gcd-choice-option input[type=checkbox]")).toHaveLength(2);
    const tierCheckboxes = [...host.querySelectorAll<HTMLInputElement>(".single-gcd-choice-option input[type=checkbox]")];
    act(() => tierCheckboxes[0]!.click());
    expect(host.querySelector(".single-objective-display")?.textContent).toContain("每威力伤害期望");
    expect(buttonNamed("开始搜索").disabled).toBe(false);
    act(() => tierCheckboxes[1]!.click());
    expect(host.querySelectorAll(".single-gcd-chip:not(.single-gcd-chip-measure)")).toHaveLength(2);
    expect(host.querySelector(".single-objective-display")?.textContent).toContain("每秒每威力伤害期望");

    selectAriaValue("GCD 约束类型", "any");
    expect(host.querySelector(".single-gcd-choice-trigger")).toBeNull();
    expect(host.querySelector(".single-objective-display")?.textContent).toContain("每秒每威力伤害期望");

    selectAriaValue("GCD 约束类型", "speed");
    expect(host.querySelector(".single-speed-inline > span:first-child")?.textContent).toBe("技速");
    expect(buttonNamed("开始搜索").disabled).toBe(false);
    inputValue("最低技速", "1234");
    await settleApp(340);
    expect(findFeasibleGcdsMock).toHaveBeenCalled();
    expect(findFeasibleGcdsMock.mock.calls.at(-1)?.[0]).toMatchObject({
      speedMin: 1234,
      gcdTarget: undefined,
      gcdChoices: undefined,
    });
    expect(host.querySelector(".single-objective-display")?.textContent).toContain("每秒每威力伤害期望");
    expect(buttonNamed("开始搜索").disabled).toBe(false);
  });

  it("GCD 档位标签按当前控件宽度自适应显示", async () => {
    findFeasibleGcdsMock.mockResolvedValue([2.5, 2.48, 2.46, 2.44]);
    chooseJob("WAR");
    selectAriaValue("GCD 约束类型", "multiple");
    await settleApp(260);
    click(buttonNamed("选择 GCD 档位"));
    const choices = [...host.querySelectorAll<HTMLInputElement>(".single-gcd-choice-option input[type=checkbox]")];
    expect(choices).toHaveLength(4);
    act(() => choices.forEach((choice) => choice.click()));

    const chips = host.querySelector<HTMLElement>(".single-gcd-chips")!;
    let availableWidth = 190;
    Object.defineProperty(chips, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        x: 0, y: 0, width: availableWidth, height: 24,
        top: 0, right: availableWidth, bottom: 24, left: 0,
        toJSON: () => ({}),
      }) as DOMRect,
    });
    act(() => window.dispatchEvent(new Event("resize")));
    expect(chips.querySelectorAll(".single-gcd-chip:not(.single-gcd-chip-measure):not(.is-overflow)")).toHaveLength(3);
    expect(chips.querySelectorAll(".single-gcd-chip.is-overflow:not(.single-gcd-chip-measure)")).toHaveLength(1);

    availableWidth = 230;
    act(() => window.dispatchEvent(new Event("resize")));
    expect(chips.querySelectorAll(".single-gcd-chip:not(.single-gcd-chip-measure):not(.is-overflow)")).toHaveLength(4);
    expect(chips.querySelectorAll(".single-gcd-chip.is-overflow:not(.single-gcd-chip-measure)")).toHaveLength(0);
  });

  it("进度页显示真实槽位候选和当前模型数据；单轮不显示核验组合计数", async () => {
    chooseJob("BLM");
    let callbacks: {
      signal: AbortSignal;
      onProgress?: (message: string) => void;
      onCandidateCounts?: (counts: { jobId: JobId; slots: { slot: string; count: number }[]; foodCount: number }) => void;
      onSolverProgress?: (progress: {
        backend: "HiGHS";
        model: string;
        kind: "bound" | "incumbent" | "log";
        objectiveValue?: number;
        bestBound?: number;
        gap?: number;
        nodes?: string;
        totalLpIterations?: string;
        variableCount?: number;
        rowCount?: number;
        status?: string;
        completed?: boolean;
      }) => void;
    } | undefined;
    optimizeMock.mockImplementation((_config: unknown, options: {
      signal: AbortSignal;
      onProgress?: (message: string) => void;
      onCandidateCounts?: (counts: { jobId: JobId; slots: { slot: string; count: number }[]; foodCount: number }) => void;
      onSolverProgress?: (progress: {
        backend: "HiGHS";
        model: string;
        kind: "bound" | "incumbent" | "log";
        objectiveValue?: number;
        bestBound?: number;
        gap?: number;
        nodes?: string;
        totalLpIterations?: string;
        variableCount?: number;
        rowCount?: number;
        status?: string;
        completed?: boolean;
      }) => void;
    }) => {
      callbacks = options;
      return new Promise((_resolve, reject) => {
      options.signal.addEventListener(
        "abort",
        () => reject(new DOMException("Search cancelled", "AbortError")),
        { once: true },
      );
      });
    });

    await startSearchAndSettle();
    act(() => {
      callbacks?.onProgress?.("候选准备完成；正在求解配装");
      callbacks?.onCandidateCounts?.({
        jobId: "BLM",
        slots: [
          { slot: "weapon", count: 57 },
          { slot: "head", count: 47 },
          { slot: "body", count: 49 },
          { slot: "hands", count: 47 },
          { slot: "legs", count: 47 },
          { slot: "feet", count: 47 },
          { slot: "earrings", count: 30 },
          { slot: "necklace", count: 30 },
          { slot: "bracelet", count: 30 },
          { slot: "rings", count: 870 },
        ],
        foodCount: 32,
      });
      callbacks?.onSolverProgress?.({
        backend: "HiGHS",
        model: "exact_damage_initial",
        kind: "bound",
        objectiveValue: 1.01,
        bestBound: 1.02,
        gap: 0.004,
        nodes: "793",
        totalLpIterations: "46103",
        variableCount: 3281,
        rowCount: 358,
      });
    });
    expect(host.querySelector('[aria-label="搜索阶段"]')).not.toBeNull();
    expect(host.textContent).toContain("正在寻找符合条件的最优配装");
    expect(host.querySelector('[role="progressbar"]')).toBeNull();
    expect(host.textContent).toContain("870");
    expect(host.textContent).toContain("32");
    expect(host.textContent).toContain("当前算法搜索状态");
    expect(host.textContent).not.toContain("仅描述当前模型");
    expect(host.textContent).toContain("793");
    expect(host.textContent).toContain("46,103");
    expect(host.textContent).toContain("3,281");
    expect(host.textContent).not.toContain("剩余时间");
    act(() => callbacks?.onSolverProgress?.({
      backend: "HiGHS",
      model: "exact_damage_initial",
      kind: "incumbent",
      objectiveValue: 1.02,
      bestBound: 1.03,
      gap: 0.01,
      nodes: "794",
      totalLpIterations: "46104",
      variableCount: 3281,
      rowCount: 358,
    }));
    expect(host.textContent).toContain("已找到待核验方案，正在检查是否还有更优方案");
    act(() => callbacks?.onProgress?.("精确候选已核验 1 个；固定点上界=123"));
    expect(host.textContent).not.toContain("已核验 1 组");
    expect(host.textContent).not.toContain("第 2 轮");
    act(() => callbacks?.onSolverProgress?.({
      backend: "HiGHS",
      model: "exact_damage_band_feasibility",
      kind: "bound",
      objectiveValue: 1,
      bestBound: 1.1,
      gap: 0.02,
      nodes: "1",
      totalLpIterations: "11",
      variableCount: 10,
      rowCount: 5,
    }));
    expect(host.textContent).not.toContain("第 2 轮");
    expect(host.textContent).not.toContain("已核验 1 组候选组合");
    click(buttonNamed("取消搜索"));
    await settleApp();
    expect(host.querySelector('[aria-label="搜索阶段"]')).toBeNull();
    expect(host.textContent).toContain("搜索已取消");

    click(buttonNamed("更换职业"));
    chooseJob("PLD");
    await startSearchAndSettle();
    act(() => callbacks?.onCandidateCounts?.({
      jobId: "PLD",
      slots: [
        { slot: "weapon", count: 5 }, { slot: "offhand", count: 5 },
        { slot: "head", count: 5 }, { slot: "body", count: 5 },
        { slot: "hands", count: 5 }, { slot: "legs", count: 5 },
        { slot: "feet", count: 5 }, { slot: "earrings", count: 5 },
        { slot: "necklace", count: 5 }, { slot: "bracelet", count: 5 },
        { slot: "rings", count: 25 },
      ],
      foodCount: 1,
    }));
    expect(host.querySelectorAll(".single-search-candidate-slot")).toHaveLength(12);
    expect(host.querySelector(".single-search-candidate-heading")?.textContent)
      .toContain("装备与食物候选");
    click(buttonNamed("取消搜索"));
    await settleApp();
  });

  it("结果页按稿显示目标值、推荐表格和摘要，并允许修改条件", async () => {
    chooseJob("SAM");
    optimizeMock.mockResolvedValueOnce(sampleResult());
    await startSearchAndSettle();
    await settleApp();

    expect(host.querySelector(".single-result-workspace")).not.toBeNull();
    expect(host.querySelector('[aria-label="搜索阶段"]')).toBeNull();
    const resultTitlebar = host.querySelector<HTMLElement>(".single-result-titlebar");
    expect(normalizedText(resultTitlebar!)).toContain("配装结果");
    expect(normalizedText(resultTitlebar!)).toContain("目标值 1.0000000");
    expect(normalizedText(resultTitlebar!)).toContain("用时 0.0 秒");
    expect(normalizedText(resultTitlebar!)).not.toContain("武士");
    expect(host.querySelector(".single-result-titlebar")).not.toBeNull();
    expect(host.querySelector(".single-result-workspace .result-toolbar h2")).toBeNull();
    expect(host.querySelector(".single-result-workspace .result-completion")).toBeNull();
    expect(host.textContent).not.toContain("基线比例");
    expect(host.textContent).not.toContain("个候选");
    expect([...host.querySelectorAll(".single-result-workspace .result-conclusion .stat-pill")]
      .map((item) => normalizedText(item.querySelector("span") ?? item))).toEqual([
      "每威力伤害期望",
      "GCD",
      "暴击率",
      "直击率",
      "每秒每威力伤害期望",
    ]);
    const resultMetrics = [...host.querySelectorAll<HTMLElement>(".single-result-workspace .result-conclusion .stat-pill")];
    expect(resultMetrics[0]?.classList.contains("accent")).toBe(false);
    expect(resultMetrics.at(-1)?.classList.contains("accent")).toBe(true);
    const resultTable = host.querySelector<HTMLTableElement>(".single-result-workspace table.single-job-gear-table");
    expect(resultTable?.tagName).toBe("TABLE");
    expect(resultTable?.caption?.textContent).toContain("推荐配装装备属性表");
    expect(resultTable?.tHead?.querySelectorAll('th[scope="col"]')).toHaveLength(11);
    expect([...resultTable!.tBodies[0]!.rows].map((row) => row.className)).toEqual([
      "gear-row",
      "food-row",
      "gear-total-row",
    ]);
    const recommendationHeading = host.querySelector<HTMLElement>(".single-result-table-heading");
    expect(recommendationHeading?.querySelector("h2")?.textContent).toBe("推荐配装");
    const shareLink = recommendationHeading?.querySelector<HTMLAnchorElement>(".single-result-open-link");
    expect(shareLink?.href).toContain("asvel.github.io/ffxiv-gearing/");
    expect(host.textContent).toContain("伤害与防御");
    expect(host.textContent).toContain("搜索条件与限制");
    expect(host.textContent).not.toContain("结果身份");
    expect(host.textContent).not.toContain("配装总属性");
    const resultAsideSections = [...host.querySelectorAll<HTMLElement>(".single-result-aside .single-summary-section h3")]
      .map((heading) => normalizedText(heading));
    expect(resultAsideSections).toEqual(["伤害与防御", "搜索条件与限制"]);
    const resultEffects = host.querySelector(".single-result-workspace .single-result-effects");
    expect(normalizedText(resultEffects!)).toContain("暴击伤害");
    expect(normalizedText(resultEffects!)).toContain("信念加成");
    expect(normalizedText(resultEffects!)).not.toContain("GCD");
    expect(normalizedText(resultEffects!)).not.toContain("暴击率");
    expect(normalizedText(resultEffects!)).not.toContain("直击率");
    expect(host.querySelectorAll(".single-job-stat-heading")).toHaveLength(6);

    click(buttonNamed("修改条件"));
    expect(host.querySelector(".single-result-workspace")).toBeNull();
    expect(host.querySelector(".single-workbench-layout")).not.toBeNull();
    expect(optimizeMock).toHaveBeenCalledTimes(1);
  });

  it("保存单次搜索历史，且摘要、结果与载入的条件都不展示职业等级", async () => {
    chooseJob("SAM");
    expect(() => textField("职业等级")).toThrow();
    optimizeMock.mockResolvedValueOnce(sampleResult());
    await startSearchAndSettle();
    await settleApp();
    expect(historyStore.records).toHaveLength(1);
    expect(historyStore.records[0]).toMatchObject({
      kind: "single",
      status: "completed",
      config: { jobId: "SAM", jobLevel: jobSchemas.SAM.maxJobLevel },
    });

    click(buttonNamed("修改条件"));
    expect(() => textField("职业等级")).toThrow();
    optimizeMock.mockResolvedValueOnce(sampleResult());
    await startSearchAndSettle();
    await settleApp();
    expect(historyStore.records).toHaveLength(2);
    expect(historyStore.records.map((record) => record.status)).toEqual(["completed", "completed"]);
    expect(historyStore.records.map((record) => (record.config as OptimizationConfig).jobLevel)).toEqual([
      jobSchemas.SAM.maxJobLevel,
      jobSchemas.SAM.maxJobLevel,
    ]);

    click(buttonNamed("修改条件"));
    openSearchHistory();
    await settleApp();
    expect(normalizedText(detailsNamed("搜索记录"))).toContain("2 次");
    const firstRecord = historyCardContaining(jobSchemas.SAM.name + " ·");
    expect(normalizedText(firstRecord)).not.toContain(`${jobSchemas.SAM.name} · ${jobSchemas.SAM.maxJobLevel} 级 ·`);
    click(firstRecord.querySelector<HTMLButtonElement>(".search-history-load-result")!);
    expect(host.querySelector(".single-result-workspace")).not.toBeNull();
    expect(host.querySelector(".single-result-summary, .single-condition-summary.is-result")).not.toBeNull();
    expect(host.textContent).toContain("数据版本");
    expect(host.textContent).not.toContain("职业等级");

    click(buttonNamed("修改条件"));
    await settleApp();
    openSearchHistory();
    const savedRecord = historyCardContaining(jobSchemas.SAM.name + " ·");
    click(savedRecord.querySelector<HTMLButtonElement>(".search-history-load-config")!);
    expect(host.querySelector(".single-workbench-layout")).not.toBeNull();
    expect(() => textField("职业等级")).toThrow();
    expect(host.querySelector(".single-result-workspace")).toBeNull();
    expect(optimizeMock).toHaveBeenCalledTimes(2);
  });

  it("载入较低等级的旧单职业条件后按职业最高等级执行", async () => {
    const legacyConfig = {
      ...testJobConfig("SAM"),
      jobLevel: Math.max(1, (jobSchemas.SAM.maxJobLevel ?? 100) - 10),
    };
    const startedAtISO = new Date(Date.UTC(2026, 9, 2, 12, 0, 0)).toISOString();
    historyStore.records.push({
      id: "legacy-single-condition",
      kind: "single",
      config: legacyConfig,
      dataVersion: currentDataVersion(),
      status: "failed",
      startedAtISO,
      finishedAtISO: new Date(Date.parse(startedAtISO) + 1_000).toISOString(),
      error: "旧历史记录",
    });

    remountApp();
    await settleApp();
    openSearchHistory();
    await settleApp();
    const legacyRecord = historyCardContaining(jobSchemas.SAM.name + " ·");
    click(legacyRecord.querySelector<HTMLButtonElement>(".search-history-load-config")!);
    expect(host.querySelector(".single-workbench-layout")).not.toBeNull();
    expect(() => textField("职业等级")).toThrow();

    optimizeMock.mockResolvedValueOnce(sampleResult());
    await startSearchAndSettle();
    await settleApp();
    expect(optimizeMock.mock.calls[0]?.[0]).toMatchObject({
      jobId: "SAM",
      jobLevel: jobSchemas.SAM.maxJobLevel,
      minItemLevel: legacyConfig.minItemLevel,
      maxItemLevel: legacyConfig.maxItemLevel,
    });
  });

  it("载入只有旧 gcdTarget 的历史条件后，转换为可搜索的单档选择", async () => {
    const legacyConfig: OptimizationConfig = {
      ...testJobConfig("SAM"),
      gcdTarget: 2.48,
      objective: "damage",
    };
    const startedAtISO = new Date(Date.UTC(2026, 9, 2, 12, 0, 0)).toISOString();
    historyStore.records.push({
      id: "legacy-single-gcd-target",
      kind: "single",
      config: legacyConfig,
      dataVersion: currentDataVersion(),
      status: "failed",
      startedAtISO,
      finishedAtISO: new Date(Date.parse(startedAtISO) + 1_000).toISOString(),
      error: "旧 GCD 条件",
    });

    remountApp();
    await settleApp();
    openSearchHistory();
    await settleApp();
    const legacyRecord = historyCardContaining(jobSchemas.SAM.name + " ·");
    click(legacyRecord.querySelector<HTMLButtonElement>(".search-history-load-config")!);
    await settleApp();

    expect(host.querySelector<HTMLSelectElement>('select[aria-label="GCD 约束类型"]')?.value).toBe("multiple");
    expect(host.querySelector(".single-gcd-choice-trigger")?.textContent).toContain("2.48");
    expect(host.querySelector(".single-objective-display")?.textContent).toContain("每威力伤害期望");
    expect(buttonNamed("开始搜索").disabled).toBe(false);

    optimizeMock.mockResolvedValueOnce(sampleResult());
    await startSearchAndSettle();
    expect(optimizeMock.mock.calls.at(-1)?.[0]).toMatchObject({
      gcdTarget: undefined,
      gcdChoices: [2.48],
      objective: "damage",
    });
  });

  it("限制详情可键盘访问，浮窗内点击保持打开，Esc 或外部点击会收起", () => {
    chooseJob("SAM");
    const summary = host.querySelector(".single-condition-summary.is-workbench");
    expect(summary).not.toBeNull();
    const triggers = [...summary!.querySelectorAll<HTMLButtonElement>(".single-summary-popover-trigger")];
    expect(triggers).toHaveLength(3);
    click(triggers[0]!);
    expect(triggers[0]!.getAttribute("aria-expanded")).toBe("true");
    const panel = document.body.querySelector(".single-summary-popover-panel");
    expect(panel).not.toBeNull();
    expect(summary!.contains(panel)).toBe(false);
    const panelList = panel!.querySelector<HTMLElement>(".single-summary-popover-list");
    expect(panelList).not.toBeNull();
    expect(panelList!.tabIndex).toBe(0);
    expect(document.activeElement).toBe(panelList);

    act(() => panelList!.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    expect(document.body.querySelector(".single-summary-popover-panel")).not.toBeNull();

    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(document.body.querySelector(".single-summary-popover-panel")).toBeNull();
    expect(document.activeElement).toBe(triggers[0]);

    act(() => triggers[0]!.click());
    expect(document.body.querySelector(".single-summary-popover-panel")).not.toBeNull();
    act(() => host.querySelector(".single-objective-display")!.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    expect(document.body.querySelector(".single-summary-popover-panel")).toBeNull();
    expect(triggers[0]!.getAttribute("aria-expanded")).toBe("false");
  });

  it("取消、无解和失败分别记录终态", async () => {
    chooseJob("SAM");
    mockAbortableSearch();
    await startSearchAndSettle();
    click(buttonNamed("取消搜索"));
    await settleApp();
    expect(host.textContent).toContain("搜索已取消");

    optimizeMock.mockResolvedValueOnce(null);
    await startSearchAndSettle();
    await settleApp();
    expect(host.textContent).toContain("没有可行配装");

    optimizeMock.mockRejectedValueOnce(new Error("Solve error"));
    await startSearchAndSettle();
    await settleApp();
    expect(host.textContent).toContain("搜索失败");

    expect(historyStore.records.map((record) => record.status)).toEqual([
      "cancelled",
      "no-result",
      "failed",
    ]);
    click(buttonNamed("更换职业"));
    openSearchHistory();
    await settleApp();
    const recordsText = normalizedText(detailsNamed("搜索记录"));
    expect(recordsText).toContain("已取消");
    expect(recordsText).toContain("无可行结果");
    expect(recordsText).toContain("搜索失败");
  });
});

describe("多职业联合搜索保持现状", () => {
  it("联合职业仍可同时设置 GCD、速度与多项坚韧条件，并保留原有控件布局", async () => {
    navigateToJoint();
    await settleApp();

    const rdmCard = [...host.querySelectorAll<HTMLDetailsElement>(".job-config-card")]
      .find((card) => normalizedText(card.querySelector("summary") ?? card).includes(jobSchemas.RDM.name));
    expect(rdmCard).toBeDefined();
    openDetails(rdmCard!);
    const rdmFields = rdmCard!.querySelector<HTMLElement>(".job-fields");
    expect(rdmFields?.querySelector(":scope > .job-level-field")).not.toBeNull();
    expect(rdmFields?.querySelector(".candidate-range-group .job-level-field")).toBeNull();
    expect(rdmFields?.querySelector(".single-restriction-columns")).toBeNull();
    expect(rdmFields?.querySelector(".restriction-details")).not.toBeNull();

    openDetails(rdmFields!.querySelector<HTMLDetailsElement>("details.advanced-section")!);
    selectAriaValue("GCD 约束类型", "single");
    inputValue("目标 GCD", "2.40");
    inputValue("最低咏速", "1234");
    expect((textField("目标 GCD") as HTMLInputElement).value).toBe("2.40");
    expect((textField("最低咏速") as HTMLInputElement).value).toBe("1234");
    expect((textField("联合目标") as HTMLSelectElement).value).toBe("damage");

    selectAriaValue("添加职业", "WAR");
    click(buttonNamed("添加职业"));
    await settleApp();
    const warCard = [...host.querySelectorAll<HTMLDetailsElement>(".job-config-card")]
      .find((card) => normalizedText(card.querySelector("summary") ?? card).includes(jobSchemas.WAR.name));
    expect(warCard).toBeDefined();
    openDetails(warCard!);
    expect(warCard!.querySelector('select[aria-label="坚韧方式"]')).toBeNull();
    inputValue("最低坚韧值", "900");
    inputValue("最低减伤", "5");
    const maximumTenacity = [...warCard!.querySelectorAll<HTMLLabelElement>("label")]
      .find((label) => normalizedText(label).includes("达到当前候选范围内的最高坚韧值"))
      ?.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(maximumTenacity).toBeDefined();
    act(() => maximumTenacity!.click());
    expect((textField("最低坚韧值") as HTMLInputElement).value).toBe("900");
    expect((textField("最低减伤") as HTMLInputElement).value).toBe("5");
    expect(maximumTenacity!.checked).toBe(true);
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

  it("联合结果继续使用原来的 GCD 折算指标名称", async () => {
    const config = testJointConfig(["RDM", "WHM"]);
    seedCompletedJointHistory(config);
    navigateToJoint();
    await settleApp();
    openSearchHistory();
    await settleApp();
    const record = historyCardContaining(`${jobSchemas.RDM.name} ${jobSchemas.RDM.maxJobLevel} 级、${jobSchemas.WHM.name}`);
    click(record.querySelector<HTMLButtonElement>(".search-history-load-result")!);

    const metricStrip = host.querySelector(".joint-job-result .result-conclusion");
    expect(normalizedText(metricStrip!)).toContain("按 GCD 折算");
    expect(normalizedText(metricStrip!)).not.toContain("每秒每威力伤害期望");
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
