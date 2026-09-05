import { execFileSync } from "node:child_process";
import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parse } from "@babel/parser";

const root = resolve(import.meta.dirname, "..");
const repository = "https://github.com/Asvel/ffxiv-gearing.git";
const upstreamRoot = resolve(
  process.env.FFXIV_GEARING_ROOT ?? resolve(root, "reference", "ffxiv-gearing"),
);
const outputPath = resolve(root, "src", "data", "generated-data.json");
const offline = process.argv.includes("--offline");
const supportedJobs = [
  "PLD", "WAR", "DRK", "GNB", "WHM", "SCH", "AST", "SGE", "MNK", "DRG", "NIN",
  "SAM", "RPR", "VPR", "BRD", "MCH", "DNC", "BLM", "SMN", "RDM", "PCT",
];
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

function normalizeGear(raw, sourceFile, jobCategories) {
  const slot = slotMap.get(raw.slot);
  if (!slot) return undefined;
  const category = jobCategories[raw.jobCategory] ?? {};
  const jobs = supportedJobs.filter((job) => category[job] === true);
  if (!jobs.length) return undefined;
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
    ...(raw.source ? { source: raw.source } : {}),
    jobs,
    weaponDamage: raw.stats.PDMG ?? raw.stats.MDMG,
    sourceFile,
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
  };
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
const outDir = resolve(upstreamRoot, "data", "out");
const gearFiles = (await readdir(outDir)).filter((file) => /^gears-.*\.js$/i.test(file)).sort();
if (!gearFiles.length) throw new Error("参考项目没有装备导出文件");

const [jobCategories, rawFoods, gameSource] = await Promise.all([
  importDefault(resolve(outDir, "jobCategories.js")),
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
  items.map((item) => normalizeGear(item, `data/out/${file}`, jobCategories)).filter(Boolean),
);
const materias = Object.fromEntries(
  combatMateriaStats.map((stat) => [stat, constants.materias[stat]]),
);
const payload = {
  version: `upstream-${commit.slice(0, 12)}`,
  provenance: {
    repository,
    commit,
    importedAt: new Date().toISOString(),
    sourceFiles: [
      ...gearFiles.map((file) => `data/out/${file}`),
      "data/out/foods.js",
      "data/out/jobCategories.js",
      "data/out/levelCaps.js",
      "data/out/slotCaps.js",
      "data/out/roleCaps.js",
      "src/game.ts",
    ],
  },
  gears,
  foods: rawFoods.filter((food) => food.slot === -1).map(normalizeFood),
  materias,
  materiaGradeRequiredLevels: constants.materiaGradeRequiredLevels,
  levelCaps,
  slotCaps,
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
  `Imported ${payload.gears.length} gears, ${payload.foods.length} foods and ${supportedJobs.length} jobs from ${commit.slice(0, 12)}`,
);
