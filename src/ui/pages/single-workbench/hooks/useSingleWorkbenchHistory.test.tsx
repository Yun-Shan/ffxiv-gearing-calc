// @vitest-environment jsdom
import { act } from "react";
import { describe, expect, it } from "vitest";
import * as testSupport from "../../../../test-utils/workbench.helper.test.tsx";
import { normalizedText } from "../../../../test-utils/workbench.helper.test.tsx";
import { jobIds, jobSchemas, type JobId, type OptimizationConfig } from "@/domain";

describe("单职业连续搜索工作台", () => {
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

  it("载入当前格式的历史条件后保留其中的职业等级", async () => {
    const savedConfig = {
      ...testSupport.testJobConfig("SAM"),
      jobLevel: Math.max(1, (jobSchemas.SAM.maxJobLevel ?? 100) - 10),
      objective: "damage" as const,
    };
    const startedAtISO = new Date(Date.UTC(2026, 9, 2, 12, 0, 0)).toISOString();
    testSupport.historyStore.records.push({
      id: "single-condition-current-format",
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
    expect(testSupport.host.querySelector('section[aria-label="单职业搜索参数"]')).not.toBeNull();
    expect(() => testSupport.textField("职业等级")).toThrow();

    testSupport.optimizeMock.mockResolvedValueOnce(testSupport.sampleResult());
    await testSupport.startSearchAndSettle();
    await testSupport.settleApp();
    expect(testSupport.optimizeMock.mock.calls[0]?.[0]).toMatchObject({
      jobId: "SAM",
      jobLevel: savedConfig.jobLevel,
      minItemLevel: savedConfig.minItemLevel,
      maxItemLevel: savedConfig.maxItemLevel,
    });
  });
});
