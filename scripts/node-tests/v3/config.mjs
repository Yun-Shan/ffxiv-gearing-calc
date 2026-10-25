import { MAX_SEARCH_MS, UNLIMITED_SEARCH_MS } from "./limits.mjs";

const DEFAULT_JOBS = ["RDM", "BLM"];

const sharedSlots = new Set([
  "head", "body", "hands", "legs", "feet", "earrings", "necklace", "bracelet", "ring", "ring2",
]);
const constraintNames = new Set([
  "gcdChoices", "speedMin", "speedMax", "minTenacity", "toughnessMinPercent", "maximizeTenacity",
]);

function parseJobs(env, jobSchemas) {
  const jobs = (env.DATA_TEST_JOBS ?? DEFAULT_JOBS.join(","))
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

function canonicalCommonSlots(env, jobs, slotsForJob) {
  const raw = env.DATA_TEST_COMMON_SLOTS;
  const supportedByAll = (slot) => jobs.every((job) => {
    const slots = slotsForJob(job);
    return slots.includes(slot);
  });

  if (raw === undefined || raw.trim() === "") {
    return [
      "head", "body", "hands", "legs", "feet", "earrings", "necklace",
      "bracelet", "ring", "ring2",
    ].filter(supportedByAll);
  }
  if (raw.trim().toLowerCase() === "none") return [];

  const slots = raw.split(",").map((value) => {
    const normalized = value.trim().toLowerCase();
    if (!sharedSlots.has(normalized)) throw new Error(`不支持的共享槽位：${value.trim()}`);
    return normalized;
  });
  if (new Set(slots).size !== slots.length) {
    throw new Error("共享槽位列表包含重复项");
  }
  for (const slot of slots) {
    const missingJobs = jobs.filter((job) => !supportedByAllForJob(slot, job, slotsForJob));
    if (missingJobs.length > 0) {
      throw new Error(`${slot} 不是所有职业都可用的槽位：${missingJobs.join(", ")}`);
    }
  }
  return slots;
}

function supportedByAllForJob(slot, job, slotsForJob) {
  const slots = slotsForJob(job);
  return slots.includes(slot);
}

function parseConstraintObject(job, value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${job} 的约束必须是对象`);
  }
  const normalized = {};
  for (const [name, rawValue] of Object.entries(value)) {
    if (!constraintNames.has(name)) throw new Error(`${job} 的约束字段不受支持：${name}`);
    if (name === "maximizeTenacity") {
      if (typeof rawValue !== "boolean") {
        throw new Error(`${job}.${name} 必须是布尔值`);
      }
      normalized[name] = rawValue;
      continue;
    }
    if (name === "gcdChoices") {
      if (
        !Array.isArray(rawValue) ||
        rawValue.length === 0 ||
        rawValue.some((gcd) => typeof gcd !== "number" || !Number.isFinite(gcd) || gcd <= 0) ||
        new Set(rawValue).size !== rawValue.length
      ) {
        throw new Error(`${job}.gcdChoices 必须是无重复的正有限数字数组`);
      }
      normalized[name] = rawValue;
      continue;
    }
    if (typeof rawValue !== "number" || !Number.isFinite(rawValue)) {
      throw new Error(`${job}.${name} 必须是有限数字`);
    }
    normalized[name] = rawValue;
  }
  return normalized;
}

function parseJobConstraints(env, jobs) {
  const raw = env.DATA_TEST_JOB_CONSTRAINTS ?? "{}";
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

function parseGlobalConstraintEnvironment(env) {
  const result = {};
  const numericEnvironments = [
    ["DATA_TEST_SPEED_MIN", "speedMin"],
    ["DATA_TEST_SPEED_MAX", "speedMax"],
    ["DATA_TEST_TOUGH_PERCENT", "toughnessMinPercent"],
    ["DATA_TEST_MIN_TENACITY", "minTenacity"],
  ];
  for (const [environmentName, name] of numericEnvironments) {
    const raw = env[environmentName];
    if (raw === undefined || raw.trim() === "") continue;
    const value = Number(raw);
    if (!Number.isFinite(value)) {
      throw new Error(`${environmentName} 必须是有限数字`);
    }
    result[name] = value;
  }

  if (env.DATA_TEST_GCD_CHOICES?.trim()) {
    let choices;
    try {
      choices = JSON.parse(env.DATA_TEST_GCD_CHOICES);
    } catch (error) {
      throw new Error(`DATA_TEST_GCD_CHOICES 不是有效 JSON：${String(error)}`);
    }
    result.gcdChoices = parseConstraintObject("全局", { gcdChoices: choices }).gcdChoices;
  }
  if (env.DATA_TEST_MAX_TOUGHNESS !== undefined) {
    const raw = env.DATA_TEST_MAX_TOUGHNESS.trim().toLowerCase();
    if (!["true", "false"].includes(raw)) {
      throw new Error("DATA_TEST_MAX_TOUGHNESS 必须是 true 或 false");
    }
    result.maximizeTenacity = raw === "true";
  }
  return result;
}

function parseFoodStrategy(env) {
  const strategy = env.DATA_TEST_FOOD_STRATEGY ?? "shared";
  if (strategy !== "shared" && strategy !== "independent") {
    throw new Error("DATA_TEST_FOOD_STRATEGY 必须是 shared 或 independent");
  }
  return strategy;
}

function parseObjective(env) {
  const objective = env.DATA_TEST_OBJECTIVE ?? "damage";
  if (objective !== "damage" && objective !== "dps") {
    throw new Error("DATA_TEST_OBJECTIVE 必须是 damage 或 dps");
  }
  return objective;
}

function parseTimeout(env) {
  const raw = env.DATA_TEST_V3_TIMEOUT_MS ?? String(MAX_SEARCH_MS);
  if (raw.trim().toLowerCase() === "unlimited") return UNLIMITED_SEARCH_MS;
  const timeout = Number(raw);
  if (!Number.isSafeInteger(timeout) || timeout <= 0 || timeout > MAX_SEARCH_MS) {
    throw new Error(`DATA_TEST_V3_TIMEOUT_MS 必须是 1 至 ${MAX_SEARCH_MS} 的整数，或 unlimited`);
  }
  return timeout;
}

function optionalPositiveIntegerEnvironment(env, name) {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return undefined;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} 必须是正安全整数`);
  }
  return value;
}

export function parseV3Config({ env, jobSchemas, slotsForJob, syncLevels }) {
  const jobs = parseJobs(env, jobSchemas);
  const jobConstraints = parseJobConstraints(env, jobs);
  const globalConstraints = parseGlobalConstraintEnvironment(env);
  const commonSlots = canonicalCommonSlots(env, jobs, slotsForJob);
  const foodStrategy = parseFoodStrategy(env);
  const objective = parseObjective(env);
  const maxSearchMs = parseTimeout(env);
  const minimumItemLevel = optionalPositiveIntegerEnvironment(env, "DATA_TEST_MIN_ITEM_LEVEL");
  const maximumItemLevel = optionalPositiveIntegerEnvironment(env, "DATA_TEST_MAX_ITEM_LEVEL");
  const syncItemLevel = optionalPositiveIntegerEnvironment(env, "DATA_TEST_SYNC_LEVEL");
  const syncJobLevel = optionalPositiveIntegerEnvironment(env, "DATA_TEST_SYNC_JOB_LEVEL");
  if (syncItemLevel !== undefined && syncJobLevel !== undefined)
    throw new Error("DATA_TEST_SYNC_LEVEL 与 DATA_TEST_SYNC_JOB_LEVEL 不能同时设置");
  if (syncItemLevel !== undefined && syncItemLevel < 90)
    throw new Error("DATA_TEST_SYNC_LEVEL 必须不低于 90");
  if (syncJobLevel !== undefined &&
      !syncLevels.some((entry) => entry.jobLevel === syncJobLevel))
    throw new Error(`DATA_TEST_SYNC_JOB_LEVEL 不受支持：${syncJobLevel}`);
  const sync = syncItemLevel === undefined
    ? syncJobLevel === undefined ? undefined : { kind: "jobLevel", value: syncJobLevel }
    : { kind: "itemLevel", value: syncItemLevel };

  const jobConfigs = jobs.map((jobId) => {
    const schema = jobSchemas[jobId];
    if (!schema?.defaultItemLevel || schema.defaultItemLevel.length !== 2) {
      throw new Error(`职业 ${jobId} 缺少默认装备品级范围`);
    }
    const minItemLevel = minimumItemLevel ?? jobSchemas[jobs[0]].defaultItemLevel[0];
    const maxItemLevel = maximumItemLevel ?? jobSchemas[jobs[0]].defaultItemLevel[1];
    if (minItemLevel > maxItemLevel) {
      throw new Error(`装备品级范围无效：${minItemLevel}–${maxItemLevel}`);
    }
    return {
      jobId,
      clanIndex: 0,
      objective,
      minItemLevel,
      maxItemLevel,
      ...(sync === undefined ? {} : { sync }),
      maximizeTenacity: false,
      excludedSources: [],
      forcedGear: {},
      foodId: 0,
      ...globalConstraints,
      ...jobConstraints.get(jobId),
    };
  });

  return {
    jobs,
    jobConstraints,
    globalConstraints,
    commonSlots,
    foodStrategy,
    objective,
    maxSearchMs,
    minimumItemLevel,
    maximumItemLevel,
    sync,
    jobConfigs,
  };
}
