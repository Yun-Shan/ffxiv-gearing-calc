import { describe, expect, it } from "vitest";
import { buildShareUrl, sharePrefix } from "./url.ts";

describe("location-derived sharing URL", () => {
  it.each([
    [
      "http://127.0.0.1:5173/single?foo=1#/joint",
      "http://127.0.0.1:5173/single?s=",
    ],
    [
      "https://example.com/ffxiv-gearing-calc/?old=1#/joint",
      "https://example.com/ffxiv-gearing-calc/?s=",
    ],
    ["https://example.com/joint#test", "https://example.com/joint?s="],
    ["https://example.com/", "https://example.com/?s="],
  ])(
    "preserves origin/path and removes search/hash for %s",
    (location, prefix) => {
      expect(sharePrefix(location)).toBe(prefix);
      expect(buildShareUrl("AQ", location)).toBe(prefix + "AQ");
    },
  );
  it("includes the actual location prefix in the complete link budget", () => {
    const base = "https://example.com/long-path/",
      prefix = sharePrefix(base),
      token = "A".repeat(32768 - prefix.length);
    expect(buildShareUrl(token, base).length).toBe(32768);
    expect(() => buildShareUrl(token + "A", base)).toThrow(/容量/);
  });
});
