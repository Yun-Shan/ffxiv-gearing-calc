// @vitest-environment jsdom
import { makeConfig, currentDataVersion } from "@/ui/services/app-config";
import { act } from "react";
import { describe, expect, it } from "vitest";
import * as support from "@/test-utils/workbench.helper.test";
describe("重构后的 Single 工作流", () => {
  it("候选不足时只提示没有可行档位，不同时要求选择档位", async () => {
    support.findFeasibleGcdsMock.mockResolvedValue([]);
    support.chooseJob("PLD");
    await support.settleApp(220);
    const gcd = support.host.querySelector('section[aria-label="GCD"]')!;
    expect(gcd.textContent).toContain("当前条件下没有可行 GCD 档位。");
    expect(gcd.textContent).not.toContain("请至少选择一个可行 GCD 档位。");
    expect(support.buttonNamed("开始搜索").disabled).toBe(true);
  });
  it("GCD 问题在控件内显示，右侧只汇总问题是否存在", async () => {
    support.chooseJob("PLD");
    await support.settleApp(220);
    const gcd = support.host.querySelector('section[aria-label="GCD"]')!;
    const status = () => support.host.querySelector('aside [role="status"]')!.textContent;
    expect(status()).toBe("存在无效的条件设置，请检查所有条件约束");
    await support.selectFirstGcdTierIfEmpty();
    await support.settleApp(220);
    expect(gcd.textContent).not.toContain("请至少选择一个可行 GCD 档位。");
    expect(status()).toBe("已就绪，可以开始搜索");
  });
  it("选择后进入条件，反序范围阻止搜索", async () => {
    expect(support.host.querySelector("h1")?.textContent).toBe("选择职业");
    support.chooseJob("SAM");
    expect(support.host.querySelector("h1")?.textContent).toContain("条件设置");
    support.inputValue("最低装备品级", "999");
    expect(support.buttonNamed("开始搜索").disabled).toBe(true);
  });
  it("种族选择更新摘要并写入 GCD 分析输入", async () => {
    support.chooseJob("SAM");
    await support.settleApp(220);
    const trigger = [...support.host.querySelectorAll("button")].find(
      (button) => button.textContent?.includes("人族 · 中原之民"),
    );
    expect(trigger).toBeDefined();
    act(() => trigger!.click());
    await support.settleApp();
    const northern = [...document.body.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "北洋之民",
    );
    expect(northern).toBeDefined();
    act(() => northern!.click());
    await support.settleApp(220);

    expect(support.host.querySelector("aside")?.textContent).toContain(
      "鲁加族 · 北洋之民",
    );
    const inputs = support.findFeasibleGcdsMock.mock.calls.map(
      ([input]) => input as { clanIndex?: number },
    );
    expect(inputs.some((input) => input.clanIndex === 8)).toBe(true);
  });
  it("真实搜索适配器传入不可变 Snapshot，结果不保留 solver 过程", async () => {
    support.optimizeMock.mockResolvedValue(support.sampleResult());
    support.chooseJob("SAM");
    await support.settleApp(220);
    await support.selectFirstGcdTierIfEmpty();
    await support.startSearchAndSettle();
    expect(support.host.querySelector("h1")?.textContent).toContain("配装结果");
    expect(support.host.querySelector("table")).not.toBeNull();
    expect(support.host.textContent).not.toContain("当前算法搜索状态");
    expect(Object.isFrozen(support.optimizeMock.mock.calls[0]![0])).toBe(true);
    support.click(support.buttonNamed("调整条件"));
    expect(support.host.querySelector("h1")?.textContent).toContain("条件设置");
  });
  it("无解返回全新 Conditions并通过Toast反馈", async () => {
    support.optimizeMock.mockResolvedValue(undefined);
    support.chooseJob("SAM");
    await support.settleApp(220);
    await support.selectFirstGcdTierIfEmpty();
    await support.startSearchAndSettle();
    expect(support.host.querySelector("h1")?.textContent).toContain("条件设置");
    expect(document.body.textContent).toContain("当前条件下没有可行配装");
    expect(support.host.querySelector("table")).toBeNull();
  });
  it("进度中的历史浮层不会取消搜索，关闭后保持原phase", async () => {
    support.mockAbortableSearch();
    support.chooseJob("SAM");
    await support.settleApp(220);
    await support.selectFirstGcdTierIfEmpty();
    await support.startSearchAndSettle();
    support.click(support.buttonNamed("搜索记录"));
    await support.settleApp();
    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(support.optimizeMock.mock.calls[0]![1].signal.aborted).toBe(false);
    const close = dialog!.querySelector<HTMLButtonElement>(
      'button[aria-label="关闭搜索记录"]',
    );
    expect(close).not.toBeNull();
    support.click(close!);
    await support.settleApp();
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    expect(support.optimizeMock.mock.calls[0]![1].signal.aborted).toBe(false);
    expect(support.host.querySelector("h1")?.textContent).toContain("正在搜索");
  });
});

async function chooseTankStrategy(name: string) {
  const label = [...support.host.querySelectorAll("label")].find(
    (el) => el.textContent === "坚韧策略",
  )!;
  const trigger = document.getElementById(label.htmlFor) as HTMLButtonElement;
  support.click(trigger);
  await support.settleApp();
  const option = [
    ...document.body.querySelectorAll<HTMLElement>('[role="option"]'),
  ].find((el) => el.textContent?.replace("✓", "").trim() === name)!;
  act(() => option.click());
  await support.settleApp();
}
describe("坚韧策略与通用输入", () => {
  it("历史最低坚韧输入清空后保留策略并阻止搜索", async () => {
    support.chooseJob("PLD");
    support.historyStore.records.push({
      id: "minimum-tank-history",
      kind: "single",
      config: { ...makeConfig("PLD"), minTenacity: 2300 },
      dataVersion: currentDataVersion,
      status: "completed",
      result: support.sampleResult(),
      startedAtISO: new Date().toISOString(),
    });
    support.click(support.buttonNamed("搜索记录"));
    await support.settleApp();
    const edit = [
      ...document.body.querySelectorAll<HTMLButtonElement>("button"),
    ].find((el) => el.textContent === "编辑条件")!;
    support.click(edit);
    await support.settleApp();
    support.inputValue("最低坚韧值", "");
    await support.settleApp();
    expect(support.textField("最低坚韧值").value).toBe("");
    expect(support.host.textContent).toContain("请输入最低坚韧值");
    expect(support.buttonNamed("开始搜索").disabled).toBe(true);
  });

  it("同职业历史载入后显示实际策略和约束", async () => {
    support.chooseJob("PLD");
    support.historyStore.records.push({
      id: "tank-history",
      kind: "single",
      config: {
        ...makeConfig("PLD"),
        minTenacity: 2300,
        toughnessMinPercent: 12,
        maximizeTenacity: true,
      },
      dataVersion: currentDataVersion,
      status: "completed",
      result: support.sampleResult(),
      startedAtISO: new Date().toISOString(),
    });
    support.click(support.buttonNamed("搜索记录"));
    await support.settleApp();
    const edit = [
      ...document.body.querySelectorAll<HTMLButtonElement>("button"),
    ].find((el) => el.textContent === "编辑条件")!;
    support.click(edit);
    await support.settleApp();
    expect(support.host.textContent).not.toContain("组合约束");
    expect(support.host.textContent).toContain("请选择单一策略");
    expect(support.host.textContent).toContain("2,300");
    expect(support.host.textContent).toContain("12%");
    expect(support.buttonNamed("开始搜索").disabled).toBe(true);
    await chooseTankStrategy("最大化减伤百分比");
    expect(support.host.textContent).not.toContain("最低坚韧值");
    expect(support.host.textContent).not.toContain("最低减伤比例");
    await support.settleApp(220);
    await support.selectFirstGcdTierIfEmpty();
    await support.startSearchAndSettle();
    const config = support.optimizeMock.mock.calls[0]![0];
    expect(config.minTenacity).toBeUndefined();
    expect(config.toughnessMinPercent).toBeUndefined();
    expect(config.maximizeTenacity).toBe(true);
  });
  it("最低值策略空值与越界值无效，切换不限清除约束", async () => {
    support.chooseJob("PLD");
    await chooseTankStrategy("最低减伤百分比");
    support.inputValue("最低减伤比例", "101");
    await support.settleApp();
    expect(support.buttonNamed("开始搜索").disabled).toBe(true);
    support.inputValue("最低减伤比例", "");
    await support.settleApp();
    expect(support.host.textContent).toContain("请输入最低减伤比例");
    await chooseTankStrategy("最低坚韧数值");
    support.inputValue("最低坚韧值", "-1");
    await support.settleApp();
    expect(support.buttonNamed("开始搜索").disabled).toBe(true);
    await chooseTankStrategy("不限");
    await support.settleApp(220);
    await support.selectFirstGcdTierIfEmpty();
    expect(support.buttonNamed("开始搜索").disabled).toBe(false);
  });
});

describe("GCD 多选", () => {
  it("默认选择可行档位，生成期间识别中，未选择时显示待选择并阻止搜索", async () => {
    support.chooseJob("SAM");
    expect(support.host.textContent).toContain("识别中…");
    await support.settleApp(220);
    expect(support.host.textContent).toContain("目标模式：待选择");
    expect(support.buttonNamed("开始搜索").disabled).toBe(true);
    await support.selectFirstGcdTierIfEmpty();
    expect(support.host.textContent).toContain("目标模式：每威力期望伤害");
    expect(support.buttonNamed("开始搜索").disabled).toBe(false);
  });

  it("可同时选择档位并取消其中一个，提交保留最终选择", async () => {
    support.chooseJob("SAM");
    await support.settleApp(220);
    const open = async (labelText: string) => {
      const label = [...support.host.querySelectorAll("label")].find(
        (el) => el.textContent === labelText,
      )!;
      support.click(
        document.getElementById(label.htmlFor) as HTMLButtonElement,
      );
      await support.settleApp();
    };
    const choose = async (text: string) => {
      const option = [
        ...document.body.querySelectorAll<HTMLElement>('[role="option"]'),
      ].find((el) => el.textContent?.replace("✓", "").trim() === text)!;
      act(() => option.click());
      await support.settleApp();
    };
    await open("GCD 条件");
    await choose("选择可行档位");
    await open("可行 GCD 档位");
    await choose("2.50 秒");
    await choose("2.48 秒");
    const selected = (text: string) =>
      [...document.body.querySelectorAll<HTMLElement>('[role="option"]')]
        .find((el) => el.textContent?.replace("✓", "").trim() === text)
        ?.getAttribute("aria-selected");
    expect(selected("2.50 秒")).toBe("true");
    expect(selected("2.48 秒")).toBe("true");
    await choose("2.50 秒");
    expect(selected("2.50 秒")).toBe("false");
    expect(selected("2.48 秒")).toBe("true");
    act(() =>
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
    );
    await support.settleApp();
    await support.selectFirstGcdTierIfEmpty();
    await support.startSearchAndSettle();
    expect(support.optimizeMock.mock.calls[0]![0].gcdChoices).toEqual([2.48]);
  });
});
