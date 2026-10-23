// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gameData } from "@/domain";
import type { SearchRangeDraft } from "../../../types";
import { SearchRangeSectionFields } from "./SearchRangeSection";

let host: HTMLDivElement;
let root: Root;

function Harness() {
  const [range, setRange] = useState<SearchRangeDraft>({
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

describe("sync target selection", () => {
  it("commits a level-only target and assists the minimum item level from ParamGrow", async () => {
    act(() => root.render(<Harness />));
    await click(getTrigger());

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
