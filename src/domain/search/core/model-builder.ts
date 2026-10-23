import type { ModelRow } from "./model-types.ts";
import type { RowSense } from "./model-types.ts";

export function addTerm(terms: Map<string, number>, name: string, coefficient: number): void {
  if (coefficient === 0) return;
  const sum = (terms.get(name) ?? 0) + coefficient;
  if (sum === 0) terms.delete(name);
  else terms.set(name, sum);
}

export function addRows(
  rows: ModelRow[],
  name: string,
  terms: ReadonlyMap<string, number> | readonly (readonly [string, number])[],
  sense: RowSense,
  rhs: number,
): void {
  const map = terms instanceof Map ? new Map(terms) : new Map(terms);
  for (const [variable, coefficient] of map) {
    if (!Number.isSafeInteger(coefficient)) {
      throw new RangeError(`模型行 ${name} 的系数不是安全整数：${coefficient}`);
    }
    if (coefficient === 0) map.delete(variable);
  }
  if (!Number.isSafeInteger(rhs)) {
    throw new RangeError(`模型行 ${name} 的右侧不是安全整数：${rhs}`);
  }
  rows.push({ name, terms: map, sense, rhs });
}
