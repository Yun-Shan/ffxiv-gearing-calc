import { describe, expect, it } from "vitest";
import {
  insertParetoCandidate,
  paretoRingCandidates,
  type ParetoCandidate,
  type RingParetoCandidate,
} from "./candidate-pareto.ts";

function point(id: string, attributes: number[], order: number): ParetoCandidate<string> {
  return { value: id, attributes, order };
}

describe("incremental exact Pareto frontier", () => {
  it("removes dominated points while retaining incomparable tradeoffs", () => {
    const frontier: ParetoCandidate<string>[] = [];
    expect(insertParetoCandidate(frontier, point("balanced", [10, 10], 0)).accepted).toBe(true);
    expect(insertParetoCandidate(frontier, point("speed", [12, 8], 1)).accepted).toBe(true);

    const insertion = insertParetoCandidate(frontier, point("strong", [11, 11], 2));
    expect(insertion.accepted).toBe(true);
    expect(insertion.removed.map(({ value }) => value)).toEqual(["balanced"]);
    expect(frontier.map(({ value }) => value)).toEqual(["speed", "strong"]);

    expect(insertParetoCandidate(frontier, point("weak", [9, 7], 3)).accepted).toBe(false);
    expect(frontier.map(({ value }) => value)).toEqual(["speed", "strong"]);
  });

  it("keeps distinct constrained-speed coordinates and collapses only equal vectors", () => {
    const frontier: ParetoCandidate<string>[] = [];
    insertParetoCandidate(frontier, point("slow", [100, 20], 0), 0);
    expect(insertParetoCandidate(frontier, point("fast", [110, 30], 1), 0).accepted).toBe(true);
    expect(insertParetoCandidate(frontier, point("same-as-slow", [100, 20], 2), 0).accepted).toBe(false);
    expect(frontier.map(({ value }) => value)).toEqual(["slow", "fast"]);
  });

  it("rejects malformed vectors instead of silently comparing partial attributes", () => {
    const frontier: ParetoCandidate<string>[] = [point("first", [1, 2], 0)];
    expect(() => insertParetoCandidate(frontier, point("short", [2], 1))).toThrow(RangeError);
    expect(frontier.map(({ value }) => value)).toEqual(["first"]);
  });

  it("keeps a weaker unique ring when the stronger unique item would conflict with its only partner", () => {
    const candidate = (
      value: string,
      itemId: number,
      isUnique: boolean,
      attributes: number[],
      order: number,
    ): RingParetoCandidate<string> => ({ value, itemId, isUnique, attributes, order });
    const ringSlot = [
      candidate("strong-X", 10, true, [100, 100], 0),
      candidate("weaker-Y", 20, true, [90, 90], 1),
      candidate("weak-repeatable", 30, false, [80, 80], 2),
    ];
    const oppositeSlot = [candidate("only-partner-X", 10, true, [50, 50], 0)];

    const retained = paretoRingCandidates(ringSlot, oppositeSlot);

    expect(retained.map(({ value }) => value)).toEqual([
      "strong-X",
      "weaker-Y",
    ]);
  });

  it("lets an all-compatible non-unique candidate prune a dominated conflicting unique ring", () => {
    const candidate = (
      value: string,
      itemId: number,
      isUnique: boolean,
      attributes: number[],
      order: number,
    ): RingParetoCandidate<string> => ({ value, itemId, isUnique, attributes, order });
    const ringSlot = [
      candidate("non-unique-strong", 20, false, [100, 100], 0),
      candidate("unique-X-weak", 10, true, [90, 90], 1),
    ];
    const oppositeSlot = [candidate("only-partner-X", 10, true, [50, 50], 0)];

    const retained = paretoRingCandidates(ringSlot, oppositeSlot);

    expect(retained.map(({ value }) => value)).toEqual(["non-unique-strong"]);
  });

  it("does not let a stronger conflicting unique ring prune an all-compatible candidate", () => {
    const candidate = (
      value: string,
      itemId: number,
      isUnique: boolean,
      attributes: number[],
      order: number,
    ): RingParetoCandidate<string> => ({ value, itemId, isUnique, attributes, order });
    const ringSlot = [
      candidate("unique-X-strong", 10, true, [100, 100], 0),
      candidate("non-unique-Y-weaker", 20, false, [90, 90], 1),
    ];
    const oppositeSlot = [candidate("only-partner-X", 10, true, [50, 50], 0)];

    const retained = paretoRingCandidates(ringSlot, oppositeSlot);

    expect(retained.map(({ value }) => value)).toEqual([
      "unique-X-strong",
      "non-unique-Y-weaker",
    ]);
  });

  it("prunes within conflicting IDs and across compatibility supersets", () => {
    const candidate = (
      value: string,
      itemId: number,
      isUnique: boolean,
      attributes: number[],
      order: number,
    ): RingParetoCandidate<string> => ({ value, itemId, isUnique, attributes, order });
    const ringSlot = [
      candidate("unique-X-weak", 10, true, [80, 80], 0),
      candidate("unique-X-strong", 10, true, [120, 120], 1),
      candidate("unique-Y-strong", 20, true, [110, 110], 2),
      candidate("repeatable-weak", 30, false, [70, 70], 3),
      candidate("repeatable-strong", 40, false, [100, 100], 4),
    ];
    const oppositeSlot = [candidate("opposite-X", 10, true, [50, 50], 0)];

    const retained = paretoRingCandidates(ringSlot, oppositeSlot);

    expect(retained.map(({ value }) => value)).toEqual([
      "unique-X-strong",
      "unique-Y-strong",
    ]);
  });

  it("requires equal speed when ring Pareto pruning is used with a speed-constrained search", () => {
    const candidate = (
      value: string,
      attributes: number[],
      order: number,
    ): RingParetoCandidate<string> => ({ value, itemId: order + 1, isUnique: false, attributes, order });

    const retained = paretoRingCandidates([
      candidate("slow", [100, 20], 0),
      candidate("fast", [110, 30], 1),
    ], [], 0);

    expect(retained.map(({ value }) => value)).toEqual(["slow", "fast"]);
  });
});
