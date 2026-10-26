import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import config, { applicationBaseFromHtml } from "../vite.config";

describe("HTML deployment base", () => {
  it.each(["/", "/ffxiv-gearing-calc/", "/single/", "/joint/"])(
    "uses the literal path %s",
    (base) => {
      expect(
        applicationBaseFromHtml(`<head><base href="${base}" /></head>`),
      ).toBe(base);
    },
  );

  it("accepts a single quoted href and ignores commented examples", () => {
    expect(
      applicationBaseFromHtml(
        `<!-- <base href="/example/"> --><base href='/app/'>`,
      ),
    ).toBe("/app/");
  });

  it.each([
    ["/配装/", "/%E9%85%8D%E8%A3%85/"],
    ["/app/../tools/", "/tools/"],
    ["/app/%2e%2e/tools/", "/tools/"],
  ])("normalizes deployment base %s to URL.pathname", (literal, pathname) => {
    expect(applicationBaseFromHtml(`<base href="${literal}">`)).toBe(pathname);
  });

  it.each([
    "",
    '<base target="_blank">',
    '<base href="/one/"><base href="/two/">',
    '<base href="">',
    '<base href="./">',
    '<base href="app/">',
    '<base href="/app">',
    '<base href="https://example.com/app/">',
    '<base href="//example.com/app/">',
    '<base href="/app/?query/">',
    '<base href="/app/#fragment/">',
    '<base href="/app\\child/">',
    '<base href="/app child/">',
    '<base href="/app&#47;">',
  ])("rejects invalid HTML base %s", (html) => {
    expect(() => applicationBaseFromHtml(html)).toThrow(
      "index.html must contain exactly one",
    );
  });

  it("uses the checked-in HTML value for Vite", () => {
    const html = readFileSync(resolve("index.html"), "utf8");
    expect(config.base).toBe(applicationBaseFromHtml(html));
  });
});
