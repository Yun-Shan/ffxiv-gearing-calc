// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NumberInput } from "./NumberInput";

let host: HTMLDivElement;
let root: Root;
const input = () =>
  host.querySelector<HTMLInputElement>('input:not([aria-hidden="true"])')!;
function type(value: string) {
  act(() => {
    input().focus();
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input(), value);
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const tick = (ms: number) => act(() => vi.advanceTimersByTime(ms));
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("number input deferred commit", () => {
  it("updates the display immediately and submits only after 1.5 seconds without further input", () => {
    const onChange = vi.fn();
    act(() =>
      root.render(
        <NumberInput
          label="范围"
          value={780}
          debounceMs={1500}
          onChange={onChange}
        />,
      ),
    );
    type("790");
    expect(input().value).toBe("790");
    tick(1000);
    expect(onChange).not.toHaveBeenCalled();
    type("795");
    tick(1499);
    expect(onChange).not.toHaveBeenCalled();
    tick(1);
    expect(onChange.mock.calls).toEqual([[795]]);
    act(() => input().blur());
    expect(onChange).toHaveBeenCalledTimes(1);
  });
  it.each(["795", ""])(
    "flushes %j on blur and cancels its delayed commit",
    (value) => {
      const onChange = vi.fn();
      act(() =>
        root.render(
          <NumberInput
            label="范围"
            value={780}
            debounceMs={1500}
            onChange={onChange}
          />,
        ),
      );
      type(value);
      expect(onChange).not.toHaveBeenCalled();
      act(() => input().blur());
      expect(onChange.mock.calls).toEqual([[value === "" ? null : 795]]);
      tick(1500);
      expect(onChange).toHaveBeenCalledTimes(1);
    },
  );
  it("discards a pending edit when the external value is replaced or the input becomes disabled", () => {
    const onChange = vi.fn();
    const render = (value: number, disabled = false) =>
      act(() =>
        root.render(
          <NumberInput
            label="范围"
            value={value}
            disabled={disabled}
            debounceMs={1500}
            onChange={onChange}
          />,
        ),
      );
    render(780);
    type("795");
    render(790);
    expect(input().value).toBe("790");
    tick(1500);
    expect(onChange).not.toHaveBeenCalled();
    type("800");
    render(790, true);
    tick(1500);
    expect(onChange).not.toHaveBeenCalled();
  });
  it("uses the latest change handler and discards pending commits on unmount", () => {
    const first = vi.fn();
    const latest = vi.fn();
    act(() =>
      root.render(
        <NumberInput
          label="范围"
          value={780}
          debounceMs={1500}
          onChange={first}
        />,
      ),
    );
    type("795");
    act(() =>
      root.render(
        <NumberInput
          label="范围"
          value={780}
          debounceMs={1500}
          onChange={latest}
        />,
      ),
    );
    tick(1500);
    expect(first).not.toHaveBeenCalled();
    expect(latest.mock.calls).toEqual([[795]]);
    type("800");
    act(() => root.render(null));
    tick(1500);
    expect(latest).toHaveBeenCalledTimes(1);
  });
  it("keeps immediate updates by default", () => {
    const onChange = vi.fn();
    act(() =>
      root.render(
        <NumberInput label="其他数字" value={780} onChange={onChange} />,
      ),
    );
    type("795");
    expect(onChange).toHaveBeenCalledWith(795);
  });
});
