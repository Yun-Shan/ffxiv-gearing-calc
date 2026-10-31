import { describe, expect, it } from "vitest";
import { SEARCH_STRATEGY_IDS, normalizeSearchStrategies, strategyEnabled } from "./strategies.ts";

describe("search execution strategies", () => {
  it("defaults every optional optimization to auto and snapshots caller settings", () => {
    const defaults = normalizeSearchStrategies();
    expect(Object.keys(defaults)).toEqual([...SEARCH_STRATEGY_IDS]);
    expect(Object.values(defaults).every((mode) => mode === "auto")).toBe(true);
    const input = { sharedStateSearch: "off" as const };
    const settings = normalizeSearchStrategies(input);
    Object.assign(input, { sharedStateSearch: "on" });
    expect(settings.sharedStateSearch).toBe("off");
    expect(settings.equalityQuotient).toBe("auto");
    expect(Object.isFrozen(settings)).toBe(true);
  });

  it.each(SEARCH_STRATEGY_IDS)("applies all three routing modes independently for %s", (id) => {
    expect(strategyEnabled(undefined, id, false)).toBe(false);
    expect(strategyEnabled({ [id]: "auto" }, id, true)).toBe(true);
    expect(strategyEnabled({ [id]: "auto" }, id, false)).toBe(false);
    expect(strategyEnabled({ [id]: "on" }, id, false)).toBe(true);
    expect(strategyEnabled({ [id]: "off" }, id, true)).toBe(false);
    expect(normalizeSearchStrategies({ [id]: "off" })[id]).toBe("off");
  });

  it.each([null, [], true, "off", 1, { unknown: "auto" }, { sharedStateSearch: true }, { equalityQuotient: undefined }])(
    "rejects invalid strategy settings %j", (value) => {
      expect(() => normalizeSearchStrategies(value)).toThrow(TypeError);
    },
  );
});
