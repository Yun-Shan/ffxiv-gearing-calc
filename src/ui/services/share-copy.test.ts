// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import fixtures from "@/share/__fixtures__/real-search.json";
import { restoreShare } from "@/share/restore";
import type { ShareInput } from "@/share/types";
import type { ResultShareData } from "@/ui/components/results/result-share-layout/types";
import { resultShareCopy } from "./share-copy";

const copies = vi.hoisted(() => ({ image: vi.fn() }));
vi.mock("./share-result", () => ({ copyResultImage: copies.image }));
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const view = restoreShare(fixtures.find(fixture => fixture.label === "brd-open")!.binary);
const linkData: ShareInput = {
  mode: "single",
  config: view.document.configs[0],
  results: view.results,
  dataVersion: view.document.dataVersion,
  elapsedMs: view.document.elapsedMs,
};
const imageData: ResultShareData = {
  jobId: "BRD", effects: view.results[0].effects, rows: [], summaryRows: [],
};
let imageTask: ReturnType<typeof deferred>;
let linkTask: ReturnType<typeof deferred>;
let writeText: ReturnType<typeof vi.fn>;
beforeEach(() => {
  expect(resultShareCopy.getSnapshot()).toBe(false);
  imageTask = deferred();
  linkTask = deferred();
  copies.image.mockReset().mockReturnValue(imageTask.promise);
  writeText = vi.fn(() => linkTask.promise);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
});
afterEach(async () => {
  imageTask.resolve();
  linkTask.resolve();
  await Promise.allSettled([imageTask.promise, linkTask.promise]);
  if (originalClipboard) Object.defineProperty(navigator, "clipboard", originalClipboard);
  else Reflect.deleteProperty(navigator, "clipboard");
});

it("ignores repeated image and link requests until the original image finishes", async () => {
  const states: boolean[] = [];
  const unsubscribe = resultShareCopy.subscribe(() => states.push(resultShareCopy.getSnapshot()));
  try {
    const first = resultShareCopy.copyImage(imageData);
    expect(copies.image).toHaveBeenCalledTimes(1);
    expect(resultShareCopy.getSnapshot()).toBe(true);
    expect(await resultShareCopy.copyImage(imageData)).toBe(false);
    expect(await resultShareCopy.copyLink(linkData)).toBe(false);
    expect(copies.image).toHaveBeenCalledTimes(1);
    expect(writeText).not.toHaveBeenCalled();
    imageTask.resolve();
    expect(await first).toBe(true);
    expect(states).toEqual([true, false]);
  } finally {
    unsubscribe();
  }
});

it("releases a failed link transaction and allows an image retry", async () => {
  const first = resultShareCopy.copyLink(linkData);
  expect(writeText).toHaveBeenCalledTimes(1);
  expect(await resultShareCopy.copyImage(imageData)).toBe(false);
  const failure = expect(first).rejects.toThrow("无法复制链接");
  linkTask.reject(new Error("clipboard denied"));
  await failure;
  expect(resultShareCopy.getSnapshot()).toBe(false);
  const retry = resultShareCopy.copyImage(imageData);
  expect(copies.image).toHaveBeenCalledTimes(1);
  imageTask.resolve();
  expect(await retry).toBe(true);
});

it("releases the lock when the copy operation throws synchronously", async () => {
  copies.image.mockImplementationOnce(() => { throw new Error("copy unavailable"); });
  await expect(resultShareCopy.copyImage(imageData)).rejects.toThrow("copy unavailable");
  expect(resultShareCopy.getSnapshot()).toBe(false);
  const retry = resultShareCopy.copyLink(linkData);
  expect(writeText).toHaveBeenCalledTimes(1);
  linkTask.resolve();
  expect(await retry).toBe(true);
});
