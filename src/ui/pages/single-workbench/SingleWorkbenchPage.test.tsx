// @vitest-environment jsdom
import { act } from "react";
import { describe, expect, it } from "vitest";
import * as testSupport from "../../../test-utils/workbench.helper.test";
import { normalizedText } from "../../../test-utils/workbench.helper.test";
import { jobIds, jobSchemas, type JobId, type OptimizationConfig } from "../../../domain/index";
describe("单职业连续搜索工作台", () => {
  it("启动时不预选职业；选择职业后直接进入连续工作台", () => {
    expect(testSupport.host.querySelector('[aria-label="配装设置进度"]')).toBeNull();
    for (const jobId of jobIds) {
      expect(testSupport.buttonNamed(jobSchemas[jobId].name).getAttribute("aria-pressed")).toBe("false");
    }
    expect(() => testSupport.buttonNamed("开始搜索")).toThrow();
    expect(testSupport.optimizeMock).not.toHaveBeenCalled();

    testSupport.chooseJob("SAM");
    expect(testSupport.host.querySelector('section[aria-label="单职业搜索参数"] h1')?.textContent).toContain(jobSchemas.SAM.name);
    expect(() => testSupport.textField("职业等级")).toThrow();
    expect(testSupport.textField("最低装备品级")).toBeDefined();
    expect(testSupport.textField("同步品级")).toBeDefined();
    expect(testSupport.textField("食物")).toBeDefined();
    expect(testSupport.buttonNamed("开始搜索").disabled).toBe(false);
    expect(testSupport.host.querySelector('aside[aria-label="当前搜索条件摘要"]')).not.toBeNull();
    expect(testSupport.optimizeMock).not.toHaveBeenCalled();
  });

  it("同步品级可不启用，且只提供参考项目标粗的档位", () => {
    testSupport.chooseJob("SAM");
    const syncLevel = testSupport.textField("同步品级");
    expect(syncLevel).toBeInstanceOf(HTMLSelectElement);
    const select = syncLevel as HTMLSelectElement;
    expect([...select.options].map((option) => option.value)).toEqual([
      "",
      "795",
      "735",
      "700",
      "695",
      "665",
      "635",
      "605",
      "475",
      "375",
      "345",
      "300",
    ]);
    expect(select.value).toBe("");
    expect(testSupport.host.querySelector('aside[aria-label="当前搜索条件摘要"]')?.textContent).toContain("未启用");

    testSupport.selectValue("同步品级", "735");
    expect(select.value).toBe("735");
    expect(testSupport.host.querySelector('aside[aria-label="当前搜索条件摘要"]')?.textContent).toContain("735");

    testSupport.selectValue("同步品级", "");
    expect(select.value).toBe("");
    expect(testSupport.host.querySelector('aside[aria-label="当前搜索条件摘要"]')?.textContent).toContain("未启用");
  });

  it("按设计稿提供不限、GCD 档位和自定义速度三种互斥状态", async () => {
    testSupport.chooseJob("WAR");
    const mode = () => testSupport.host.querySelector<HTMLSelectElement>('select[aria-label="GCD 约束类型"]')!;
    expect([...mode().options].map((option) => [option.value, option.textContent])).toEqual([
      ["any", "不限"],
      ["multiple", "指定 GCD 档位"],
      ["speed", "自定义速度范围"],
    ]);
    expect(mode().value).toBe("any");
    expect(testSupport.host.querySelector(".single-objective-display")?.textContent).toContain("每秒每威力伤害期望");
    expect(testSupport.host.querySelector(".single-gcd-choice-trigger")).toBeNull();
    expect(testSupport.host.querySelector(".single-speed-inline")).toBeNull();
    expect(() => testSupport.textField("最低技速")).toThrow();
    expect(() => testSupport.textField("最高技速")).toThrow();
    expect(testSupport.buttonNamed("开始搜索").disabled).toBe(false);
    expect(testSupport.host.querySelector('aside[aria-label="当前搜索条件摘要"]')?.textContent).toContain("已就绪");
    expect(testSupport.textField("坚韧约束")).toBeDefined();

    testSupport.selectAriaValue("GCD 约束类型", "multiple");
    expect(testSupport.host.querySelector(".single-gcd-choice-trigger")?.textContent).toContain("正在查询档位");
    expect(testSupport.buttonNamed("开始搜索").disabled).toBe(true);
    await testSupport.settleApp(260);
    expect(testSupport.findFeasibleGcdsMock).toHaveBeenCalledTimes(1);
    expect(testSupport.findFeasibleGcdsMock.mock.calls.at(-1)?.[0]).toMatchObject({
      gcdTarget: undefined,
      gcdChoices: undefined,
      speedMin: undefined,
      speedMax: undefined,
    });
    testSupport.click(testSupport.buttonNamed("选择 GCD 档位"));
    expect(testSupport.host.querySelectorAll(".single-gcd-choice-option input[type=checkbox]")).toHaveLength(2);
    const tierCheckboxes = [...testSupport.host.querySelectorAll<HTMLInputElement>(".single-gcd-choice-option input[type=checkbox]")];
    act(() => tierCheckboxes[0]!.click());
    expect(testSupport.host.querySelector(".single-objective-display")?.textContent).toContain("每威力伤害期望");
    expect(testSupport.buttonNamed("开始搜索").disabled).toBe(false);
    act(() => tierCheckboxes[1]!.click());
    expect(testSupport.host.querySelectorAll(".single-gcd-chip:not(.single-gcd-chip-measure)")).toHaveLength(2);
    expect(testSupport.host.querySelector(".single-objective-display")?.textContent).toContain("每秒每威力伤害期望");

    testSupport.selectAriaValue("GCD 约束类型", "any");
    expect(testSupport.host.querySelector(".single-gcd-choice-trigger")).toBeNull();
    expect(testSupport.host.querySelector(".single-objective-display")?.textContent).toContain("每秒每威力伤害期望");

    testSupport.selectAriaValue("GCD 约束类型", "speed");
    expect(testSupport.host.querySelector(".single-speed-inline > span:first-child")?.textContent).toBe("技速");
    expect(testSupport.textField("最低技速").value).toBe("");
    expect(testSupport.textField("最高技速").value).toBe("");
    expect(testSupport.host.querySelector(".single-speed-separator")?.textContent).toBe("–");
    expect(testSupport.buttonNamed("开始搜索").disabled).toBe(false);
    testSupport.inputValue("最低技速", "1234");
    await testSupport.settleApp(340);
    expect(testSupport.findFeasibleGcdsMock).toHaveBeenCalled();
    expect(testSupport.findFeasibleGcdsMock.mock.calls.at(-1)?.[0]).toMatchObject({
      speedMin: 1234,
      gcdTarget: undefined,
      gcdChoices: undefined,
    });
    expect(testSupport.host.querySelector(".single-objective-display")?.textContent).toContain("每秒每威力伤害期望");
    expect(testSupport.buttonNamed("开始搜索").disabled).toBe(false);
  });

  it("进度页显示真实槽位候选和当前模型数据；单轮不显示核验组合计数", async () => {
    testSupport.chooseJob("BLM");
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
    testSupport.optimizeMock.mockImplementation((_config: unknown, options: {
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

    await testSupport.startSearchAndSettle();
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
    expect(testSupport.host.querySelector('[aria-label="搜索阶段"]')).not.toBeNull();
    expect(testSupport.host.textContent).toContain("正在寻找符合条件的最优配装");
    expect(testSupport.host.querySelector('[role="progressbar"]')).toBeNull();
    expect(testSupport.host.textContent).toContain("870");
    expect(testSupport.host.textContent).toContain("32");
    expect(testSupport.host.textContent).toContain("当前算法搜索状态");
    expect(testSupport.host.textContent).not.toContain("仅描述当前模型");
    expect(testSupport.host.textContent).toContain("793");
    expect(testSupport.host.textContent).toContain("46,103");
    expect(testSupport.host.textContent).toContain("3,281");
    expect(testSupport.host.textContent).not.toContain("剩余时间");
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
    expect(testSupport.host.textContent).toContain("已找到可行方案，正在继续搜索更优配装");
    act(() => callbacks?.onProgress?.("精确候选已核验 1 个；固定点上界=123"));
    expect(testSupport.host.textContent).toContain("已找到待核验方案，正在检查是否还有更优方案");
    expect(testSupport.host.querySelector('[aria-label="搜索阶段"] [aria-current="step"]')?.textContent)
      .toContain("核验候选与最优性");
    expect(testSupport.host.textContent).not.toContain("已核验 1 组");
    expect(testSupport.host.textContent).not.toContain("第 2 轮");
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
    expect(testSupport.host.textContent).not.toContain("第 2 轮");
    expect(testSupport.host.textContent).not.toContain("已核验 1 组候选组合");
    testSupport.click(testSupport.buttonNamed("取消搜索"));
    await testSupport.settleApp();
    expect(testSupport.host.querySelector('[aria-label="搜索阶段"]')).toBeNull();
    expect(testSupport.host.textContent).toContain("搜索已取消");

    testSupport.click(testSupport.buttonNamed("更换职业"));
    testSupport.chooseJob("PLD");
    await testSupport.startSearchAndSettle();
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
    expect(testSupport.host.querySelectorAll('[aria-label="候选数量"] strong')).toHaveLength(12);
    expect(testSupport.host.querySelector('[aria-label="候选数量"] h2')?.textContent)
      .toContain("装备与食物候选");
    testSupport.click(testSupport.buttonNamed("取消搜索"));
    await testSupport.settleApp();
  });

  it("结果页按稿显示目标值、推荐表格和摘要，并允许修改条件", async () => {
    testSupport.chooseJob("SAM");
    testSupport.optimizeMock.mockResolvedValueOnce(testSupport.sampleResult());
    await testSupport.startSearchAndSettle();
    await testSupport.settleApp();

    expect(testSupport.host.querySelector(".single-result-workspace")).not.toBeNull();
    expect(testSupport.host.querySelector('[aria-label="搜索阶段"]')).toBeNull();
    const resultTitle = testSupport.host.querySelector<HTMLElement>("#single-result-title");
    expect(resultTitle?.textContent).toBe("配装结果");
    const resultHeading = resultTitle?.parentElement;
    expect(normalizedText(resultHeading!)).toContain("目标值 1.0000000");
    expect(normalizedText(resultHeading!)).toContain("用时 0.0 秒");
    expect(normalizedText(resultHeading!)).not.toContain("武士");
    expect(testSupport.host.querySelector(".single-result-workspace .result-toolbar h2")).toBeNull();
    expect(testSupport.host.querySelector(".single-result-workspace .result-completion")).toBeNull();
    expect(testSupport.host.textContent).not.toContain("基线比例");
    expect(testSupport.host.textContent).not.toContain("个候选");
    const metricsSection = testSupport.host.querySelector<HTMLElement>('[aria-label="伤害指标"]');
    expect([...metricsSection!.children]
      .map((item) => normalizedText(item.querySelector("span") ?? item))).toEqual([
      "每威力伤害期望",
      "GCD",
      "暴击率",
      "直击率",
      "每秒每威力伤害期望",
    ]);
    const resultTable = testSupport.host.querySelector<HTMLTableElement>(".single-result-workspace table");
    expect(resultTable?.tagName).toBe("TABLE");
    expect(resultTable?.caption?.textContent).toContain("推荐配装装备属性表");
    const columnHeadings = [...resultTable!.tHead!.querySelectorAll('th[scope="col"]')]
      .map(normalizedText);
    expect(columnHeadings).toEqual([
      "部位", "装备名称", "来源", "品级", "魔晶石 / 生效属性",
      "力量", "暴击", "信念", "直击", "技速", "耐力",
    ]);
    const bodyRows = [...resultTable!.tBodies[0]!.rows];
    expect(bodyRows).toHaveLength(2);
    expect(bodyRows.map((row) => normalizedText(row.querySelector('th[scope="row"]')!)))
      .toEqual(["武器", "食物"]);
    expect(normalizedText(resultTable!.tFoot!.rows[0]!.querySelector('th[scope="row"]')!))
      .toBe("总属性");
    const recommendationHeading = [...testSupport.host.querySelectorAll("h2")]
      .find((heading) => normalizedText(heading) === "推荐配装");
    expect(recommendationHeading).toBeDefined();
    const shareLink = testSupport.host.querySelector<HTMLAnchorElement>('a[href*="asvel.github.io/ffxiv-gearing/"]');
    expect(shareLink?.href).toContain("asvel.github.io/ffxiv-gearing/");
    expect(testSupport.host.textContent).toContain("伤害与防御");
    expect(testSupport.host.textContent).toContain("搜索条件与限制");
    expect(testSupport.host.textContent).not.toContain("结果身份");
    expect(testSupport.host.textContent).not.toContain("配装总属性");
    const resultAside = testSupport.host.querySelector<HTMLElement>('aside[aria-label="配装条件摘要"]');
    const resultAsideSections = [...resultAside!.querySelectorAll("h3")]
      .map((heading) => normalizedText(heading));
    expect(resultAsideSections).toEqual(["伤害与防御", "搜索条件与限制"]);
    const resultEffects = [...resultAside!.querySelectorAll("section")]
      .find((section) => normalizedText(section.querySelector("h3") ?? section) === "伤害与防御");
    expect(normalizedText(resultEffects!)).toContain("暴击伤害");
    expect(normalizedText(resultEffects!)).toContain("信念加成");
    expect(normalizedText(resultEffects!)).not.toContain("GCD");
    expect(normalizedText(resultEffects!)).not.toContain("暴击率");
    expect(normalizedText(resultEffects!)).not.toContain("直击率");

    testSupport.click(testSupport.buttonNamed("编辑当前条件"));
    expect(testSupport.host.querySelector(".single-result-workspace")).toBeNull();
    expect(testSupport.host.querySelector('section[aria-label="单职业搜索参数"]')).not.toBeNull();
    expect(testSupport.optimizeMock).toHaveBeenCalledTimes(1);
  });

  it("保存单次搜索历史，且摘要、结果与载入的条件都不展示职业等级", async () => {
    testSupport.chooseJob("SAM");
    expect(() => testSupport.textField("职业等级")).toThrow();
    testSupport.optimizeMock.mockResolvedValueOnce(testSupport.sampleResult());
    await testSupport.startSearchAndSettle();
    await testSupport.settleApp();
    expect(testSupport.historyStore.records).toHaveLength(1);
    expect(testSupport.historyStore.records[0]).toMatchObject({
      kind: "single",
      status: "completed",
      config: { jobId: "SAM", jobLevel: jobSchemas.SAM.maxJobLevel },
    });

    testSupport.click(testSupport.buttonNamed("编辑当前条件"));
    expect(() => testSupport.textField("职业等级")).toThrow();
    testSupport.optimizeMock.mockResolvedValueOnce(testSupport.sampleResult());
    await testSupport.startSearchAndSettle();
    await testSupport.settleApp();
    expect(testSupport.historyStore.records).toHaveLength(2);
    expect(testSupport.historyStore.records.map((record) => record.status)).toEqual(["completed", "completed"]);
    expect(testSupport.historyStore.records.map((record) => (record.config as OptimizationConfig).jobLevel)).toEqual([
      jobSchemas.SAM.maxJobLevel,
      jobSchemas.SAM.maxJobLevel,
    ]);

    testSupport.click(testSupport.buttonNamed("编辑当前条件"));
    testSupport.openSearchHistory();
    await testSupport.settleApp();
    expect(normalizedText(testSupport.detailsNamed("搜索记录"))).toContain("2 次");
    const firstRecord = testSupport.historyCardContaining(jobSchemas.SAM.name + " ·");
    expect(normalizedText(firstRecord)).not.toContain(`${jobSchemas.SAM.name} · ${jobSchemas.SAM.maxJobLevel} 级 ·`);
    testSupport.click(testSupport.historyActionButton(firstRecord, "载入结果"));
    expect(testSupport.host.querySelector(".single-result-workspace")).not.toBeNull();
    expect(testSupport.host.querySelector('aside[aria-label="配装条件摘要"]')).not.toBeNull();
    expect(testSupport.host.textContent).toContain("数据版本");
    expect(testSupport.host.textContent).not.toContain("职业等级");

    testSupport.click(testSupport.buttonNamed("编辑当前条件"));
    await testSupport.settleApp();
    testSupport.openSearchHistory();
    const savedRecord = testSupport.historyCardContaining(jobSchemas.SAM.name + " ·");
    testSupport.click(testSupport.historyActionButton(savedRecord, "载入条件"));
    expect(testSupport.host.querySelector('section[aria-label="单职业搜索参数"]')).not.toBeNull();
    expect(() => testSupport.textField("职业等级")).toThrow();
    expect(testSupport.host.querySelector(".single-result-workspace")).toBeNull();
    expect(testSupport.optimizeMock).toHaveBeenCalledTimes(2);
  });

  it("载入较低等级的旧单职业条件后按职业最高等级执行", async () => {
    const legacyConfig = {
      ...testSupport.testJobConfig("SAM"),
      jobLevel: Math.max(1, (jobSchemas.SAM.maxJobLevel ?? 100) - 10),
    };
    const startedAtISO = new Date(Date.UTC(2026, 9, 2, 12, 0, 0)).toISOString();
    testSupport.historyStore.records.push({
      id: "legacy-single-condition",
      kind: "single",
      config: legacyConfig,
      dataVersion: testSupport.currentDataVersion(),
      status: "failed",
      startedAtISO,
      finishedAtISO: new Date(Date.parse(startedAtISO) + 1_000).toISOString(),
      error: "旧历史记录",
    });

    testSupport.remountApp();
    await testSupport.settleApp();
    testSupport.openSearchHistory();
    await testSupport.settleApp();
    const legacyRecord = testSupport.historyCardContaining(jobSchemas.SAM.name + " ·");
    testSupport.click(testSupport.historyActionButton(legacyRecord, "载入条件"));
    expect(testSupport.host.querySelector('section[aria-label="单职业搜索参数"]')).not.toBeNull();
    expect(() => testSupport.textField("职业等级")).toThrow();

    testSupport.optimizeMock.mockResolvedValueOnce(testSupport.sampleResult());
    await testSupport.startSearchAndSettle();
    await testSupport.settleApp();
    expect(testSupport.optimizeMock.mock.calls[0]?.[0]).toMatchObject({
      jobId: "SAM",
      jobLevel: jobSchemas.SAM.maxJobLevel,
      minItemLevel: legacyConfig.minItemLevel,
      maxItemLevel: legacyConfig.maxItemLevel,
    });
  });

  it("载入只有旧 gcdTarget 的历史条件后，转换为可搜索的单档选择", async () => {
    const legacyConfig: OptimizationConfig = {
      ...testSupport.testJobConfig("SAM"),
      gcdTarget: 2.48,
      objective: "damage",
    };
    const startedAtISO = new Date(Date.UTC(2026, 9, 2, 12, 0, 0)).toISOString();
    testSupport.historyStore.records.push({
      id: "legacy-single-gcd-target",
      kind: "single",
      config: legacyConfig,
      dataVersion: testSupport.currentDataVersion(),
      status: "failed",
      startedAtISO,
      finishedAtISO: new Date(Date.parse(startedAtISO) + 1_000).toISOString(),
      error: "旧 GCD 条件",
    });

    testSupport.remountApp();
    await testSupport.settleApp();
    testSupport.openSearchHistory();
    await testSupport.settleApp();
    const legacyRecord = testSupport.historyCardContaining(jobSchemas.SAM.name + " ·");
    testSupport.click(testSupport.historyActionButton(legacyRecord, "载入条件"));
    await testSupport.settleApp(240);

    expect(testSupport.host.querySelector<HTMLSelectElement>('select[aria-label="GCD 约束类型"]')?.value).toBe("multiple");
    expect(testSupport.host.querySelector(".single-gcd-choice-trigger")?.textContent).toContain("2.48");
    expect(testSupport.host.querySelector(".single-objective-display")?.textContent).toContain("每威力伤害期望");
    expect(testSupport.buttonNamed("开始搜索").disabled).toBe(false);

    testSupport.optimizeMock.mockResolvedValueOnce(testSupport.sampleResult());
    await testSupport.startSearchAndSettle();
    expect(testSupport.optimizeMock.mock.calls.at(-1)?.[0]).toMatchObject({
      gcdTarget: undefined,
      gcdChoices: [2.48],
      objective: "damage",
    });
  });

  it("取消、无解和失败分别记录终态", async () => {
    testSupport.chooseJob("SAM");
    testSupport.mockAbortableSearch();
    await testSupport.startSearchAndSettle();
    testSupport.click(testSupport.buttonNamed("取消搜索"));
    await testSupport.settleApp();
    expect(testSupport.host.textContent).toContain("搜索已取消");

    testSupport.optimizeMock.mockResolvedValueOnce(null);
    await testSupport.startSearchAndSettle();
    await testSupport.settleApp();
    expect(testSupport.host.textContent).toContain("没有可行配装");

    testSupport.optimizeMock.mockRejectedValueOnce(new Error("Solve error"));
    await testSupport.startSearchAndSettle();
    await testSupport.settleApp();
    expect(testSupport.host.textContent).toContain("搜索失败");

    expect(testSupport.historyStore.records.map((record) => record.status)).toEqual([
      "cancelled",
      "no-result",
      "failed",
    ]);
    testSupport.click(testSupport.buttonNamed("更换职业"));
    testSupport.openSearchHistory();
    await testSupport.settleApp();
    const recordsText = normalizedText(testSupport.detailsNamed("搜索记录"));
    expect(recordsText).toContain("已取消");
    expect(recordsText).toContain("无可行结果");
    expect(recordsText).toContain("搜索失败");
  });
});
