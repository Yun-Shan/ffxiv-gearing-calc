import { classJobSearchReturnFields, classJobSearchTextFields } from "./query-presets.mjs";

function chunks(values, size = 100) {
  const result = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

export function createMcpQueryHelpers({ concurrency = 4, sleep = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds)) } = {}) {
  async function retryQuery(operation, failureMessage) {
    let response;
    let lastError;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        response = await operation();
        break;
      } catch (error) {
        lastError = error;
        if (attempt < 2) await sleep(250 * (attempt + 1));
      }
    }
    if (!response) throw new Error(failureMessage, { cause: lastError });
    return response;
  }

  async function queryRows(client, sheet, rowIds, returnFields, queries) {
    const uniqueIds = [...new Set(rowIds.map(Number).filter(Number.isInteger))];
    const batches = chunks(uniqueIds);
    const rows = [];
    const missingRowIds = [];
    let cursor = 0;
    async function worker() {
      while (true) {
        const index = cursor++;
        if (index >= batches.length) return;
        const batch = batches[index];
        const response = await retryQuery(
          () => client.callTool("get_rows", {
            sheet,
            rowIds: batch,
            returnFields,
            languages: "chs",
          }),
          `MCP ${sheet} 批次 ${index + 1}/${batches.length} 失败`,
        );
        const value = response.value;
        rows.push(...(value.rows ?? []));
        missingRowIds.push(...(value.missingRowIds ?? []));
        queries.push({
          method: "get_rows",
          sheet,
          rowIds: batch,
          ...(returnFields ? { fields: returnFields.split(",") } : {}),
          returnedRows: value.rows?.length ?? 0,
          missingRowIds: value.missingRowIds ?? [],
          gameVersion: value.gameVersion,
          queriedAt: value.timestamp,
        });
        if (batches.length > 1) console.error(`MCP ${sheet}: ${Math.min((index + 1) * 100, uniqueIds.length)}/${uniqueIds.length}`);
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, batches.length) }, worker));
    return { rows, missingRowIds };
  }

  async function queryAllRows(client, sheet, returnFields, queries) {
    const response = await retryQuery(
      () => client.callTool("list_rows", {
        sheet,
        returnFields,
        limit: -1,
        languages: "chs",
      }),
      `MCP ${sheet} 全量行查询失败`,
    );
    const value = response.value;
    if (!Array.isArray(value.rows) || !Array.isArray(value.rowIds) ||
        value.rows.length !== value.rowIds.length)
      throw new Error(`MCP ${sheet} 全量行查询返回了不完整的行目录`);
    queries.push({
      method: "list_rows",
      sheet,
      limit: -1,
      fields: returnFields.split(","),
      rowIds: value.rowIds,
      returnedRows: value.rows.length,
      gameVersion: value.gameVersion,
      queriedAt: value.timestamp,
    });
    return { rows: value.rows, missingRowIds: value.missingRowIds ?? [] };
  }

  function validateResistanceWeaponAdjustRows(rows, missingRowIds, description, gameVersion, queriedRowIds, returnFields) {
    if (!Array.isArray(rows) || rows.length !== description.rowCount || missingRowIds.length)
      throw new Error(`MCP ResistanceWeaponAdjust 全量查询不完整：${rows?.length ?? 0}/${description.rowCount}`);
    if (!Array.isArray(queriedRowIds) || queriedRowIds.length !== rows.length)
      throw new Error("MCP ResistanceWeaponAdjust 全量查询范围不完整");
    const seenIds = new Set();
    const nonzeroItemIds = [];
    for (const row of rows) {
      if (!row || !Number.isSafeInteger(row.rowId) || row.rowId < 0 || seenIds.has(row.rowId))
        throw new Error("MCP ResistanceWeaponAdjust 返回了无效或重复 rowId");
      seenIds.add(row.rowId);
      if (row.gameVersion !== gameVersion || !row.timestamp ||
          !row.fields || typeof row.fields !== "object" || Array.isArray(row.fields))
        throw new Error(`MCP ResistanceWeaponAdjust 行 ${row.rowId} 缺少同版本字段或查询时间`);
      for (const fieldName of returnFields) {
        const value = row.fields[fieldName];
        if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff)
          throw new Error(`MCP ResistanceWeaponAdjust 行 ${row.rowId} 的 ${fieldName} 不是有效 uint`);
      }
      if (row.rowId === 0 && returnFields.some((fieldName) => row.fields[fieldName] !== 0))
        throw new Error("MCP ResistanceWeaponAdjust 行 0 应全部为零");
      if (row.rowId > 0 && ![0, 1, 2, 3].some((index) => row.fields[`BaseParam[${index}]`] > 0))
        throw new Error(`MCP ResistanceWeaponAdjust 行 ${row.rowId} 没有可调整属性`);
      if (row.rowId > 0) nonzeroItemIds.push(row.rowId);
    }
    if (!seenIds.has(0) || queriedRowIds.some((id) => !seenIds.has(id)) ||
        rows.some((row) => !queriedRowIds.includes(row.rowId)))
      throw new Error("MCP ResistanceWeaponAdjust 全量查询缺少空行 0 或行目录与查询范围不一致");
    return nonzeroItemIds.sort((left, right) => left - right);
  }

  function describeQuery(sheet, description) {
    return {
      method: "describe_sheet",
      sheet,
      fields: description.columns.map((column) => column.name),
      returnedRows: description.rowCount,
      gameVersion: description.gameVersion,
      queriedAt: description.timestamp,
    };
  }

  function validateSyncLevelSchema(sheet, description, requiredFields) {
    if (!Array.isArray(description?.columns))
      throw new Error(`MCP ${sheet} Schema 不可用，无法核验同步品级来源`);
    const availableFields = new Set(description.columns.map((column) => column.name));
    const missing = requiredFields.filter((field) => !availableFields.has(field));
    if (missing.length)
      throw new Error(`MCP ${sheet} 缺少同步品级核验字段：${missing.join(", ")}`);
  }

  async function searchClassJobs(client, jobs, queries) {
    const found = new Array(jobs.length);
    let cursor = 0;
    async function worker() {
      while (true) {
        const index = cursor++;
        if (index >= jobs.length) return;
        const job = jobs[index];
        const response = await retryQuery(
          () => client.callTool("search_rows", {
            sheet: "ClassJob",
            query: job,
            textFields: classJobSearchTextFields.join(","),
            returnFields: classJobSearchReturnFields.join(","),
            limit: 200,
            languages: "chs",
          }),
          `MCP ClassJob 缩写 ${job} 查询失败`,
        );
        const matches = (response.value.results ?? []).filter((row) => row.fields?.Abbreviation === job);
        if (matches.length !== 1)
          throw new Error(`MCP ClassJob 缩写 ${job} 应精确匹配一行，实际 ${matches.length} 行`);
        const row = matches[0];
        found[index] = { job, rowId: Number(row.rowId) };
        queries.push({
          method: "search_rows",
          sheet: "ClassJob",
          query: job,
          textFields: classJobSearchTextFields,
          fields: classJobSearchReturnFields,
          returnedRows: matches.length,
          rowIds: [Number(row.rowId)],
          gameVersion: response.value.gameVersion,
          queriedAt: response.value.timestamp,
        });
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
    return found;
  }

  return {
    queryRows,
    queryAllRows,
    validateResistanceWeaponAdjustRows,
    describeQuery,
    validateSyncLevelSchema,
    searchClassJobs,
  };
}
