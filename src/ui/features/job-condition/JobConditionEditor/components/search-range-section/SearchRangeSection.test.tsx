// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gameData } from "@/domain";
import type { SearchRangeDraft } from "../../../types";
import { SearchRangeSectionFields } from "./SearchRangeSection";

let host: HTMLDivElement;
let root: Root;
const getAnimationsDescriptor = Object.getOwnPropertyDescriptor(
  Element.prototype,
  "getAnimations",
);

function Harness({ initialRange }: { initialRange?: SearchRangeDraft } = {}) {
  const [range, setRange] = useState<SearchRangeDraft>(initialRange ?? {
    minItemLevel: 700,
    maxItemLevel: 795,
    sync: undefined,
    clanIndex: 0,
  });
  return (
    <>
      <SearchRangeSectionFields range={range} onChange={setRange} />
      <output>{JSON.stringify(range)}</output>
    </>
  );
}

async function click(element: HTMLElement) {
  await act(async () => element.click());
}

function getTrigger() {
  return [...host.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent?.includes("未启用"),
  )!;
}

function currentRange() {
  return JSON.parse(
    host.querySelector("output")!.textContent!,
  ) as SearchRangeDraft;
}

beforeEach(() => {
  Object.defineProperty(Element.prototype, "getAnimations", {
    configurable: true,
    value: () => [],
  });
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
  if (getAnimationsDescriptor)
    Object.defineProperty(Element.prototype, "getAnimations", getAnimationsDescriptor);
  else Reflect.deleteProperty(Element.prototype, "getAnimations");
});

describe("sync target selection", () => {
  it("retains the clicked duty even at the same target and clears it on a numeric selection without reapplying assistance", async () => {
    const group = gameData.sync.groups.find(({ options }) => options.some((option, index) =>
      option.target.kind === "itemLevel" && option.target.value < 700 && options.slice(index + 1).some((other) =>
        other.name !== option.name && other.target.kind === option.target.kind && other.target.value === option.target.value,
      ),
    ))!;
    const first = group.options.find((option) => option.target.kind === "itemLevel" && option.target.value < 700 && group.options.some((other) =>
      other.name !== option.name && other.target.kind === option.target.kind && other.target.value === option.target.value,
    ))!;
    const second = group.options.find((option) => option.name !== first.name && option.target.kind === first.target.kind && option.target.value === first.target.value)!;
    act(() => root.render(<Harness initialRange={{ minItemLevel: 700, maxItemLevel: 795, sync: first.target, clanIndex: 0 }} />));
    const trigger = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === `品级 ${first.target.value}`)!;
    const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('[aria-label="同步设置"] button')].find((item) => item.textContent === text)!;
    await click(trigger);
    await click(button("按副本"));
    await click(button(group.name));
    await click(button(`${first.name}${first.target.value}`));
    expect(currentRange()).toMatchObject({ sync: first.target, syncDuty: first.name, minItemLevel: 700 });
    expect(trigger.textContent).toBe(`${first.name}(品级${first.target.value})`);
    await click(trigger);
    await click(button(`${second.name}${second.target.value}`));
    expect(currentRange()).toMatchObject({ sync: second.target, syncDuty: second.name, minItemLevel: 700 });
    await click(trigger);
    expect(button(`${first.name}${first.target.value}`).getAttribute("aria-pressed")).toBe("false");
    expect(button(`${second.name}${second.target.value}`).getAttribute("aria-pressed")).toBe("true");
    await click(button("按品级"));
    await click(button("应用"));
    expect(currentRange().syncDuty).toBeUndefined();
    expect(currentRange().minItemLevel).toBe(700);
    expect(trigger.textContent).toBe(`品级 ${first.target.value}`);
  });

  it("commits a level-only target and assists the minimum item level from ParamGrow", async () => {
    act(() => root.render(<Harness />));
    const trigger = getTrigger();
    await click(trigger);

    const level = 90;
    const category = [
      ...document.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.textContent === `${level} 级`)!;
    await click(category);
    const levelTarget = [
      ...document.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.textContent?.includes(`仅同步等级 ${level}`))!;
    await click(levelTarget);

    expect(currentRange().sync).toEqual({ kind: "jobLevel", value: level });
    expect(trigger.textContent).toBe(`${level}级`);
    const defaultItemLevel = gameData.sync.levels.find(
      (entry) => entry.jobLevel === level,
    )!.defaultItemLevel;
    expect(currentRange().minItemLevel).toBe(
      Math.min(700, Math.floor((defaultItemLevel - 10) / 10) * 10),
    );
  });

  it("rejects custom item levels below 90 without changing the committed target", async () => {
    act(() => root.render(<Harness />));
    await click(getTrigger());
    const input = document.querySelector<HTMLInputElement>(
      'input[class*="manualInput"]',
    )!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, "89");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click(
      [...document.querySelectorAll<HTMLButtonElement>("button")].find(
        (button) => button.textContent === "应用",
      )!,
    );

    expect(currentRange().sync).toBeUndefined();
    expect(currentRange().minItemLevel).toBe(700);
    expect(document.body.textContent).toContain("不低于 90");
  });
});
