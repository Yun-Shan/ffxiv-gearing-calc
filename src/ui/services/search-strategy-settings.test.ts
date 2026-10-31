// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { SEARCH_STRATEGY_IDS } from "@/domain/search/strategies";
import {
  getSearchStrategySettings,
  resetSearchStrategies,
  setSearchStrategy,
  subscribeSearchStrategySettings,
} from "./search-strategy-settings";

const storageKey = "ffxiv-gearing-calc:search-strategies:v1";
const expectedDefaults = Object.fromEntries(SEARCH_STRATEGY_IDS.map((id) => [id, "auto"]));

afterEach(() => {
  resetSearchStrategies();
  localStorage.removeItem(storageKey);
  localStorage.removeItem("unrelated");
  vi.restoreAllMocks();
});

describe("global search strategy settings", () => {
  it("defaults every strategy to auto and stores changes separately from search configuration", () => {
    expect(getSearchStrategySettings()).toEqual(expectedDefaults);
    setSearchStrategy("equalityQuotient", "off");
    expect(getSearchStrategySettings()).toEqual({ ...expectedDefaults, equalityQuotient: "off" });
    expect(JSON.parse(localStorage.getItem(storageKey)!)).toEqual({
      version: 1,
      strategies: { ...expectedDefaults, equalityQuotient: "off" },
    });
    expect(getSearchStrategySettings()).not.toHaveProperty("objective");
  });

  it("notifies settings subscribers and resets only these settings to auto", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeSearchStrategySettings(listener);
    setSearchStrategy("sharedStateSearch", "on");
    expect(listener).toHaveBeenCalledTimes(1);
    localStorage.setItem("unrelated", "keep");
    resetSearchStrategies();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(getSearchStrategySettings()).toEqual(expectedDefaults);
    expect(localStorage.getItem("unrelated")).toBe("keep");
    unsubscribe();
  });

  it("uses auto defaults for malformed saved data received from another tab", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeSearchStrategySettings(listener);
    localStorage.setItem(storageKey, JSON.stringify({ version: 1, strategies: { unknown: "on" } }));
    window.dispatchEvent(new StorageEvent("storage", { key: storageKey }));
    expect(getSearchStrategySettings()).toEqual(expectedDefaults);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("keeps current-tab settings when storage writes fail", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Blocked", "SecurityError");
    });
    expect(() => setSearchStrategy("candidateDominance", "off")).not.toThrow();
    expect(getSearchStrategySettings().candidateDominance).toBe("off");
  });

  it("refreshes changes made while the modal has no subscribers before the next execution", () => {
    const initial = getSearchStrategySettings();
    localStorage.setItem(storageKey, JSON.stringify({ version: 1, strategies: { equalityQuotient: "off" } }));
    window.dispatchEvent(new StorageEvent("storage", { key: storageKey }));
    const next = getSearchStrategySettings();
    expect(next.equalityQuotient).toBe("off");
    expect(next).not.toBe(initial);
    expect(getSearchStrategySettings()).toBe(next);
    const unsubscribe = subscribeSearchStrategySettings(() => {});
    expect(getSearchStrategySettings()).toBe(next);
    unsubscribe();
  });

  it("retains the current snapshot when storage reads also become unavailable", () => {
    setSearchStrategy("sharedStateSearch", "off");
    const snapshot = getSearchStrategySettings();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("Blocked"); });
    expect(getSearchStrategySettings()).toBe(snapshot);
  });
});
