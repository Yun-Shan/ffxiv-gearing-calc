// @vitest-environment jsdom
import { act } from "react";
import { describe, expect, it } from "vitest";
import * as testSupport from "../../../../test-utils/workbench.helper.test.tsx";
import { normalizedText } from "../../../../test-utils/workbench.helper.test.tsx";
import { jobIds, jobSchemas, type JobId, type OptimizationConfig } from "@/domain";

describe("单职业连续搜索工作台", () => {
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
    expect(testSupport.host.querySelector('[key="progressbar"]')).toBeNull();
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
