import { describe, expect, it } from "vitest";
import { jobIds } from "@/domain";
import { jobIconUrl } from "./job-icons";
import generated from "./generated/job-icons.json";
import { displayedDataVersion } from "./app-config";

describe("job icons", () => {
  it("uses the current snapshot and covers every supported job", () => {
    expect(generated.gameVersion).toBe(displayedDataVersion);
    expect(Object.keys(generated.icons).sort()).toEqual([...jobIds].sort());
    expect(jobIconUrl("PLD")).toContain("ui/icon/062000/062119.tex");
    expect(jobIconUrl("BST")).toContain("ui/icon/062000/062143.tex");
  });
});
