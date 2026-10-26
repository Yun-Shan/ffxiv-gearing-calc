// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { applicationBase } from "./application-base";

let base: HTMLBaseElement | undefined;
const originalUrl = window.location.href;
afterEach(() => {
  base?.remove();
  base = undefined;
  window.history.replaceState(null, "", originalUrl);
});

describe("application HTML base", () => {
  it("falls back to root without inferring the current route", () => {
    window.history.replaceState(null, "", "/single/conditions");
    expect(applicationBase()).toBe("/");
  });

  it("reads the explicit href on every call", () => {
    window.history.replaceState(null, "", "/app/joint/conditions");
    base = document.createElement("base");
    base.setAttribute("href", "/app/");
    document.head.append(base);
    expect(applicationBase()).toBe("/app/");
    base.setAttribute("href", "/another/");
    expect(applicationBase()).toBe("/another/");
    base.remove();
    expect(applicationBase()).toBe("/");
  });

  it.each([
    ["/配装/", "/%E9%85%8D%E8%A3%85/"],
    ["/app/../tools/", "/tools/"],
    ["/app/%2e%2e/tools/", "/tools/"],
  ])("normalizes deployment base %s to URL.pathname", (literal, pathname) => {
    base = document.createElement("base");
    base.setAttribute("href", literal);
    document.head.append(base);
    expect(applicationBase()).toBe(pathname);
  });
});
