import { execFileSync } from "node:child_process";
import { access, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parse } from "@babel/parser";
import { classJobReturnFields } from "../mcp-lumina/query-presets.mjs";
import { normalizeMcpClassJobRow, supportedJobIds } from "../mcp-lumina-import.mjs";
import { referenceGearSource } from "../gear-catalog-policy.mjs";
import { snapshotRows, snapshotSource } from "./mcp-snapshot.mjs";

export const referenceRepository = "https://github.com/Asvel/ffxiv-gearing.git";
const supportedJobs = supportedJobIds;
const limitedJobIds = new Set(["BLU", "BST"]);
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

function runGit(context, args) {
  // The reference exports have no submodules; avoid inheriting recursive updates from user Git settings.
  return execFileSync("git", ["-c", "submodule.recurse=false", "-c", `safe.directory=${context.upstreamRoot}`, ...args], {
    cwd: context.root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  }).trim();
}

export async function prepareUpstream(context) {
  if (!(await exists(resolve(context.upstreamRoot, ".git")))) {
    await mkdir(resolve(context.upstreamRoot, ".."), { recursive: true });
    execFileSync("git", ["clone", "--depth", "1", context.repository, context.upstreamRoot], {
      cwd: context.root,
      stdio: "inherit",
    });
  } else {
    runGit(context, ["-C", context.upstreamRoot, "pull", "--ff-only"]);
  }
  return runGit(context, ["-C", context.upstreamRoot, "rev-parse", "HEAD"]);
}

export async function importDefault(path) {
  const module = await import(`${pathToFileURL(path).href}?commit=${Date.now()}`);
  return module.default;
}

export function parseGameConstants(sourceText) {
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
  // The restriction is a reference rule, not a Materia sheet column.
  // Import its explicit grade list instead of duplicating grade numbers in runtime code.
  const restrictionLoop = sourceFile.program.body.find((statement) =>
    statement.type === "ForOfStatement" &&
    statement.body.type === "ExpressionStatement" &&
    statement.body.expression.type === "AssignmentExpression" &&
    statement.body.expression.left.type === "MemberExpression" &&
    statement.body.expression.left.object.type === "Identifier" &&
    statement.body.expression.left.object.name === "materiaGradeIsRestricted",
  );
  if (!restrictionLoop) throw new Error("上游缺少魔晶石禁断等级限制规则");
  const restrictedGrades = evaluate(restrictionLoop.right);
  if (!Array.isArray(restrictedGrades) || restrictedGrades.some((grade) => !Number.isInteger(grade) || grade < 1))
    throw new Error("上游魔晶石禁断等级限制格式错误");
  return {
    jobLevelModifiers,
    jobSchemas,
    materias: evaluateIdentifier("materias"),
    materiaGradeRequiredLevels: evaluateIdentifier("materiaGradeRequiredLevels"),
    materiaGradeIsRestricted: Array.from(
      { length: evaluateIdentifier("materiaGradeRequiredLevels").length + 1 },
      (_, grade) => restrictedGrades.includes(grade),
    ),
    baseStats: evaluateIdentifier("baseStats"),
    clanStats: evaluateIdentifier("clanStats"),
  };
}

export function normalizeJobSchemas(rawSchemas, snapshot, context) {
  const classJobRows = snapshotRows(snapshot, "ClassJob");
  return Object.fromEntries(
    supportedJobs.map((id) => {
      const schema = rawSchemas[id];
      if (!schema) throw new Error(`上游缺少职业：${id}`);
      const rowId = Number(snapshot.queryPlan.classJobIds[id]);
      const classJobRow = classJobRows[rowId];
      const mcpSchema = normalizeMcpClassJobRow(classJobRow);
      if (!mcpSchema || mcpSchema.abbreviation !== id)
        throw new Error(`MCP ClassJob 行 ${rowId} 缺少职业 ${id} 的完整字段`);
      if (limitedJobIds.has(id) && !mcpSchema.isLimitedJob)
        throw new Error(`MCP ClassJob 未将 ${id} 标记为限职，拒绝生成职业数据`);
      if (!limitedJobIds.has(id) && mcpSchema.isLimitedJob)
        throw new Error(`当前支持职业 ${id} 被 MCP 标记为限职，请核对支持职业清单`);
      if (!Array.isArray(schema.defaultItemLevel) || schema.defaultItemLevel.length !== 2 ||
          schema.defaultItemLevel.some((value) => !Number.isSafeInteger(value) || value < 1) ||
          !Number.isSafeInteger(schema.jobLevel) || schema.jobLevel < 1)
        throw new Error(`参考职业 ${id} 缺少合法 defaultItemLevel 或 jobLevel`);
      const role = mcpSchema.role;
      const referenceSchemaSource = {
        kind: "reference",
        repository: context.repository,
        commit: context.commit,
        importedAt: context.importedAt,
        sourceFiles: ["src/game.ts"],
        note: "提供 key、secondaryStat、stats、partyBonus、GCD/trait 公式修正、defaultItemLevel、maxJobLevel 与 slots.weapon.levelWeight；mainStat 来自 MCP ClassJob.PrimaryStat，role 来自 MCP ClassJob.JobType，ClassJob 不提供其他领域公式字段。",
      };
      return [id, {
        id,
        name: mcpSchema.name,
        isLimitedJob: mcpSchema.isLimitedJob,
        role,
        mainStat: mcpSchema.mainStat,
        secondaryStat: schema.secondaryStat,
        stats: schema.stats,
        statModifiers: { ...schema.statModifiers, ...mcpSchema.statModifiers },
        ...(schema.partyBonus ? { partyBonus: schema.partyBonus } : {}),
        gcdModifier: schema.statModifiers?.gcd ?? 100,
        traitDamageMultiplier: schema.traitDamageMultiplier,
        defaultItemLevel: schema.defaultItemLevel,
        maxJobLevel: schema.jobLevel,
        ignoreWeaponItemLevel: schema.slots.some(
          (slot) => (slot.slot === 1 || slot.slot === 13) && slot.levelWeight === 0,
        ),
        dataSources: [
          snapshotSource(
            snapshot,
            "ClassJob",
            classJobReturnFields,
            [rowId],
            "Name 映射至职业名称，PrimaryStat 映射至 mainStat，JobType 映射至 role；ModifierHitPoints/Modifier{Strength,Vitality,Dexterity,Intelligence,Mind,Piety} 映射至 statModifiers；IsLimitedJob 用于校验，CanWearShield 原样记录以保留 MCP 来源字段。",
          ),
          referenceSchemaSource,
        ],
      }];
    }),
  );
}

export function normalizeGear(raw, sourceFile, context) {
  const slot = slotMap.get(raw.slot);
  if (!slot) return undefined;
  const source = referenceGearSource(raw);
  // 参考项目只提供待查询的装备候选 ID；职业适用性必须由后续 MCP 分类确定。
  // 这里不依据 reference jobCategories 过滤装备，避免在 MCP 查询前丢失候选。
  const jobs = [];
  return {
    id: raw.id,
    name: raw.name,
    slot,
    rawSlot: raw.rawSlot,
    level: raw.level,
    equipLevel: raw.equipLevel,
    roleId: raw.role,
    jobCategory: raw.jobCategory,
    stats: raw.stats,
    materiaSlots: raw.materiaSlot,
    ...(raw.materiaAdvanced ? { materiaAdvanced: true } : {}),
    ...(raw.customizable ? { customizable: true } : {}),
    ...(source ? { source } : {}),
    jobs,
    weaponDamage: raw.stats.PDMG ?? raw.stats.MDMG,
    sourceFile,
    dataSources: [{
      kind: "reference",
      repository: context.repository,
      commit: context.commit,
      importedAt: context.importedAt,
      sourceFiles: [sourceFile],
    }],
  };
}

export function normalizeFood(raw, context) {
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
      repository: context.repository,
      commit: context.commit,
      importedAt: context.importedAt,
      sourceFiles: ["data/out/foods.js"],
    }],
  };
}

export function validateBluMdmgAdditions(exported, measuredSource) {
  if (!Array.isArray(exported) || exported.length === 0)
    throw new Error("参考项目缺少完整的 bluMdmgAdditions 数组");
  if (!exported.every((value) => Number.isSafeInteger(value) && value >= 0))
    throw new Error("bluMdmgAdditions 必须全部是非负安全整数");
  const measuredValues = measuredSource.trim().split(/\r?\n/).map((value) => {
    if (!/^\d+$/.test(value.trim()))
      throw new Error("参考项目 bluMdmgAdditions.txt 含有非整数或空数据");
    const number = Number(value.trim());
    if (!Number.isSafeInteger(number) || number < 0)
      throw new Error("参考项目 bluMdmgAdditions.txt 含有非负安全整数范围外的数据");
    return number;
  });
  if (measuredValues.length !== exported.length ||
      measuredValues.some((value, index) => value !== exported[index]))
    throw new Error("bluMdmgAdditions.js 与原始测量数据不一致或不完整");
  return exported.slice();
}
