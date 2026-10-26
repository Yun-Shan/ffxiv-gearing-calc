// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import fixtures from "@/share/__fixtures__/real-search.json";
import { restoreShare } from "@/share/restore";
import type { ShareInput } from "@/share/types";
import { FeedbackProvider } from "@/ui/components/feedback/FeedbackProvider";
import type { ResultShareData } from "../../../result-share-layout/types";
import { ShareResultButton } from "./ShareResultButton";

const copies = vi.hoisted(() => ({ image: vi.fn() }));
vi.mock("@/ui/services/share-result", () => ({ copyResultImage: copies.image }));
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
function deferred() {
  let resolve!: () => void, reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const view = restoreShare(fixtures.find(f => f.label === "brd-open")!.binary);
const linkData: ShareInput = {
  mode: "single", config: view.document.configs[0], results: view.results,
  dataVersion: view.document.dataVersion, elapsedMs: view.document.elapsedMs,
};
// Image rendering is mocked: these tests exercise the copy transaction and menu.
const imageData: ResultShareData = {
  jobId: "BRD", effects: view.results[0].effects, rows: [], summaryRows: [],
};
let host: HTMLDivElement, root: Root;
let imageTask: ReturnType<typeof deferred>, linkTask: ReturnType<typeof deferred>;
let writeText: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  imageTask = deferred(); linkTask = deferred();
  copies.image.mockReset().mockReturnValue(imageTask.promise);
  writeText = vi.fn(() => linkTask.promise);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => { imageTask.resolve(); linkTask.resolve(); });
  act(() => root.unmount()); host.remove();
  if (originalClipboard) Object.defineProperty(navigator, "clipboard", originalClipboard);
  else Reflect.deleteProperty(navigator, "clipboard");
  vi.unstubAllGlobals();
});
function button(label: string): HTMLButtonElement {
  const value = [...document.querySelectorAll("button")].find(b => b.textContent?.trim() === label);
  expect(value, label).toBeDefined(); return value!;
}
async function open(multiple = false) {
  act(() => root.render(<FeedbackProvider><ShareResultButton data={imageData} linkData={linkData}
    images={multiple ? [{ label: "当前配装", data: imageData }, { label: "对比配装", data: imageData }] : undefined}
  /></FeedbackProvider>));
  const trigger = button("分享配装结果");
  await act(async () => trigger.click());
  return trigger;
}

it.each(["link", "image"] as const)("serializes both copy actions when %s starts first", async first => {
  const trigger = await open(), link = button("复制分享链接"), image = button("复制图片分享");
  act(() => {
    (first === "link" ? link : image).click();
    (first === "link" ? image : link).click();
  });
  expect(writeText).toHaveBeenCalledTimes(first === "link" ? 1 : 0);
  expect(copies.image).toHaveBeenCalledTimes(first === "image" ? 1 : 0);
  expect(trigger.disabled).toBe(true);
  expect(link.disabled).toBe(true); expect(image.disabled).toBe(true);
  await act(async () => (first === "link" ? linkTask : imageTask).resolve());
  expect(trigger.disabled).toBe(false);
  await act(async () => trigger.click());
  act(() => button(first === "link" ? "复制图片分享" : "复制分享链接").click());
  expect(writeText).toHaveBeenCalledTimes(1); expect(copies.image).toHaveBeenCalledTimes(1);
});

it("keeps the copy lock after closing the popup until a pending link fails", async () => {
  const trigger = await open();
  act(() => button("复制分享链接").click());
  act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  expect(trigger.disabled).toBe(true);
  await act(async () => linkTask.reject(new Error("clipboard denied")));
  expect(trigger.disabled).toBe(false);
  await act(async () => trigger.click());
  act(() => button("复制图片分享").click());
  expect(copies.image).toHaveBeenCalledTimes(1);
});

it("disables the image picker back action while copying and releases it on failure", async () => {
  const trigger = await open(true);
  act(() => button("复制图片分享").click());
  act(() => button("复制当前配装图片").click());
  const back = button("返回");
  expect(back.disabled).toBe(true); expect(trigger.disabled).toBe(true);
  act(() => back.click());
  expect(button("复制对比配装图片").disabled).toBe(true);
  await act(async () => imageTask.reject(new Error("image denied")));
  expect(back.disabled).toBe(false); expect(trigger.disabled).toBe(false);
  act(() => back.click());
  act(() => button("复制分享链接").click());
  expect(writeText).toHaveBeenCalledTimes(1);
});
