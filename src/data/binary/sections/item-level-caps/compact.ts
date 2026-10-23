import { assertUInt, fail } from "../../shared/bytes.ts";
import { CAP_COLUMNS } from "./schema.ts";

export interface CompactLevelCaps {
  levels: number[];
  columns: number[][];
  references: number[];
}

function assertRecord(
  value: unknown,
): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("ITEM_LEVEL_CAPS_BINARY levelCaps 不是记录");
}

function assertAscendingLevels(levels: number[]): void {
  if (!levels.length) fail("ITEM_LEVEL_CAPS_BINARY levelCaps.level 不能为空");
  levels.forEach((level, index) =>
    assertUInt(level, 16, `ITEM_LEVEL_CAPS_BINARY levelCaps.level[${index}]`),
  );
  for (let index = 1; index < levels.length; index++) {
    if (levels[index] <= levels[index - 1])
      fail("ITEM_LEVEL_CAPS_BINARY levelCaps.level 必须严格递增");
  }
}

function columnKey(values: readonly number[]): string {
  return values.join(",");
}

export function compactLevelCaps(value: unknown): CompactLevelCaps {
  assertRecord(value);
  for (const field of Object.keys(value))
    if (field !== "levelCaps")
      fail(`ITEM_LEVEL_CAPS_BINARY 含未定义字段 ${field}`);
  if (!Object.hasOwn(value, "levelCaps"))
    fail("ITEM_LEVEL_CAPS_BINARY 缺少 levelCaps");
  const levelCaps = value.levelCaps;
  assertRecord(levelCaps);

  const expectedFields = new Set(["level", ...CAP_COLUMNS]);
  for (const field of Object.keys(levelCaps))
    if (!expectedFields.has(field))
      fail(`ITEM_LEVEL_CAPS_BINARY levelCaps 含未定义字段 ${field}`);
  for (const field of expectedFields)
    if (!Object.hasOwn(levelCaps, field))
      fail(`ITEM_LEVEL_CAPS_BINARY levelCaps 缺少字段 ${field}`);

  const levels = levelCaps.level;
  if (!Array.isArray(levels))
    fail("ITEM_LEVEL_CAPS_BINARY levelCaps.level 不是数组");
  assertAscendingLevels(levels);

  const columns: number[][] = [];
  const references: number[] = [];
  const columnIndexes = new Map<string, number>();
  for (const field of CAP_COLUMNS) {
    const values = levelCaps[field];
    if (!Array.isArray(values))
      fail(`ITEM_LEVEL_CAPS_BINARY levelCaps.${field} 不是数组`);
    if (values.length !== levels.length)
      fail(`ITEM_LEVEL_CAPS_BINARY levelCaps.${field} 长度与 level 不符`);
    values.forEach((value, index) =>
      assertUInt(
        value,
        16,
        `ITEM_LEVEL_CAPS_BINARY levelCaps.${field}[${index}]`,
      ),
    );

    const key = columnKey(values);
    let columnIndex = columnIndexes.get(key);
    if (columnIndex === undefined) {
      columnIndex = columns.length;
      columnIndexes.set(key, columnIndex);
      columns.push([...values]);
    }
    references.push(columnIndex);
  }
  return { levels: [...levels], columns, references };
}

export function expandLevelCaps(value: unknown): {
  levelCaps: Record<string, number[]>;
} {
  assertRecord(value);
  const levels = value.levels;
  const columns = value.columns;
  const references = value.references;
  if (
    !Array.isArray(levels) ||
    !Array.isArray(columns) ||
    !Array.isArray(references)
  )
    fail("ITEM_LEVEL_CAPS_BINARY 压缩上限表结构无效");
  assertAscendingLevels(levels);
  if (!columns.length || columns.length > CAP_COLUMNS.length)
    fail("ITEM_LEVEL_CAPS_BINARY 上限列字典数量无效");
  if (references.length !== CAP_COLUMNS.length)
    fail("ITEM_LEVEL_CAPS_BINARY 上限列引用数量无效");

  const seenColumns = new Set<string>();
  for (const [index, column] of columns.entries()) {
    if (!Array.isArray(column) || column.length !== levels.length)
      fail(`ITEM_LEVEL_CAPS_BINARY 上限列字典 ${index} 长度无效`);
    const key = columnKey(column);
    if (seenColumns.has(key)) fail("ITEM_LEVEL_CAPS_BINARY 上限列字典含重复列");
    seenColumns.add(key);
  }

  const levelCaps: Record<string, number[]> = { level: [...levels] };
  for (const [index, field] of CAP_COLUMNS.entries()) {
    const reference = references[index];
    if (
      !Number.isInteger(reference) ||
      reference < 0 ||
      reference >= columns.length
    )
      fail(`ITEM_LEVEL_CAPS_BINARY ${field} 列引用越界`);
    // Keep each business field independently mutable, even when wire columns share storage.
    levelCaps[field] = [...columns[reference]];
  }
  return { levelCaps };
}
