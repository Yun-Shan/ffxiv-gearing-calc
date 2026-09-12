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
