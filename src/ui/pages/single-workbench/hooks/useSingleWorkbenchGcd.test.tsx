// @vitest-environment jsdom
import { act } from "react";
import { describe, expect, it } from "vitest";
import * as testSupport from "../../../../test-utils/workbench.helper.test.tsx";
import { normalizedText } from "../../../../test-utils/workbench.helper.test.tsx";
import { jobIds, jobSchemas, type JobId, type OptimizationConfig } from "@/domain";

describe("单职业连续搜索工作台", () => {
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

  it("载入当前格式的历史条件后保留已选 GCD 档位", async () => {
    const savedConfig: OptimizationConfig = {
      ...testSupport.testJobConfig("SAM"),
      gcdTarget: undefined,
      gcdChoices: [2.48],
      objective: "damage",
    };
    const startedAtISO = new Date(Date.UTC(2026, 9, 2, 12, 0, 0)).toISOString();
    testSupport.historyStore.records.push({
      id: "single-gcd-choices-current-format",
      kind: "single",
      config: savedConfig,
      dataVersion: testSupport.currentDataVersion(),
      status: "failed",
      startedAtISO,
      finishedAtISO: new Date(Date.parse(startedAtISO) + 1_000).toISOString(),
      error: "搜索失败",
    });

    testSupport.remountApp();
    await testSupport.settleApp();
    testSupport.openSearchHistory();
    await testSupport.settleApp();
    const recordCard = testSupport.historyCardContaining(jobSchemas.SAM.name + " ·");
    testSupport.click(testSupport.historyActionButton(recordCard, "载入条件"));
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
});
