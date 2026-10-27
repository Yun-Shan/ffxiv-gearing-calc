// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JobConditionScopeProvider } from "../../../scope";
import { jobConditionDraftFromConfig } from "../../../draft";
import { makeConfig } from "@/ui/services/app-config";
import type { GcdAnalysisState, GcdDraft, JobConditionDraft } from "../../../types";
import { GcdSection } from "./GcdSection";

let host: HTMLDivElement;
let root: Root;
function Harness({
  analysis,
  initialTiers = [],
  initialGcd,
  readOnly = false,
}: {
  analysis: GcdAnalysisState;
  initialTiers?: number[];
  initialGcd?: GcdDraft;
  readOnly?: boolean;
}) {
  const [draft, setDraft] = useState<JobConditionDraft>({
    range: {
      minItemLevel: 780,
      maxItemLevel: 795,
      sync: undefined,
      clanIndex: 0,
    },
    gcd: initialGcd ?? { mode: "tiers", tiers: initialTiers },
    food: { mode: "auto" },
    tank: { strategy: "any" },
  });
  return (
    <JobConditionScopeProvider
      jobId="SAM"
      draft={draft}
      onChange={setDraft}
      runtime={{ gcdAnalysis: analysis }}
      readOnly={readOnly}
    >
      <GcdSection />
      <output>{JSON.stringify(draft.gcd)}</output>
    </JobConditionScopeProvider>
  );
}
const selected = () =>
  JSON.parse(host.querySelector("output")!.textContent!).tiers;
const gcdValue = () => JSON.parse(host.querySelector("output")!.textContent!);
function trigger(labelText: string): HTMLButtonElement {
  const label = [...host.querySelectorAll("label")].find(
    (element) => element.textContent === labelText,
  )!;
  return document.getElementById(label.htmlFor) as HTMLButtonElement;
}
async function click(element: HTMLElement) {
  await act(async () => element.click());
}
async function choose(text: string) {
  const option = [...document.body.querySelectorAll<HTMLElement>('[role="option"]')]
    .find((element) => element.textContent?.replace("✓", "").trim() === text)!;
  await click(option);
}
const readyAnalysis: GcdAnalysisState = {
  status: "ready", key: "test", feasibleTiers: [2.5, 2.48, 2.46],
};
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("GCD single and multiple selection", () => {
  it.each([
    { tiers: [], expected: "选择单个档位" },
    { tiers: [2.5], expected: "选择单个档位" },
    { tiers: [2.5, 2.48], expected: "选择多个档位" },
  ])("infers $expected from rebuilt choices $tiers", ({ tiers, expected }) => {
    const initialGcd = jobConditionDraftFromConfig({
      ...makeConfig("SAM"), gcdChoices: tiers,
    }).gcd;
    act(() => root.render(<Harness analysis={readyAnalysis} initialGcd={initialGcd} />));
    expect(trigger("GCD 条件").textContent).toContain(expected);
    expect(selected()).toEqual(tiers);
  });

  it("replaces the chosen tier in single mode", async () => {
    act(() => root.render(<Harness analysis={readyAnalysis} />));
    await click(trigger("可行 GCD 档位"));
    await choose("2.50 秒");
    expect(selected()).toEqual([2.5]);
    await click(trigger("可行 GCD 档位"));
    await choose("2.48 秒");
    expect(gcdValue()).toEqual({ mode: "tiers", tiers: [2.48], multiple: false });
  });

  it("clears choices when switching modes and keeps multiple mode with one or no tiers", async () => {
    act(() => root.render(<Harness analysis={readyAnalysis} initialTiers={[2.5]} />));
    await click(trigger("GCD 条件"));
    await choose("选择多个档位");
    expect(gcdValue()).toEqual({ mode: "tiers", tiers: [], multiple: true });
    await click(trigger("可行 GCD 档位"));
    await choose("2.50 秒");
    expect(selected()).toEqual([2.5]);
    expect(trigger("GCD 条件").textContent).toContain("选择多个档位");
    await choose("2.50 秒");
    expect(selected()).toEqual([]);
    expect(trigger("GCD 条件").textContent).toContain("选择多个档位");
    await choose("2.48 秒");
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    await click(trigger("GCD 条件"));
    await choose("选择单个档位");
    expect(gcdValue()).toEqual({ mode: "tiers", tiers: [], multiple: false });
    expect(host.textContent).toContain("目标模式：待选择");
  });
});

describe("GCD selection after analysis", () => {
  it("retains inferred multiple mode when recalculation leaves one tier or clears all tiers", () => {
    const render = (key: string, feasibleTiers: number[]) => act(() => root.render(
      <Harness analysis={{ status: "ready", key, feasibleTiers }} initialTiers={[2.5, 2.48]} />,
    ));
    render("one", [2.48]);
    expect(gcdValue()).toEqual({ mode: "tiers", tiers: [2.48], multiple: true });
    expect(trigger("GCD 条件").textContent).toContain("选择多个档位");
    render("none", [2.46]);
    expect(gcdValue()).toEqual({ mode: "tiers", tiers: [], multiple: true });
    expect(trigger("GCD 条件").textContent).toContain("选择多个档位");
  });

  it.each([[2.5], [2.5, 2.48, 2.46]])(
    "retains available selections from %j through recalculation",
    (...tiers) => {
      const initialTiers = tiers as number[];
      const render = (analysis: GcdAnalysisState) =>
        act(() =>
          root.render(
            <Harness analysis={analysis} initialTiers={initialTiers} />,
          ),
        );
      render({
        status: "ready",
        key: "first",
        feasibleTiers: [2.5, 2.48, 2.46],
      });
      expect(selected()).toEqual(initialTiers);
      render({ status: "loading", key: "next" });
      expect(selected()).toEqual(initialTiers);
      render({
        status: "ready",
        key: "next",
        feasibleTiers: [2.5, 2.46, 2.44],
      });
      expect(selected()).toEqual(initialTiers.filter((tier) => tier !== 2.48));
    },
  );
  it("drops all unavailable tiers without choosing a replacement or restoring dropped tiers later", () => {
    const render = (key: string, feasibleTiers: number[]) =>
      act(() =>
        root.render(
          <Harness
            analysis={{ status: "ready", key, feasibleTiers }}
            initialTiers={[2.5, 2.48]}
          />,
        ),
      );
    render("first", [2.46]);
    expect(selected()).toEqual([]);
    render("next", [2.5, 2.48]);
    expect(selected()).toEqual([]);
    expect(host.textContent).toContain("目标模式：待选择");
  });
  it("does not change a read-only selection", () => {
    act(() =>
      root.render(
        <Harness
          readOnly
          analysis={{ status: "ready", key: "readonly", feasibleTiers: [2.46] }}
          initialTiers={[2.5]}
        />,
      ),
    );
    expect(selected()).toEqual([2.5]);
  });
  it("updates the empty-tier error when a ready result becomes nonempty", () => {
    const render = (key: string, feasibleTiers: number[]) =>
      act(() =>
        root.render(
          <Harness
            analysis={{ status: "ready", key, feasibleTiers }}
            initialTiers={[]}
          />,
        ),
      );
    render("empty", []);
    expect(host.textContent).toContain("当前条件下没有可行 GCD 档位。");
    render("available", [2.5]);
    expect(host.textContent).not.toContain("当前条件下没有可行 GCD 档位。");
  });
});
