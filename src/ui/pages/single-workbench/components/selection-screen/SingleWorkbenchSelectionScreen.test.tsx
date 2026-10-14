// @vitest-environment jsdom
import { act } from "react";
import { describe, expect, it } from "vitest";
import * as testSupport from "../../../../../test-utils/workbench.helper.test";
import { normalizedText } from "../../../../../test-utils/workbench.helper.test";
import { jobIds, jobSchemas, type JobId, type OptimizationConfig } from "@/domain";

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
});
