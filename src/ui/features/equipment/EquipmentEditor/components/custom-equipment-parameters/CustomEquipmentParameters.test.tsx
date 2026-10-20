// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getGearById, getGearStatCap, type ForcedGearValue } from "@/domain";
import { CustomEquipmentParameters } from "./CustomEquipmentParameters";

let host: HTMLDivElement;
let root: Root;
const active = (selector: string) =>
  [...document.body.querySelectorAll<HTMLElement>(selector)].filter(
    (element) => !element.closest("[data-closed]"),
  );
const button = (text: string) =>
  active("button").find((element) => element.textContent === text)!;
function field(label: string) {
  const element = [...document.body.querySelectorAll("label")].find(
    (element) => element.textContent === label,
  )!;
  return document.getElementById(element.htmlFor)!;
}
async function click(element: HTMLElement) {
  await act(async () => element.click());
}
async function choose(label: string, value: string) {
  await click(field(label));
  await click(
    active('[role="option"]').find((element) => element.textContent === value)!,
  );
}
async function fill(label: string, value: string) {
  const input = field(label) as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function Harness({
  id,
  readOnly = false,
  initialValue,
  syncLevel,
}: {
  id: number;
  readOnly?: boolean;
  initialValue?: ForcedGearValue;
  syncLevel?: number;
}) {
  const [value, setValue] = useState<ForcedGearValue>(initialValue ?? id);
  return (
    <>
      <output data-forced-value>{JSON.stringify(value)}</output>
      <CustomEquipmentParameters
        gear={getGearById(id)!}
        config={{ jobId: "PLD", syncLevel }}
        readOnly={readOnly}
        value={value}
        onChange={setValue}
      />
    </>
  );
}
function render(id: number, readOnly = false, initialValue?: ForcedGearValue) {
  act(() =>
    root.render(
      <Harness id={id} readOnly={readOnly} initialValue={initialValue} />,
    ),
  );
}
const forcedValue = () =>
  JSON.parse(host.querySelector("[data-forced-value]")!.textContent!) as
    | number
    | { id: number; customStats: Record<string, number> };
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("custom equipment parameter confirmation", () => {
  it("shows effective Manderville values in the summary, selected fields and options without changing saved parameters", async () => {
    const id = 39920;
    const initialValue = { id, customStats: { CRT: 209, DET: 209, SKS: 51, TEN: 0 } };
    act(() => root.render(<Harness id={id} syncLevel={475} initialValue={initialValue} />));
    const trigger = host.querySelector<HTMLButtonElement>("button")!;
    const cap = getGearStatCap(getGearById(id)!, "CRT", 475);
    expect(trigger.textContent).toBe(`暴击 ${cap} / 信念 ${cap} / 技速 51`);
    expect(trigger.querySelectorAll('svg[aria-label="属性同步"]')).toHaveLength(2);
    await click(trigger);
    expect(field("大属性一").textContent).toContain(`暴击 209${cap}`);
    expect(field("大属性一").querySelector('svg[aria-label="属性同步"]')).not.toBeNull();
    expect(field("小属性").querySelector('svg[aria-label="属性同步"]')).toBeNull();
    await click(field("大属性一"));
    const option = active('[role="option"]').find((option) => option.textContent?.startsWith("暴击 209"))!;
    expect(option.textContent).toContain(String(cap));
    expect(option.querySelector('svg[aria-label="属性同步"]')).not.toBeNull();
    expect(forcedValue()).toEqual(initialValue);
  });

  it("marks Resistance sync caps on the slider and removes marks when the cap exceeds the available range", async () => {
    const id = 33462;
    act(() => root.render(<Harness id={id} syncLevel={475} />));
    const trigger = host.querySelector<HTMLButtonElement>("button")!;
    expect(trigger.textContent).toBe("自动");
    expect(trigger.querySelector('svg[aria-label="属性同步"]')).not.toBeNull();
    await click(trigger);
    const cap = getGearStatCap(getGearById(id)!, "CRT", 475);
    const mark = document.querySelector<HTMLElement>(`[aria-label="暴击同步上限 ${cap}"]`)!;
    expect(mark).not.toBeNull();
    expect(mark.style.left).toBe(`${Number((cap / 150 * 100).toFixed(3))}%`);
    const gear = getGearById(id)!;
    const cappedRange = { ...gear, resistanceWeaponAdjust: { ...gear.resistanceWeaponAdjust!, maxEachStat: cap - 1 } };
    act(() => root.render(<CustomEquipmentParameters gear={cappedRange} config={{ jobId: "PLD", syncLevel: 475 }} readOnly={false} value={id} onChange={() => undefined} />));
    await click(host.querySelector<HTMLButtonElement>("button")!);
    expect(document.querySelector('[aria-label*="同步上限"]')).toBeNull();
    act(() => root.render(<CustomEquipmentParameters gear={gear} config={{ jobId: "PLD" }} readOnly={false} value={id} onChange={() => undefined} />));
    expect(host.querySelector('button svg[aria-label="属性同步"]')).toBeNull();
    expect(document.querySelector('[aria-label*="同步上限"]')).toBeNull();
  });
  it("masks automatic controls, requires all three choices, commits and discards cancelled changes", async () => {
    render(39920);
    const trigger = host.querySelector<HTMLButtonElement>("button")!;
    expect(trigger.textContent).toBe("自动");
    await click(trigger);
    expect((field("大属性一") as HTMLButtonElement).disabled).toBe(true);
    expect(
      document.querySelector(
        '[aria-label="自定义属性"] > [aria-hidden="true"]',
      ),
    ).not.toBeNull();
    await choose("参数模式", "自定义");
    expect((button("确认") as HTMLButtonElement).disabled).toBe(true);
    await choose("大属性一", "暴击 209");
    await choose("大属性二", "暴击 209");
    expect(field("大属性一").getAttribute("aria-invalid")).toBe("true");
    expect(field("大属性二").getAttribute("aria-invalid")).toBe("true");
    expect((button("确认") as HTMLButtonElement).disabled).toBe(true);
    await choose("大属性二", "信念 209");
    expect(field("大属性一").hasAttribute("aria-invalid")).toBe(false);
    expect(field("大属性二").hasAttribute("aria-invalid")).toBe(false);
    await choose("小属性", "技速 51");
    expect(trigger.textContent).toBe("自动");
    await click(button("确认"));
    expect(trigger.textContent).toBe("暴击 209 / 信念 209 / 技速 51");
    expect(forcedValue()).toMatchObject({
      id: 39920,
      customStats: { CRT: 209, DET: 209, SKS: 51 },
    });
    await click(trigger);
    await choose("小属性", "坚韧 51");
    await click(button("取消"));
    expect(trigger.textContent).toBe("暴击 209 / 信念 209 / 技速 51");
    await click(trigger);
    expect(field("小属性").textContent).toContain("技速 51");
    await choose("参数模式", "自动");
    await click(button("确认"));
    expect(forcedValue()).toBe(39920);
    expect(trigger.textContent).toBe("自动");
  });
  it("blocks incomplete and over-budget Resistance drafts and commits a legal shield allocation", async () => {
    render(33479);
    const trigger = host.querySelector<HTMLButtonElement>("button")!;
    await click(trigger);
    expect((field("暴击数值") as HTMLInputElement).disabled).toBe(true);
    await choose("参数模式", "自定义");
    await fill("暴击数值", "60");
    await fill("信念数值", "60");
    await fill("技速数值", "15");
    expect((button("确认") as HTMLButtonElement).disabled).toBe(true);
    expect(active('[role="status"]').at(-1)!.textContent).toBe("超限");
    expect(
      document.querySelector('[aria-label="总分配当前值"]')!.textContent,
    ).toBe("135");
    expect(
      document.querySelector('[aria-label="总分配当前值"]')!.className,
    ).toContain("overLimit");
    await fill("技速数值", "");
    expect((button("确认") as HTMLButtonElement).disabled).toBe(true);
    expect(active('[role="status"]').at(-1)!.textContent).toBe("未填完整");
    await fill("技速数值", "13");
    expect(active('[role="status"]').at(-1)!.textContent).toBe("未分配满");
    expect((button("确认") as HTMLButtonElement).disabled).toBe(true);
    await fill("技速数值", "14");
    expect((button("确认") as HTMLButtonElement).disabled).toBe(false);
    expect(active('[role="status"]').at(-1)!.textContent).toBe("");
    expect(
      document.querySelector('[aria-label="总分配当前值"]')!.className,
    ).not.toContain("overLimit");
    expect(
      document
        .querySelector('[aria-label="暴击滑块"]')
        ?.getAttribute("aria-valuenow"),
    ).toBe("60");
    await click(button("确认"));
    expect(trigger.textContent).toBe("暴击 60 / 信念 60 / 技速 14");
    expect(forcedValue()).toMatchObject({
      id: 33479,
      customStats: { CRT: 60, DET: 60, SKS: 14 },
    });
  });
  it("keeps read-only custom settings closed", () => {
    render(39939, true);
    expect(host.querySelector<HTMLButtonElement>("button")!.disabled).toBe(
      true,
    );
  });
});
