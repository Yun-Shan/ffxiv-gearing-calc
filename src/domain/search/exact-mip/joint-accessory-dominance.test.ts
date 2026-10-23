import { afterEach, describe, expect, test, vi } from "vitest";
import type { EquipInfo, SharedSlotProjection } from "../types.ts";
import type { JointPreparedJob } from "./joint-types.ts";
import type {
  SharedEquipmentDomain,
  SharedEquipmentEntry,
} from "./joint-model.ts";
import type { ModelRow } from "../core/model-types.ts";
import { prepareJointAccessoryDominance } from "./joint-accessory-dominance.ts";

const equip = (itemId: number): EquipInfo => ({
  itemId,
  itemLevel: 100,
  key: String(itemId),
  baseParams: [],
  PDMG: 0,
  MDMG: 0,
  DLY: 0,
});

function fixture() {
  const domains: SharedEquipmentDomain[] = [
    { slot: "earrings", keys: new Set(["low", "high"]), choices: [] },
    { slot: "necklace", keys: new Set(["only"]), choices: [] },
  ];
  const jobs = [0, 1].map(() => {
    const earringEntries = new Map<string, SharedEquipmentEntry>([
      ["low", { equipment: equip(1), variables: [], attributes: [2, 5] }],
      ["high", { equipment: equip(2), variables: [], attributes: [4, 5] }],
    ]);
    const necklaceEntries = new Map<string, SharedEquipmentEntry>([
      ["only", { equipment: equip(3), variables: [], attributes: [3, 1] }],
    ]);
    domains[0]!.choices.push(earringEntries);
    domains[1]!.choices.push(necklaceEntries);
    // This phase only reads the original slot layout and candidate item IDs.
    return {
      originalJob: {
        slotNames: ["earrings", "necklace", "weapon"],
        options: { slots: [[equip(1), equip(2)], [equip(3)], [equip(99)]] },
      },
    } as unknown as JointPreparedJob;
  });
  const model = {
    rows: [] as ModelRow[],
    sharedEquipmentDomains: domains,
    sharedEquipmentSelectors: new Map([
      [
        "earrings",
        new Map([
          ["low", "e0"],
          ["high", "e1"],
        ]),
      ],
      ["necklace", new Map([["only", "n0"]])],
    ]),
  };
  const run = (
    overrides: {
      enabled?: boolean;
      projections?: Map<string, SharedSlotProjection>;
      budgetMs?: number;
      cancelled?: () => boolean;
    } = {},
  ) =>
    prepareJointAccessoryDominance(
      overrides.enabled ?? true,
      jobs,
      model,
      overrides.projections ?? new Map(),
      overrides.budgetMs ?? 10_000,
      overrides.cancelled ?? (() => false),
    );
  return { model, domains, jobs, run };
}

afterEach(() => vi.restoreAllMocks());

describe("shared accessory dominance preparation", () => {
  test("cuts a strictly dominated pair while retaining the exhaustive optimum", () => {
    vi.spyOn(performance, "now").mockReturnValue(0);
    const { model, run } = fixture();
    const statistics = run();
    expect(statistics.sharedAccessoryPairDominanceCandidateUpperBound).toBe(2n);
    expect(statistics.sharedAccessoryPairDominanceCandidateCount).toBe(2);
    expect(statistics.sharedAccessoryPairDominanceComparisons).toBe(1);
    expect(statistics.sharedAccessoryPairDominanceCuts).toBe(1);
    expect(statistics.sharedAccessoryPairDominanceLimitReached).toBe(false);
    expect(statistics.sharedAccessoryPairDominanceMaximumCuts).toBe(64);
    expect(statistics.sharedAccessoryPairDominanceMaximumComparisons).toBe(
      75_000,
    );
    expect(statistics.sharedAccessoryPairDominancePreprocessingBudgetMs).toBe(
      100,
    );
    expect(statistics.sharedAccessoryPairDominancePreprocessingMs).toBe(0);
    expect(model.rows).toEqual([
      {
        name: "shared_accessory_pair_dominance_0",
        terms: new Map([
          ["e0", 1],
          ["n0", 1],
        ]),
        sense: "<=",
        rhs: 1,
      },
    ]);
    const assignments = [
      {
        values: new Map([
          ["e0", 1],
          ["e1", 0],
          ["n0", 1],
        ]),
        score: 11,
      },
      {
        values: new Map([
          ["e0", 0],
          ["e1", 1],
          ["n0", 1],
        ]),
        score: 13,
      },
    ];
    const retained = assignments.filter(({ values }) =>
      model.rows.every(
        (row) =>
          [...row.terms].reduce(
            (sum, [variable, coefficient]) =>
              sum + values.get(variable)! * coefficient,
            0,
          ) <= row.rhs,
      ),
    );
    expect(retained).toEqual([assignments[1]]);
    expect(Math.max(...retained.map(({ score }) => score))).toBe(
      Math.max(...assignments.map(({ score }) => score)),
    );
  });

  test.each([
    "plain",
    "ring-child",
    "unknown-outside-id",
    "missing-slot",
  ] as const)(
    "keeps pairs when replacement safety is unproved: %s",
    (reason) => {
      const { jobs, model, run } = fixture();
      if (reason === "missing-slot")
        jobs[1]!.originalJob.slotNames = ["earrings", "other", "weapon"];
      else {
        const outside =
          reason === "plain"
            ? equip(2)
            : reason === "unknown-outside-id"
              ? equip(NaN)
              : {
                  ...equip(100),
                  ringEquips: [equip(2), equip(101)],
                };
        jobs[1]!.originalJob.options.slots = [
          [equip(1), equip(2)],
          [equip(3)],
          [outside],
        ];
      }
      expect(run().sharedAccessoryPairDominanceCuts).toBe(0);
      expect(model.rows).toEqual([]);
    },
  );

  test("an accessory item repeated in the pair cannot serve as a replacement", () => {
    const { domains, run } = fixture();
    for (const choices of domains[0]!.choices)
      choices.get("high")!.equipment = equip(3);
    expect(run().sharedAccessoryPairDominanceCuts).toBe(0);
  });

  test.each([
    undefined,
    [-1, 5],
    [1.5, 5],
    [Number.MAX_SAFE_INTEGER, 5],
    [4],
  ] as const)(
    "does not prune using incomplete or invalid attribute vectors: %j",
    (attributes) => {
      const { domains, run, model } = fixture();
      domains[0]!.choices[1]!.get("high")!.attributes = attributes;
      expect(run().sharedAccessoryPairDominanceCuts).toBe(0);
      expect(model.rows).toEqual([]);
    },
  );

  test("requires dominance for every job and every coordinate", () => {
    const { domains, run } = fixture();
    domains[0]!.choices[1]!.get("high")!.attributes = [4, 4];
    expect(run().sharedAccessoryPairDominanceCuts).toBe(0);
  });

  test.each([
    "disabled",
    "projection",
    "split-domain",
    "missing-selector",
    "missing-entry",
  ] as const)("skips unsupported or incomplete domains: %s", (reason) => {
    const { domains, model, run } = fixture();
    if (reason === "split-domain") domains[1]!.splitPair = true;
    if (reason === "missing-selector")
      model.sharedEquipmentSelectors.delete("necklace");
    if (reason === "missing-entry") domains[1]!.choices[1]!.delete("only");
    const stats = run({
      enabled: reason !== "disabled",
      projections:
        reason === "projection"
          ? new Map([
              [
                "necklace",
                {
                  commonSlot: "necklace",
                  slotName: "pair",
                  ringIndex: 0,
                },
              ],
            ])
          : undefined,
    });
    expect(stats.sharedAccessoryPairDominanceCuts).toBe(0);
    expect(model.rows).toEqual([]);
  });

  test("missing individual selectors do not produce a partial exclusion row", () => {
    const { model, run } = fixture();
    model.sharedEquipmentSelectors.get("earrings")!.delete("high");
    expect(run().sharedAccessoryPairDominanceCandidateCount).toBe(1);
    expect(model.rows).toEqual([]);
  });

  test.each(["zero-budget", "cancelled", "candidate-budget"] as const)(
    "stops conservatively on %s",
    (reason) => {
      const { domains, run, model } = fixture();
      if (reason === "candidate-budget") {
        for (const domain of domains)
          domain.keys = new Set(
            Array.from({ length: 225 }, (_, i) => String(i)),
          );
      }
      const stats = run({
        budgetMs: reason === "zero-budget" ? 0 : undefined,
        cancelled: () => reason === "cancelled",
      });
      expect(stats.sharedAccessoryPairDominanceLimitReached).toBe(true);
      expect(stats.sharedAccessoryPairDominanceCuts).toBe(0);
      expect(stats.sharedAccessoryPairDominanceCandidateCount).toBe(0);
      expect(model.rows).toEqual([]);
    },
  );
});
