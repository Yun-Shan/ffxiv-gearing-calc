import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { applySyncLimit } from "./equipment-sync.ts";

describe("applySyncLimit", () => {
  it("caps an item-level 795 weapon damage value at its 735 sync limit", () => {
    assert.equal(applySyncLimit(158, 146), 146);
  });

  it("keeps a weapon damage value that is already below the sync limit", () => {
    assert.equal(applySyncLimit(145, 146), 145);
  });

  it("keeps the original weapon damage when level sync is disabled", () => {
    assert.equal(applySyncLimit(158, undefined), 158);
  });
});
