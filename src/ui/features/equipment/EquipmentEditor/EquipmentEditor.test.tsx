// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Gear } from "@/domain";
import { EquipmentEditor } from "./EquipmentEditor";
import { SingleEquipmentScope } from "../scope";
import { equipmentGearCatalog } from "../catalog";
import { applySingleEquipmentAction } from "../transactions";
import type { SingleEquipmentDraft } from "../types";

const gears = [
  { id: 1, source: "B/Second" },
  { id: 2, source: "A/Group/Zulu" },
  { id: 3, source: "A/Group/Alpha" },
  { id: 4, source: "A/Group/Alpha" },
].map((gear) => ({
  ...gear,
  slot: "head",
  name: String(gear.id),
  level: 795,
})) as Gear[];
const catalog = equipmentGearCatalog([...gears, gears[0]!], []);
let host: HTMLDivElement;
let root: Root;
function Harness({
  initial = [],
  readOnly = false,
}: {
  initial?: string[];
  readOnly?: boolean;
}) {
  const [draft, setDraft] = useState<SingleEquipmentDraft>({
    excludedSources: initial,
    excludedGearIds: [],
    forcedGear: {},
  });
  return (
    <SingleEquipmentScope
      draft={draft}
      catalog={catalog}
      readOnly={readOnly}
      onAction={(action) =>
        setDraft(
          (current) =>
            applySingleEquipmentAction(current, action, (id) =>
              gears.find((gear) => gear.id === id),
            ).state,
        )
      }
    >
      <EquipmentEditor />
    </SingleEquipmentScope>
  );
}
const click = (el: HTMLElement) => act(() => el.click());
const labels = () =>
  [...document.body.querySelectorAll("label")].filter((el) =>
    el.querySelector('[role="checkbox"]'),
  );
function checkbox(name: string) {
  const label = labels().find((el) => el.textContent === name);
  if (!label) throw new Error(`Missing checkbox ${name}`);
  return label.querySelector<HTMLElement>('[role="checkbox"]')!;
}
function open() {
  click(
    [...host.querySelectorAll("button")].find(
      (el) => el.textContent === "选择来源",
    )!,
  );
}
const selectedSources = () =>
  [
    ...host.querySelectorAll('ul[aria-label="已排除来源"] [data-source-name]'),
  ].map((el) => el.textContent);
beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("source tree selection", () => {
  it("sorts each level, aggregates unique gear counts and selects a partial parent fully", () => {
    act(() => root.render(<Harness />));
    open();
    expect(labels().map((el) => el.textContent)).toEqual([
      "A3",
      "Group3",
      "Alpha2",
      "Zulu1",
      "B1",
      "Second1",
    ]);
    click(checkbox("Alpha2"));
    expect(checkbox("A3").getAttribute("aria-checked")).toBe("mixed");
    expect(checkbox("Group3").getAttribute("aria-checked")).toBe("mixed");
    click(checkbox("A3"));
    expect(checkbox("A3").getAttribute("aria-checked")).toBe("true");
    expect(selectedSources()).toEqual(["A/Group/Alpha", "A/Group/Zulu"]);
    expect(
      [
        ...host.querySelectorAll(
          'ul[aria-label="已排除来源"] [aria-label$="件装备"]',
        ),
      ].map((el) => el.textContent),
    ).toEqual(["2", "1"]);
    click(checkbox("A3"));
    expect(checkbox("Alpha2").getAttribute("aria-checked")).toBe("false");
    expect(selectedSources()).toEqual([]);
  });
  it("expands historical prefixes and keeps the flat list in sync when removing a leaf", () => {
    act(() => root.render(<Harness initial={["A/"]} />));
    open();
    expect(checkbox("A3").getAttribute("aria-checked")).toBe("true");
    click(checkbox("Alpha2"));
    expect(selectedSources()).toEqual(["A/Group/Zulu"]);
    const remove = host.querySelector<HTMLButtonElement>(
      'ul[aria-label="已排除来源"] button',
    )!;
    click(remove);
    open();
    expect(checkbox("A3").getAttribute("aria-checked")).toBe("false");
    expect(selectedSources()).toEqual([]);
  });
  it("disables the selector for read-only scopes", () => {
    act(() => root.render(<Harness readOnly />));
    expect(
      [...host.querySelectorAll("button")].find(
        (el) => el.textContent === "选择来源",
      )!.disabled,
    ).toBe(true);
  });
  it("gives each source checkbox its own accessible name inside the outer field", () => {
    act(() => root.render(<Harness />));
    open();
    for (const label of labels()) {
      const control = label.querySelector<HTMLElement>('[role="checkbox"]')!;
      const labelledBy = control.getAttribute("aria-labelledby");
      expect(labelledBy).not.toBeNull();
      expect(document.getElementById(labelledBy!)?.textContent).toBe(
        label.textContent,
      );
      expect(labelledBy).not.toBe("排除来源");
    }
  });
});
