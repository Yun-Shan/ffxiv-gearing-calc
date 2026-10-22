// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  gameData,
  gears,
  prepareEquipmentMateria,
  type ForcedGearValue,
  type Gear,
  type JobId,
} from "@/domain";
import { ForcedMateriaSlots } from "./ForcedMateriaSlots";
vi.mock("@/domain", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/domain")>();
  return {
    ...actual,
    prepareEquipmentMateria: vi.fn(actual.prepareEquipmentMateria),
  };
});

const gear = gears.find((gear) => gear.name === "宫廷爱人御敌发夹")!;
function Harness({
  syncLevel,
  freshGear = false,
  equipment = gear,
  jobId = "PLD",
  initialValue,
}: {
  syncLevel?: number;
  freshGear?: boolean;
  equipment?: Gear;
  jobId?: JobId;
  initialValue?: ForcedGearValue;
}) {
  const [value, setValue] = useState<ForcedGearValue>(
    initialValue ?? equipment.id,
  );
  return (
    <>
      <output data-forced-value>{JSON.stringify(value)}</output>
      <ForcedMateriaSlots
        gear={freshGear ? { ...equipment } : equipment}
        config={{ jobId, syncLevel }}
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
    | {
        id: number;
        melds: ({ stat: string; value: number; grade: number } | null)[];
      };
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
  it.each([['PLD', 'TEN', '坚韧'], ['WHM', 'PIE', '信仰']] as const)("allows %s to force %s materia", async (jobId, stat, label) => {
    const equipment = gears.find((item) => item.jobs.includes(jobId) && item.level === 770 && item.materiaSlots === 2 && !item.materiaAdvanced)!;
    act(() => root.render(<Harness equipment={equipment} jobId={jobId} />));
    await click(holes()[0]!);
    const choice = options().find((option) => option.textContent?.startsWith(`${label} +`))!;
    expect(choice).toBeDefined();
    await click(choice);
    expect(holes()[0]!.textContent).toContain(label);
    expect(selectedForce()).toMatchObject({ id: equipment.id, melds: [{ stat }, null] });
  });

  it("selects per hole, updates equipment totals, marks the choice and restores auto", async () => {
    act(() => root.render(<Harness />));
    expect(holes()).toHaveLength(5);
    expect(holes().every((hole) => hole.textContent === "自动—")).toBe(true);
    await click(holes()[0]!);
    expect(options().map((o) => o.textContent)).toEqual([
      "自动",
      "暴击 +54257 / 257",
      "信念 +540 / 257",
      "直击 +540 / 257",
      "技速 +540 / 257",
      `坚韧 +54${gear.stats.TEN ?? 0} / 257`,
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
      act(() => root.render(<Harness syncLevel={syncLevel} freshGear />));
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

  it("shows an imported low-grade materia accurately and allows replacing it with the normal highest grade", async () => {
    const imported = {
      id: gear.id,
      melds: [
        { stat: "CRT" as const, value: 18, grade: 11 },
        { stat: "DET" as const, value: 54, grade: 12 },
        null,
        null,
        null,
      ],
    };
    act(() => root.render(<Harness initialValue={imported} />));
    expect(holes()[0]!.textContent).toBe("暴击+18");
    expect(holes()[1]!.textContent).toBe("信念+54");
    await click(holes()[0]!);
    expect(options().map((option) => option.textContent)).toContain(
      "暴击 +18（11级已导入）275 / 257",
    );
    expect(options().map((option) => option.textContent)).toContain(
      "暴击 +54275 / 257",
    );
    await click(
      options().find((option) => option.textContent?.startsWith("暴击 +54"))!,
    );
    expect(holes()[0]!.textContent).toBe("暴击+54");
    expect(selectedForce()).toMatchObject({
      melds: [
        { stat: "CRT", value: 54, grade: 12 },
        { stat: "DET", value: 54, grade: 12 },
        null,
        null,
        null,
      ],
    });
  });

  it("shows imported healer PIE materia and its real cap hint", async () => {
    const healerGear = gears.find(
      (item) =>
        item.jobs.includes("WHM") && item.materiaSlots >= 2 && item.level >= 50,
    )!;
    const pieValue = gameData.materias.PIE?.[0]!;
    const imported = {
      id: healerGear.id,
      melds: [{ stat: "PIE" as const, value: pieValue, grade: 1 }, null],
    };
    act(() =>
      root.render(
        <Harness equipment={healerGear} jobId="WHM" initialValue={imported} />,
      ),
    );
    expect(holes()[0]!.textContent).toBe(`信仰+${pieValue}`);
    await click(holes()[0]!);
    const importedOption = options().find((option) =>
      option.textContent?.startsWith(`信仰 +${pieValue}（1级已导入）`),
    )!;
    expect(importedOption).toBeDefined();
    expect(importedOption.querySelector("[aria-label]")).not.toBeNull();
    expect(selectedForce()).toMatchObject({
      melds: [{ stat: "PIE", value: pieValue, grade: 1 }, null],
    });
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
