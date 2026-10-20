import { foods, gameData, gears, jobIds } from "@/domain";
import { iconUrl, itemIconId, jobIconUrl } from "./icons";
import { describe, expect, it } from "vitest";

describe("Item icon metadata", () => {
  it("pads the icon ID and rounds the directory down to a thousand", () => {
    expect(iconUrl(51474)).toBe(
      "https://xivapi-v2.xivcdn.com/api/asset?path=ui/icon/051000/051474.tex&format=png",
    );
    expect(iconUrl(999)).toContain("ui/icon/000000/000999.tex");
    expect(iconUrl(100000)).toContain("ui/icon/100000/100000.tex");
    expect(() => iconUrl(0)).toThrow();
  });
  it("reads the binary icon field for every current equipment and food item", () => {
    expect(
      gears.every((gear) => itemIconId(gear.id) === gear.icon && Number.isSafeInteger(gear.icon)),
    ).toBe(true);
    expect(
      foods.every((food) => itemIconId(food.id) === food.icon && Number.isSafeInteger(food.icon)),
    ).toBe(true);
    expect(itemIconId(undefined)).toBeUndefined();
    expect(itemIconId(-1)).toBeUndefined();
  });
});

describe("job icons", () => {
  it("uses each job row ID plus 62100 for every supported job", () => {
    expect(Object.keys(gameData.jobs).sort()).toEqual([...jobIds].sort());
    for (const jobId of jobIds) {
      expect(jobIconUrl(jobId)).toBe(iconUrl(gameData.jobs[jobId].id + 62100));
    }
    expect(jobIconUrl("PLD")).toContain("ui/icon/062000/062119.tex");
    expect(jobIconUrl("BST")).toContain("ui/icon/062000/062143.tex");
  });
});
