import type { ModelRow } from "./model-types.ts";
import type { VariableBounds } from "./model-types.ts";

export function validateMipSolution(
  rows: readonly ModelRow[],
  bounds: readonly VariableBounds[],
  columns: Record<string, { Primal: number }>,
): void {
  const integerValues = new Map<string, bigint>();
  for (const bound of bounds) {
    const primal = columns[bound.name]?.Primal;
    const value = primal ?? (bound.min === 0 ? 0 : bound.min === bound.max ? bound.min : undefined);
    if (value === undefined || !Number.isFinite(value)) {
      throw new Error(`HiGHS 最优解缺少变量 ${bound.name}`);
    }
    const rounded = Math.round(value);
    if (!Number.isSafeInteger(rounded) || Math.abs(value - rounded) > 1e-5) {
      throw new Error(`HiGHS 变量 ${bound.name} 不是可靠整数：${value}`);
    }
    if (rounded < bound.min || rounded > bound.max) {
      throw new Error(`HiGHS 变量 ${bound.name} 超出上下界：${rounded}`);
    }
    integerValues.set(bound.name, BigInt(rounded));
  }
  for (const row of rows) {
    let lhs = 0n;
    for (const [name, coefficient] of row.terms) {
      const value = integerValues.get(name);
      if (value === undefined) throw new Error(`模型行 ${row.name} 引用了未知变量 ${name}`);
      lhs += BigInt(coefficient) * value;
    }
    const rhs = BigInt(row.rhs);
    const valid = row.sense === "=" ? lhs === rhs : row.sense === "<=" ? lhs <= rhs : lhs >= rhs;
    if (!valid) {
      throw new Error(`HiGHS 最优解不满足整数模型行 ${row.name}：${lhs} ${row.sense} ${rhs}`);
    }
  }
}
