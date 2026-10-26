import { afterEach, describe, expect, it, vi } from "vitest";
import { runShareTask, workbenchResultFromShare } from "./share-link";
import realSearch from "@/share/__fixtures__/real-search.json";
import dutyMetadata from "@/share/__fixtures__/duty-metadata.json";
import { restoreDocument, restoreShare } from "@/share/restore";
import { projectShareInput } from "@/share/projection";
import { encodeShareBinary, toBase64url } from "@/share/codec";
import type { ShareWorkerResponse } from "@/share/worker-protocol";
import type { ShareView } from "@/share/types";

describe("workbench result initialization", () => {
  it.each([...realSearch, ...dutyMetadata])(
    "preserves ordinary re-sharing for $label",
    (fixture) => {
      const input = workbenchResultFromShare(restoreShare(fixture.binary));
      const results =
        input.mode === "single"
          ? [input.result]
          : input.config.jobs.map(
              (config) => input.result.jobResults[config.jobId]!,
            );
      const document = projectShareInput({
        mode: input.mode,
        config: input.config,
        results,
        dataVersion: input.dataVersion,
        elapsedMs: input.result.statistics.elapsedMs,
        ...(input.mode === "joint"
          ? {
              baselines: input.config.jobs.map(
                (config) => input.result.optima[config.jobId]!.score,
              ),
              jointValue: input.result.value.approximate,
            }
          : {}),
      });
      expect(toBase64url(encodeShareBinary(document))).toBe(fixture.binary);
      if (input.mode === "joint")
        expect(input.result).not.toHaveProperty("proof");
    },
  );
  it("does not deliver unresolved source conditions to a workbench", () => {
    const document = structuredClone(
      realSearch[0].document,
    ) as ShareView["document"];
    for (const config of document.configs)
      config.excludedSources = [{ unknownSourceId: 9999 }];
    expect(() => workbenchResultFromShare(restoreDocument(document))).toThrow(
      "来源条件不完整",
    );
  });
});

class ControlledWorker extends EventTarget {
  static instances: ControlledWorker[] = [];
  sent: unknown[] = [];
  terminated = false;
  constructor() {
    super();
    ControlledWorker.instances.push(this);
  }
  postMessage(value: unknown) {
    this.sent.push(value);
  }
  terminate() {
    this.terminated = true;
  }
  emit(value: ShareWorkerResponse) {
    this.dispatchEvent(new MessageEvent("message", { data: value }));
  }
}
afterEach(() => {
  vi.unstubAllGlobals();
  ControlledWorker.instances = [];
});
describe("share restoration worker lifetime", () => {
  it("sends one request after readiness, terminates after a result and ignores late messages", async () => {
    vi.stubGlobal("Worker", ControlledWorker);
    const controller = new AbortController();
    const promise = runShareTask({ token: "AQ" }, controller.signal),
      worker = ControlledWorker.instances[0];
    expect(worker.sent).toEqual([]);
    worker.emit({ kind: "ready" });
    worker.emit({ kind: "ready" });
    expect(worker.sent).toEqual([{ token: "AQ" }]);
    const view = { document: { mode: "single" } } as ShareView;
    worker.emit({ kind: "result", view });
    await expect(promise).resolves.toBe(view);
    expect(worker.terminated).toBe(true);
    worker.emit({ kind: "error", message: "late" });
    controller.abort();
  });
  it("cancels a live worker and rejects late completion", async () => {
    vi.stubGlobal("Worker", ControlledWorker);
    const controller = new AbortController();
    const promise = runShareTask({ token: "AQ" }, controller.signal),
      worker = ControlledWorker.instances[0];
    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    expect(worker.terminated).toBe(true);
    worker.emit({ kind: "ready" });
    expect(worker.sent).toEqual([]);
    worker.emit({ kind: "result", view: {} as ShareView });
  });
  it("does not allocate a worker for cancelled or over-budget input", async () => {
    vi.stubGlobal("Worker", ControlledWorker);
    await expect(
      runShareTask({ token: "AQ" }, AbortSignal.abort()),
    ).rejects.toMatchObject({ name: "AbortError" });
    await expect(
      runShareTask({ token: "A".repeat(32769) }, new AbortController().signal),
    ).rejects.toThrow(/容量/);
    expect(ControlledWorker.instances).toEqual([]);
  });
  it.each(["worker", "message", "domain"] as const)(
    "terminates on %s errors",
    async (kind) => {
      vi.stubGlobal("Worker", ControlledWorker);
      const promise = runShareTask(
          { token: "AQ" },
          new AbortController().signal,
        ),
        worker = ControlledWorker.instances[0];
      if (kind === "domain")
        worker.emit({ kind: "error", message: "无效的分享链接" });
      else if (kind === "worker") worker.dispatchEvent(new Event("error"));
      else worker.dispatchEvent(new Event("messageerror"));
      await expect(promise).rejects.toThrow();
      expect(worker.terminated).toBe(true);
    },
  );
});
