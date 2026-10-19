// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import * as testSupport from "@/test-utils/workbench.helper.test";
import { foods, jobSchemas } from "@/domain";
import {
  createSearchHistory,
  finishSearchHistory,
} from "@/ui/services/search-history";

const normalizedText = testSupport.normalizedText;

function historyRecord(
  text: string,
  action: "编辑条件" | "查看结果",
  root: ParentNode = testSupport.host,
): HTMLElement {
  const record = [
    ...root.querySelectorAll<HTMLElement>('[aria-label="搜索记录"] article'),
  ].find(
    (item) =>
      normalizedText(item).includes(text) &&
      [...item.querySelectorAll("button")].some(
        (button) => normalizedText(button) === action,
      ),
  );
  if (!record) throw new Error(`找不到「${text}」历史记录的「${action}」操作`);
  return record;
}

function historyAction(
  record: HTMLElement,
  action: "编辑条件" | "查看结果",
): HTMLButtonElement {
  const button = [...record.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => normalizedText(item) === action,
  );
  if (!button) throw new Error(`历史记录中没有「${action}」按钮`);
  return button;
}

async function enterConditions(): Promise<void> {
  testSupport.navigateToJoint();
  await testSupport.settleApp();
  testSupport.click(testSupport.buttonNamed(jobSchemas.RDM.name));
  testSupport.click(testSupport.buttonNamed(jobSchemas.BLM.name));
  await testSupport.settleApp();
  testSupport.click(testSupport.buttonNamed("前往条件设置"));
  await testSupport.settleApp(220);
  expect(testSupport.buttonNamed("开始联合搜索").disabled).toBe(true);
  for (const jobId of ["RDM", "BLM"] as const) {
    testSupport.click(testSupport.buttonNamed(jobSchemas[jobId].name));
    await testSupport.settleApp();
    await testSupport.selectFirstGcdTierIfEmpty();
  }
  testSupport.click(testSupport.buttonNamed("共享设置"));
  await testSupport.settleApp();
}

async function waitForGcdValidation(): Promise<void> {
  await testSupport.settleApp(220);
}

describe("联合工作台", () => {
  it("共享搜索范围的种族选择会写入每个职业的搜索输入", async () => {
    await enterConditions();
    const clanTrigger = () =>
      [...testSupport.host.querySelectorAll("button")].find((button) =>
        normalizedText(button).includes("人族 · 中原之民"),
      );
    expect(clanTrigger()).toBeDefined();
    testSupport.click(clanTrigger()!);
    await testSupport.settleApp();
    const highland = [...document.body.querySelectorAll("button")].find(
      (button) => normalizedText(button) === "高地之民",
    );
    expect(highland).toBeDefined();
    testSupport.click(highland as HTMLButtonElement);
    await testSupport.settleApp(220);

    expect(
      [...testSupport.host.querySelectorAll("button")].some((button) =>
        normalizedText(button).includes("人族 · 高地之民"),
      ),
    ).toBe(true);
    expect(testSupport.host.querySelector("aside")?.textContent).toContain(
      "人族 · 高地之民",
    );
    const inputs = testSupport.findFeasibleGcdsMock.mock.calls.map(
      ([input]) => input as { clanIndex?: number },
    );
    expect(inputs.some((input) => input.clanIndex === 1)).toBe(true);
  });

  it("搜索范围只属于共享设置，职业条件不再提供", async () => {
    await enterConditions();
    const labelsNamed = (name: string) =>
      [...testSupport.host.querySelectorAll("label")].filter(
        (label) => normalizedText(label) === name,
      );
    expect(labelsNamed("最低装备品级")).toHaveLength(1);
    expect(labelsNamed("最高装备品级")).toHaveLength(1);
    expect(labelsNamed("同步品级")).toHaveLength(1);

    testSupport.click(testSupport.buttonNamed(jobSchemas.RDM.name));
    await testSupport.settleApp();
    expect(labelsNamed("最低装备品级")).toHaveLength(0);
    expect(labelsNamed("最高装备品级")).toHaveLength(0);
    expect(labelsNamed("同步品级")).toHaveLength(0);
  });

  it("选择页按职业选择、前往条件设置操作行、搜索记录的顺序排列", async () => {
    testSupport.navigateToJoint();
    await testSupport.settleApp();
    const jobButton = testSupport.buttonNamed(jobSchemas.RDM.name);
    const continueButton = testSupport.buttonNamed("前往条件设置");
    const selection = testSupport.host.querySelector(
      'section[aria-labelledby="joint-selection-title"]',
    )!;
    const history = testSupport.host.querySelector(
      'section[aria-label="搜索记录"]',
    );
    expect(history).not.toBeNull();
    expect(selection.querySelectorAll("footer")).toHaveLength(0);
    const action = continueButton.parentElement;
    expect(action?.tagName).toBe("DIV");
    expect(action?.className).toContain("selectionAction");
    const follows = (left: Node, right: Node) =>
      (left.compareDocumentPosition(right) &
        Node.DOCUMENT_POSITION_FOLLOWING) !==
      0;
    expect(follows(jobButton, continueButton)).toBe(true);
    expect(follows(continueButton, history!)).toBe(true);
  });

  it("重新编辑相同历史条件后重新同步已完成的 GCD 分析", async () => {
    testSupport.seedCompletedJointHistory(testSupport.testJointConfig(["RDM", "BLM"]));
    testSupport.navigateToJoint();
    await testSupport.settleApp();
    testSupport.click(historyAction(historyRecord("赤魔法师 / 黑魔法师", "编辑条件"), "编辑条件"));
    await waitForGcdValidation();
    expect(testSupport.buttonNamed("开始联合搜索").disabled).toBe(false);
    const analysisCalls = testSupport.findFeasibleGcdsMock.mock.calls.length;
    testSupport.click(testSupport.buttonNamed("搜索记录"));
    await testSupport.settleApp();
    testSupport.click(historyAction(historyRecord("赤魔法师 / 黑魔法师", "编辑条件", document.body), "编辑条件"));
    await waitForGcdValidation();
    expect(testSupport.buttonNamed("开始联合搜索").disabled).toBe(false);
    expect(testSupport.findFeasibleGcdsMock).toHaveBeenCalledTimes(analysisCalls);
  });

  it("历史职业结果的公式等级保留记录值", async () => {
    testSupport.seedCompletedJointHistory(testSupport.testJointConfig(["RDM", "BLM"]));
    const record = testSupport.historyStore.records[0]!;
    record.dataVersion = "old-game-version";
    const result = record.result as ReturnType<typeof testSupport.sampleJointResult>;
    result.jobResults.RDM!.calculationLevel = 80;
    testSupport.navigateToJoint();
    await testSupport.settleApp();
    testSupport.click(historyAction(historyRecord("赤魔法师 / 黑魔法师", "查看结果"), "查看结果"));
    await testSupport.settleApp();
    testSupport.click(testSupport.buttonNamed(jobSchemas.RDM.name));
    await testSupport.settleApp();
    const aside = testSupport.host.querySelector("aside")!;
    expect(normalizedText(aside)).toMatch(/公式等级\s*80 级/);
    expect(normalizedText(aside)).not.toContain("最低坚韧");
  });

  it("选择同组职业后进入条件相位，并显示真实公式等级", async () => {
    await enterConditions();

    expect(testSupport.host.querySelector("h1")?.textContent).toBe(
      "设置联合条件",
    );
    await waitForGcdValidation();
    expect(testSupport.buttonNamed("开始联合搜索").disabled).toBe(false);
  });

  it("共享食物策略下的职业摘要与禁用编辑器显示同一食物，切回独立时保留各自选择", async () => {
    const config = testSupport.testJointConfig(["RDM", "BLM"]);
    config.jobs[0]!.foodId = foods[0]!.id;
    config.jobs[1]!.foodId = foods[1]!.id;
    testSupport.seedCompletedJointHistory(config);
    testSupport.navigateToJoint();
    await testSupport.settleApp();
    const record = historyRecord(
      jobSchemas.RDM.name + " / " + jobSchemas.BLM.name,
      "编辑条件",
    );
    testSupport.click(historyAction(record, "编辑条件"));
    await testSupport.settleApp();

    testSupport.click(testSupport.buttonNamed(jobSchemas.BLM.name));
    const foodSection = () =>
      testSupport.host.querySelector('section[aria-label="食物"]');
    expect(foodSection()).not.toBeNull();
    expect(
      foodSection()!.querySelector<HTMLInputElement>('input[role="combobox"]')
        ?.value,
    ).toBe(foods[0]!.name);
    expect(normalizedText(foodSection()!)).toContain("使用共享食物");

    testSupport.click(testSupport.buttonNamed("共享设置"));
    const strategyLabel = [...testSupport.host.querySelectorAll("label")].find(
      (label) => label.textContent === "食物策略",
    )!;
    testSupport.click(
      document.getElementById(strategyLabel.htmlFor) as HTMLButtonElement,
    );
    await testSupport.settleApp();
    const independent = [
      ...document.body.querySelectorAll<HTMLElement>('[role="option"]'),
    ].find((option) => option.textContent?.trim() === "各职业独立")!;
    testSupport.click(independent as HTMLButtonElement);
    await testSupport.settleApp();
    expect(
      testSupport.host.querySelector('input[aria-label="共享食物选择"]'),
    ).toBeNull();
    testSupport.click(testSupport.buttonNamed(jobSchemas.BLM.name));
    expect(
      foodSection()!.querySelector<HTMLInputElement>('input[role="combobox"]')
        ?.value,
    ).toBe(foods[1]!.name);
    expect(normalizedText(foodSection()!)).not.toContain("使用共享食物");
  });

  it("结果可查看；编辑旧数据版本结果前要求确认", async () => {
    const config = testSupport.testJointConfig(["RDM", "BLM"]);
    testSupport.seedCompletedJointHistory(config);
    testSupport.historyStore.records[0]!.dataVersion = "old-game-version";
    testSupport.navigateToJoint();
    await testSupport.settleApp();
    const record = historyRecord(
      jobSchemas.RDM.name + " / " + jobSchemas.BLM.name,
      "查看结果",
    );
    testSupport.click(historyAction(record, "查看结果"));
    await testSupport.settleApp();

    expect(testSupport.host.querySelector("h1")?.textContent).toBe(
      "联合配装结果",
    );
    expect(testSupport.host.textContent).toContain("不会按当前数据重新计算");
    testSupport.click(testSupport.buttonNamed("调整条件"));
    expect(testSupport.host.textContent).toContain("结果来自旧数据版本");
    const confirmButton = [
      ...document.body.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => normalizedText(button) === "确认");
    expect(confirmButton).toBeDefined();
    confirmButton!.click();
    await testSupport.settleApp();
    expect(testSupport.host.querySelector("h1")?.textContent).toBe(
      "设置联合条件",
    );
  });

  it("历史共享装备冲突时保留正在进行的搜索并提示恢复失败", async () => {
    const conflictingConfig = testSupport.testJointConfig(["PLD", "WAR"]);
    conflictingConfig.commonSlots = ["head"];
    conflictingConfig.jobs[0]!.forcedGear.head = 12345;
    conflictingConfig.jobs[1]!.forcedGear.head = 67890;
    testSupport.seedCompletedJointHistory(conflictingConfig);
    testSupport.mockDelayedAbortableJointSearch();
    await enterConditions();
    await waitForGcdValidation();
    await testSupport.startSearchAndSettle();
    expect(testSupport.host.querySelector("h1")?.textContent).toBe("搜索进度");

    testSupport.click(testSupport.buttonNamed("搜索记录"));
    await testSupport.settleApp();
    const record = historyRecord(
      jobSchemas.PLD.name + " / " + jobSchemas.WAR.name,
      "编辑条件",
      document.body,
    );
    testSupport.click(historyAction(record, "编辑条件"));
    await testSupport.settleApp();
    const confirmButton = [
      ...document.body.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => normalizedText(button) === "确认");
    expect(confirmButton).toBeDefined();
    testSupport.click(confirmButton!);
    await testSupport.settleApp();

    expect(testSupport.host.querySelector("h1")?.textContent).toBe("搜索进度");
    expect(document.body.textContent).toContain("历史条件无法恢复");
    const options = testSupport.optimizeJointMock.mock.calls[0]?.[1] as
      { signal?: AbortSignal } | undefined;
    expect(options?.signal?.aborted).toBe(false);

    testSupport.click(testSupport.buttonNamed("取消搜索"));
    await testSupport.settleApp(40);
  });

  it("调整条件遇到共享装备冲突时保留结果并提示恢复失败", async () => {
    const conflictingConfig = testSupport.testJointConfig(["RDM", "BLM"]);
    conflictingConfig.commonSlots = ["head"];
    conflictingConfig.jobs[0]!.forcedGear.head = 12345;
    conflictingConfig.jobs[1]!.forcedGear.head = 67890;
    testSupport.seedCompletedJointHistory(conflictingConfig);
    testSupport.historyStore.records[0]!.dataVersion = "old-game-version";
    testSupport.navigateToJoint();
    await testSupport.settleApp();
    const record = historyRecord(
      jobSchemas.RDM.name + " / " + jobSchemas.BLM.name,
      "查看结果",
    );
    testSupport.click(historyAction(record, "查看结果"));
    await testSupport.settleApp();

    testSupport.click(testSupport.buttonNamed("调整条件"));
    const confirmButton = [
      ...document.body.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => normalizedText(button) === "确认");
    expect(confirmButton).toBeDefined();
    testSupport.click(confirmButton!);
    await testSupport.settleApp();

    expect(testSupport.host.querySelector("h1")?.textContent).toBe(
      "联合配装结果",
    );
    expect(document.body.textContent).toContain("历史条件无法恢复");
  });

  it("结果耗时与历史记录使用相同的开始和结束时间", async () => {
    const config = testSupport.testJointConfig(["RDM", "BLM"]);
    testSupport.optimizeJointMock.mockResolvedValue(
      testSupport.sampleJointResult(config),
    );
    await enterConditions();
    await waitForGcdValidation();
    let nowCall = 0;
    const nowSpy = vi
      .spyOn(Date, "now")
      .mockImplementation(() => 1_000 + nowCall++ * 1_000);
    try {
      await testSupport.startSearchAndSettle();
      await testSupport.settleApp();

      const startedAtISO = vi
        .mocked(createSearchHistory)
        .mock.calls.at(-1)?.[0].startedAtISO;
      const finishedAtISO = vi
        .mocked(finishSearchHistory)
        .mock.calls.at(-1)?.[1].finishedAtISO;
      const displayedDuration = /搜索耗时\s+([\d.]+)\s*秒/.exec(
        testSupport.host.textContent ?? "",
      )?.[1];
      expect(startedAtISO).toBeDefined();
      expect(finishedAtISO).toBeDefined();
      expect(displayedDuration).toBeDefined();
      const recordedDurationSeconds =
        (Date.parse(finishedAtISO!) - Date.parse(startedAtISO!)) / 1000;
      expect(Number(recordedDurationSeconds.toFixed(1))).toBe(
        Number(displayedDuration),
      );
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("职业结果页的核心指标只显示当前联合配装", async () => {
    const config = testSupport.testJointConfig(["RDM", "BLM"]);
    testSupport.seedCompletedJointHistory(config);
    testSupport.navigateToJoint();
    await testSupport.settleApp();
    const record = historyRecord(
      jobSchemas.RDM.name + " / " + jobSchemas.BLM.name,
      "查看结果",
    );
    testSupport.click(historyAction(record, "查看结果"));
    await testSupport.settleApp();

    const rdmTab = testSupport.host.querySelector<HTMLButtonElement>(
      '[role="tab"][data-value="RDM"]',
    );
    expect(rdmTab).not.toBeNull();
    testSupport.click(rdmTab!);
    await testSupport.settleApp();

    const metricLabels = [
      ...testSupport.host.querySelectorAll(
        'section[aria-label="核心指标"] li > span',
      ),
    ].map((label) => normalizedText(label));
    expect(metricLabels).toEqual([]);
    const lists = [
      ...testSupport.host.querySelectorAll('section[aria-label="核心指标"] ul'),
    ];
    expect(lists.length).toBeGreaterThan(0);
    expect(lists.every((list) => list.children.length === 1)).toBe(true);
  });

  it("History 创建延迟时仍先显示求解结果，并在记录可用后补写完成状态", async () => {
    const createMock = vi.mocked(createSearchHistory);
    const originalCreate = createMock.getMockImplementation();
    if (!originalCreate) throw new Error("测试需要搜索记录 mock 实现");
    let releaseHistory: (() => void) | undefined;
    createMock.mockImplementation(async (input) => {
      const record = await originalCreate(input);
      return await new Promise((resolve) => {
        releaseHistory = () => resolve(record);
      });
    });

    const config = testSupport.testJointConfig(["RDM", "BLM"]);
    testSupport.optimizeJointMock.mockResolvedValue(
      testSupport.sampleJointResult(config),
    );
    await enterConditions();
    await waitForGcdValidation();
    await testSupport.startSearchAndSettle();
    await testSupport.settleApp();

    expect(testSupport.host.querySelector("h1")?.textContent).toBe(
      "联合配装结果",
    );
    expect(releaseHistory).toBeDefined();
    releaseHistory!();
    await testSupport.settleApp();

    expect(vi.mocked(finishSearchHistory)).toHaveBeenCalledTimes(1);
    expect(testSupport.historyStore.records.at(-1)?.status).toBe("completed");
    expect(
      vi.mocked(createSearchHistory).mock.calls.at(-1)?.[0].startedAtISO,
    ).toBeTypeOf("string");
    expect(
      vi.mocked(finishSearchHistory).mock.calls[0]?.[1].finishedAtISO,
    ).toBeTypeOf("string");
  });

  it("取消搜索期间保持 progress，求解器 settle 后恢复可编辑的 conditions", async () => {
    testSupport.mockDelayedAbortableJointSearch();
    await enterConditions();
    testSupport.click(testSupport.buttonNamed(jobSchemas.BLM.name));
    await waitForGcdValidation();
    await testSupport.startSearchAndSettle();
    expect(testSupport.host.querySelector("h1")?.textContent).toBe("搜索进度");
    const aside = testSupport.host.querySelector("aside");
    expect(aside?.querySelector("h3")?.textContent).toBe(jobSchemas.BLM.name);
    expect(aside?.textContent).toContain("GCD");
    expect(aside?.textContent).not.toContain(jobSchemas.RDM.name);

    testSupport.click(testSupport.buttonNamed("取消搜索"));
    expect(testSupport.host.textContent).toContain("正在等待搜索任务结束");
    await testSupport.settleApp(40);

    expect(testSupport.host.querySelector("h1")?.textContent).toBe(
      "设置联合条件",
    );
    expect(
      testSupport.host.querySelector("[data-status='running']"),
    ).toBeNull();
  });
});

it("Base UI 页签关联面板，共享戒指通过CheckboxGroup独立切换", async () => {
  await enterConditions();
  const tabs = testSupport.host.querySelector(
    '[role="tablist"][aria-label="条件编辑范围"]',
  )!;
  expect(tabs.querySelectorAll('[role="tab"]').length).toBe(3);
  const group = testSupport.host.querySelector(
    '[role="group"][aria-label="共享部位选择"]',
  )!;
  const ring = (name: string) =>
    [...group.querySelectorAll<HTMLElement>('[role="checkbox"]')].find((el) =>
      el.closest("label")?.textContent?.includes(name),
    )!;
  expect(ring("戒指1").getAttribute("aria-checked")).toBe("true");
  testSupport.click(ring("戒指2") as HTMLButtonElement);
  await testSupport.settleApp();
  expect(ring("戒指1").getAttribute("aria-checked")).toBe("true");
  expect(ring("戒指2").getAttribute("aria-checked")).toBe("false");
  testSupport.click(testSupport.buttonNamed(jobSchemas.RDM.name));
  await testSupport.settleApp();
  const selected = tabs.querySelector('[aria-selected="true"]')!;
  const panel = testSupport.host.querySelector('[role="tabpanel"]')!;
  expect(panel.id).toBe(selected.getAttribute("aria-controls"));
});
