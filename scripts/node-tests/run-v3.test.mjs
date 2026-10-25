import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { parseV3Config } from "./v3/config.mjs";
import {
  MAX_RSS_BYTES,
  MAX_SEARCH_MS,
  UNLIMITED_SEARCH_MS,
} from "./v3/limits.mjs";
import { buildV3Output, digestV3Output } from "./v3/report.mjs";
import { runInWorker } from "./v3/worker.mjs";

const jobSchemas = {
  RDM: { defaultItemLevel: [700, 790] },
  BLM: { defaultItemLevel: [710, 790] },
  PCT: { defaultItemLevel: [720, 790] },
};
const slotsByJob = {
  RDM: ["weapon", "offhand", "head", "body", "hands", "legs", "feet", "earrings", "necklace", "bracelet", "ring", "ring2"],
  BLM: ["weapon", "head", "body", "hands", "legs", "feet", "earrings", "necklace", "bracelet", "ring", "ring2"],
  PCT: ["weapon", "head", "body", "hands", "legs", "feet", "earrings", "necklace", "bracelet", "ring", "ring2"],
};
const syncLevels = [
  { jobLevel: 50, minItemLevel: 90, defaultItemLevel: 130 },
  { jobLevel: 60, minItemLevel: 250, defaultItemLevel: 270 },
  { jobLevel: 70, minItemLevel: 300, defaultItemLevel: 400 },
];

function parse(env = {}) {
  return parseV3Config({
    env,
    jobSchemas,
    slotsForJob: (job) => slotsByJob[job] ?? [],
    syncLevels,
  });
}

test("V3 config defaults use the standard jobs, supported shared slots, and 235-second limit", () => {
  const config = parse();
  assert.deepEqual(config.jobs, ["RDM", "BLM"]);
  assert.deepEqual(config.commonSlots, [
    "head", "body", "hands", "legs", "feet", "earrings", "necklace",
    "bracelet", "ring", "ring2",
  ]);
  assert.equal(config.foodStrategy, "shared");
  assert.equal(config.objective, "damage");
  assert.equal(config.maxSearchMs, 235_000);
  assert.deepEqual(config.jobConfigs.map(({ jobId, minItemLevel, maxItemLevel }) => [
    jobId, minItemLevel, maxItemLevel,
  ]), [["RDM", 700, 790], ["BLM", 700, 790]]);
  assert.deepEqual(config.jobConfigs.map(({ maximizeTenacity }) => maximizeTenacity), [false, false]);
});

test("V3 config accepts concrete shared slots and rejects duplicate or unsupported slots", () => {
  assert.deepEqual(parse({ DATA_TEST_COMMON_SLOTS: "ring,ring2" }).commonSlots, ["ring", "ring2"]);
  assert.throws(() => parse({ DATA_TEST_COMMON_SLOTS: "head,head" }), /重复项/);
  assert.throws(() => parse({ DATA_TEST_COMMON_SLOTS: "waist" }), /不支持的共享槽位/);
  assert.throws(() => parse({ DATA_TEST_COMMON_SLOTS: "offhand" }), /不支持的共享槽位/);
  assert.deepEqual(parse({ DATA_TEST_COMMON_SLOTS: "none" }).commonSlots, []);
});

test("V3 config rejects invalid jobs and unsupported constraints", () => {
  assert.throws(() => parse({ DATA_TEST_JOBS: "RDM" }), /至少两个/);
  assert.throws(() => parse({ DATA_TEST_JOBS: "RDM,RDM" }), /不重复/);
  assert.throws(() => parse({ DATA_TEST_JOBS: "RDM,NOPE" }), /不支持的职业缩写/);
  assert.throws(() => parse({
    DATA_TEST_JOB_CONSTRAINTS: JSON.stringify({ RDM: { unknownLimit: 1 } }),
  }), /约束字段不受支持/);
  assert.throws(() => parse({
    DATA_TEST_JOB_CONSTRAINTS: JSON.stringify({ RDM: { gcdChoices: [2.5, 2.5] } }),
  }), /无重复的正有限数字数组/);
});

test("per-job constraints override global values with current domain field names", () => {
  const config = parse({
    DATA_TEST_GCD_CHOICES: "[2.5]",
    DATA_TEST_MAX_TOUGHNESS: "false",
    DATA_TEST_JOB_CONSTRAINTS: JSON.stringify({
      RDM: { gcdChoices: [2.45] },
      BLM: { gcdChoices: [2.45, 2.5] },
    }),
  });
  assert.deepEqual(config.globalConstraints, { gcdChoices: [2.5], maximizeTenacity: false });
  assert.deepEqual(config.jobConfigs.map((job) => ({
    jobId: job.jobId, gcdChoices: job.gcdChoices, clanIndex: job.clanIndex,
    objective: job.objective, maximizeTenacity: job.maximizeTenacity,
  })), [
    { jobId: "RDM", gcdChoices: [2.45], clanIndex: 0, objective: "damage", maximizeTenacity: false },
    { jobId: "BLM", gcdChoices: [2.45, 2.5], clanIndex: 0, objective: "damage", maximizeTenacity: false },
  ]);
});

test("V3 sync settings and item-level overrides preserve supported bounds", () => {
  const itemSync = parse({
    DATA_TEST_SYNC_LEVEL: "90",
    DATA_TEST_MIN_ITEM_LEVEL: "710",
    DATA_TEST_MAX_ITEM_LEVEL: "780",
  });
  assert.deepEqual(itemSync.sync, { kind: "itemLevel", value: 90 });
  assert.deepEqual(itemSync.jobConfigs.map(({ minItemLevel, maxItemLevel, sync }) => [
    minItemLevel, maxItemLevel, sync,
  ]), [
    [710, 780, { kind: "itemLevel", value: 90 }],
    [710, 780, { kind: "itemLevel", value: 90 }],
  ]);
  assert.deepEqual(parse({ DATA_TEST_SYNC_JOB_LEVEL: "60" }).sync, { kind: "jobLevel", value: 60 });
  assert.throws(() => parse({ DATA_TEST_SYNC_LEVEL: "89" }), /不低于 90/);
  assert.throws(() => parse({ DATA_TEST_SYNC_JOB_LEVEL: "55" }), /不受支持/);
  assert.throws(() => parse({ DATA_TEST_SYNC_LEVEL: "90", DATA_TEST_SYNC_JOB_LEVEL: "60" }), /不能同时设置/);
  assert.throws(() => parse({ DATA_TEST_MIN_ITEM_LEVEL: "781", DATA_TEST_MAX_ITEM_LEVEL: "780" }), /范围无效/);
  assert.throws(() => parse({ DATA_TEST_MIN_ITEM_LEVEL: "700.5" }), /正安全整数/);
});

test("V3 timeout accepts both inclusive bounds and unlimited, and rejects invalid values", () => {
  assert.equal(MAX_SEARCH_MS, 235_000);
  assert.equal(parse({ DATA_TEST_V3_TIMEOUT_MS: "1" }).maxSearchMs, 1);
  assert.equal(parse({ DATA_TEST_V3_TIMEOUT_MS: "235000" }).maxSearchMs, 235_000);
  assert.equal(parse({ DATA_TEST_V3_TIMEOUT_MS: "UnLiMiTeD" }).maxSearchMs, UNLIMITED_SEARCH_MS);
  for (const value of ["0", "235001", "1.5", "NaN", "9007199254740992", ""]) {
    assert.throws(() => parse({ DATA_TEST_V3_TIMEOUT_MS: value }), undefined, `timeout ${JSON.stringify(value)} must be rejected`);
  }
});

const makeGear = (slot, id) => ({
  slot,
  id,
  name: `Gear ${id}`,
  level: 790,
  finalStats: { CRT: 100, DET: 90 },
  melds: [{ stat: "CRT", value: 36, grade: 12 }],
});

const makeOptimization = (job, gear) => ({
  effects: { damage: 12345 },
  gcdTier: 2.45,
  damagePerSecond: 5040.8,
  score: 12345,
  stats: { CRT: 1500, DET: 1400 },
  maximumTenacity: 0,
  statistics: { elapsedMs: 321 },
  searchedCandidates: 876,
  food: { id: 3001, name: "Test food", level: 790, stats: { CRT: 90 } },
  gear: [gear],
  job,
});

test("V3 report retains complete proof/statistics, requested job and equipment order, fields, and SHA-256 JSON digest", () => {
  const head = makeGear("head", 1001);
  const ringA = makeGear("ring", 1002);
  const ringB = makeGear("ring2", 1003);
  const joint = makeOptimization("BLM", head);
  const solo = makeOptimization("BLM", ringA);
  const result = {
    objective: "damage",
    value: 2.125,
    commonFood: { id: 3001, name: "Test food", level: 790, stats: { CRT: 90 } },
    commonGear: { head: [head], ring: [ringA], ring2: [ringB] },
    jobResults: { BLM: joint, RDM: null },
    optima: { BLM: solo, RDM: null },
    proof: {
      status: "optimal",
      allJobsOptimal: true,
      jointObjectiveVerified: true,
      identityVerified: true,
      nested: { checkedSignatures: 44, bound: "tight" },
    },
    statistics: {
      elapsedMs: 9.6,
      exploredNodes: 120,
      solverCalls: 7,
      prunedByBound: 32,
      timeLimitMs: 235000,
      nested: { rounds: [1, 2, 3] },
    },
  };
  const output = buildV3Output(result, ["BLM", "RDM"], {
    maxSearchMs: MAX_SEARCH_MS,
    peakRssBytes: 1_234_567,
  });

  assert.deepEqual(Object.keys(output), [
    "objective", "normalizedJointValue", "commonFood", "commonEquipment", "jobs",
    "proof", "statistics", "runtime",
  ]);
  assert.equal(output.objective, "damage");
  assert.equal(output.normalizedJointValue, 2.125);
  assert.deepEqual(Object.keys(output.commonEquipment), ["头部", "戒指1", "戒指2"]);
  assert.deepEqual([...output.commonEquipment["戒指1"], ...output.commonEquipment["戒指2"]].map(({ itemId }) => itemId), [1002, 1003]);
  assert.deepEqual(Object.keys(output.jobs), ["BLM", "RDM"]);
  assert.deepEqual(Object.keys(output.jobs.BLM), ["joint", "soloOptimum"]);
  assert.deepEqual(output.jobs.BLM.joint, {
    job: "BLM",
    damagePerPotency: 12345,
    gcd: 2.45,
    damagePerSecond: 5040.8,
    objectiveScore: 12345,
    totalAttributes: { CRT: 1500, DET: 1400 },
    maximumTenacity: 0,
    statistics: { elapsedMs: 321 },
    searchedCandidates: 876,
    food: { itemId: 3001, name: "Test food", itemLevel: 790, attributes: { CRT: 90 } },
    equipment: [{
      slot: "头部",
      itemId: 1001,
      name: "Gear 1001",
      itemLevel: 790,
      attributes: { CRT: 100, DET: 90 },
      materia: [{ stat: "CRT", value: 36, grade: 12 }],
    }],
  });
  assert.equal(output.jobs.RDM.joint, null);
  assert.equal(output.jobs.RDM.soloOptimum, null);
  assert.deepEqual(output.proof, result.proof);
  assert.deepEqual(output.statistics, result.statistics);
  assert.deepEqual(output.runtime, {
    peakRssBytes: 1_234_567,
    rssLimitBytes: MAX_RSS_BYTES,
    timeoutMs: 235_000,
  });
  const expectedDigest = createHash("sha256").update(JSON.stringify(output)).digest("hex");
  assert.equal(digestV3Output(output), expectedDigest);
  assert.match(digestV3Output(output), /^[a-f0-9]{64}$/);

  const unlimitedOutput = buildV3Output(result, ["BLM", "RDM"], {
    maxSearchMs: UNLIMITED_SEARCH_MS,
    peakRssBytes: 1_234_567,
  });
  assert.equal(unlimitedOutput.statistics.timeLimitMs, "unlimited");
  assert.equal(unlimitedOutput.runtime.timeoutMs, "unlimited");
});

function makeWorkerHarness({ rss = 10, now = 0, maxRssBytes = 350 } = {}) {
  const timers = new Map();
  const cleared = [];
  const logs = [];
  let nextTimerId = 1;
  let currentRss = rss;
  let currentTime = now;
  const instances = [];

  class FakeWorker extends EventEmitter {
    constructor(url, options) {
      super();
      this.url = url;
      this.options = options;
      this.terminateCalls = 0;
      instances.push(this);
    }

    terminate() {
      this.terminateCalls += 1;
      return Promise.resolve(0);
    }
  }

  return {
    dependencies: {
      Worker: FakeWorker,
      performance: { now: () => currentTime },
      setTimeout(callback, delay) {
        const id = nextTimerId++;
        timers.set(id, { type: "timeout", callback, delay });
        return id;
      },
      clearTimeout(id) {
        cleared.push(id);
        timers.delete(id);
      },
      setInterval(callback, delay) {
        const id = nextTimerId++;
        timers.set(id, { type: "interval", callback, delay });
        return id;
      },
      clearInterval(id) {
        cleared.push(id);
        timers.delete(id);
      },
      processPeakRssBytes: () => currentRss,
      logger: { log: (...args) => logs.push(args) },
      maxRssBytes,
    },
    timers,
    cleared,
    logs,
    instances,
    setRss(value) { currentRss = value; },
    setNow(value) { currentTime = value; },
    fire(type) {
      const timer = [...timers.values()].find((entry) => entry.type === type);
      assert.ok(timer, `expected a scheduled ${type}`);
      timer.callback();
    },
  };
}

function startWorker(harness, maxSearchMs = 100, startedAt = 0) {
  return runInWorker({ marker: "config" }, maxSearchMs, startedAt, new Uint8Array([1, 2]), harness.dependencies);
}

test("V3 worker accepts one result, forwards progress and diagnostics, and terminates exactly once", async () => {
  const harness = makeWorkerHarness();
  let settleCount = 0;
  const pending = startWorker(harness).then((value) => {
    settleCount += 1;
    return value;
  });
  const [worker] = harness.instances;
  assert.ok(worker);
  assert.deepEqual(worker.options.workerData, {
    config: { marker: "config" },
    dataBinary: new Uint8Array([1, 2]),
  });
  assert.equal(worker.options.resourceLimits.maxOldGenerationSizeMb, 2560);
  worker.emit("message", { type: "progress", message: "phase 1" });
  worker.emit("message", { type: "solverProgress", progress: { kind: "log", line: 4 } });
  worker.emit("message", { type: "result", result: { answer: 42 } });
  worker.emit("message", { type: "error", error: { message: "late duplicate event" } });

  assert.deepEqual(await pending, { result: { answer: 42 }, peakRssBytes: 10 });
  assert.equal(settleCount, 1);
  assert.deepEqual(harness.logs, [
    ["[搜索进度] phase 1"],
    ['[求解器诊断] {"kind":"log","line":4}'],
  ]);
  assert.equal(worker.terminateCalls, 1);
  assert.equal(harness.timers.size, 0);
  assert.equal(harness.cleared.length, 2);
});

test("V3 worker timeout rejects, terminates, and clears both timers", async () => {
  const harness = makeWorkerHarness();
  const pending = startWorker(harness, 1);
  const [worker] = harness.instances;
  const timeout = [...harness.timers.values()].find(({ type }) => type === "timeout");
  assert.equal(timeout.delay, 1);
  timeout.callback();
  await assert.rejects(pending, /达到 1ms 时限.*未完成最优性证明/);
  assert.equal(worker.terminateCalls, 1);
  assert.equal(harness.timers.size, 0);
  assert.equal(harness.cleared.length, 2);
});

test("V3 worker rejects a result arriving exactly at its time limit", async () => {
  const harness = makeWorkerHarness({ now: 101 });
  const pending = startWorker(harness, 1, 100);
  const [worker] = harness.instances;
  worker.emit("message", { type: "result", result: "late" });
  await assert.rejects(pending, /达到 1ms 时限.*未报告成功/);
  assert.equal(worker.terminateCalls, 1);
  assert.equal(harness.timers.size, 0);
});

test("unlimited V3 worker omits only the time watchdog and retains RSS protection", async () => {
  assert.equal(MAX_RSS_BYTES, Math.floor(3.5 * 1024 * 1024 * 1024));
  const harness = makeWorkerHarness({ rss: 350, maxRssBytes: 350 });
  const pending = startWorker(harness, UNLIMITED_SEARCH_MS);
  const [worker] = harness.instances;
  assert.equal([...harness.timers.values()].filter(({ type }) => type === "timeout").length, 0);
  assert.equal([...harness.timers.values()].filter(({ type }) => type === "interval").length, 1);
  harness.fire("interval");
  await assert.rejects(pending, /峰值 RSS 达到 350 字节保护线/);
  worker.emit("message", { type: "result", result: "late after RSS rejection" });
  assert.equal(worker.terminateCalls, 1);
  assert.equal(harness.timers.size, 0);
  assert.ok(harness.cleared.includes(undefined));
});

test("V3 worker treats the RSS limit as exclusive and rejects a result at the boundary", async () => {
  const below = makeWorkerHarness({ rss: 349, maxRssBytes: 350 });
  const success = startWorker(below, UNLIMITED_SEARCH_MS);
  below.instances[0].emit("message", { type: "result", result: "under limit" });
  assert.deepEqual(await success, { result: "under limit", peakRssBytes: 349 });

  const atLimit = makeWorkerHarness({ rss: 349, maxRssBytes: 350 });
  const rejected = startWorker(atLimit, UNLIMITED_SEARCH_MS);
  atLimit.setRss(350);
  atLimit.instances[0].emit("message", { type: "result", result: "must reject" });
  await assert.rejects(rejected, /峰值 RSS 达到 350 字节保护线/);
  assert.equal(atLimit.instances[0].terminateCalls, 1);
});

test("V3 worker reports error and unexpected exit without a result, settling only once", async () => {
  const errored = makeWorkerHarness();
  const errorResult = startWorker(errored);
  const [errorWorker] = errored.instances;
  errorWorker.emit("message", { type: "error", error: { name: "RangeError", message: "bad worker input" } });
  errorWorker.emit("exit", 1);
  await assert.rejects(errorResult, (error) => error.name === "RangeError" && error.message === "bad worker input");
  assert.equal(errorWorker.terminateCalls, 1);
  assert.equal(errored.timers.size, 0);

  const exited = makeWorkerHarness();
  const exitResult = startWorker(exited);
  const [exitWorker] = exited.instances;
  exitWorker.emit("exit", 7);
  exitWorker.emit("error", new Error("late error"));
  await assert.rejects(exitResult, /退出（代码 7），没有返回结果/);
  assert.equal(exitWorker.terminateCalls, 1);
  assert.equal(exited.timers.size, 0);

  const workerErrored = makeWorkerHarness();
  const workerErrorResult = startWorker(workerErrored);
  const [workerError] = workerErrored.instances;
  workerError.emit("error", new TypeError("thread crashed"));
  await assert.rejects(workerErrorResult, (error) => error.name === "TypeError" && error.message === "thread crashed");
  assert.equal(workerError.terminateCalls, 1);
  assert.equal(workerErrored.timers.size, 0);
});
