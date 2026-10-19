// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { Breadcrumbs } from "./Breadcrumbs";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("Breadcrumbs", () => {
  it("renders the route path as non-interactive text", () => {
    const host = document.createElement("div");
    const root = createRoot(host);
    act(() => root.render(<Breadcrumbs items={["实验室", "装备对比"]} />));
    const nav = host.querySelector('nav[aria-label="面包屑"]');
    expect(nav).not.toBeNull();
    expect(
      [...nav!.querySelectorAll("li")].map((item) => item.textContent),
    ).toEqual(["实验室", "装备对比"]);
    expect(nav!.querySelectorAll("a, button")).toHaveLength(0);
    expect(nav!.querySelector('[aria-current="page"]')?.textContent).toBe(
      "装备对比",
    );
    act(() => root.unmount());
  });

  it("renders nothing without path items", () => {
    const host = document.createElement("div");
    const root = createRoot(host);
    act(() => root.render(<Breadcrumbs items={[]} />));
    expect(host.querySelector('nav[aria-label="面包屑"]')).toBeNull();
    act(() => root.unmount());
  });
});
