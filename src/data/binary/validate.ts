import { assertUInt, fail } from "./shared/bytes.ts";

const LEVEL_CAP_STATS = [
  "STR",
  "DEX",
  "VIT",
  "INT",
  "MND",
  "PIE",
  "GP",
  "CP",
  "PDMG",
  "MDMG",
  "TEN",
  "DHT",
  "CRT",
  "DET",
  "SKS",
  "SPS",
  "CMS",
  "CRL",
  "GTH",
  "PCP",
] as const;
type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(
  value: unknown,
  keys: readonly string[],
): value is RecordValue {
  return (
    isRecord(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

/** Cross-section metadata invariants retained from the format-9 generic payload. */
export function validateGameDataMetadata(
  gameData: unknown,
  label: string,
): void {
  if (
    !isRecord(gameData) ||
    !isRecord(gameData.jobSchemas) ||
    !isRecord(gameData.jobs) ||
    !isRecord(gameData.sync) ||
    !Array.isArray(gameData.foods)
  )
    fail(`${label} 缺少职业、食物或同步选择数据`);
  for (const key of ["syncLevels", "syncLevelOfJobLevels", "syncLevelDuties"])
    if (Object.hasOwn(gameData, key))
      fail(`${label} 仍包含已移除的旧同步数据字段`);

  const jobSchemas = gameData.jobSchemas;
  const jobs = gameData.jobs;
  const schemaIds = Object.keys(jobSchemas);
  const jobIds = Object.keys(jobs);
  if (
    !schemaIds.length ||
    schemaIds.length !== jobIds.length ||
    schemaIds.some((jobId) => !Object.hasOwn(jobs, jobId))
  )
    fail(`${label} 的 jobs 与 jobSchemas 职业范围不一致`);
  const numericJobIds = new Set<number>();
  for (const jobId of jobIds) {
    const job = jobs[jobId];
    const schema = jobSchemas[jobId];
    if (
      !isRecord(job) ||
      !Number.isSafeInteger(job.id) ||
      (job.id as number) <= 0 ||
      typeof job.name !== "string" ||
      !job.name.trim() ||
      job.abbreviation !== jobId ||
      !isRecord(schema) ||
      schema.name !== job.name
    )
      fail(`${label} 的职业 ${jobId} 元数据无效`);
    assertUInt(job.id as number, 32, `${label} 的职业 ${jobId} 数字 ID`);
    if (numericJobIds.has(job.id as number))
      fail(`${label} 的职业数字 ID 重复：${job.id}`);
    numericJobIds.add(job.id as number);
  }

  for (const food of gameData.foods) {
    if (
      !isRecord(food) ||
      !Number.isSafeInteger(food.icon) ||
      (food.icon as number) <= 0
    )
      fail(`${label} 的食物缺少有效 icon`);
    assertUInt(food.icon as number, 32, `${label} 食物图标 ID`);
  }

  const levelCaps = gameData.levelCaps;
  if (
    !isRecord(levelCaps) ||
    !Array.isArray(levelCaps.level) ||
    !levelCaps.level.length
  )
    fail(`${label} 缺少 ItemLevel 属性上限目录`);
  for (const stat of LEVEL_CAP_STATS)
    if (!Object.hasOwn(levelCaps, stat))
      fail(`${label} 缺少 ItemLevel 属性上限列 ${stat}`);
  const capLevels = new Set<number>();
  let previousCap = 0;
  for (const itemLevel of levelCaps.level) {
    if (
      !Number.isSafeInteger(itemLevel) ||
      (itemLevel as number) < 1 ||
      (itemLevel as number) <= previousCap
    )
      fail(`${label} 的 ItemLevel 属性上限目录无效或未严格升序`);
    capLevels.add(itemLevel as number);
    previousCap = itemLevel as number;
  }
  for (const [stat, values] of Object.entries(levelCaps)) {
    if (stat === "level") continue;
    if (!Array.isArray(values) || values.length !== levelCaps.level.length)
      fail(`${label} 的 ItemLevel 属性上限列 ${stat} 缺失、截断或包含无效值`);
    for (const value of values) {
      if (!Number.isSafeInteger(value) || (value as number) < 0)
        fail(`${label} 的 ItemLevel 属性上限列 ${stat} 缺失、截断或包含无效值`);
    }
  }

  const jobLevelModifiers = gameData.jobLevelModifiers;
  if (!isRecord(jobLevelModifiers)) fail(`${label} 缺少职业等级公式参数`);
  const supportedLevels = Object.keys(jobLevelModifiers)
    .map(Number)
    .filter((level) => Number.isSafeInteger(level) && level >= 50)
    .sort((left, right) => left - right);
  if (
    !supportedLevels.length ||
    new Set(supportedLevels).size !== supportedLevels.length
  )
    fail(`${label} 的可同步等级目录为空或包含重复值`);

  const syncData = gameData.sync;
  if (
    !hasExactKeys(syncData, ["levels", "groups"]) ||
    !Array.isArray(syncData.levels) ||
    syncData.levels.length !== supportedLevels.length ||
    !Array.isArray(syncData.groups) ||
    !syncData.groups.length
  )
    fail(`${label} 的同步数据结构无效`);
  const syncLevels = new Set<number>();
  let previousMinItemLevel = 0;
  for (let index = 0; index < syncData.levels.length; index++) {
    const entry = syncData.levels[index];
    if (
      !hasExactKeys(entry, ["jobLevel", "minItemLevel", "defaultItemLevel"]) ||
      entry.jobLevel !== supportedLevels[index] ||
      !Number.isSafeInteger(entry.minItemLevel) ||
      (entry.minItemLevel as number) < 90 ||
      (entry.minItemLevel as number) <= previousMinItemLevel ||
      !Number.isSafeInteger(entry.defaultItemLevel) ||
      (entry.defaultItemLevel as number) < 90 ||
      (entry.defaultItemLevel as number) < (entry.minItemLevel as number) ||
      !capLevels.has(entry.minItemLevel as number) ||
      !capLevels.has(entry.defaultItemLevel as number) ||
      (entry.jobLevel === 50 && entry.minItemLevel !== 90)
    )
      fail(`${label} 的同步等级下界、ParamGrow 默认品级或支持等级无效`);
    syncLevels.add(entry.jobLevel as number);
    previousMinItemLevel = entry.minItemLevel as number;
  }

  const seenGroups = new Set<string>();
  const seenOptions = new Set<string>();
  for (const group of syncData.groups) {
    if (
      !hasExactKeys(group, ["name", "options"]) ||
      typeof group.name !== "string" ||
      !group.name.trim() ||
      seenGroups.has(group.name) ||
      !Array.isArray(group.options) ||
      !group.options.length
    )
      fail(`${label} 的同步副本大分类结构无效或重复`);
    seenGroups.add(group.name);
    for (const option of group.options) {
      const target = isRecord(option) ? option.target : undefined;
      const optionName = isRecord(option) ? option.name : undefined;
      const key = `${optionName}\0${isRecord(target) ? target.kind : undefined}:${isRecord(target) ? target.value : undefined}`;
      if (
        !hasExactKeys(option, ["name", "target"]) ||
        typeof option.name !== "string" ||
        !option.name.trim() ||
        !hasExactKeys(target, ["kind", "value"]) ||
        !Number.isSafeInteger(target.value) ||
        seenOptions.has(key)
      )
        fail(`${label} 的同步副本选项或目标无效、重复`);
      if (target.kind === "jobLevel") {
        if (!syncLevels.has(target.value as number))
          fail(`${label} 的同步副本引用了未知职业等级`);
      } else if (target.kind === "itemLevel") {
        if (
          (target.value as number) < 90 ||
          !capLevels.has(target.value as number)
        )
          fail(`${label} 的同步副本引用了低于 90 或缺少属性上限的品级`);
      } else {
        fail(`${label} 的同步目标类型无效`);
      }
      seenOptions.add(key);
    }
  }
}
