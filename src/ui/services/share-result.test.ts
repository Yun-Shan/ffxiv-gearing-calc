// @vitest-environment jsdom
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { snapdom } from "@zumer/snapdom";
import type { ResultShareData } from "@/ui/components/results/result-share-layout/types";
import { copyResultImage } from "./share-result";

vi.mock("@zumer/snapdom", () => ({ snapdom: { toBlob: vi.fn() } }));

const toBlob = vi.mocked(snapdom.toBlob);
let clipboardData: Record<string, Promise<Blob>>[];
const write = vi.fn();

beforeAll(async () => {
  await import("@/ui/components/results/result-share-layout/ResultShareLayout");
});

function shareData(): ResultShareData {
  return {
    jobId: "PLD",
    effects: {
      crtChance: 0.2,
      crtDamage: 1.4,
      detDamage: 1.1,
      dhtChance: 0.05,
      tenDamage: 1,
      tenMitigation: 0.01,
      damage: 100,
      gcd: 2.5,
      hp: 1000,
      mp: 1000,
    },
    rows: [
      {
        key: "weapon",
        slotLabel: "武器",
        marker: "共享",
        item: {
          kind: "gear",
          key: "weapon",
          slot: "weapon",
          name: "保存的武器",
          level: 700,
          stats: { STR: 217 },
          melds: [],
        },
        replacements: [
          {
            kind: "gear",
            key: "other-weapon",
            slot: "weapon",
            name: "替换武器",
            level: 700,
            stats: {},
            melds: [],
          },
          {
            kind: "gear",
            key: "third-weapon",
            slot: "weapon",
            name: "另一武器",
            level: 700,
            stats: {},
            melds: [],
          },
        ],
        onReplacementSelect: vi.fn(),
      },
      {
        key: "food",
        slotLabel: "食物",
        item: {
          kind: "food",
          key: "food",
          name: "保存的食物",
          level: 700,
          actualStats: { DET: 12 },
          utilization: 94,
          stats: { DET: 20 },
          statsMeaning: "actual-gain",
        },
      },
      {
        key: "total",
        slotLabel: "总属性",
        item: {
          kind: "summary",
          key: "total",
          label: "总属性",
          stats: { STR: 999 },
        },
      },
    ],
    summaryRows: [
      { label: "种族", value: "人族 · 中原之民" },
      { label: "装备品级", value: "590–795" },
      { label: "同步目标", value: "605" },
      { label: "公式等级", value: "90 级" },
      { label: "GCD", value: "2.50 秒" },
      { label: "来源排除", value: "0 项" },
    ],
  };
}

beforeEach(() => {
  clipboardData = [];
  toBlob.mockReset();
  write.mockReset();
  write.mockImplementation(async () => {
    await Promise.all(clipboardData.map((data) => data["image/png"]));
  });
  vi.stubGlobal(
    "navigator",
    new Proxy(navigator, {
      get: (target, property) =>
        property === "clipboard"
          ? { write }
          : Reflect.get(target, property, target),
    }),
  );
  vi.stubGlobal(
    "ClipboardItem",
    class {
      constructor(data: Record<string, Promise<Blob>>) {
        clipboardData.push(data);
      }
    },
  );
});

afterEach(() => vi.unstubAllGlobals());

describe("copyResultImage", () => {
  it("starts the clipboard write before rendering finishes and exports PNG", async () => {
    const blob = new Blob(["png"], { type: "image/png" });
    let finish!: (blob: Blob) => void;
    toBlob.mockReturnValue(
      new Promise<Blob>((resolve) => {
        finish = resolve;
      }),
    );

    const copying = copyResultImage(shareData());
    expect(write).toHaveBeenCalledOnce();
    expect(clipboardData[0]?.["image/png"]).toBeInstanceOf(Promise);
    try {
      await vi.waitFor(() =>
        expect(toBlob).toHaveBeenCalledWith(expect.any(HTMLElement), {
          format: "png",
          scale: 1,
          dpr: 1,
          backgroundColor: "#ffffff",
          reconcile: true,
        }),
      );
    } finally {
      finish(blob);
      await copying;
    }
    expect(await clipboardData[0]!["image/png"]).toBe(blob);
    expect(toBlob.mock.calls[0]![0].isConnected).toBe(false);
  });

  it("renders all saved rows, metrics and metadata without interactive controls", async () => {
    const data = shareData();
    const saved = JSON.stringify(data);
    toBlob.mockImplementation(async (capture) => {
      expect(capture.isConnected).toBe(true);
      expect(capture.querySelector("h2")?.textContent).toContain(
        "骑士 · 推荐配装",
      );
      expect(capture.textContent).toContain("人族 · 中原之民");
      expect(capture.querySelector("aside")?.textContent).toContain(
        "同步目标605",
      );
      expect(capture.textContent).not.toContain("耗时");
      expect(capture.textContent).not.toContain("公式等级");
      expect(capture.textContent).toContain("100.0000000");
      const metrics = capture.querySelector('section[aria-label="核心指标"]')!;
      expect(
        [...metrics.querySelectorAll("span")].map((label) => label.textContent),
      ).toEqual(["GCD", "暴击率", "直击率", "坚韧减伤", "生命值"]);
      expect(capture.querySelector("aside")?.textContent).toContain("条件摘要");
      expect(capture.querySelector("aside")?.textContent).toContain("590–795");
      const heading = capture.querySelector("header")!;
      expect(heading.textContent).toContain("每威力伤害期望100.0000000");
      expect(heading.textContent).not.toContain("中原之民");
      expect(heading.textContent).not.toContain("同步");
      expect(capture.querySelectorAll("tbody tr")).toHaveLength(
        data.rows.length,
      );
      expect(capture.textContent).toContain("保存的武器");
      expect(capture.textContent).toContain("保存的食物");
      expect(capture.textContent).toContain("利用率 94%");
      expect(capture.textContent).toContain("共享");
      expect(
        capture.querySelector("tbody tr:last-child")?.textContent,
      ).toContain("999");
      expect(capture.querySelector("button, a")).toBeNull();
      expect(capture.textContent).not.toContain("替换武器");
      return new Blob(["png"], { type: "image/png" });
    });
    await copyResultImage(data);
    expect(JSON.stringify(data)).toBe(saved);
    expect(toBlob.mock.calls[0]![0].isConnected).toBe(false);
    expect(document.querySelector("[data-result-share-layout]")).toBeNull();
  });

  it.each(["未启用", "90级"])(
    "renders the saved clan and sync summary for %s",
    async (expectedSync) => {
      const data = shareData();
      data.summaryRows = [
        { label: "种族", value: "鲁加族 · 红焰之民" },
        { label: "同步目标", value: expectedSync },
      ];
      toBlob.mockImplementation(async (capture) => {
        const heading = capture.querySelector("header")!;
        const summary = capture.querySelector("aside")!;
        expect(summary.textContent).toContain("鲁加族 · 红焰之民");
        expect(summary.textContent).toContain(expectedSync);
        expect(heading.textContent).not.toContain("鲁加族");
        expect(heading.textContent).not.toContain("同步");
        return new Blob(["png"], { type: "image/png" });
      });
      await copyResultImage(data);
    },
  );

  it("reports unsupported clipboard APIs without starting a capture", async () => {
    vi.stubGlobal("navigator", {});
    await expect(copyResultImage(shareData())).rejects.toThrow(
      "不支持复制图片",
    );
    expect(toBlob).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it("propagates a rendering error and unmounts the temporary layout", async () => {
    toBlob.mockRejectedValue(new Error("capture failed"));
    await expect(copyResultImage(shareData())).rejects.toThrow(
      "capture failed",
    );
    expect(toBlob.mock.calls[0]![0].isConnected).toBe(false);
    expect(document.querySelector("[data-result-share-layout]")).toBeNull();
  });

  it("handles a late rendering failure after clipboard permission is denied", async () => {
    let fail!: (error: Error) => void;
    toBlob.mockReturnValue(
      new Promise<Blob>((_, reject) => {
        fail = reject;
      }),
    );
    write.mockRejectedValue(new Error("permission denied"));
    await expect(copyResultImage(shareData())).rejects.toThrow(
      "permission denied",
    );
    await vi.waitFor(() => expect(toBlob).toHaveBeenCalledOnce());
    fail(new Error("late capture failure"));
    await vi.waitFor(() =>
      expect(document.querySelector("[data-result-share-layout]")).toBeNull(),
    );
  });
});
