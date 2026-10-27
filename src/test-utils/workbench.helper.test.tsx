// @vitest-environment jsdom
// 页面和组件界面测试共用的夹具；Vitest 会排除 .helper.test 文件。
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, vi } from "vitest";

type MockHistoryRecord = {
  id: string;
  kind: "single" | "joint";
  config: unknown;
  dataVersion: string;
  status:
    | "running"
    | "completed"
    | "cancelled"
    | "no-result"
    | "failed"
    | "interrupted";
  startedAtISO: string;
  error?: string;
  result?: unknown;
};

const testMocks = vi.hoisted(() => ({
  optimizeMock: vi.fn(),
  optimizeJointMock: vi.fn(),
  findFeasibleGcdsMock: vi.fn(),
  historyStore: { records: [] as MockHistoryRecord[], nextId: 0 },
}));
export const optimizeMock = testMocks.optimizeMock;
export const optimizeJointMock = testMocks.optimizeJointMock;
export const findFeasibleGcdsMock = testMocks.findFeasibleGcdsMock;
export const historyStore = testMocks.historyStore;

vi.mock("@/domain", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/domain")>()),
  optimize: testMocks.optimizeMock,
  optimizeJoint: testMocks.optimizeJointMock,
  findFeasibleGcds: testMocks.findFeasibleGcdsMock,
}));

vi.mock("@/ui/services/search-history", async (original) => ({
  ...(await original<typeof import("@/ui/services/search-history")>()),
  replaceSearchHistoryGearIfCurrent: vi.fn(async (link, gear) => {
    const record = historyStore.records.find(record => record.id === link.id);
    if (!record?.result || record.kind !== "single") return undefined;
    record.result = { ...record.result as object, gear: structuredClone(gear) };
    return link;
  }),
  saveCompletedSearchHistory: vi.fn(
    async (input: {
      kind: "single" | "joint";
      config: unknown;
      dataVersion: string;
      startedAtISO: string;
      result: unknown;
    }) => {
      historyStore.nextId += 1;
      const record: MockHistoryRecord = {
        ...structuredClone(input),
        id: `history-${historyStore.nextId}`,
        status: "completed",
      };
      historyStore.records.push(record);
      return structuredClone(record);
    },
  ),
  listSearchHistory: vi.fn(async (kind?: "single" | "joint") =>
    historyStore.records
      .filter(
        (record) =>
          record.status === "completed" &&
          (kind === undefined || record.kind === kind),
      )
      .sort(
        (left, right) =>
          Date.parse(right.startedAtISO) - Date.parse(left.startedAtISO) ||
          right.id.localeCompare(left.id),
      )
      .map((record) => structuredClone(record)),
  ),
}));

import { App, createAppRouter, type AppRouter } from "../ui/app/App";
import {
  defaultDataVersion,
  foods,
  gears,
  jobIds,
  jobSchemas,
  type JobId,
  type JointOptimizationConfig,
  type JointOptimizationResult,
  type OptimizationConfig,
  type OptimizationResult,
} from "@/domain";

export let host: HTMLDivElement;
let root: Root;
let appRouter: AppRouter;

beforeEach(async () => {
  optimizeMock.mockReset();
  optimizeJointMock.mockReset();
  findFeasibleGcdsMock.mockReset();
  findFeasibleGcdsMock.mockResolvedValue([2.5, 2.48]);
  historyStore.records.length = 0;
  historyStore.nextId = 0;
  host = document.createElement("div");
  document.body.append(host);
  window.history.replaceState(null, "", "/single");
  appRouter = createAppRouter({ restore: false });
  await appRouter.load();
  root = createRoot(host);
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  act(() => root.render(<App router={appRouter} />));
  await settleApp();
});

afterEach(() => {
  act(() => root.unmount());
  appRouter.history.destroy();
  host.remove();
});

export function normalizedText(element: Element): string {
  return element.textContent?.replace(/\s+/g, " ").trim() ?? "";
}
export function buttonNamed(name: string): HTMLButtonElement {
  const button = [...host.querySelectorAll("button")].find(
    (item) =>
      normalizedText(item) === name || item.getAttribute("aria-label") === name,
  );
  if (!button) throw new Error(`找不到按钮「${name}」`);
  return button;
}
export function buttonContaining(text: string): HTMLButtonElement {
  const button = [...host.querySelectorAll("button")].find((item) =>
    normalizedText(item).includes(text),
  );
  if (!button) throw new Error(`找不到包含「${text}」的按钮`);
  return button;
}

export function click(button: HTMLButtonElement): void {
  act(() => button.click());
}

export function textField(
  labelText: string,
): HTMLInputElement | HTMLSelectElement {
  const label = [...host.querySelectorAll("label")].find((item) =>
    normalizedText(item).startsWith(labelText),
  );
  const control = label?.control ?? label?.querySelector("input, select");
  if (!(
    control instanceof HTMLInputElement || control instanceof HTMLSelectElement
  )) {
    throw new Error(`找不到「${labelText}」输入项`);
  }
  return control;
}

export function selectValue(label: string, value: string): void {
  const select = textField(label);
  if (!(select instanceof HTMLSelectElement))
    throw new Error(`「${label}」不是下拉框`);
  act(() => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

export function selectAriaValue(ariaLabel: string, value: string): void {
  const select = host.querySelector<HTMLSelectElement>(
    `select[aria-label="${ariaLabel}"]`,
  );
  if (!select) throw new Error(`找不到「${ariaLabel}」下拉框`);
  act(() => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

export function inputValue(label: string, value: string): void {
  const input = textField(label);
  if (!(input instanceof HTMLInputElement))
    throw new Error(`「${label}」不是输入框`);
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

export function currentStep(): string | undefined {
  return (
    host.querySelector('[aria-current="step"]')?.getAttribute("aria-label") ??
    undefined
  );
}

export function progressStep(step: number): HTMLButtonElement {
  const button = [
    ...host
      .querySelector('[aria-label="配装设置进度"]')!
      .querySelectorAll("button"),
  ].find((item) => item.getAttribute("aria-label")?.startsWith(`${step}.`));
  if (!button) throw new Error(`找不到第 ${step} 步进度按钮`);
  return button;
}

export function editSummaryRow(label: string): void {
  const row = [...host.querySelectorAll(".summary-row")].find(
    (item) => normalizedText(item.querySelector("span") ?? item) === label,
  );
  if (!row) throw new Error(`找不到「${label}」条件摘要`);
  const edit = row.querySelector("button");
  if (!edit) throw new Error(`「${label}」没有编辑入口`);
  click(edit);
}

export function detailsNamed(text: string): HTMLDetailsElement {
  const details = [...host.querySelectorAll("details")].find((item) =>
    normalizedText(item.querySelector("summary") ?? item).includes(text),
  );
  if (!details) throw new Error(`找不到「${text}」折叠区`);
  return details;
}

export function snapshotValue(
  label: string,
  ariaLabel = "本次结果的搜索条件",
): string {
  const snapshot = host.querySelector(`[aria-label="${ariaLabel}"]`);
  if (!snapshot) throw new Error("找不到本次结果的搜索条件快照");
  const row = [...snapshot.querySelectorAll("dl > div")].find(
    (item) => normalizedText(item.querySelector("dt") ?? item) === label,
  );
  const value = row?.querySelector("dd");
  if (!value) throw new Error(`找不到结果快照中的「${label}」`);
  return normalizedText(value);
}

export function openDetails(details: HTMLDetailsElement): void {
  if (details.open) return;
  const summary = details.querySelector("summary");
  if (!summary) throw new Error("折叠区缺少标题");
  act(() => summary.click());
}

export function chooseJob(jobId: keyof typeof jobSchemas): void {
  const jobName = jobSchemas[jobId].name;
  click(buttonNamed(jobName));
}

export function confirmStep(): void {
  click(buttonNamed("确认并继续"));
}

export function advanceToReview(jobId: keyof typeof jobSchemas = "SAM"): void {
  chooseJob(jobId);
  confirmStep();
  confirmStep();
  confirmStep();
}

export function mockAbortableSearch(): void {
  optimizeMock.mockImplementation(
    (_config: unknown, options: { signal: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        options.signal.addEventListener(
          "abort",
          () => reject(new DOMException("Search cancelled", "AbortError")),
          { once: true },
        );
      }),
  );
}

export function sampleResult(): OptimizationResult {
  const sampleWeapon = gears.find(
    (gear) => gear.slot === "weapon" && gear.jobs.includes("SAM"),
  );
  if (!sampleWeapon) throw new Error("测试需要一件有效的武士武器");
  return {
    calculationLevel: 100,
    gear: [{ ...sampleWeapon, melds: [], finalStats: {} }],
    food: { ...foods[0]!, actualStats: {}, utilization: 0 },
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
    statistics: { elapsedMs: 1 },
  };
}

export function currentDataVersion(): string {
  return defaultDataVersion;
}

export async function settleApp(milliseconds = 0): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  });
}

export async function startSearchAndSettle(): Promise<void> {
  await act(async () => {
    const button = [...host.querySelectorAll("button")].find(
      (item) =>
        normalizedText(item).includes("开始") &&
        normalizedText(item).includes("搜索"),
    );
    if (!button) throw new Error("找不到开始搜索按钮");
    if (button.disabled) throw new Error("开始搜索按钮当前不可用");
    button.click();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

export function openSearchHistory(): void {
  const history = detailsNamed("搜索记录");
  const ancestors: HTMLDetailsElement[] = [];
  for (
    let parent = history.parentElement;
    parent;
    parent = parent.parentElement
  ) {
    if (parent instanceof HTMLDetailsElement) ancestors.push(parent);
  }
  act(() => {
    for (const details of ancestors.reverse()) details.open = true;
    history.open = true;
  });
}

export function historyCardContaining(
  text: string,
  action?: "载入结果" | "载入条件",
): HTMLLIElement {
  const card = [
    ...host.querySelectorAll<HTMLLIElement>("details ol > li"),
  ].find(
    (item) =>
      normalizedText(item).includes(text) &&
      (action === undefined ||
        [...item.querySelectorAll("button")].some(
          (button) => normalizedText(button) === action,
        )),
  );
  if (!card) {
    const available = [
      ...host.querySelectorAll<HTMLLIElement>("details ol > li"),
    ]
      .map(normalizedText)
      .join(" | ");
    throw new Error(
      `找不到包含「${text}」并提供「${action ?? "任一操作"}」的搜索记录；当前记录：${available || "无"}`,
    );
  }
  return card;
}

export function historyActionButton(
  record: HTMLLIElement,
  label: "载入结果" | "载入条件",
): HTMLButtonElement {
  const button = [...record.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => normalizedText(item) === label,
  );
  if (!button) throw new Error(`找不到「${label}」按钮`);
  return button;
}

export function summaryRowValue(label: string): string {
  const row = [...host.querySelectorAll(".config-summary .summary-row")].find(
    (item) => normalizedText(item.querySelector("span") ?? item) === label,
  );
  if (!row) throw new Error(`找不到「${label}」条件摘要`);
  return normalizedText(row.querySelector("strong") ?? row);
}

export function remountApp(path = "/single"): void {
  act(() => root.unmount());
  appRouter.history.destroy();
  host.remove();
  host = document.createElement("div");
  document.body.append(host);
  window.history.replaceState(null, "", path);
  appRouter = createAppRouter({ restore: false });
  root = createRoot(host);
  act(() => root.render(<App router={appRouter} />));
}

export function navigateToJoint(): void {
  act(() => {
    void appRouter.navigate({ to: "/joint", search: {} });
  });
}

export function testJobConfig(jobId: JobId): OptimizationConfig {
  const job = jobSchemas[jobId];
  return {
    clanIndex: 0,
    jobId,
    minItemLevel: job.defaultItemLevel?.[0] ?? 1,
    maxItemLevel: job.defaultItemLevel?.[1] ?? 999,
    maximizeTenacity: false,
    objective: "damage",
    excludedSources: [],
    forcedGear: {},

    foodId: 0,
  };
}

export function testJointConfig(jobs: JobId[]): JointOptimizationConfig {
  return {
    jobs: jobs.map(testJobConfig),
    commonSlots: [],
    foodStrategy: "shared",
    objective: "damage",
  };
}

export function sampleJointResult(
  config: JointOptimizationConfig,
): JointOptimizationResult {
  const perJobResults = Object.fromEntries(
    config.jobs.map(({ jobId }) => [jobId, sampleResult()]),
  );
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

export function seedCompletedJointHistory(
  config: JointOptimizationConfig,
): void {
  const startedAtISO = new Date(Date.UTC(2026, 9, 2, 12, 0, 0)).toISOString();
  historyStore.records.push({
    id: "saved-joint-result",
    kind: "joint",
    config: structuredClone(config),
    dataVersion: currentDataVersion(),
    status: "completed",
    startedAtISO,
    result: structuredClone(sampleJointResult(config)),
  });
}

export function mockDelayedAbortableJointSearch(): void {
  optimizeJointMock.mockImplementation(
    (_config: unknown, options: { signal: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        options.signal.addEventListener(
          "abort",
          () => {
            window.setTimeout(
              () =>
                reject(
                  new DOMException("Joint search cancelled", "AbortError"),
                ),
              25,
            );
          },
          { once: true },
        );
      }),
  );
}

export async function selectFirstGcdTierIfEmpty(): Promise<void> {
  const label = [...host.querySelectorAll("label")].find(
    (el) => el.textContent === "可行 GCD 档位",
  );
  if (!label) return;
  const trigger = document.getElementById(label.htmlFor) as HTMLButtonElement;
  if (!/选择(?:单个|多个)档位/.test(trigger.textContent ?? "")) return;
  click(trigger);
  await settleApp();
  const option = [
    ...document.body.querySelectorAll<HTMLElement>('[role="option"]'),
  ].find((el) => /秒$/.test(normalizedText(el)));
  if (!option) throw new Error("没有可选 GCD 档位");
  act(() => option.click());
  await settleApp();
  act(() =>
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    ),
  );
  await settleApp(220);
}
