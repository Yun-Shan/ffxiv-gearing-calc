// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JobConditionScopeProvider } from "../../../scope";
import type { GcdAnalysisState, JobConditionDraft } from "../../../types";
import { GcdSection } from "./GcdSection";

let host: HTMLDivElement;
let root: Root;
function Harness({
  analysis,
  initialTiers,
  readOnly = false,
}: {
  analysis: GcdAnalysisState;
  initialTiers: number[];
  readOnly?: boolean;
}) {
  const [draft, setDraft] = useState<JobConditionDraft>({
    range: {
      minItemLevel: 780,
      maxItemLevel: 795,
      sync: undefined,
      clanIndex: 0,
    },
    gcd: { mode: "tiers", tiers: initialTiers },
    food: { mode: "auto" },
    tank: { maximizeTenacity: false },
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
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("GCD selection after analysis", () => {
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
