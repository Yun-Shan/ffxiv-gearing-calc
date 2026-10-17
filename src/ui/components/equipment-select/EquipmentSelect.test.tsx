// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  EquipmentSelect,
  type EquipmentSelectionItem,
} from "./EquipmentSelect";

const items: EquipmentSelectionItem[] = Array.from(
  { length: 1000 },
  (_, index) => ({
    id: 100000 + index,
    slot: "head",
    name: `装备 ${index}`,
    level: 795,
  }),
);
let host: HTMLDivElement;
let root: Root;
const rows = () => [
  ...document.body.querySelectorAll<HTMLElement>('[role="option"]'),
];
const scroll = () => rows()[0]!.parentElement!.parentElement!;
const input = () => host.querySelector<HTMLInputElement>('[role="combobox"]')!;
async function open() {
  await act(async () =>
    host
      .querySelector<HTMLButtonElement>('[aria-label="打开测试装备列表"]')!
      .click(),
  );
}
async function search(value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input(), value);
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });
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

describe("virtual equipment selection", () => {
  it("mounts only a window and reaches the last item by scrolling", async () => {
    act(() =>
      root.render(
        <EquipmentSelect
          label="测试装备"
          placeholder="搜索"
          items={items}
          onSelect={() => {}}
        />,
      ),
    );
    await open();
    expect(rows().length).toBeGreaterThan(0);
    expect(rows().length).toBeLessThan(30);
    expect(rows()[0]!.getAttribute("aria-setsize")).toBe("1000");
    act(() => {
      scroll().scrollTop = 36000;
      scroll().dispatchEvent(new Event("scroll"));
    });
    expect(rows().at(-1)!.getAttribute("aria-posinset")).toBe("1000");
    expect(rows().length).toBeLessThan(30);
  });
  it("resets a scrolled window when searching and selects the matching equipment", async () => {
    const onSelect = vi.fn();
    act(() =>
      root.render(
        <EquipmentSelect
          label="测试装备"
          placeholder="搜索"
          items={items}
          onSelect={onSelect}
        />,
      ),
    );
    await open();
    act(() => {
      scroll().scrollTop = 36000;
      scroll().dispatchEvent(new Event("scroll"));
    });
    await search("装备 999");
    expect(rows()).toHaveLength(1);
    expect(rows()[0]!.getAttribute("aria-posinset")).toBe("1");
    act(() => rows()[0]!.click());
    expect(onSelect).toHaveBeenCalledWith(items[999]);
  });
  it("shows the empty state only when filtering has no results", async () => {
    act(() =>
      root.render(
        <EquipmentSelect
          label="测试装备"
          placeholder="搜索"
          items={items}
          onSelect={() => {}}
        />,
      ),
    );
    await open();
    expect(document.body.textContent).not.toContain("没有匹配的选项。");
    await search("no matches");
    expect(rows()).toHaveLength(0);
    expect(document.body.textContent).toContain("没有匹配的选项。");
    await search("装备 99");
    expect(rows().length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toContain("没有匹配的选项。");
  });
});
