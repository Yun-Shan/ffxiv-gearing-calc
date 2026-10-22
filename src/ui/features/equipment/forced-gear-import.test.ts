import { describe, expect, it } from "vitest";
import {
  gameData,
  gearOptionsFor,
  gears,
  jobSchemas,
  type Gear,
  type GearSlot,
  type JobId,
  type Materia,
} from "@/domain";
import { prepareCustomEquipmentParameters } from "@/domain/custom-equipment-parameters";
import { makeConfig } from "@/ui/services/app-config";
import { stringifyReferenceGearset } from "@/ui/services/reference-gearset-share";
import { equipmentGearCatalog } from "./catalog";
import { prepareForcedGearImport } from "./forced-gear-import";

function gearFor(job: JobId, slot: GearSlot) {
  const config = makeConfig(job);
  const gear = gearOptionsFor(config, slot)[0];
  if (!gear) throw new Error(`Missing ${job} ${slot} fixture`);
  return gear;
}

function link(
  job: JobId,
  entries: {
    gear: Gear;
    materias?: (readonly [Materia["stat"], number] | null)[];
    customStats?: Record<string, number>;
    slot?: GearSlot;
  }[],
) {
  return stringifyReferenceGearset({
    job,
    role: jobSchemas[job].role,
    jobLevel: 100,
    gears: entries.map(({ gear, materias = [], customStats, slot }) => ({
      id: gear.id,
      materias,
      ...(customStats === undefined ? {} : { customStats }),
      ...(slot === undefined ? {} : { slot }),
    })),
  })!;
}

function options(job: JobId, allowedSlots: GearSlot[], gearList: Gear[]) {
  return {
    allowedJobs: [job],
    allowedSlots,
    catalog: equipmentGearCatalog(gearList, allowedSlots),
    config: { jobId: job },
  } as const;
}

describe("prepare forced gear import", () => {
  it("accepts a different link job when the gear is compatible with the selected job", () => {
    const head = gears.find(
      (gear) =>
        gear.slot === "head" &&
        gear.jobs.includes("PLD") &&
        gear.jobs.includes("WAR"),
    );
    if (!head) throw new Error("Missing shared tank head fixture");
    const result = prepareForcedGearImport(
      link("PLD", [{ gear: head }]),
      options("WAR", ["head"], [head]),
    );
    expect(result.jobId).toBe("PLD");
    expect(result.entries.map(({ gear }) => gear.id)).toEqual([head.id]);
    expect(result.restrictedGear).toEqual([]);
  });

  it("skips gear incompatible with one shared job and keeps eligible entries", () => {
    const restrictedHead = gears.find(
      (gear) =>
        gear.slot === "head" &&
        gear.jobs.includes("PLD") &&
        !gear.jobs.includes("WAR"),
    );
    const sharedHead = gears.find(
      (gear) =>
        gear.slot === "head" &&
        gear.jobs.includes("PLD") &&
        gear.jobs.includes("WAR"),
    );
    if (!restrictedHead || !sharedHead) {
      throw new Error("Missing compatible and incompatible tank head fixtures");
    }
    const result = prepareForcedGearImport(
      link("PLD", [{ gear: restrictedHead }, { gear: sharedHead }]),
      {
        ...options("PLD", ["head"], [restrictedHead, sharedHead]),
        allowedJobs: ["PLD", "WAR"],
      },
    );
    expect(result.entries.map(({ gear }) => gear.id)).toEqual([sharedHead.id]);
    expect(result.restrictedGear).toEqual([
      {
        id: restrictedHead.id,
        name: restrictedHead.name,
        reason: "不适用于选中的职业：WAR。",
      },
    ]);
  });

  it("silently keeps only shared slots for joint shared scope", () => {
    const head = gearFor("PLD", "head");
    const ring = gearFor("PLD", "ring");
    const result = prepareForcedGearImport(
      link("PLD", [{ gear: head }, { gear: ring }]),
      {
        ...options("PLD", ["head"], [head]),
        allowedJobs: ["PLD", "WAR"],
      },
    );
    expect(result.entries.map(({ slot }) => slot)).toEqual(["head"]);
    expect(result.forces).toEqual({ head: head.id });
  });

  it("silently keeps only private slots for a matching joint job", () => {
    const head = gearFor("PLD", "head");
    const ring = gearFor("PLD", "ring");
    const result = prepareForcedGearImport(
      link("PLD", [{ gear: ring }, { gear: head }]),
      options("PLD", ["head"], [head]),
    );
    expect(result.entries.map(({ slot }) => slot)).toEqual(["head"]);
  });

  it("silently ignores incompatible gear in an out-of-scope slot", () => {
    const restrictedRing = gears.find(
      (gear) =>
        gear.slot === "ring" &&
        gear.jobs.includes("PLD") &&
        !gear.jobs.includes("WAR"),
    );
    const head = gears.find(
      (gear) =>
        gear.slot === "head" &&
        gear.jobs.includes("PLD") &&
        gear.jobs.includes("WAR"),
    );
    if (!restrictedRing || !head) {
      throw new Error("Missing restricted ring and shared head fixtures");
    }
    const result = prepareForcedGearImport(
      link("PLD", [{ gear: restrictedRing }, { gear: head }]),
      {
        ...options("PLD", ["head"], [head]),
        allowedJobs: ["PLD", "WAR"],
      },
    );
    expect(result.entries.map(({ gear }) => gear.id)).toEqual([head.id]);
    expect(result.restrictedGear).toEqual([]);
  });

  it("skips catalog-ineligible gear with a restriction warning", () => {
    const head = gearFor("PLD", "head");
    const result = prepareForcedGearImport(link("PLD", [{ gear: head }]), {
      ...options("PLD", ["head"], [head]),
      catalog: equipmentGearCatalog([head], ["head"], { head: [] }),
    });
    expect(result.entries).toEqual([]);
    expect(result.forces).toEqual({});
    expect(result.restrictedGear).toEqual([
      {
        id: head.id,
        name: head.name,
        reason: "不符合当前head部位的可选条件。",
      },
    ]);
  });

  it("assigns ring positions in the source ordering before filtering scope", () => {
    const rings = gears
      .filter((gear) => gear.slot === "ring" && gear.jobs.includes("PLD"))
      .slice(0, 2);
    expect(rings).toHaveLength(2);
    const result = prepareForcedGearImport(
      link("PLD", [{ gear: rings[0]! }, { gear: rings[1]! }]),
      options("PLD", ["ring", "ring2"], rings),
    );
    expect(result.entries.map(({ slot, gear }) => [slot, gear.id])).toEqual([
      ["ring", rings[0]!.id],
      ["ring2", rings[1]!.id],
    ]);
  });

  it("orders imported entries by the selected job's canonical slot order", () => {
    const head = gearFor("PLD", "head");
    const body = gearFor("PLD", "body");
    const result = prepareForcedGearImport(
      link("PLD", [{ gear: body }, { gear: head }]),
      options("PLD", ["body", "head"], [body, head]),
    );
    expect(result.entries.map(({ slot }) => slot)).toEqual(["head", "body"]);
  });

  it("preserves share materia values and physical holes", () => {
    const gear = gears.find(
      (item) =>
        item.jobs.includes("PLD") &&
        item.slot === "head" &&
        item.materiaSlots >= 2 &&
        item.level >= 100,
    )!;
    const gradeIndex = gameData.materiaGradeRequiredLevels.findLastIndex(
      (level) => level <= gear.level,
    );
    const grade = gradeIndex + 1;
    const result = prepareForcedGearImport(
      link("PLD", [
        {
          gear,
          materias: [["CRT", grade], null],
        },
      ]),
      options("PLD", ["head"], [gear]),
    );
    const value = result.forces.head;
    expect(typeof value).not.toBe("number");
    if (value !== undefined && typeof value !== "number" && "melds" in value) {
      expect(value.melds).toEqual([
        { stat: "CRT", grade, value: gameData.materias.CRT![grade - 1] },
        null,
        ...Array.from(
          { length: (gear.materiaAdvanced ? 5 : gear.materiaSlots) - 2 },
          () => null,
        ),
      ]);
    }
  });

  it("converts imported materia above the gear's legal grade to auto", () => {
    const highestGrade = gameData.materiaGradeRequiredLevels.length;
    const highestGradeLevel =
      gameData.materiaGradeRequiredLevels[highestGrade - 1]!;
    const gear = gears.find(
      (item) =>
        item.jobs.includes("PLD") &&
        item.slot === "head" &&
        item.materiaSlots > 0 &&
        item.level < highestGradeLevel,
    );
    if (!gear) throw new Error("Missing low-level PLD head fixture");
    const payload = link("PLD", [{ gear, materias: [["CRT", highestGrade]] }]);
    const result = prepareForcedGearImport(
      payload,
      options("PLD", ["head"], [gear]),
    );
    expect(result.entries.map(({ gear: imported }) => imported.id)).toEqual([
      gear.id,
    ]);
    expect(result.restrictedGear).toEqual([]);
    const value = result.forces.head;
    expect(typeof value).not.toBe("number");
    if (value !== undefined && typeof value !== "number" && "melds" in value) {
      expect(value.melds[0]).toBeNull();
    }
  });

  it("converts source-role materia unsupported by the selected job to auto", () => {
    const gear = gears.find(
      (item) =>
        item.slot === "earrings" &&
        item.jobs.includes("PLD") &&
        item.jobs.includes("WHM") &&
        item.materiaSlots > 0,
    );
    if (!gear) throw new Error("Missing all-jobs earring fixture");
    const gradeIndex = gameData.materiaGradeRequiredLevels.findLastIndex(
      (level) => level <= gear.level,
    );
    if (gradeIndex < 0) throw new Error("Missing usable materia grade");
    const result = prepareForcedGearImport(
      link("PLD", [{ gear, materias: [["TEN", gradeIndex + 1]] }]),
      options("WHM", ["earrings"], [gear]),
    );
    expect(result.entries.map(({ gear: imported }) => imported.id)).toEqual([
      gear.id,
    ]);
    expect(result.restrictedGear).toEqual([]);
    const value = result.forces.earrings;
    expect(value).not.toBe(gear.id);
    if (value !== undefined && typeof value !== "number" && "melds" in value) {
      expect(value.melds[0]).toBeNull();
    }
  });

  it("keeps other valid meld positions when one imported stat becomes auto", () => {
    const gear = gears.find(
      (item) =>
        item.slot === "head" &&
        item.jobs.includes("PLD") &&
        item.jobs.includes("WHM") &&
        item.materiaSlots >= 2,
    );
    if (!gear) throw new Error("Missing two-slot all-jobs head fixture");
    const gradeIndex = gameData.materiaGradeRequiredLevels.findLastIndex(
      (level) => level <= gear.level,
    );
    if (gradeIndex < 0) throw new Error("Missing usable materia grade");
    const grade = gradeIndex + 1;
    const result = prepareForcedGearImport(
      link("PLD", [
        {
          gear,
          materias: [
            ["TEN", grade],
            ["CRT", grade],
          ],
        },
      ]),
      options("WHM", ["head"], [gear]),
    );
    const value = result.forces.head;
    expect(value).not.toBe(gear.id);
    if (value !== undefined && typeof value !== "number" && "melds" in value) {
      expect(value.melds.slice(0, 2)).toEqual([
        null,
        { stat: "CRT", grade, value: gameData.materias.CRT![gradeIndex] },
      ]);
    }
    expect(result.restrictedGear).toEqual([]);
  });

  it("ignores encoded melds beyond the gear's available hole count", () => {
    const gear = gears.find(
      (item) =>
        item.slot === "head" &&
        item.jobs.includes("PLD") &&
        item.materiaAdvanced !== true &&
        item.materiaSlots === 2,
    );
    if (!gear) throw new Error("Missing two-hole PLD head fixture");
    const gradeIndex = gameData.materiaGradeRequiredLevels.findLastIndex(
      (level) => level <= gear.level,
    );
    if (gradeIndex < 0) throw new Error("Missing usable materia grade");
    const grade = gradeIndex + 1;
    const result = prepareForcedGearImport(
      link("PLD", [
        {
          gear,
          materias: [
            ["CRT", grade],
            ["DET", grade],
            ["DHT", grade],
          ],
        },
      ]),
      options("PLD", ["head"], [gear]),
    );
    const value = result.forces.head;
    expect(value).not.toBe(gear.id);
    if (value !== undefined && typeof value !== "number" && "melds" in value) {
      expect(value.melds).toHaveLength(2);
      expect(value.melds.map((meld) => meld?.stat ?? null)).toEqual([
        "CRT",
        "DET",
      ]);
    }
  });

  it("preserves healer PIE and tank TEN as supported forced materia", () => {
    const healerGear = gears.find(
      (item) =>
        item.slot === "head" &&
        item.jobs.includes("WHM") &&
        item.materiaSlots > 0,
    );
    const tankGear = gears.find(
      (item) =>
        item.slot === "head" &&
        item.jobs.includes("PLD") &&
        item.materiaSlots > 0,
    );
    if (!healerGear || !tankGear) {
      throw new Error("Missing healer and tank head fixtures");
    }
    const healerGradeIndex = gameData.materiaGradeRequiredLevels.findLastIndex(
      (level) => level <= healerGear.level,
    );
    const tankGradeIndex = gameData.materiaGradeRequiredLevels.findLastIndex(
      (level) => level <= tankGear.level,
    );
    if (healerGradeIndex < 0 || tankGradeIndex < 0) {
      throw new Error("Missing usable healer or tank materia grade");
    }
    const healer = prepareForcedGearImport(
      link("WHM", [
        { gear: healerGear, materias: [["PIE", healerGradeIndex + 1]] },
      ]),
      options("WHM", ["head"], [healerGear]),
    );
    const tank = prepareForcedGearImport(
      link("PLD", [
        { gear: tankGear, materias: [["TEN", tankGradeIndex + 1]] },
      ]),
      options("PLD", ["head"], [tankGear]),
    );
    const healerValue = healer.forces.head;
    const tankValue = tank.forces.head;
    expect(typeof healerValue).not.toBe("number");
    expect(typeof tankValue).not.toBe("number");
    if (
      healerValue !== undefined &&
      typeof healerValue !== "number" &&
      "melds" in healerValue &&
      tankValue !== undefined &&
      typeof tankValue !== "number" &&
      "melds" in tankValue
    ) {
      expect(healerValue.melds[0]?.stat).toBe("PIE");
      expect(tankValue.melds[0]?.stat).toBe("TEN");
    }
  });

  it("preserves validated custom weapon parameters", () => {
    const gear = gears.find((item) => item.id === 39920)!;
    const model = prepareCustomEquipmentParameters(gear, "PLD");
    if (model.kind !== "manderville")
      throw new Error("Expected a Manderville weapon");
    const parameters = model.attributes;
    const stats = Object.fromEntries([
      [parameters[0]!.stat, parameters[0]!.base + parameters[0]!.bigValue],
      [parameters[1]!.stat, parameters[1]!.base + parameters[1]!.bigValue],
      [parameters[2]!.stat, parameters[2]!.base + parameters[2]!.smallValue],
      [parameters[3]!.stat, parameters[3]!.base],
    ]);
    const result = prepareForcedGearImport(
      link("PLD", [{ gear, customStats: stats }]),
      options("PLD", ["weapon"], [gear]),
    );
    expect(result.forces.weapon).toEqual({
      id: gear.id,
      customStats: Object.fromEntries(
        Object.entries(stats).filter(([, value]) => value !== 0),
      ),
    });
  });

  it("skips unknown item IDs and reports them alongside known entries", () => {
    const head = gearFor("PLD", "head");
    const payload = stringifyReferenceGearset({
      job: "PLD",
      role: "tank",
      jobLevel: 100,
      gears: [
        { id: 59999, materias: [] },
        { id: head.id, materias: [] },
      ],
    })!;
    const result = prepareForcedGearImport(
      payload,
      options("PLD", ["head"], [head]),
    );
    expect(result.unknownGearIds).toEqual([59999]);
    expect(result.entries.map(({ gear }) => gear.id)).toEqual([head.id]);
  });

  it("returns an empty preview with unknown IDs when all imported items are unknown", () => {
    const payload = stringifyReferenceGearset({
      job: "PLD",
      role: "tank",
      jobLevel: 100,
      gears: [{ id: 59999, materias: [] }],
    })!;
    const result = prepareForcedGearImport(
      payload,
      options("PLD", ["head"], []),
    );
    expect(result.unknownGearIds).toEqual([59999]);
    expect(result.entries).toEqual([]);
    expect(result.forces).toEqual({});
  });

  it("ignores unmapped out-of-scope slots only after assigning slots", () => {
    const weapon = gearFor("PLD", "weapon");
    const head = gearFor("PLD", "head");
    const result = prepareForcedGearImport(
      link("PLD", [{ gear: weapon }, { gear: head }]),
      options("PLD", ["head"], [head]),
    );
    expect(result.entries.map(({ slot }) => slot)).toEqual(["head"]);
  });
});
