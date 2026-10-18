// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { FaqPage } from "./FaqPage";
import { faqEntries } from "./faq-content";
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("常见问题页", () => {
  it("每条问答都由同一组件渲染在同一列表容器内", () => {
    const host = document.createElement("div"),
      root = createRoot(host);
    act(() => root.render(<FaqPage />));

    const list = host.querySelector<HTMLElement>(
      'section[aria-label="常见问题列表"]',
    );
    expect(list).not.toBeNull();
    const items = [...list!.querySelectorAll("article")];
    expect(items).toHaveLength(faqEntries.length);
    items.forEach((item, index) => {
      expect(item.querySelector("h2")?.textContent).toBe(
        faqEntries[index]!.question,
      );
      expect(item.querySelector("p")?.textContent?.trim().length).toBeGreaterThan(
        0,
      );
    });
    const feedbackButton = list!.querySelector<HTMLButtonElement>("button");
    expect(feedbackButton).not.toBeNull();
    expect(feedbackButton!.textContent).toBe("反馈入口");
    expect(feedbackButton!.type).toBe("button");

    act(() => root.unmount());
  });
});
