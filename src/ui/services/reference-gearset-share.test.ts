import { describe, expect, it } from "vitest";
import type {
  MeldedGear,
  OptimizationConfig,
  OptimizationResult,
} from "@/domain";
import { foods, gears } from "@/domain";
import {
  parseReferenceGearset,
  resultReferenceUrl,
  stringifyReferenceGearset,
} from "./reference-gearset-share";

describe("reference gearset share compatibility", () => {
  it("exports synchronized result rings by their slots even when the result array has another order", () => {
    const rings = gears
      .filter(
        (gear) =>
          gear.slot === "ring" && gear.jobs.includes("SAM") && gear.level > 660,
      )
      .slice(0, 2)
      .sort((a, b) => a.id - b.id);
    expect(rings).toHaveLength(2);
    const result = {
      calculationLevel: 100,
      food: foods[0]!,
      gear: rings.map((gear, index) => ({
        ...gear,
        slot: index === 0 ? "ring2" : "ring",
        melds: [{ stat: "CRT", grade: 12, value: 36 }],
        finalStats: {},
      })),
    } as OptimizationResult;
    const parsed = parseReferenceGearset(
      resultReferenceUrl(result, {
        jobId: "SAM",
        syncLevel: 660,
      } as OptimizationConfig)!,
    );
    expect(parsed.gears.map((gear) => gear.id)).toEqual([
      rings[1]!.id,
      rings[0]!.id,
    ]);
    expect(parsed.gears.every((gear) => gear.materias.length === 0)).toBe(true);
    expect(parsed.foodId).toBe(result.food.id);
  });
  it.each([undefined, 660])(
    "preserves swapped empty rings with food at sync %s",
    (syncLevel) => {
      const rings = gears
        .filter((gear) => gear.slot === "ring" && gear.jobs.includes("SAM"))
        .slice(0, 2)
        .sort((a, b) => a.id - b.id);
      expect(rings).toHaveLength(2);
      const payloads = [rings, [...rings].reverse()].map((ordered) => {
        const input = {
          job: "SAM" as const,
          role: "str" as const,
          jobLevel: 100,
          syncLevel,
          foodId: foods[0]!.id,
          gears: ordered.map((gear) => ({ id: gear.id, materias: [] })),
        };
        const payload = stringifyReferenceGearset(input)!;
        const parsed = parseReferenceGearset(payload);
        expect(parsed.gears.map((gear) => gear.id)).toEqual(
          ordered.map((gear) => gear.id),
        );
        expect(parsed.gears.every((gear) => gear.materias.length === 0)).toBe(
          true,
        );
        expect(parsed.foodId).toBe(input.foodId);
        expect(parsed.syncLevel).toBe(syncLevel);
        return payload;
      });
      expect(payloads[0]).not.toBe(payloads[1]);
    },
  );
  it("preserves empty sockets and the original materia positions", () => {
    const gearset = {
      job: "SAM" as const,
      role: "str" as const,
      jobLevel: 100,
      gears: [
        {
          id: 42001,
          materias: [null, ["CRT", 12], null, ["DET", 9], null] as const,
        },
      ],
    };
    const parsed = parseReferenceGearset(stringifyReferenceGearset(gearset)!);
    expect(parsed.gears).toEqual(gearset.gears);
  });

  // 基准字符串已与 Asvel/ffxiv-gearing 的提交逐字节比对：
  // 048376fb6c6c6538a482eba5f76128d985958fa0；测试不依赖被忽略的本地副本。
  it.each([
    [660, "2OOvPWohS7itc5QuD"],
    [130, "2OOvPWohS7itb02ld"],
  ])(
    "encodes a level 100 Samurai with sync level %i",
    (syncLevel, expected) => {
      const gearset = {
        job: "SAM" as const,
        role: "str" as const,
        jobLevel: 100,
        syncLevel,
        gears: [
          {
            id: 42001,
            materias: [
              ["CRT", 12],
              ["DET", 11],
            ] as const,
          },
          { id: 42008, materias: [] },
          { id: 42013, materias: [["SKS", 10]] as const },
        ],
      };
      expect(stringifyReferenceGearset(gearset)).toBe(expected);
    },
  );

  it("retains customizable weapon parameters in the upstream encoding", () => {
    const gearset = {
      job: "PLD" as const,
      role: "tank" as const,
      jobLevel: 100,
      gears: [{ id: 42001, materias: [], customStats: { CRT: 72, DET: 36 } }],
    };
    expect(stringifyReferenceGearset(gearset)).toBe("7tM6ar4jjt5Ln4QOqG1");
  });

  it("encodes BST with the upstream v6 job index", () => {
    const gearset = {
      job: "BST" as const,
      role: "str" as const,
      jobLevel: 50,
      gears: [
        { id: 2228, materias: [] },
        {
          id: 2630,
          materias: [
            ["CRT", 12],
            ["SKS", 11],
          ] as const,
        },
        { id: 2999, materias: [] },
      ],
    };
    expect(stringifyReferenceGearset(gearset)).toBe("1997WKuo5hrggLRU1");
    expect(parseReferenceGearset("1997WKuo5hrggLRU1")).toMatchObject({
      job: "BST",
      role: "str",
      jobLevel: 50,
      gears: [{ id: 2228 }, { id: 2630 }, { id: 2999 }],
    });
  });

  it("includes food as an encoded gear entry", () => {
    const withoutFood = stringifyReferenceGearset({
      job: "SAM",
      role: "str",
      jobLevel: 100,
      gears: [{ id: 42001, materias: [] }],
    });
    const withFood = stringifyReferenceGearset({
      job: "SAM",
      role: "str",
      jobLevel: 100,
      gears: [{ id: 42001, materias: [] }],
      foodId: 49240,
    });
    const foodOnly = stringifyReferenceGearset({
      job: "SAM",
      role: "str",
      jobLevel: 100,
      gears: [],
      foodId: 49240,
    });
    expect(withFood).toBeDefined();
    expect(foodOnly).toBeDefined();
    expect(withFood).not.toBe(withoutFood);
    expect(parseReferenceGearset(foodOnly!)).toMatchObject({
      job: "SAM",
      gears: [],
      foodId: 49240,
    });
    expect(parseReferenceGearset(withFood!)).toMatchObject({
      gears: [{ id: 42001 }],
      foodId: 49240,
    });
  });

  it("parses Asvel URLs, saved melds, and synchronized job level", () => {
    const payload = stringifyReferenceGearset({
      job: "SAM",
      role: "str",
      jobLevel: 100,
      syncLevel: 660,
      gears: [
        {
          id: 42001,
          materias: [
            ["CRT", 12],
            ["DET", 11],
          ],
        },
        { id: 42008, materias: [] },
        { id: 42013, materias: [["SKS", 10]] },
      ],
    });
    const parsed = parseReferenceGearset(
      `https://asvel.github.io/ffxiv-gearing/?${payload}`,
    );
    expect(parsed).toMatchObject({
      job: "SAM",
      jobLevel: 100,
      syncLevel: 660,
    });
    expect(
      parsed.gears
        .map(({ id, materias }) => [id, materias])
        .sort(([leftId], [rightId]) => Number(leftId) - Number(rightId)),
    ).toEqual([
      [
        42001,
        [
          ["CRT", 12],
          ["DET", 11],
        ],
      ],
      [42008, []],
      [42013, [["SKS", 10]]],
    ]);
  });

  it("round-trips a current catalog food without fabricating a gear", () => {
    const foodId = foods[0]!.id;
    const payload = stringifyReferenceGearset({
      job: "PLD",
      role: "tank",
      jobLevel: 100,
      gears: [],
      foodId,
    });
    expect(parseReferenceGearset(payload!)).toMatchObject({
      job: "PLD",
      gears: [],
      foodId,
    });
  });

  it("rejects malformed and unsupported links", () => {
    expect(() => parseReferenceGearset("not-a-link")).toThrow("有效的 Asvel");
    expect(() => parseReferenceGearset("https://example.com/?123")).toThrow(
      "不是受支持的 Asvel",
    );
  });

  it("builds a Result URL with saved food and synchronized gear semantics", () => {
    const weapon = {
      id: 42001,
      slot: "weapon",
      level: 700,
      melds: [{ stat: "CRT", grade: 12, value: 36 }],
      customParameters: undefined,
      resistanceWeaponAdjust: undefined,
      finalStats: { CRT: 36 },
      stats: { CRT: 0 },
    } as unknown as MeldedGear;
    const result = {
      calculationLevel: 100,
      gear: [weapon],
      food: { id: 49240 },
    } as OptimizationResult;
    const config = { jobId: "SAM", syncLevel: 660 } as OptimizationConfig;
    const payload = stringifyReferenceGearset({
      job: "SAM",
      role: "str",
      jobLevel: 100,
      syncLevel: 660,
      gears: [{ id: 42001, materias: [] }],
      foodId: 49240,
    });
    expect(resultReferenceUrl(result, config)).toBe(
      `https://asvel.github.io/ffxiv-gearing/?${payload}`,
    );
  });

  it("exports original custom allocations even when synchronization capped the result", () => {
    const weapon = {
      id: 42001,
      level: 700,
      equipLevel: 90,
      stats: { CRT: 100, DET: 20 },
      finalStats: { CRT: 50, DET: 50 },
      customParameters: [{ stat: "CRT" }, { stat: "DET" }],
      melds: [
        { stat: "CRT", grade: 0, value: 72 },
        { stat: "DET", grade: 0, value: 36 },
      ],
    } as unknown as MeldedGear;
    const result = {
      calculationLevel: 100,
      gear: [weapon],
      food: foods[0]!,
    } as OptimizationResult;
    const url = resultReferenceUrl(result, {
      jobId: "SAM",
      syncLevel: 660,
    } as OptimizationConfig)!;
    expect(parseReferenceGearset(url).gears[0]!.customStats).toEqual({
      CRT: 172,
      DET: 56,
    });
  });

  it("exports empty materia sockets using saved slot indices", () => {
    const weapon = {
      id: 42001,
      level: 700,
      equipLevel: 90,
      stats: {},
      finalStats: {},
      melds: [{ stat: "CRT", grade: 9, value: 12, slotIndex: 2 }],
    } as unknown as MeldedGear;
    const result = {
      calculationLevel: 100,
      gear: [weapon],
      food: foods[0]!,
    } as OptimizationResult;
    const url = resultReferenceUrl(result, {
      jobId: "SAM",
    } as OptimizationConfig)!;
    expect(parseReferenceGearset(url).gears[0]!.materias).toEqual([
      null,
      null,
      ["CRT", 9],
    ]);
  });
});
