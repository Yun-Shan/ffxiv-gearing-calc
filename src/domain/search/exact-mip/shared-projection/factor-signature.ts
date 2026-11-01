import type { ProjectionClass, ProjectionJob } from "./types.ts";

/** One food is applied to every coordinate of this equipment vector. */
export function projectionClass(
  job: ProjectionJob,
  food: number,
  axis: number,
  raw: number,
): ProjectionClass | undefined {
  const rule = job.foods[food]!.bonuses[axis];
  let value = BigInt(raw);
  if (rule) {
    const bonus =
      (value * BigInt(rule.numerator) + BigInt(rule.offset)) /
      BigInt(rule.denominator);
    value += bonus < BigInt(rule.cap) ? bonus : BigInt(rule.cap);
  }
  const classes = job.axes[axis]!.classes;
  let low = 0,
    high = classes.length;
  while (low < high) {
    const mid = low + Math.floor((high - low) / 2);
    if (BigInt(classes[mid]!.max) < value) low = mid + 1;
    else high = mid;
  }
  const found = classes[low];
  return found && BigInt(found.min) <= value ? found : undefined;
}

export function qualifyingSignature(
  job: ProjectionJob,
  raw: readonly number[],
  food: number,
): string[] | undefined {
  const selectors: string[] = [];
  let sum = 0n;
  for (let axis = 0; axis < job.axes.length; axis++) {
    const cls = projectionClass(job, food, axis, raw[axis]!);
    if (!cls) return undefined;
    selectors.push(cls.selector);
    sum += BigInt(cls.q);
  }
  return sum >= BigInt(job.rhs) ? selectors : undefined;
}
