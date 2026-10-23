import { describe, expect, it } from "vitest";
import { gameData, syncTargetJobLevel } from "@/domain";
import {
  dutyOptionCategories,
  levelOptionCategories,
} from "./sync-level-options";

describe("sync level panel options", () => {
  it("derives one item-level choice per target and groups by generated level boundaries", () => {
    expect(levelOptionCategories.map(({ id }) => Number(id))).toEqual(
      gameData.sync.levels
        .map(({ jobLevel }) => jobLevel)
        .toSorted((left, right) => right - left),
    );
    for (const category of levelOptionCategories) {
      const levels = category.options.map(({ target }) => target.value);
      expect(new Set(levels).size).toBe(levels.length);
      expect(levels).toEqual(
        [...levels].toSorted((left, right) => right - left),
      );
      expect(
        category.options.every(
          ({ target }) =>
            target.kind === "itemLevel" &&
            syncTargetJobLevel(target) === Number(category.id),
        ),
      ).toBe(true);
    }
  });

  it("uses generated group names, options, and order directly for the duty view", () => {
    expect(dutyOptionCategories.map(({ label }) => label)).toEqual(
      gameData.sync.groups.map(({ name }) => name),
    );
    for (const [index, category] of dutyOptionCategories.entries()) {
      expect(category.options).toEqual(
        gameData.sync.groups[index]!.options.map(({ name, target }) => ({
          name,
          target,
        })),
      );
    }
    const levelChoices = levelOptionCategories.flatMap(
      ({ options }) => options,
    );
    const dutyItemTargets = dutyOptionCategories
      .flatMap(({ options }) => options)
      .filter(({ target }) => target.kind === "itemLevel")
      .map(({ target }) => target.value);
    expect(
      levelChoices.map(({ target }) => target.value).toSorted((a, b) => b - a),
    ).toEqual([...new Set(dutyItemTargets)].toSorted((a, b) => b - a));
  });
});
