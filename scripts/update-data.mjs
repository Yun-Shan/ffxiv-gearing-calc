import { execFileSync } from "node:child_process";
import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parse } from "@babel/parser";
import {
  itemActionReturnFields,
  itemFoodReturnFields,
  itemLevelReturnFields,
  itemReturnFields,
  mandervilleReturnFields,
  mcpSource,
  normalizeMcpFoodRows,
  normalizeMcpGearRow,
  normalizeMcpCustomParameters,
  normalizeMcpItemLevel,
  normalizeMcpMateriaRows,
  rowMap,
} from "./mcp-lumina-import.mjs";

const root = resolve(import.meta.dirname, "..");
const repository = "https://github.com/Asvel/ffxiv-gearing.git";
const upstreamRoot = resolve(
  process.env.FFXIV_GEARING_ROOT ?? resolve(root, "reference", "ffxiv-gearing"),
);
const outputPath = resolve(root, "src", "data", "generated-data.json");
const mcpSnapshotPath = resolve(
  process.env.FFXIV_MCP_LUMINA_SNAPSHOT ?? resolve(root, "src", "data", "mcp-lumina.snapshot.json"),
);
const offline = process.argv.includes("--offline");
const supportedJobs = [
  "PLD", "WAR", "DRK", "GNB", "WHM", "SCH", "AST", "SGE", "MNK", "DRG", "NIN",
  "SAM", "RPR", "VPR", "BRD", "MCH", "DNC", "BLM", "SMN", "RDM", "PCT",
];
const importStartedAt = new Date().toISOString();
let currentCommit = "unknown";
const combatMateriaStats = ["CRT", "DET", "DHT", "SKS", "SPS", "TEN", "PIE"];
const slotMap = new Map([
  [1, "weapon"], [2, "offhand"], [3, "head"], [4, "body"], [5, "hands"],
  [7, "legs"], [8, "feet"], [9, "earrings"], [10, "necklace"],
  [11, "bracelet"], [12, "ring"], [13, "weapon"],
]);

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function runGit(args) {
  return execFileSync("git", ["-c", `safe.directory=${upstreamRoot}`, ...args], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  }).trim();
}

async function prepareUpstream() {
  if (!(await exists(resolve(upstreamRoot, ".git")))) {
    if (offline) throw new Error(`参考项目不存在：${upstreamRoot}`);
    await mkdir(resolve(upstreamRoot, ".."), { recursive: true });
    execFileSync("git", ["clone", "--depth", "1", repository, upstreamRoot], {
      cwd: root,
      stdio: "inherit",
    });
  } else if (!offline) {
    runGit(["-C", upstreamRoot, "pull", "--ff-only"]);
  }
  return runGit(["-C", upstreamRoot, "rev-parse", "HEAD"]);
}

async function importDefault(path) {
  const module = await import(`${pathToFileURL(path).href}?commit=${Date.now()}`);
  return module.default;
}

function parseGameConstants(sourceText) {
  const sourceFile = parse(sourceText, {
    sourceType: "module",
    plugins: ["typescript"],
  });
  const declarations = new Map();
  for (const statement of sourceFile.program.body) {
    const declaration = statement.type === "ExportNamedDeclaration" ? statement.declaration : statement;
    if (declaration?.type !== "VariableDeclaration") continue;
    for (const item of declaration.declarations) {
      if (item.id.type === "Identifier" && item.init)
        declarations.set(item.id.name, item.init);
    }
  }

  const cache = new Map();
  const evaluateIdentifier = (name) => {
    if (cache.has(name)) return cache.get(name);
    const initializer = declarations.get(name);
    if (!initializer) throw new Error(`无法解析 game.ts 常量：${name}`);
    const value = evaluate(initializer);
    cache.set(name, value);
    return value;
  };
  const propertyName = (property) => {
    if (!property.computed && property.key.type === "Identifier") return property.key.name;
    if (property.key.type === "StringLiteral" || property.key.type === "NumericLiteral")
      return String(property.key.value);
    throw new Error(`不支持的属性名：${property.key.type}`);
  };
  const evaluate = (node, locals = {}) => {
    if (node.type === "TSAsExpression" || node.type === "TSTypeAssertion" || node.type === "ParenthesizedExpression")
      return evaluate(node.expression, locals);
    if (node.type === "StringLiteral" || node.type === "NumericLiteral" || node.type === "BooleanLiteral")
      return node.value;
    if (node.type === "NullLiteral") return null;
    if (node.type === "UnaryExpression" && (node.operator === "-" || node.operator === "+")) {
      const value = evaluate(node.argument, locals);
      return node.operator === "-" ? -value : value;
    }
    if (node.type === "Identifier")
      return Object.hasOwn(locals, node.name) ? locals[node.name] : evaluateIdentifier(node.name);
    if (node.type === "BinaryExpression") {
      const left = evaluate(node.left, locals);
      const right = evaluate(node.right, locals);
      if (node.operator === "-") return left - right;
      if (node.operator === "+") return left + right;
      throw new Error(`不支持的二元运算：${node.operator}`);
    }
    if (node.type === "MemberExpression") {
      const target = evaluate(node.object, locals);
      const key = node.computed ? evaluate(node.property, locals) : node.property.name;
      return target[key];
    }
    if (node.type === "CallExpression" && node.callee.type === "MemberExpression" &&
        !node.callee.computed && node.callee.property.name === "map") {
      const target = evaluate(node.callee.object, locals);
      const callback = node.arguments[0];
      if (!Array.isArray(target) || callback?.type !== "ArrowFunctionExpression" ||
          callback.params[0]?.type !== "Identifier")
        throw new Error("不支持的 map 表达式");
      const parameter = callback.params[0].name;
      return target.map((value) => evaluate(callback.body, { ...locals, [parameter]: value }));
    }
    if (node.type === "ArrayExpression") {
      const result = [];
      for (const element of node.elements) {
        if (!element) continue;
        if (element.type === "SpreadElement") result.push(...evaluate(element.argument, locals));
        else result.push(evaluate(element, locals));
      }
      return result;
    }
    if (node.type === "ObjectExpression") {
      const result = {};
      for (const property of node.properties) {
        if (property.type === "SpreadElement") Object.assign(result, evaluate(property.argument, locals));
        else if (property.type === "ObjectProperty")
          result[propertyName(property)] = property.shorthand
            ? evaluateIdentifier(property.key.name)
            : evaluate(property.value, locals);
        else throw new Error(`不支持的对象属性：${property.type}`);
      }
      return result;
    }
    throw new Error(`不支持的 game.ts 表达式：${node.type}`);
  };

  const jobLevelModifiers = evaluateIdentifier("jobLevelModifiers");
  cache.set("jobLevelMax", Math.max(...Object.keys(jobLevelModifiers).map(Number)));
  const jobSchemasNode = declarations.get("jobSchemas");
  if (jobSchemasNode?.type !== "ObjectExpression")
    throw new Error("无法解析 game.ts jobSchemas");
  const jobSchemas = {};
  for (const property of jobSchemasNode.properties) {
    if (property.type !== "ObjectProperty") continue;
    const name = propertyName(property);
    if (supportedJobs.includes(name)) jobSchemas[name] = evaluate(property.value);
  }
  return {
    jobLevelModifiers,
    jobSchemas,
    materias: evaluateIdentifier("materias"),
    materiaGradeRequiredLevels: evaluateIdentifier("materiaGradeRequiredLevels"),
    baseStats: evaluateIdentifier("baseStats"),
    clanStats: evaluateIdentifier("clanStats"),
  };
}

function normalizeJobSchemas(rawSchemas) {
  return Object.fromEntries(
    supportedJobs.map((id) => {
      const schema = rawSchemas[id];
      if (!schema) throw new Error(`上游缺少职业：${id}`);
      const role = schema.stats.includes("TEN")
        ? "tank"
        : schema.stats.includes("PIE")
          ? "healer"
          : schema.mainStat === "STR"
            ? "str"
            : schema.mainStat === "DEX"
              ? "dex"
              : "int";
      return [id, {
        id,
        name: schema.name,
        role,
        mainStat: schema.mainStat,
        secondaryStat: schema.secondaryStat,
        attackStat: schema.mainStat === "VIT" ? "STR" : schema.mainStat,
        stats: schema.stats,
        statModifiers: schema.statModifiers,
        ...(schema.partyBonus ? { partyBonus: schema.partyBonus } : {}),
        gcdModifier: schema.statModifiers?.gcd ?? 100,
        traitDamageMultiplier: schema.traitDamageMultiplier,
      }];
    }),
  );
}

function normalizeGear(raw, sourceFile) {
  const slot = slotMap.get(raw.slot);
  if (!slot) return undefined;
  // 参考项目只提供待查询的装备候选 ID；职业适用性必须由后续 MCP 分类确定。
  // 这里不依据 reference jobCategories 过滤装备，避免在 MCP 查询前丢失候选。
  const jobs = [];
  return {
    id: raw.id,
    name: raw.name,
    slot,
    rawSlot: raw.slot,
    level: raw.level,
    equipLevel: raw.equipLevel,
    roleId: raw.role,
    jobCategory: raw.jobCategory,
    stats: raw.stats,
    materiaSlots: raw.materiaSlot,
    ...(raw.materiaAdvanced ? { materiaAdvanced: true } : {}),
    ...(raw.hq ? { hq: true } : {}),
    ...(raw.customizable ? { customizable: true } : {}),
    ...(raw.source ? { source: raw.source } : {}),
    jobs,
    weaponDamage: raw.stats.PDMG ?? raw.stats.MDMG,
    sourceFile,
    dataSources: [{
      kind: "reference",
      repository,
      commit: currentCommit,
      importedAt: importStartedAt,
      sourceFiles: [sourceFile],
    }],
  };
}

function normalizeFood(raw) {
  return {
    id: raw.id,
    name: raw.name,
    level: raw.level,
    stats: raw.stats,
    statRates: raw.statRates,
    ...(raw.best ? { best: true } : {}),
    sourceFile: "data/out/foods.js",
    dataSources: [{
      kind: "reference",
      repository,
      commit: currentCommit,
      importedAt: importStartedAt,
      sourceFiles: ["data/out/foods.js"],
    }],
  };
}

async function loadMcpSnapshot() {
  if (!(await exists(mcpSnapshotPath))) return undefined;
  let snapshot;
  try {
    snapshot = JSON.parse(await readFile(mcpSnapshotPath, "utf8"));
  } catch (error) {
    throw new Error(`MCP 查询产物无法解析：${mcpSnapshotPath}`, { cause: error });
  }
  if (snapshot?.server !== "ffxiv-mcp-lumina" || snapshot?.schemaVersion !== 1)
    throw new Error(`MCP 查询产物格式不受支持：${mcpSnapshotPath}`);
  if (!snapshot.gameVersion || !snapshot.validatedVersion || !snapshot.queriedAt)
    throw new Error(`MCP 查询产物缺少游戏版本或查询时间：${mcpSnapshotPath}`);
  if (snapshot.gameVersion !== snapshot.validatedVersion)
    throw new Error(`MCP 查询产物的游戏版本与验证版本不一致：${snapshot.gameVersion} !== ${snapshot.validatedVersion}`);
  return snapshot;
}

function indexRows(value) {
  if (Array.isArray(value)) return rowMap(value);
  if (!value || typeof value !== "object") return {};
  const rows = Object.values(value);
  if (rows.every((row) => row && typeof row === "object" && row.fields)) return rowMap(rows);
  return value;
}

function snapshotRows(snapshot, name) {
  return indexRows(snapshot?.rows?.[name] ?? snapshot?.[name]);
}

function snapshotSource(snapshot, sheet, fields, rowIds, note) {
  return mcpSource({
    sheet,
    fields,
    rowIds,
    gameVersion: snapshot.gameVersion,
    validatedVersion: snapshot.validatedVersion,
    queriedAt: snapshot.queriedAt,
    note,
  });
}

function resolveMandervilleIds(mandervilleRows, referenceMandervilleAliases) {
  // 自定义武器主键 = MandervilleWeaponEnhance 表内全部有效行（游戏当前版本唯一信源）。
  const mcpIds = Object.keys(mandervilleRows).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (mcpIds.length === 0)
    throw new Error("MandervilleWeaponEnhance 行集合为空，无法确认自定义武器主键");
  const mcpSet = new Set(mcpIds);
  const refSet = new Set(referenceMandervilleAliases);
  // 跨版本漂移允许：参考导出与 MCP 集合若完全无交集则报警。
  let overlap = 0;
  for (const id of mcpSet) if (refSet.has(id)) overlap++;
  if (overlap === 0)
    throw new Error(
      `MandervilleWeaponEnhance 行集合 ${mcpIds.join(",")} 与参考项目 customizable 集合 ${referenceMandervilleAliases.join(",")} 无任何交集，请检查 MCP 快照或参考版本`,
    );
  return { mandervilleIds: mcpIds, referenceAliases: referenceMandervilleAliases };
}
function mergeMcpGearData(gears, snapshot, fallbackSource) {
  const itemRows = snapshotRows(snapshot, "Item");
  const categoryRows = snapshotRows(snapshot, "ClassJobCategory");
  const mandervilleRows = snapshotRows(snapshot, "MandervilleWeaponEnhance");
  const materiaRows = snapshotRows(snapshot, "Materia");
  const referenceMandervilleAliases = gears
    .filter((gear) => gear.customizable)
    .map((gear) => gear.id);
  const { mandervilleIds } = resolveMandervilleIds(mandervilleRows, referenceMandervilleAliases);
  const usedIds = [];
  const missing = [];
  const result = gears
    .map((gear) => {
    const itemRow = itemRows[gear.id];
    const categoryRow = itemRow && categoryRows[Number(itemRow.fields?.ClassJobCategory)];
    const merged = normalizeMcpGearRow(itemRow, gear, categoryRow, { hq: gear.hq === true });
    if (!merged) {
      missing.push(gear.id);
      // 即使参考项目有分类结果，也不能回退其职业适用性；等待 MCP 分类后再统一过滤。
      return { ...gear, jobs: [] };
    }
    usedIds.push(gear.id);
    const source = snapshotSource(snapshot, "Item", itemReturnFields, [gear.id]);
    const categorySource = snapshotSource(
      snapshot,
      "ClassJobCategory",
      ["PLD", "MNK", "WAR", "DRG", "BRD", "WHM", "BLM", "SMN", "SCH", "NIN", "MCH", "DRK", "AST", "SAM", "RDM", "GNB", "DNC", "RPR", "SGE", "VPR", "PCT"],
      [Number(itemRow.fields.ClassJobCategory)],
    );
    const customRow = mandervilleRows[gear.id];
    const customParameters = customRow
      ? normalizeMcpCustomParameters(customRow, materiaRows)
      : undefined;
    if (customRow && !customParameters)
      throw new Error(`MandervilleWeaponEnhance 行 ${gear.id} 的自定义参数字段不完整`);
    return {
      ...merged,
      ...(customRow ? { customizable: true, customParameters } : {}),
      dataSources: [source, categorySource, ...(gear.dataSources ?? []).filter((item) => item.kind === "reference")],
    };
  });
  // MCP 当前版本的自定义参数武器主键（51000-51021 等）并不在参考项目导出中，需要主动合并。
  const existingIds = new Set(result.map((g) => g.id));
  const categoryFieldList = ["PLD", "MNK", "WAR", "DRG", "BRD", "WHM", "BLM", "SMN", "SCH", "NIN", "MCH", "DRK", "AST", "SAM", "RDM", "GNB", "DNC", "RPR", "SGE", "VPR", "PCT"];
  for (const mcpId of mandervilleIds) {
    if (existingIds.has(mcpId)) continue;
    const itemRow = itemRows[mcpId];
    if (!itemRow) continue;
    const categoryRow = categoryRows[Number(itemRow.fields?.ClassJobCategory)];
    const merged = normalizeMcpGearRow(itemRow, undefined, categoryRow, { hq: false });
    if (!merged) continue;
    const customRow = mandervilleRows[mcpId];
    const customParameters = customRow ? normalizeMcpCustomParameters(customRow, materiaRows) : undefined;
    if (!customParameters)
      throw new Error(`MandervilleWeaponEnhance 行 ${mcpId} 的自定义参数字段不完整`);
    usedIds.push(mcpId);
    const source = snapshotSource(snapshot, "Item", itemReturnFields, [mcpId]);
    const categorySource = snapshotSource(snapshot, "ClassJobCategory", categoryFieldList, [Number(itemRow.fields.ClassJobCategory)]);
    result.push({
      ...merged,
      customizable: true,
      customParameters,
      dataSources: [source, categorySource, { kind: "mcp-manderville-source", sheet: "MandervilleWeaponEnhance", rowIds: [mcpId] }],
    });
  }
  return { result: result.filter((gear) => gear.jobs.length > 0), usedIds, missing };
}

function mergeMcpFoodData(foods, snapshot) {
  const itemRows = snapshotRows(snapshot, "Item");
  const actionRows = snapshotRows(snapshot, "ItemAction");
  const foodRows = snapshotRows(snapshot, "ItemFood");
  const usedIds = [];
  const usedActionIds = [];
  const missing = [];
  const result = foods.map((food) => {
    const itemRow = itemRows[food.id];
    const actionId = Number(itemRow?.fields?.ItemAction ?? 0);
    const merged = normalizeMcpFoodRows(itemRow, actionRows[actionId], foodRows, food);
    if (!merged) {
      missing.push(food.id);
      return food;
    }
    usedIds.push(food.id);
    usedActionIds.push(actionId);
    const actionRow = actionRows[actionId];
    const foodIds = [];
    for (let index = 0; index < 9; index++) {
      const id = Number(actionRow?.fields?.[`Data[${index}]`] ?? 0);
      if (id) foodIds.push(id);
    }
    const missingFoodIds = foodIds.filter((id) => !foodRows[id]);
    return {
      ...merged,
      dataSources: [
        snapshotSource(snapshot, "Item", ["Name", "LevelItem", "ItemAction"], [food.id]),
        snapshotSource(snapshot, "ItemAction", itemActionReturnFields, [actionId]),
        snapshotSource(
          snapshot,
          "ItemFood",
          itemFoodReturnFields,
          foodIds,
          missingFoodIds.length
            ? `MCP 缺少 ItemFood 行：${missingFoodIds.join(",")}；其余效果字段由 MCP 提供`
            : undefined,
        ),
        ...(food.dataSources ?? []).filter((item) => item.kind === "reference"),
      ],
    };
  });
  return { result, usedIds, usedActionIds, missing };
}

function mergeMcpLevelCaps(levelCaps, snapshot) {
  const rows = snapshotRows(snapshot, "ItemLevel");
  const levels = levelCaps.level.slice();
  const merged = Object.fromEntries(Object.entries(levelCaps).map(([stat, values]) => [stat, values.slice()]));
  const usedIds = [];
  for (let index = 0; index < levels.length; index++) {
    const row = rows[levels[index]];
    const stats = normalizeMcpItemLevel(row);
    if (!stats) continue;
    usedIds.push(levels[index]);
    for (const [stat, value] of Object.entries(stats)) {
      if (merged[stat]) merged[stat][index] = value;
    }
  }
  return { value: merged, usedIds };
}

function mergeMcpSlotCaps(slotCaps, snapshot) {
  const rows = snapshotRows(snapshot, "BaseParam");
  const baseParamByStat = { STR: 1, DEX: 2, VIT: 3, INT: 4, MND: 5, PIE: 6, TEN: 19, DHT: 22, CRT: 27, DET: 44, SKS: 45, SPS: 46 };
  const fieldsBySlot = [
    undefined, "OneHandWeaponPercent", "OffHandPercent", "HeadPercent", "ChestPercent", "HandsPercent",
    "WaistPercent", "LegsPercent", "FeetPercent", "EarringPercent", "NecklacePercent", "BraceletPercent",
    "RingPercent", "TwoHandWeaponPercent", "UnderArmorPercent", "ChestHeadPercent", "ChestHeadLegsFeetPercent",
    "Unknown0", "LegsFeetPercent", "HeadChestHandsLegsFeetPercent", "ChestLegsGlovesPercent", "ChestLegsFeetPercent",
    "Unknown1", "Unknown3",
  ];
  const merged = Object.fromEntries(Object.entries(slotCaps).map(([stat, values]) => [stat, values.slice()]));
  const usedIds = [];
  const supportedSlots = new Set([1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12, 13]);
  for (const [stat, rowId] of Object.entries(baseParamByStat)) {
    const row = rows[rowId];
    if (!row?.fields) continue;
    let changed = false;
    // The project uses raw slot IDs 1..18. Newer Lumina fields after LegsFeetPercent
    // describe additional slots that this upstream data model does not represent.
    for (const slot of supportedSlots) {
      const value = row.fields[fieldsBySlot[slot]];
      if (typeof value === "number") {
        merged[stat] ??= [];
        merged[stat][slot] = value;
        changed = true;
      }
    }
    if (changed) usedIds.push(rowId);
  }
  return { value: merged, usedIds };
}

function mergeMcpMaterias(materias, snapshot) {
  const rows = snapshotRows(snapshot, "Materia");
  const merged = normalizeMcpMateriaRows(Object.values(rows));
  const value = { ...materias };
  const usedStats = [];
  for (const stat of combatMateriaStats) {
    if (merged[stat]?.length === 12 && merged[stat].some((entry) => entry > 0)) {
      value[stat] = merged[stat];
      usedStats.push(stat);
    }
  }
  return { value, usedStats };
}

function validate(payload) {
  if (payload.gears.length < 1000) throw new Error(`装备数量异常：${payload.gears.length}`);
  if (payload.foods.length < 100) throw new Error(`食物数量异常：${payload.foods.length}`);
  if (Object.keys(payload.jobSchemas).length !== supportedJobs.length)
    throw new Error("职业数量异常");
  if (Object.keys(payload.materias).length !== combatMateriaStats.length)
    throw new Error("魔晶石数据不完整");
  if (!payload.levelCaps.level?.length || !payload.slotCaps.CRT?.length || !payload.roleCaps.CRT?.length)
    throw new Error("装备属性上限数据不完整");
  const ids = new Set();
  for (const gear of payload.gears) {
    if (ids.has(gear.id)) throw new Error(`装备 ID 重复：${gear.id}`);
    ids.add(gear.id);
    if (!gear.jobs.length || !gear.stats || !gear.sourceFile)
      throw new Error(`装备记录不完整：${gear.id}`);
  }
}

const commit = await prepareUpstream();
currentCommit = commit;
const outDir = resolve(upstreamRoot, "data", "out");
const gearFiles = (await readdir(outDir)).filter((file) => /^gears-.*\.js$/i.test(file)).sort();
if (!gearFiles.length) throw new Error("参考项目没有装备导出文件");

const [rawFoods, gameSource] = await Promise.all([
  importDefault(resolve(outDir, "foods.js")),
  readFile(resolve(upstreamRoot, "src", "game.ts"), "utf8"),
]);
const [levelCaps, slotCaps, roleCaps] = await Promise.all([
  importDefault(resolve(outDir, "levelCaps.js")),
  importDefault(resolve(outDir, "slotCaps.js")),
  importDefault(resolve(outDir, "roleCaps.js")),
]);
const constants = parseGameConstants(gameSource);
const gearGroups = await Promise.all(
  gearFiles.map(async (file) => ({ file, items: await importDefault(resolve(outDir, file)) })),
);
const gears = gearGroups.flatMap(({ file, items }) =>
  items.map((item) => normalizeGear(item, `data/out/${file}`)).filter(Boolean),
);
const referenceSourceFiles = [
  ...gearFiles.map((file) => `data/out/${file}`),
  "data/out/foods.js",
  "data/out/levelCaps.js",
  "data/out/slotCaps.js",
  "data/out/roleCaps.js",
  "src/game.ts",
];
const referenceSource = {
  kind: "reference",
  repository,
  commit,
  importedAt: importStartedAt,
  sourceFiles: referenceSourceFiles,
};
let foods = rawFoods.filter((food) => food.slot === -1).map(normalizeFood);
let effectiveLevelCaps = levelCaps;
let effectiveSlotCaps = slotCaps;
let materias = Object.fromEntries(
  combatMateriaStats.map((stat) => [stat, constants.materias[stat]]),
);
const sourceRecords = [referenceSource];
const mcpSnapshot = await loadMcpSnapshot();
let mcpSummary = "MCP 查询产物未找到，使用参考项目数据";
if (mcpSnapshot) {
  const gearMerge = mergeMcpGearData(gears, mcpSnapshot, referenceSource);
  gears.splice(0, gears.length, ...gearMerge.result);
  const foodMerge = mergeMcpFoodData(foods, mcpSnapshot);
  foods = foodMerge.result;
  const levelMerge = mergeMcpLevelCaps(levelCaps, mcpSnapshot);
  effectiveLevelCaps = levelMerge.value;
  const slotMerge = mergeMcpSlotCaps(slotCaps, mcpSnapshot);
  effectiveSlotCaps = slotMerge.value;
  const materiaMerge = mergeMcpMaterias(materias, mcpSnapshot);
  materias = materiaMerge.value;
  sourceRecords.push(
    snapshotSource(mcpSnapshot, "Item", itemReturnFields, gearMerge.usedIds),
    snapshotSource(mcpSnapshot, "ItemAction", itemActionReturnFields, foodMerge.usedActionIds),
    snapshotSource(mcpSnapshot, "ItemFood", itemFoodReturnFields, undefined, mcpSnapshot.missing?.ItemFood?.length
      ? `MCP 缺少 ItemFood 行：${mcpSnapshot.missing.ItemFood.join(",")}`
      : undefined),
    snapshotSource(mcpSnapshot, "ItemLevel", itemLevelReturnFields, levelMerge.usedIds),
    snapshotSource(mcpSnapshot, "BaseParam", undefined, slotMerge.usedIds),
    snapshotSource(mcpSnapshot, "Materia", undefined, Object.keys(snapshotRows(mcpSnapshot, "Materia")).map(Number)),
  );
  const fallbackCount = gearMerge.missing.length + foodMerge.missing.length;
  mcpSummary = `MCP 优先：覆盖 ${gearMerge.usedIds.length}/${gears.length} 件装备、${foodMerge.usedIds.length}/${foods.length} 种食物，${fallbackCount} 项回退参考项目`;
} else if (!offline) {
  console.warn(`未找到 MCP 查询产物：${mcpSnapshotPath}。请先使用环境 MCP 工具生成该文件；本次仅使用参考项目。`);
}
const payload = {
  version: mcpSnapshot
    ? `mcp-${mcpSnapshot.gameVersion}-upstream-${commit.slice(0, 12)}`
    : `upstream-${commit.slice(0, 12)}`,
  provenance: {
    repository,
    commit,
    importedAt: importStartedAt,
    sourceFiles: referenceSourceFiles,
    sources: sourceRecords,
  },
  gears,
  foods,
  materias,
  materiaGradeRequiredLevels: constants.materiaGradeRequiredLevels,
  levelCaps: effectiveLevelCaps,
  slotCaps: effectiveSlotCaps,
  roleCaps,
  baseStats: constants.baseStats,
  clanStats: constants.clanStats,
  jobSchemas: normalizeJobSchemas(constants.jobSchemas),
  jobLevelModifiers: constants.jobLevelModifiers,
};
validate(payload);
await mkdir(resolve(outputPath, ".."), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(payload)}\n`, "utf8");
console.log(
  `Imported ${payload.gears.length} gears, ${payload.foods.length} foods and ${supportedJobs.length} jobs from ${commit.slice(0, 12)}. ${mcpSummary}`,
);
