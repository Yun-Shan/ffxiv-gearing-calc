import type { JointPreparedJob, ExactRatio } from "./joint-types.ts";
import type { FactorClassUpperBound } from "./joint-candidate-bounds.ts";
import type { ModelRow } from "../core/model-types.ts";

export function factorDomain(
  jobCount = 2,
  names = ["det", "crt", "dht"],
  values = [70, 80, 100],
) {
  const preparedJobs = Array.from(
    { length: jobCount },
    () =>
      ({
        prepared: {
          groups: names.map((name) => ({
            name,
            classes: values.map((value, index) => ({
              variable: `${name}_${index}`,
              value,
              min: index,
              max: index,
              q: 0,
            })),
          })),
        },
      }) as unknown as JointPreparedJob,
  );
  const bounds: FactorClassUpperBound[] = preparedJobs.flatMap(
    ({ prepared }, jobIndex) =>
      prepared.groups.flatMap((group) =>
        group.classes.map((entry) => ({
          jobIndex,
          groupName: group.name,
          variable: entry.variable,
          rowName: `bound_${jobIndex}_${entry.variable}`,
          ratio: { numerator: BigInt(entry.value), denominator: 100n },
        })),
      ),
  );
  const compareExactRatios = (left: ExactRatio, right: ExactRatio) => {
    const difference =
      left.numerator * right.denominator - right.numerator * left.denominator;
    return difference < 0n ? -1 : difference > 0n ? 1 : 0;
  };
  const candidates = {
    factorClassUpperBounds: bounds,
    factorClassUpperBoundsByJobAndGroup: preparedJobs.map(
      (_, jobIndex) =>
        new Map(
          names.map((name) => [
            name,
            bounds.filter(
              (bound) =>
                bound.jobIndex === jobIndex && bound.groupName === name,
            ),
          ]),
        ),
    ),
    compareExactRatios,
  };
  const prefix = (index: number, name: string) => `j${index}_${name}`;
  return { preparedJobs, candidates, prefix };
}

export const rowSatisfied = (
  row: ModelRow,
  assignment: ReadonlyMap<string, number>,
) => {
  const total = [...row.terms].reduce(
    (sum, [name, coefficient]) =>
      sum + coefficient * (assignment.get(name) ?? 0),
    0,
  );
  return row.sense === "<="
    ? total <= row.rhs
    : row.sense === ">="
      ? total >= row.rhs
      : total === row.rhs;
};

/** Exhaust the tiny independent factor domain; no solver or production pruning is used. */
export function factorAssignments(domain: ReturnType<typeof factorDomain>) {
  const { preparedJobs, prefix } = domain;
  const groups = preparedJobs.flatMap(({ prepared }, jobIndex) =>
    prepared.groups.map((group) => ({ jobIndex, group })),
  );
  const result: { selected: Map<string, number>; scores: bigint[] }[] = [];
  const visit = (
    index: number,
    selected: Map<string, number>,
    scores: bigint[],
  ) => {
    if (index === groups.length) {
      result.push({ selected, scores });
      return;
    }
    const { jobIndex, group } = groups[index]!;
    for (const entry of group.classes) {
      const nextScores = [...scores];
      nextScores[jobIndex] = nextScores[jobIndex]! * BigInt(entry.value);
      visit(
        index + 1,
        new Map([...selected, [prefix(jobIndex, entry.variable), 1]]),
        nextScores,
      );
    }
  };
  visit(
    0,
    new Map(),
    preparedJobs.map(() => 1n),
  );
  return result;
}
