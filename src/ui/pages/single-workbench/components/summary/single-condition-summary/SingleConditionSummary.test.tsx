// @vitest-environment jsdom
import { act } from "react";
import { describe, expect, it } from "vitest";
import * as testSupport from "../../../../../../test-utils/workbench.helper.test";

describe("SingleConditionSummary restriction popovers", () => {
  it("限制详情可键盘访问，浮窗内点击保持打开，Esc 或外部点击会收起", () => {
    testSupport.chooseJob("SAM");
    const summary = testSupport.host.querySelector('aside[aria-label="当前搜索条件摘要"]');
    expect(summary).not.toBeNull();
    const triggers = [...summary!.querySelectorAll<HTMLButtonElement>('[aria-haspopup="dialog"]')];
    expect(triggers).toHaveLength(3);
    testSupport.click(triggers[0]!);
    expect(triggers[0]!.getAttribute("aria-expanded")).toBe("true");
    const panel = document.body.querySelector('[key="dialog"]');
    expect(panel).not.toBeNull();
    expect(summary!.contains(panel)).toBe(false);
    const panelList = panel!.querySelector<HTMLElement>('[key="region"][tabindex="0"]');
    expect(panelList).not.toBeNull();
    expect(panelList!.tabIndex).toBe(0);
    expect(document.activeElement).toBe(panelList);

    act(() => panelList!.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    expect(document.body.querySelector('[key="dialog"]')).not.toBeNull();

    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(document.body.querySelector('[key="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(triggers[0]);

    act(() => triggers[0]!.click());
    expect(document.body.querySelector('[key="dialog"]')).not.toBeNull();
    act(() => testSupport.host.querySelector('[aria-label="自动选择的搜索指标"]')!.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    expect(document.body.querySelector('[key="dialog"]')).toBeNull();
    expect(triggers[0]!.getAttribute("aria-expanded")).toBe("false");
  });
});
