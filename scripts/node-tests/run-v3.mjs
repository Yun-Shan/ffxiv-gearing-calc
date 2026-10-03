import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { Worker } from "node:worker_threads";
import { gameData } from "../../src/domain/data.ts";
import { jobSchemas } from "../../src/domain/jobs.ts";
import { slotsForJob } from "../../src/domain/optimizer.ts";

const DEFAULT_JOBS = ["RDM", "BLM"];
const MAX_SEARCH_MS = 235_000;
const MAX_RSS_BYTES = Math.floor(3.5 * 1024 * 1024 * 1024);

function readEnvironment(primaryName, aliasName, defaultValue) {
  return process.env[primaryName] ?? process.env[aliasName] ?? defaultValue;
}

function parseJobs() {
  const jobs = (process.env.DATA_TEST_JOBS ?? DEFAULT_JOBS.join(","))
    .split(",")
    .map((job) => job.trim())
    .filter(Boolean);
  if (jobs.length < 2 || new Set(jobs).size !== jobs.length) {
    throw new Error("DATA_TEST_JOBS 必须包含至少两个不重复的职业缩写");
  }
  for (const job of jobs) {
    if (!Object.hasOwn(jobSchemas, job)) {
      throw new Error(`不支持的职业缩写：${job}`);
    }
  }
  return jobs;
}

const slotAliases = new Map([
  ["weapon", "weapon"], ["mainhand", "weapon"],
  ["offhand", "offhand"],
  ["head", "head"],
  ["body", "body"],
  ["hands", "hands"], ["gloves", "hands"],
  ["legs", "legs"],
  ["feet", "feet"],
  ["earrings", "earrings"], ["ears", "earrings"],
  ["necklace", "necklace"], ["neck", "necklace"],
  ["bracelet", "bracelet"], ["wrists", "bracelet"],
  ["ring", "ring"], ["ring1", "ring"],
  ["ring2", "ring2"],
  ["rings", "rings"], ["finger", "rings"],
]);

function canonicalCommonSlots(jobs) {
  const raw = readEnvironment(
    "DATA_TEST_COMMON_SLOTS",
    "COMMON_SLOTS",
    undefined,
  );
  const supportedByAll = (slot) => jobs.every((job) => {
    const slots = slotsForJob(job);
    return slot === "rings"
      ? slots.includes("ring") && slots.includes("ring2")
      : slots.includes(slot);
  });

  if (raw === undefined || raw.trim() === "") {
    return [
      "head", "body", "hands", "legs", "feet", "earrings", "necklace",
      "bracelet", "rings",
    ].filter(supportedByAll);
  }
  if (raw.trim().toLowerCase() === "none") return [];

  const slots = raw.split(",").map((value) => {
    const normalized = value.trim().toLowerCase();
    const slot = slotAliases.get(normalized);
    if (!slot) throw new Error(`不支持的共享槽位：${value.trim()}`);
    return slot;
  });
  if (new Set(slots).size !== slots.length) {
    throw new Error("共享槽位列表包含重复项（含同义名称）");
  }
  for (const slot of slots) {
    const missingJobs = jobs.filter((job) => !supportedByAllForJob(slot, job));
    if (missingJobs.length > 0) {
      throw new Error(`${slot} 不是所有职业都可用的槽位：${missingJobs.join(", ")}`);
    }
  }
  return slots;
}

function supportedByAllForJob(slot, job) {
  const slots = slotsForJob(job);
  return slot === "rings"
    ? slots.includes("ring") && slots.includes("ring2")
    : slots.includes(slot);
}

const constraintAliases = new Map([
  ["gcd", "gcdTarget"], ["gcdTarget", "gcdTarget"],
  ["gcdChoices", "gcdChoices"],
  ["speedMin", "speedMin"], ["speedMax", "speedMax"],
  ["toughMin", "toughnessMin"], ["minTenacity", "toughnessMin"],
  ["toughnessMin", "toughnessMin"],
  ["toughnessMinPercent", "toughnessMinPercent"],
  ["maxToughnessMode", "maximizeTenacity"],
  ["maximizeTenacity", "maximizeTenacity"],
]);

function parseConstraintObject(job, value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${job} 的约束必须是对象`);
  }
  const normalized = {};
  for (const [name, rawValue] of Object.entries(value)) {
    const configName = constraintAliases.get(name);
    if (!configName) throw new Error(`${job} 的约束字段不受支持：${name}`);
    if (Object.hasOwn(normalized, configName)) {
      throw new Error(`${job} 的约束重复指定了 ${configName}`);
    }
    if (configName === "maximizeTenacity") {
      if (typeof rawValue !== "boolean") {
        throw new Error(`${job}.${name} 必须是布尔值`);
      }
      normalized[configName] = rawValue;
      continue;
    }
    if (configName === "gcdChoices") {
      if (
        !Array.isArray(rawValue) ||
        rawValue.length === 0 ||
        rawValue.some((gcd) => typeof gcd !== "number" || !Number.isFinite(gcd) || gcd <= 0) ||
        new Set(rawValue).size !== rawValue.length
      ) {
        throw new Error(`${job}.gcdChoices 必须是无重复的正有限数字数组`);
      }
      normalized[configName] = rawValue;
      continue;
    }
    if (typeof rawValue !== "number" || !Number.isFinite(rawValue)) {
      throw new Error(`${job}.${name} 必须是有限数字`);
    }
    if (configName === "gcdTarget" && rawValue <= 0) {
      throw new Error(`${job}.${name} 必须大于 0`);
    }
    normalized[configName] = rawValue;
  }
  return normalized;
}

function parseJobConstraints(jobs) {
  const raw = readEnvironment(
    "DATA_TEST_JOB_CONSTRAINTS",
    "JOB_CONSTRAINTS",
    "{}",
  );
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`DATA_TEST_JOB_CONSTRAINTS 不是有效 JSON：${String(error)}`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("DATA_TEST_JOB_CONSTRAINTS 必须是以职业缩写为键的对象");
  }
  const constraints = new Map();
  for (const [job, value] of Object.entries(parsed)) {
    if (!jobs.includes(job)) {
      throw new Error(`DATA_TEST_JOB_CONSTRAINTS 包含未选择的职业：${job}`);
    }
    constraints.set(job, parseConstraintObject(job, value));
  }
  return constraints;
}

function parseGlobalConstraintEnvironment() {
  const result = {};
  const numericEnvironments = [
    ["DATA_TEST_GCD", "gcdTarget"],
    ["DATA_TEST_SPEED_MIN", "speedMin"],
    ["DATA_TEST_SPEED_MAX", "speedMax"],
    ["DATA_TEST_TOUGH_PERCENT", "toughnessMinPercent"],
    ["DATA_TEST_TOUGH_MIN", "toughnessMin"],
  ];
  for (const [environmentName, configName] of numericEnvironments) {
    const raw = process.env[environmentName];
    if (raw === undefined || raw.trim() === "") continue;
    const value = Number(raw);
    if (!Number.isFinite(value)) {
      throw new Error(`${environmentName} 必须是有限数字`);
    }
    if (configName === "gcdTarget" && value <= 0) {
      throw new Error(`${environmentName} 必须大于 0`);
    }
    result[configName] = value;
  }

  if (process.env.DATA_TEST_GCD_CHOICES?.trim()) {
    let choices;
    try {
      choices = JSON.parse(process.env.DATA_TEST_GCD_CHOICES);
    } catch (error) {
      throw new Error(`DATA_TEST_GCD_CHOICES 不是有效 JSON：${String(error)}`);
    }
    result.gcdChoices = parseConstraintObject("全局", { gcdChoices: choices }).gcdChoices;
  }
  if (process.env.DATA_TEST_MAX_TOUGHNESS !== undefined) {
    const raw = process.env.DATA_TEST_MAX_TOUGHNESS.trim().toLowerCase();
    if (!["true", "false"].includes(raw)) {
      throw new Error("DATA_TEST_MAX_TOUGHNESS 必须是 true 或 false");
    }
    result.maximizeTenacity = raw === "true";
  }
  return result;
}

function parseFoodStrategy() {
  const strategy = readEnvironment(
    "DATA_TEST_FOOD_STRATEGY",
    "FOOD_STRATEGY",
    "shared",
  );
  if (strategy !== "shared" && strategy !== "independent") {
    throw new Error("DATA_TEST_FOOD_STRATEGY 必须是 shared 或 independent");
  }
  return strategy;
}

function parseObjective() {
  const objective = readEnvironment(
    "DATA_TEST_OBJECTIVE",
    "OBJECTIVE",
    "damage",
  );
  if (objective !== "damage" && objective !== "dps") {
    throw new Error("DATA_TEST_OBJECTIVE 必须是 damage 或 dps");
  }
  return objective;
}

function parseTimeout() {
  const raw = readEnvironment(
    "DATA_TEST_V3_TIMEOUT_MS",
    "TIMEOUT_MS",
    String(MAX_SEARCH_MS),
  );
  const timeout = Number(raw);
  if (!Number.isSafeInteger(timeout) || timeout <= 0 || timeout > MAX_SEARCH_MS) {
    throw new Error(`DATA_TEST_V3_TIMEOUT_MS 必须是大于 0 且不超过 ${MAX_SEARCH_MS} 的整数`);
  }
  return timeout;
}

const slotLabels = {
  weapon: "主手",
  offhand: "副手",
  head: "头部",
  body: "身体",
  hands: "手部",
  legs: "腿部",
  feet: "脚部",
  earrings: "耳饰",
  necklace: "项链",
  bracelet: "手镯",
  ring: "戒指1",
  ring2: "戒指2",
  rings: "戒指对",
};

function summarizeGear(gear) {
  return {
    slot: slotLabels[gear.slot] ?? gear.slot,
    itemId: gear.id,
    name: gear.name,
    itemLevel: gear.level,
    attributes: gear.finalStats,
    materia: gear.melds.map(({ stat, value, grade }) => ({ stat, value, grade })),
  };
}

function summarizeFood(food) {
  if (!food) return null;
  return {
    itemId: food.id,
    name: food.name,
    itemLevel: food.level,
    attributes: food.stats,
  };
}

function summarizeOptimization(job, result) {
  if (!result) return null;
  return {
    job,
    damagePerPotency: result.effects.damage,
    gcd: result.gcdTier,
    damagePerSecond: result.damagePerSecond,
    objectiveScore: result.score,
    totalAttributes: result.stats,
    maximumTenacity: result.maximumTenacity,
    durationMs: result.durationMs,
    searchedCandidates: result.searchedCandidates,
    food: summarizeFood(result.food),
    equipment: result.gear.map(summarizeGear),
  };
}

function summarizeJointResult(result, jobs) {
  return {
    objective: result.objective,
    normalizedJointValue: result.value,
    commonFood: summarizeFood(result.commonFood),
    commonEquipment: Object.fromEntries(
      Object.entries(result.commonGear).map(([slot, gears]) => [
        slotLabels[slot] ?? slot,
        gears?.map(summarizeGear) ?? [],
      ]),
    ),
    jobs: Object.fromEntries(jobs.map((job) => [
      job,
      {
        joint: summarizeOptimization(job, result.jobResults[job]),
        soloOptimum: summarizeOptimization(job, result.optima[job]),
      },
    ])),
    proof: result.proof,
    statistics: result.statistics,
  };
}

function processPeakRssBytes() {
  const operatingSystemPeakKiB = process.resourceUsage().maxRSS;
  return Math.max(
    process.memoryUsage.rss(),
    Number.isFinite(operatingSystemPeakKiB) ? operatingSystemPeakKiB * 1024 : 0,
  );
}

function runInWorker(config, maxSearchMs, startedAt) {
  return new Promise((resolve, reject) => {
    let worker;
    let settled = false;
    let peakRssBytes = processPeakRssBytes();
    const finish = (callback) => {
      if (settled) return false;
      settled = true;
      clearInterval(memoryMonitor);
      clearTimeout(timeWatchdog);
      callback();
      return true;
    };
    const stopWithError = (error) => {
      if (settled) return;
      settled = true;
      clearInterval(memoryMonitor);
      clearTimeout(timeWatchdog);
      const reason = error instanceof Error ? error : new Error(String(error));
      reason.elapsedMs = Math.round(performance.now() - startedAt);
      reason.peakRssBytes = Math.max(peakRssBytes, processPeakRssBytes());
      if (worker) {
        void worker.terminate().then(
          () => reject(reason),
          () => reject(reason),
        );
      } else {
        reject(reason);
      }
    };
    const updatePeakRss = () => {
      peakRssBytes = Math.max(peakRssBytes, processPeakRssBytes());
      return peakRssBytes;
    };
    const memoryMonitor = setInterval(() => {
      if (updatePeakRss() >= MAX_RSS_BYTES) {
        stopWithError(new Error(
          `Node 验收峰值 RSS 达到 ${MAX_RSS_BYTES} 字节保护线，已停止且未报告成功`,
        ));
      }
    }, 20);
    const timeWatchdog = setTimeout(() => {
      updatePeakRss();
      stopWithError(new Error(
        `Node 验收总耗时达到 ${maxSearchMs}ms 时限，已停止且未完成最优性证明`,
      ));
    }, maxSearchMs);

    try {
      worker = new Worker(new URL("./v3-worker.mjs", import.meta.url), {
        workerData: { config },
        resourceLimits: { maxOldGenerationSizeMb: 2560 },
      });
    } catch (error) {
      stopWithError(error);
      return;
    }
    updatePeakRss();

    worker.on("message", (message) => {
      if (message?.type === "progress") {
        console.log(`[搜索进度] ${message.message}`);
        return;
      }
      if (message?.type === "error") {
        const error = new Error(message.error?.message ?? "V3 worker 失败");
        error.name = message.error?.name ?? "Error";
        if (message.error?.stack) error.stack = message.error.stack;
        stopWithError(error);
        return;
      }
      if (message?.type === "result") {
        const peak = updatePeakRss();
        if (performance.now() - startedAt >= maxSearchMs) {
          stopWithError(new Error(
            `Node 验收总耗时达到 ${maxSearchMs}ms 时限，已停止且未报告成功`,
          ));
          return;
        }
        if (peak >= MAX_RSS_BYTES) {
          stopWithError(new Error(
            `Node 验收峰值 RSS 达到 ${MAX_RSS_BYTES} 字节保护线，已停止且未报告成功`,
          ));
          return;
        }
        finish(() => resolve({ result: message.result, peakRssBytes: peak }));
        void worker.terminate();
      }
    });
    worker.once("error", stopWithError);
    worker.once("exit", (code) => {
      if (!settled) {
        stopWithError(new Error(`V3 worker 退出（代码 ${code}），没有返回结果`));
      }
    });
  });
}

async function main() {
  const jobs = parseJobs();
  const jobConstraints = parseJobConstraints(jobs);
  const globalConstraints = parseGlobalConstraintEnvironment();
  const commonSlots = canonicalCommonSlots(jobs);
  const foodStrategy = parseFoodStrategy();
  const objective = parseObjective();
  const maxSearchMs = parseTimeout();

  const jobConfigs = jobs.map((jobId) => {
    const schema = jobSchemas[jobId];
    if (!schema?.defaultItemLevel || schema.defaultItemLevel.length !== 2) {
      throw new Error(`职业 ${jobId} 缺少默认装备品级范围`);
    }
    return {
      jobId,
      minItemLevel: schema.defaultItemLevel[0],
      maxItemLevel: schema.defaultItemLevel[1],
      maximizeTenacity: false,
      excludedSources: [],
      forcedGear: {},
      foodId: 0,
      ...globalConstraints,
      ...jobConstraints.get(jobId),
    };
  });

  console.log("Node 多职业验收配置：");
  console.log(JSON.stringify({
    jobs: jobConfigs.map((config) => ({
      id: config.jobId,
      itemLevelRange: [config.minItemLevel, config.maxItemLevel],
      constraints: Object.fromEntries(Object.entries(config).filter(([name]) => [
        "gcdTarget", "gcdChoices", "speedMin", "speedMax", "toughnessMin",
        "toughnessMinPercent", "maximizeTenacity",
      ].includes(name))),
    })),
    commonSlots,
    foodStrategy,
    objective,
    maxSearchMs,
    gameData: {
      version: gameData.version,
      referenceCommit: gameData.provenance.commit,
      importedAt: gameData.provenance.importedAt,
    },
    solver: "src/domain/search (HiGHS)",
  }, null, 2));

  const config = {
    jobs: jobConfigs,
    commonSlots,
    foodStrategy,
    objective,
    maxSearchMs,
  };
  const startedAt = performance.now();
  const { result, peakRssBytes } = await runInWorker(config, maxSearchMs, startedAt);
  const elapsedMs = performance.now() - startedAt;

  if (!result) {
    console.log(
      `搜索完成但没有满足全部约束的联合配装（${elapsedMs.toFixed(0)}ms，峰值 RSS ${peakRssBytes} 字节）。`,
    );
    process.exitCode = 2;
    return;
  }

  const output = summarizeJointResult(result, jobs);
  output.runtime = {
    elapsedMs: Math.round(elapsedMs),
    peakRssBytes,
    rssLimitBytes: MAX_RSS_BYTES,
    timeoutMs: maxSearchMs,
  };
  const digest = createHash("sha256").update(JSON.stringify(output)).digest("hex");
  console.log(`联合搜索完成（${elapsedMs.toFixed(0)}ms）。`);
  console.log(JSON.stringify(output, null, 2));
  console.log(`结果 SHA-256：${digest}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`Node 多职业验收失败：${message}`);
  if (error instanceof Error && error.elapsedMs !== undefined) {
    console.error(`已停止：${error.elapsedMs}ms，峰值 RSS ${error.peakRssBytes} 字节；未报告成功。`);
  }
  process.exitCode = 1;
});
