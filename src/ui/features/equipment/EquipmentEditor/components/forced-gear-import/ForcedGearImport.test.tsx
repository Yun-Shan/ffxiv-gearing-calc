// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EquipmentMateriaConfig, Gear } from "@/domain";
import { EquipmentScopeProvider } from "../../../scope";
import type {
  EquipmentAction,
  EquipmentGearCatalog,
  SingleEquipmentDraft,
} from "../../../types";
import { ForcedGearImport } from "./ForcedGearImport";

const { prepareMock } = vi.hoisted(() => ({ prepareMock: vi.fn() }));
vi.mock("../../../forced-gear-import", () => ({
  prepareForcedGearImport: prepareMock,
}));

const gear = {
  id: 123,
  slot: "head",
  name: "预览头盔",
  level: 795,
  equipLevel: 100,
  rawSlot: 0,
  roleId: 0,
  jobCategory: 0,
  stats: {},
  materiaSlots: 0,
  jobs: ["SAM"],
  sourceFile: "test",
} as Gear;
const config: EquipmentMateriaConfig = { jobId: "SAM" };
const draft: SingleEquipmentDraft = {
  excludedSources: [],
  excludedGearIds: [],
  forcedGear: {},
};
const catalog: EquipmentGearCatalog = {
  gearOptions: [gear],
  forceGearOptions: { head: [gear] },
  allowedForcedGearSlots: ["head"],
};
const prepared = {
  jobId: "SAM",
  entries: [{ slot: "head", gear, value: gear.id }],
  forces: { head: gear.id },
  unknownGearIds: [],
};

let host: HTMLDivElement;
let root: Root;
let dispatch: (action: EquipmentAction) => boolean | void;
let dispatchMock: ReturnType<
  typeof vi.fn<(action: EquipmentAction) => boolean>
>;

function Harness({ readOnly = false }: { readOnly?: boolean }) {
  return (
    <EquipmentScopeProvider
      scope={{ kind: "single" }}
      draft={draft}
      catalog={catalog}
      readOnly={readOnly}
      onAction={dispatch}
    >
      <ForcedGearImport config={config} allowedJobs={["SAM"]} />
    </EquipmentScopeProvider>
  );
}

function click(target: HTMLElement) {
  act(() => target.click());
}

function button(name: string, scope: ParentNode = document.body) {
  const found = [...scope.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === name,
  );
  if (!found) throw new Error(`Missing button: ${name}`);
  return found;
}

function typeLink(value: string) {
  const input = document.querySelector<HTMLInputElement>(
    'input[placeholder^="https://asvel"]',
  )!;
  act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function identify() {
  typeLink("https://asvel.github.io/ffxiv-gearing/?fixture");
  click(button("识别"));
}

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  dispatchMock = vi.fn<(action: EquipmentAction) => boolean>(() => true);
  dispatch = dispatchMock;
  prepareMock.mockReset().mockReturnValue(prepared);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("forced gear import dialog", () => {
  it("sorts preview slots and combines restricted equipment into the warning", () => {
    prepareMock.mockReturnValue({
      ...prepared,
      entries: [
        {
          slot: "body",
          gear: { ...gear, id: 124, slot: "body", name: "预览衣服" },
          value: 124,
        },
        ...prepared.entries,
      ],
      restrictedGear: [
        { id: 125, name: "受限装备", reason: "当前职业不可用。" },
      ],
    });
    act(() => root.render(<Harness />));
    click(button("导入", host));
    identify();
    const rows = [
      ...document.querySelectorAll('[aria-label="导入装备预览"] > li'),
    ];
    expect(rows[0]?.textContent).toContain("预览头盔");
    expect(rows[1]?.textContent).toContain("预览衣服");
    expect(document.querySelector('[role="status"]')?.textContent).toContain(
      "受限装备（125）：当前职业不可用，已忽略。",
    );
    expect(button("确认导入").disabled).toBe(false);
  });

  it("previews recognized gear without changing the equipment until confirmation", () => {
    act(() => root.render(<Harness />));
    click(button("导入", host));
    expect(prepareMock).not.toHaveBeenCalled();
    expect(button("确认导入").disabled).toBe(true);

    identify();
    expect(document.body.textContent).toContain("预览头盔");
    expect(
      document.body.querySelector('[aria-label="导入装备预览"]'),
    ).not.toBeNull();
    expect(dispatchMock).not.toHaveBeenCalled();

    const previewList = document.querySelector('[aria-label="导入装备预览"]')!;
    expect(previewList.querySelectorAll("button:not(:disabled)")).toHaveLength(
      0,
    );
    expect(previewList.textContent).not.toContain("移除");
    click(button("确认导入"));
    expect(dispatchMock).toHaveBeenCalledOnce();
    expect(dispatchMock).toHaveBeenCalledWith({
      type: "import-forces",
      forces: prepared.forces,
    });
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });

  it("discards the preview when the source link is edited", () => {
    act(() => root.render(<Harness />));
    click(button("导入", host));
    identify();
    expect(document.body.textContent).toContain("预览头盔");
    typeLink("https://asvel.github.io/ffxiv-gearing/?changed");
    expect(document.body.textContent).not.toContain("预览头盔");
    expect(button("确认导入").disabled).toBe(true);
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it("shows parser errors and keeps confirmation disabled", () => {
    prepareMock.mockImplementation(() => {
      throw new Error("职业不匹配");
    });
    act(() => root.render(<Harness />));
    click(button("导入", host));
    typeLink("invalid");
    click(button("识别"));
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      "职业不匹配",
    );
    expect(button("确认导入").disabled).toBe(true);
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it("keeps the preview open when the atomic transaction rejects it", () => {
    dispatchMock.mockReturnValue(false);
    act(() => root.render(<Harness />));
    click(button("导入", host));
    identify();
    click(button("确认导入"));
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "冲突",
    );
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.body.textContent).toContain("预览头盔");
  });

  it("does not apply previewed equipment when the dialog is cancelled", () => {
    act(() => root.render(<Harness />));
    click(button("导入", host));
    identify();
    click(button("取消"));
    expect(dispatchMock).not.toHaveBeenCalled();
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });

  it("disables the import entry in a read-only scope", () => {
    act(() => root.render(<Harness readOnly />));
    expect(button("导入", host).disabled).toBe(true);
  });

  it("warns about unknown IDs while allowing known entries to be confirmed", () => {
    prepareMock.mockReturnValue({
      ...prepared,
      unknownGearIds: [987654],
    });
    act(() => root.render(<Harness />));
    click(button("导入", host));
    identify();

    expect(document.querySelector('[role="status"]')?.textContent).toContain(
      "987654",
    );
    expect(document.body.textContent).toContain("预览头盔");
    expect(button("确认导入").disabled).toBe(false);
    click(button("确认导入"));
    expect(dispatchMock).toHaveBeenCalledWith({
      type: "import-forces",
      forces: prepared.forces,
    });
  });

  it("disables confirmation when every imported item ID is unknown", () => {
    prepareMock.mockReturnValue({
      ...prepared,
      entries: [],
      forces: {},
      unknownGearIds: [987654],
    });
    act(() => root.render(<Harness />));
    click(button("导入", host));
    identify();

    expect(document.querySelector('[role="status"]')?.textContent).toContain(
      "987654",
    );
    expect(button("确认导入").disabled).toBe(true);
    expect(dispatchMock).not.toHaveBeenCalled();
  });
});
