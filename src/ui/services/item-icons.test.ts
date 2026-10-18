import { foods, gears } from "@/domain";
import { displayedDataVersion } from "./app-config";
import { iconUrl } from "./icon-url";
import { itemIconId, itemIconDataVersion } from "./item-icons";
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
  it("has a real snapshot icon for every current equipment and food item", () => {
    expect(itemIconDataVersion).toBe(displayedDataVersion);
    expect(
      gears.every((gear) => Number.isSafeInteger(itemIconId(gear.id))),
    ).toBe(true);
    expect(
      foods.every((food) => Number.isSafeInteger(itemIconId(food.id))),
    ).toBe(true);
  });
});
