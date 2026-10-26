// @vitest-environment jsdom
import { expect, it } from "vitest";
import { isPlainNavigation } from "./navigation";

it("runs reset actions only for ordinary current-tab anchor clicks", () => {
  const click = {
    button: 0,
    defaultPrevented: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
  };
  expect(isPlainNavigation(click)).toBe(true);
  expect(isPlainNavigation(click, "_self")).toBe(true);
  for (const key of [
    "ctrlKey",
    "metaKey",
    "shiftKey",
    "altKey",
    "defaultPrevented",
  ] as const)
    expect(isPlainNavigation({ ...click, [key]: true })).toBe(false);
  expect(isPlainNavigation({ ...click, button: 1 })).toBe(false);
  expect(isPlainNavigation(click, "_blank")).toBe(false);
});
