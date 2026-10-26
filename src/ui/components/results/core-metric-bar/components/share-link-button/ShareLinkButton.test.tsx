// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import fixtures from "@/share/__fixtures__/real-search.json";
import type { ShareDocument, ShareInput } from "@/share/types";
import { restoreDocument } from "@/share/restore";
import { FeedbackProvider } from "@/ui/components/feedback/FeedbackProvider";
import { ShareLinkButton } from "./ShareLinkButton";
const originalClipboard = Object.getOwnPropertyDescriptor(
  navigator,
  "clipboard",
);
afterEach(() => {
  if (originalClipboard)
    Object.defineProperty(navigator, "clipboard", originalClipboard);
  else Reflect.deleteProperty(navigator, "clipboard");
  vi.unstubAllGlobals();
});

it("starts the clipboard write during the original user gesture", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let clickActive = false;
  const observed: boolean[] = [];
  const writeText = vi.fn((_url: string) => {
    observed.push(clickActive);
    return Promise.resolve();
  });
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const snapshot = fixtures.find((f) => f.label === "brd-open")!
    .document as unknown as ShareDocument;
  const input: ShareInput = {
    mode: "single",
    config: snapshot.configs[0],
    results: restoreDocument(snapshot).results,
    dataVersion: snapshot.dataVersion,
    elapsedMs: snapshot.elapsedMs,
  };
  act(() =>
    root.render(
      <FeedbackProvider>
        <ShareLinkButton data={input} />
      </FeedbackProvider>,
    ),
  );
  act(() => {
    clickActive = true;
    host.querySelector("button")!.click();
    clickActive = false;
  });
  expect(observed).toEqual([true]);
  expect(writeText.mock.calls[0]?.[0]).toMatch(
    /^http:\/\/localhost(?::\d+)?\/\?s=/,
  );
  await act(async () => {});
  act(() => root.unmount());
  host.remove();
});
