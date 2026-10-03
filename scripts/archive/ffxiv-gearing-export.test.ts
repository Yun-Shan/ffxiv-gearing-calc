import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  MateriaGrade,
  Stat,
} from "../../reference/ffxiv-gearing/src/game.ts";
import {
  parseFfxivGearingGearset,
  reverseEquipmentForFfxivGearing,
  stringifyFfxivGearingGearset,
} from "./ffxiv-gearing-export.ts";
import type { EquipInfo, ParamInfo } from "./types.ts";

function equipment(
  itemId: number,
  key: string,
  baseParams: ParamInfo[],
): EquipInfo {
  return {
    itemId,
    itemLevel: 735,
    key,
    baseParams,
    PDMG: 0,
    MDMG: 0,
    DLY: 0,
  };
}

const statByBaseParam: Record<number, Stat> = {
  20: "CRT",
  21: "DHT",
  22: "DET",
};
const reverseOptions = {
  rawBaseParams: [
    { baseParamId: 1, value: 300 },
    { baseParamId: 20, value: 100 },
  ],
  materiaSlotCount: 2,
  advancedMelding: false,
  materiaGrade: 12 as MateriaGrade,
  materiaValue: () => 54,
  statForBaseParam: (baseParamId: number) => statByBaseParam[baseParamId],
};

describe("ffxiv-gearing V1 result export", () => {
  it("parses current v6 share links with the reference implementation", () => {
    const v1 = parseFfxivGearingGearset(
      "4i882LbtTACmeJKUCDy81dyZ9v1Aw5guObFtKHN8NczMgLEzx",
    );
    const v2 = parseFfxivGearingGearset(
      "lSjupmNs6WXHsTOWguedIb45D1sGglsb96lRYNJDumDc1J1DYT",
    );

    assert.notEqual(typeof v1, "string");
    assert.notEqual(typeof v2, "string");
    if (typeof v1 === "string" || typeof v2 === "string") return;

    assert.deepEqual(
      {
        job: v1.job,
        jobLevel: v1.jobLevel,
        syncLevel: v1.syncLevel,
        gearIds: v1.gears.map(({ id }) => id).sort((a, b) => a - b),
      },
      {
        job: "RDM",
        jobLevel: 100,
        syncLevel: 735,
        gearIds: [
          43076, 43090, 43100, 43154, 43162, 43172, 43177, 47140, 47141,
          47142, 49240, 51014,
        ],
      },
    );
    assert.deepEqual(
      {
        job: v2.job,
        jobLevel: v2.jobLevel,
        syncLevel: v2.syncLevel,
        gearIds: v2.gears.map(({ id }) => id).sort((a, b) => a - b),
      },
      {
        job: "RDM",
        jobLevel: 100,
        syncLevel: 735,
        gearIds: [
          43076, 43090, 43100, 43154, 43162, 43172, 43177, 47140, 47141,
          47142, 49240, 51014,
        ],
      },
    );

    const configuredStatTotals = (gearset: typeof v1) => {
      const totals: Partial<Record<Stat, number>> = {};
      const add = (stat: Stat, value: number) => {
        totals[stat] = (totals[stat] ?? 0) + value;
      };
      for (const gear of gearset.gears) {
        for (const [stat, value] of Object.entries(gear.customStats ?? {})) {
          add(stat as Stat, value);
        }
        for (const materia of gear.materias) {
          if (materia === null) continue;
          const [stat, grade] = materia;
          assert.equal(grade, 12);
          add(stat, 54);
        }
      }
      return totals;
    };
    assert.deepEqual(configuredStatTotals(v1), {
      CRT: 771,
      DET: 879,
      DHT: 432,
    });
    assert.deepEqual(configuredStatTotals(v2), {
      CRT: 771,
      DET: 486,
      DHT: 663,
      SPS: 108,
    });
  });

  it("reverses a normal equipment result into materia slots", () => {
    const result = reverseEquipmentForFfxivGearing(
      equipment(1000, "normal", [
        { baseParamId: 1, value: 300 },
        { baseParamId: 20, value: 154 },
        { baseParamId: 22, value: 54 },
      ]),
      reverseOptions,
    );

    assert.deepEqual(result, {
      id: 1000,
      materias: [
        ["CRT", 12],
        ["DET", 12],
      ],
    });
  });

  it("exports synced equipment without materia", () => {
    const result = reverseEquipmentForFfxivGearing(
      equipment(1001, "synced", [
        { baseParamId: 1, value: 280 },
        { baseParamId: 20, value: 90 },
      ]),
      { ...reverseOptions, materiaGrade: undefined },
    );

    assert.deepEqual(result, { id: 1001, materias: [] });
  });

  it("uniquely matches a projected custom weapon candidate", () => {
    const selectedCandidate = equipment(51014, "custom-a", [
      { baseParamId: 1, value: 300 },
      { baseParamId: 20, value: 100 },
      { baseParamId: 21, value: 300 },
      { baseParamId: 22, value: 100 },
    ]);
    const otherCandidate = equipment(51014, "custom-b", [
      { baseParamId: 1, value: 300 },
      { baseParamId: 20, value: 100 },
      { baseParamId: 21, value: 100 },
      { baseParamId: 22, value: 300 },
    ]);
    const project = (candidate: EquipInfo): ParamInfo[] =>
      candidate.baseParams.map((param) => ({
        ...param,
        value: Math.min(param.value, 200),
      }));

    const result = reverseEquipmentForFfxivGearing(
      equipment(51014, "custom-a", project(selectedCandidate)),
      {
        ...reverseOptions,
        customCandidates: [selectedCandidate, otherCandidate],
        projectCustomCandidate: project,
      },
    );

    assert.deepEqual(result, {
      id: 51014,
      materias: [],
      customStats: { DHT: 300, DET: 100 },
    });
  });

  it("rejects materia increments that are not whole materia values", () => {
    assert.throws(
      () =>
        reverseEquipmentForFfxivGearing(
          equipment(1002, "invalid", [
            { baseParamId: 1, value: 300 },
            { baseParamId: 20, value: 155 },
            { baseParamId: 22, value: 54 },
          ]),
          reverseOptions,
        ),
      /增量 55 无法按魔晶石值 54 反解/,
    );
  });

  it("rejects custom equipment without a unique source candidate", () => {
    const duplicate = equipment(51014, "duplicate", [
      { baseParamId: 1, value: 300 },
      { baseParamId: 20, value: 100 },
      { baseParamId: 21, value: 300 },
    ]);
    assert.throws(
      () =>
        reverseEquipmentForFfxivGearing(duplicate, {
          ...reverseOptions,
          customCandidates: [duplicate, { ...duplicate }],
        }),
      /无法唯一反解：匹配 2 个候选/,
    );
  });

  it("round-trips through the reference project's share implementation", () => {
    const encoded = stringifyFfxivGearingGearset({
      job: "RDM",
      jobLevel: 100,
      syncLevel: 735,
      gears: [
        { id: 43100, materias: [["CRT", 12]] },
        {
          id: 51014,
          materias: [],
          customStats: { CRT: 376, DET: 376, DHT: 188 },
        },
        { id: 49240, materias: [] },
      ],
    });

    assert.deepEqual(parseFfxivGearingGearset(encoded), {
      job: "RDM",
      jobLevel: 100,
      syncLevel: 735,
      gears: [
        { id: 43100, materias: [["CRT", 12]], customStats: undefined },
        {
          id: 49240,
          materias: [],
          customStats: undefined,
        },
        {
          id: 51014,
          materias: [],
          customStats: { CRT: 376, DET: 376, DHT: 188 },
        },
      ],
    });
  });
});
