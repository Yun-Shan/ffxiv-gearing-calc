import { describe, expect, test } from "vitest";
import type { ModelRow, VariableBounds } from "../core/model-types.ts";
import { assembleJointRatioEnvelope } from "./joint-ratio-envelope.ts";
import {
  factorDomain,
  factorAssignments,
  rowSatisfied,
} from "./joint-factor-domain.helper.test.ts";

describe("integer normalized-ratio envelope", () => {
  test("upward rounding and pair rows preserve the true product for every small-model assignment", () => {
    const domain = factorDomain(2);
    const model = {
      rows: [] as ModelRow[],
      bounds: [] as VariableBounds[],
      generals: [] as string[],
      prefix: domain.prefix,
    };
    const envelope = assembleJointRatioEnvelope(
      { objective: "dps" },
      domain.preparedJobs,
      model,
      domain.candidates,
    );
    expect(
      envelope.ratioUpperCoefficientExact({ numerator: 1n, denominator: 3n }),
    ).toBe(333_333_334n);
    expect(
      envelope.ratioUpperCoefficientExact({ numerator: 3n, denominator: 2n }),
    ).toBe(1_000_000_000n);
    expect(
      envelope.ratioUpperCoefficientExact({ numerator: 0n, denominator: 2n }),
    ).toBe(0n);
    expect(envelope.ratioUpperBoundPairCutCount).toBeGreaterThan(0);
    expect(envelope.ratioUpperBoundPairPreprocessingWork).toBe(54);
    expect(envelope.ratioUpperBoundObjectiveEnabled).toBe(true);
    expect([...envelope.ratioUpperBoundObjective]).toEqual([
      ["joint_ratio_upper_0", 1],
      ["joint_ratio_upper_1", 1],
    ]);
    expect(model.generals).toEqual(envelope.ratioUpperBoundVariables);
    expect(model.bounds).toEqual(
      envelope.ratioUpperBoundVariables.map((name) => ({
        name,
        min: 0,
        max: 1_000_000_000,
      })),
    );
    for (const { selected, scores } of factorAssignments(domain)) {
      const point = new Map(selected);
      for (let job = 0; job < 2; job++)
        point.set(
          envelope.ratioUpperBoundVariables[job]!,
          Number((scores[job]! * 1_000_000_000n + 999_999n) / 1_000_000n),
        );
      expect(model.rows.every((row) => rowSatisfied(row, point))).toBe(true);
    }
    const pair = model.rows.find(({ name }) => name.includes("pair_upper"))!;
    const impossible = new Map(
      [...pair.terms].map(([name, coefficient]) => [
        name,
        coefficient > 0
          ? name.startsWith("joint_ratio")
            ? 1_000_000_000
            : 1
          : 0,
      ]),
    );
    expect(rowSatisfied(pair, impossible)).toBe(false);
  });

  test("disabled pair policy retains all single-group envelope rows", () => {
    const domain = factorDomain();
    const model = {
      rows: [] as ModelRow[],
      bounds: [] as VariableBounds[],
      generals: [] as string[],
      prefix: domain.prefix,
    };
    const result = assembleJointRatioEnvelope(
      { objective: "damage", ratioUpperPairPolicy: "disabled" },
      domain.preparedJobs,
      model,
      domain.candidates,
    );
    expect(result.ratioUpperBoundPairCutCount).toBe(0);
    expect(result.ratioUpperBoundPairPreprocessingWork).toBe(0);
    expect(model.rows).toHaveLength(6);
  });

  test("damage objective omits GCD while DPS requires its complete factor domain", () => {
    const domain = factorDomain(1, ["crt", "gcd"]);
    domain.candidates.factorClassUpperBounds =
      domain.candidates.factorClassUpperBounds.filter(
        ({ groupName }) => groupName !== "gcd",
      );
    const model = () => ({
      rows: [] as ModelRow[],
      bounds: [] as VariableBounds[],
      generals: [] as string[],
      prefix: domain.prefix,
    });
    expect(() =>
      assembleJointRatioEnvelope(
        { objective: "damage" },
        domain.preparedJobs,
        model(),
        domain.candidates,
      ),
    ).not.toThrow();
    expect(() =>
      assembleJointRatioEnvelope(
        { objective: "dps" },
        domain.preparedJobs,
        model(),
        domain.candidates,
      ),
    ).toThrow(/缺少完整类别.*gcd/);
  });
});
