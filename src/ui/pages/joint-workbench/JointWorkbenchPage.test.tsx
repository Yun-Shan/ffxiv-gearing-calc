// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import * as testSupport from "../../../test-utils/workbench.helper.test";
import { normalizedText } from "../../../test-utils/workbench.helper.test";
import { jobSchemas, type JobId } from "@/domain";

function professionSummaryCard(jobId: JobId): HTMLButtonElement {
  const card = [...testSupport.host.querySelectorAll<HTMLButtonElement>(
    '[aria-label="已选职业条件摘要"] button',
  )].find((item) => item.querySelector("small")?.textContent?.trim() === jobId);
  if (!card) throw new Error(`找不到「${jobId}」职业条件摘要`);
  return card;
}

function selectProfession(jobId: JobId): void {
  testSupport.click(professionSummaryCard(jobId));
}

function selectSharedConditions(): void {
  const card = [...testSupport.host.querySelectorAll<HTMLButtonElement>(
    '[aria-label="已选职业条件摘要"] button',
  )].find((item) => !item.querySelector("small") && normalizedText(item).includes("共享条件"));
  if (!card) throw new Error("找不到共享条件摘要");
  testSupport.click(card);
}

function professionConfigCard(jobId: JobId): HTMLDetailsElement {
  const card = [...testSupport.host.querySelectorAll<HTMLDetailsElement>("[data-job-config-card]")]
    .find((item) => item.querySelector("summary strong")?.textContent?.trim() === jobSchemas[jobId].name);
  if (!card) throw new Error(`找不到「${jobSchemas[jobId].name}」职业配置`);
  return card;
}

describe("多职业联合搜索工作台", () => {
  it("可以为不同职业设置 GCD 与速度条件，并选择联合优化目标", async () => {
    testSupport.navigateToJoint();
    await testSupport.settleApp();
    testSupport.click(testSupport.buttonNamed("前往条件设置"));
    await testSupport.settleApp();

    selectProfession("RDM");
    const rdmCard = professionConfigCard("RDM");
    expect(rdmCard.querySelector("summary")?.textContent).toContain("同步未启用");
    testSupport.selectValue("同步品级", "735");
    expect(rdmCard.querySelector("summary")?.textContent).toContain("同步品级 735");
    testSupport.selectValue("同步品级", "");
    expect(rdmCard.querySelector("summary")?.textContent).toContain("同步未启用");
    expect([...rdmCard.querySelectorAll("summary")]
      .some((summary) => normalizedText(summary).includes("来源与装备限制")))
      .toBe(true);

    testSupport.selectAriaValue("GCD 约束类型", "single");
    testSupport.inputValue("目标 GCD", "2.40");
    testSupport.inputValue("最低咏速", "1234");
    expect((testSupport.textField("目标 GCD") as HTMLInputElement).value).toBe("2.40");
    expect((testSupport.textField("最低咏速") as HTMLInputElement).value).toBe("1234");

    selectSharedConditions();
    const objectiveGroup = testSupport.host.querySelector('[key="group"][aria-label="优化目标"]');
    const gcdObjective = [...(objectiveGroup?.querySelectorAll<HTMLButtonElement>("button") ?? [])]
      .find((button) => normalizedText(button) === "按 GCD 折算");
    expect(gcdObjective).toBeDefined();
    testSupport.click(gcdObjective!);
    expect(gcdObjective!.getAttribute("aria-pressed")).toBe("true");

    selectProfession("BLM");
    expect(professionConfigCard("BLM").querySelector("summary strong")?.textContent)
      .toBe(jobSchemas.BLM.name);
    expect(normalizedText(professionSummaryCard("RDM"))).toContain("GCD 2.40 秒");
  });

  it("载入联合条件后进入条件页并保留已选职业", async () => {
    const config = testSupport.testJointConfig(["RDM", "BLM"]);
    testSupport.seedCompletedJointHistory(config);
    testSupport.navigateToJoint();
    await testSupport.settleApp();
    testSupport.openSearchHistory();
    await testSupport.settleApp();
    const record = testSupport.historyCardContaining(
      `${jobSchemas.RDM.name} ${jobSchemas.RDM.maxJobLevel} 级、${jobSchemas.BLM.name}`,
    );
    testSupport.click(testSupport.historyActionButton(record, "载入条件"));
    await testSupport.settleApp();

    expect(testSupport.host.querySelector("h1")?.textContent).toBe("设置联合条件");
    const selectedJobs = [...testSupport.host.querySelectorAll(
      '[aria-label="已选职业条件摘要"] button small',
    )].map((item) => item.textContent?.trim());
    expect(selectedJobs).toEqual(["RDM", "BLM"]);
  });

  it("取消联合搜索后，迟到回调不会覆盖已载入的历史结果", async () => {
    const savedConfig = testSupport.testJointConfig(["RDM", "BLM"]);
    testSupport.seedCompletedJointHistory(savedConfig);
    testSupport.navigateToJoint();
    await testSupport.settleApp();
    testSupport.openSearchHistory();
    await testSupport.settleApp();
    const savedRecord = testSupport.historyCardContaining(
      `${jobSchemas.RDM.name} ${jobSchemas.RDM.maxJobLevel} 级、${jobSchemas.BLM.name}`,
    );
    testSupport.click(testSupport.historyActionButton(savedRecord, "载入条件"));
    await testSupport.settleApp();

    testSupport.mockDelayedAbortableJointSearch();
    await testSupport.startSearchAndSettle();
    await testSupport.settleApp();
    expect(testSupport.optimizeJointMock).toHaveBeenCalledTimes(1);
    expect(testSupport.host.textContent).toContain("正在准备各职业的搜索模型");

    testSupport.openSearchHistory();
    const resultRecord = testSupport.historyCardContaining(
      `${jobSchemas.RDM.name} ${jobSchemas.RDM.maxJobLevel} 级、${jobSchemas.BLM.name}`,
      "载入结果",
    );
    testSupport.click(testSupport.historyActionButton(resultRecord, "载入结果"));
    expect(testSupport.host.querySelector('[aria-label="搜索结果状态"]')).not.toBeNull();
    expect(testSupport.host.querySelector("h1")?.textContent).toBe("联合配装结果");

    await testSupport.settleApp(40);
    expect(testSupport.host.querySelector('[aria-label="搜索结果状态"]')).not.toBeNull();
    expect(testSupport.host.querySelector("h1")?.textContent).toBe("联合配装结果");
    const canceledAttempt = testSupport.historyStore.records.find(
      (item) => item.kind === "joint" && item.id !== "saved-joint-result",
    );
    expect(canceledAttempt?.status).toBe("cancelled");
    expect(testSupport.optimizeJointMock).toHaveBeenCalledTimes(1);
  });

  it("从已载入的联合结果调整食物策略后显示条件编辑页", async () => {
    const config = testSupport.testJointConfig(["RDM", "BLM"]);
    testSupport.seedCompletedJointHistory(config);
    testSupport.navigateToJoint();
    await testSupport.settleApp();
    testSupport.openSearchHistory();
    await testSupport.settleApp();

    const savedRecord = testSupport.historyCardContaining(
      `${jobSchemas.RDM.name} ${jobSchemas.RDM.maxJobLevel} 级、${jobSchemas.BLM.name}`,
      "载入结果",
    );
    testSupport.click(testSupport.historyActionButton(savedRecord, "载入结果"));
    await testSupport.settleApp();
    expect(testSupport.host.querySelector('[aria-label="搜索结果状态"]')?.textContent)
      .toContain("搜索完成");

    testSupport.click(testSupport.buttonNamed("调整条件"));
    await testSupport.settleApp();
    const foodStrategy = testSupport.host.querySelector('[key="group"][aria-label="食物策略"]');
    const independentFoodButton = [...(foodStrategy?.querySelectorAll<HTMLButtonElement>("button") ?? [])]
      .find((button) => normalizedText(button) === "各职业独立");
    expect(independentFoodButton).toBeDefined();
    testSupport.click(independentFoodButton!);

    expect(testSupport.host.querySelector('[aria-label="搜索结果状态"]')).toBeNull();
    expect(testSupport.host.querySelector("h1")?.textContent).toBe("设置联合条件");
    expect(independentFoodButton!.getAttribute("aria-pressed")).toBe("true");
    expect(testSupport.optimizeJointMock).not.toHaveBeenCalled();
  });
});
