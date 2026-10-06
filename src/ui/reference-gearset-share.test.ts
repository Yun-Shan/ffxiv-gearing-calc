import { describe, expect, it } from "vitest";
import { stringifyReferenceGearset } from "./reference-gearset-share";

describe("reference gearset share compatibility", () => {
  // Golden strings were compared byte-for-byte with Asvel/ffxiv-gearing commit
  // 048376fb6c6c6538a482eba5f76128d985958fa0; keep tests independent of the ignored local clone.
  it.each([
    [660, "2OOvPWohS7itc5QuD"],
    [130, "2OOvPWohS7itb02ld"],
  ])("encodes a level 100 Samurai with sync level %i", (syncLevel, expected) => {
    const gearset = {
      job: "SAM" as const,
      role: "str" as const,
      jobLevel: 100,
      syncLevel,
      gears: [
        { id: 42001, materias: [["CRT", 12], ["DET", 11]] as const },
        { id: 42008, materias: [] },
        { id: 42013, materias: [["SKS", 10]] as const },
      ],
    };
    expect(stringifyReferenceGearset(gearset)).toBe(expected);
  });

  it("retains customizable weapon parameters in the upstream encoding", () => {
    const gearset = {
      job: "PLD" as const,
      role: "tank" as const,
      jobLevel: 100,
      gears: [{ id: 42001, materias: [], customStats: { CRT: 72, DET: 36 } }],
    };
    expect(stringifyReferenceGearset(gearset)).toBe("7tM6ar4jjt5Ln4QOqG1");
  });
});
