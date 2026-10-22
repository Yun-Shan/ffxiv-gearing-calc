// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { navigateTo, routeHref, subscribeNavigation } from "./navigation";

afterEach(() => {
  vi.unstubAllEnvs();
  window.history.replaceState(null, "", "/");
});

it("keeps root-hosted navigation paths", () => {
  vi.stubEnv("BASE_URL", "/");
  vi.stubEnv("VITE_PAGES", "false");
  expect(routeHref("/lab")).toBe("/lab");
});

it("uses hash links on Pages with a custom domain", () => {
  vi.stubEnv("BASE_URL", "/");
  vi.stubEnv("VITE_PAGES", "true");
  expect(routeHref("/lab")).toBe("/#/lab");
});

it("preserves the Pages entry path and notifies navigation listeners", () => {
  vi.stubEnv("BASE_URL", "/ffxiv-gearing-calc/");
  window.history.replaceState(null, "", "/ffxiv-gearing-calc/");
  const listener = vi.fn();
  const unsubscribe = subscribeNavigation(listener);
  try {
    navigateTo("/gear-comparison");
    expect(window.location.pathname).toBe("/ffxiv-gearing-calc/");
    expect(window.location.hash).toBe("#/gear-comparison");
    expect(listener).toHaveBeenCalledOnce();
  } finally {
    unsubscribe();
  }
});
