// @vitest-environment jsdom
import { act } from "react";
import { describe, expect, it } from "vitest";
import * as testSupport from "../../../../test-utils/workbench.helper.test";

describe("JobConfigFields GCD chip layout", () => {
  it("GCD 档位标签按当前控件宽度自适应显示", async () => {
    testSupport.findFeasibleGcdsMock.mockResolvedValue([2.5, 2.48, 2.46, 2.44]);
    testSupport.chooseJob("WAR");
    testSupport.selectAriaValue("GCD 约束类型", "multiple");
    await testSupport.settleApp(260);
    testSupport.click(testSupport.buttonNamed("选择 GCD 档位"));
    const choices = [...testSupport.host.querySelectorAll<HTMLInputElement>(".single-gcd-choice-option input[type=checkbox]")];
    expect(choices).toHaveLength(4);
    act(() => choices.forEach((choice) => choice.click()));

    const chips = testSupport.host.querySelector<HTMLElement>(".single-gcd-chips")!;
    let availableWidth = 190;
    Object.defineProperty(chips, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        x: 0, y: 0, width: availableWidth, height: 24,
        top: 0, right: availableWidth, bottom: 24, left: 0,
        toJSON: () => ({}),
      }) as DOMRect,
    });
    act(() => window.dispatchEvent(new Event("resize")));
    expect(chips.querySelectorAll(".single-gcd-chip:not(.single-gcd-chip-measure):not(.is-overflow)")).toHaveLength(3);
    expect(chips.querySelectorAll(".single-gcd-chip.is-overflow:not(.single-gcd-chip-measure)")).toHaveLength(1);

    availableWidth = 230;
    act(() => window.dispatchEvent(new Event("resize")));
    expect(chips.querySelectorAll(".single-gcd-chip:not(.single-gcd-chip-measure):not(.is-overflow)")).toHaveLength(4);
    expect(chips.querySelectorAll(".single-gcd-chip.is-overflow:not(.single-gcd-chip-measure)")).toHaveLength(0);
  });
});
