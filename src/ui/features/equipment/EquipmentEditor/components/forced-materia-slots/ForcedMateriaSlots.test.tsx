// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gears, prepareEquipmentMateria, type ForcedGearValue } from "@/domain";
import { ForcedMateriaSlots } from "./ForcedMateriaSlots";
vi.mock("@/domain", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/domain")>();
  return {
    ...actual,
    prepareEquipmentMateria: vi.fn(actual.prepareEquipmentMateria),
  };
});

const gear = gears.find((gear) => gear.name === "宫廷爱人御敌发夹")!;
function Harness({ syncLevel, freshGear = false }: { syncLevel?: number; freshGear?: boolean }) {
  const [value, setValue] = useState<ForcedGearValue>(gear.id);
  return (
    <>
      <output data-forced-value>{JSON.stringify(value)}</output>
      <ForcedMateriaSlots
        gear={freshGear ? { ...gear } : gear}
        config={{ jobId: "PLD", syncLevel }}
        readOnly={false}
        value={value}
        onChange={setValue}
      />
    </>
  );
}
let host: HTMLDivElement;
let root: Root;
const holes = () => [
  ...host.querySelectorAll<HTMLButtonElement>('button[role="combobox"]'),
];
const options = () =>
  [...document.body.querySelectorAll<HTMLElement>('[role="option"]')].filter(
    (option) => !option.closest("[data-closed]"),
  );
const selectedForce = () =>
  JSON.parse(host.querySelector("[data-forced-value]")!.textContent!) as
    | number
    | { id: number; melds: ({ stat: string; value: number; grade: number } | null)[] };
async function click(element: HTMLElement) {
  await act(async () => element.click());
}
beforeEach(() => {
  vi.mocked(prepareEquipmentMateria).mockClear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("forced equipment materia controls", () => {
  it("selects per hole, updates equipment totals, marks the choice and restores auto", async () => {
    act(() =>
      root.render(<Harness />),
    );
    expect(holes()).toHaveLength(5);
    expect(holes().every((hole) => hole.textContent === "自动—")).toBe(true);
    await click(holes()[0]!);
    expect(options().map((o) => o.textContent)).toEqual([
      "自动",
      "暴击 +54257 / 257",
      "信念 +540 / 257",
      "直击 +540 / 257",
      "技速 +540 / 257",
    ]);
    await click(options()[2]!);
    expect(holes()[0]!.textContent).toBe("信念+54");
    expect(selectedForce()).toMatchObject({
      id: gear.id,
      melds: [{ stat: "DET" }, null, null, null, null],
    });
    await click(holes()[0]!);
    expect(options()[2]!.getAttribute("aria-selected")).toBe("true");
    expect(options()[2]!.querySelector("svg")).not.toBeNull();
    expect(options()[2]!.textContent).toBe("信念 +5454 / 257");
    await click(options()[0]!);
    expect(holes()[0]!.textContent).toBe("自动—");
    expect(selectedForce()).toBe(gear.id);
    await click(holes()[3]!);
    expect(options()[2]!.textContent).toBe("信念 +180 / 257");
    expect(prepareEquipmentMateria).toHaveBeenCalledTimes(1);
  });
  it("keeps other holes selected and retains cached facts across parent rerenders", async () => {
    const render = (syncLevel?: number) =>
      act(() =>
        root.render(<Harness syncLevel={syncLevel} freshGear />),
      );
    render();
    await click(holes()[0]!);
    await click(options()[2]!);
    await click(holes()[1]!);
    await click(options()[3]!);
    render();
    expect(holes()[0]!.textContent).toBe("信念+54");
    expect(holes()[1]!.textContent).toBe("直击+54");
    expect(prepareEquipmentMateria).toHaveBeenCalledTimes(1);
    render(660);
    expect(holes()).toHaveLength(0);
    expect(selectedForce()).toMatchObject({
      melds: [{ stat: "DET" }, { stat: "DHT" }, null, null, null],
    });
    render();
    expect(holes()[0]!.textContent).toBe("信念+54");
    expect(holes()[1]!.textContent).toBe("直击+54");
    await click(holes()[0]!);
    expect(
      options()[1]!.querySelector('[aria-label="暴击当前 257，上限 257"]')!
        .className,
    ).toContain("atCap");
    await click(options()[1]!);
    await click(holes()[0]!);
    expect(
      options()[1]!.querySelector('[aria-label="暴击当前 311，上限 257"]')!
        .className,
    ).toContain("overCap");
    expect(prepareEquipmentMateria).toHaveBeenCalledTimes(3);
  });
  it("disables choices in read-only and synchronized views", () => {
    act(() =>
      root.render(
        <ForcedMateriaSlots
          gear={gear}
          config={{ jobId: "PLD" }}
          readOnly
          value={gear.id}
          onChange={() => undefined}
        />,
      ),
    );
    expect(holes().every((hole) => hole.disabled)).toBe(true);
    act(() =>
      root.render(
        <ForcedMateriaSlots
          gear={gear}
          config={{ jobId: "PLD", syncLevel: 660 }}
          readOnly={false}
          value={gear.id}
          onChange={() => undefined}
        />,
      ),
    );
    expect(holes()).toHaveLength(0);
    expect(
      host.querySelector('svg[aria-label="品级同步后魔晶石不生效"] path'),
    ).not.toBeNull();
  });
});
