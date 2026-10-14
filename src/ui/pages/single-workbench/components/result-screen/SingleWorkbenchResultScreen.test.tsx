// @vitest-environment jsdom
import { act } from "react";
import { describe, expect, it } from "vitest";
import * as testSupport from "../../../../../test-utils/workbench.helper.test";
import { normalizedText } from "../../../../../test-utils/workbench.helper.test";
import { jobIds, jobSchemas, type JobId, type OptimizationConfig } from "@/domain";

describe("单职业连续搜索工作台", () => {
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
});
