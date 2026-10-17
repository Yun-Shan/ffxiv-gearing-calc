// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { JobSelection } from "./JobSelection";
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
describe("JobSelection semantic modes", () => {
  it("single click immediately reports a job", () => {
    const host = document.createElement("div"),
      root = createRoot(host),
      onSelect = vi.fn();
    act(() => root.render(<JobSelection mode="single" onSelect={onSelect} />));
    act(() => host.querySelector<HTMLButtonElement>("button")!.click());
    expect(onSelect).toHaveBeenCalledWith("PLD");
    act(() => root.unmount());
  });
  it("reports invalid initial mixed groups without changing the supplied selection", () => {
    const host = document.createElement("div"),
      root = createRoot(host),
      callback = vi.fn();
    const initial = ["PLD", "WHM"] as const;
    act(() =>
      root.render(
        <JobSelection
          mode="joint"
          initialJobs={initial}
          onSelectionChange={callback}
        />,
      ),
    );
    expect(callback).toHaveBeenLastCalledWith({
      jobs: ["PLD", "WHM"],
      valid: false,
      invalidReason: "mixed-gear-groups",
    });
    expect(initial).toEqual(["PLD", "WHM"]);
    act(() => root.unmount());
  });
  it("owns its Set while selection screen owns submit action", () => {
    const host = document.createElement("div"),
      root = createRoot(host),
      callback = vi.fn();
    act(() =>
      root.render(<JobSelection mode="joint" onSelectionChange={callback} />),
    );
    const buttons = [...host.querySelectorAll<HTMLButtonElement>("button")];
    act(() => buttons[0]!.click());
    expect(callback).toHaveBeenLastCalledWith({
      jobs: ["PLD"],
      valid: false,
      invalidReason: "too-few-jobs",
    });
    act(() => buttons[1]!.click());
    expect(callback).toHaveBeenLastCalledWith({
      jobs: ["PLD", "WAR"],
      valid: true,
      invalidReason: undefined,
    });
    expect(host.textContent).not.toContain("前往条件设置");
    act(() => root.unmount());
  });
});
