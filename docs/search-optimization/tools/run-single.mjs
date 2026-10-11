import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { Worker } from "node:worker_threads";
import { gameData } from "../../../src/domain/data.ts";
import { currentLevel, jobSchemas } from "../../../src/domain/jobs.ts";

const MAX_RSS_BYTES = Math.floor(3.5 * 1024 * 1024 * 1024);
const UNLIMITED_SEARCH_MS = Number.MAX_SAFE_INTEGER;

function positiveInteger(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} 必须是正安全整数`);
  return value;
}

function nonNegativeInteger(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} 必须是非负安全整数`);
  return value;
}

function parseTimeout() {
  const raw = process.env.DATA_TEST_SINGLE_TIMEOUT_MS ?? "unlimited";
  if (raw.trim().toLowerCase() === "unlimited") return UNLIMITED_SEARCH_MS;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error("DATA_TEST_SINGLE_TIMEOUT_MS 必须是正安全整数或 unlimited");
  }
  return value;
}

function processPeakRssBytes() {
  const operatingSystemPeakKiB = process.resourceUsage().maxRSS;
  return Math.max(
    process.memoryUsage.rss(),
    Number.isFinite(operatingSystemPeakKiB) ? operatingSystemPeakKiB * 1024 : 0,
  );
}

function makeConfig() {
  const jobId = process.env.DATA_TEST_SINGLE_JOB ?? "VPR";
  const schema = jobSchemas[jobId];
  if (!schema) throw new Error(`不支持的职业缩写：${jobId}`);
  const minItemLevel = positiveInteger("DATA_TEST_SINGLE_MIN_ITEM_LEVEL", schema.defaultItemLevel[0]);
  const maxItemLevel = positiveInteger("DATA_TEST_SINGLE_MAX_ITEM_LEVEL", schema.defaultItemLevel[1]);
  if (minItemLevel > maxItemLevel) throw new Error(`装备品级范围无效：${minItemLevel}–${maxItemLevel}`);

  const objective = process.env.DATA_TEST_SINGLE_OBJECTIVE ?? "dps";
  if (objective !== "damage" && objective !== "dps") {
    throw new Error("DATA_TEST_SINGLE_OBJECTIVE 必须是 damage 或 dps");
  }
  const foodId = nonNegativeInteger("DATA_TEST_SINGLE_FOOD_ID", 0);
  const syncLevel = process.env.DATA_TEST_SINGLE_SYNC_LEVEL === undefined
    ? undefined
    : positiveInteger("DATA_TEST_SINGLE_SYNC_LEVEL", undefined);
  const maxSearchMs = parseTimeout();
  const maxJobLevel = schema.maxJobLevel ?? currentLevel;
  const jobLevel = Math.min(currentLevel, maxJobLevel);

  return {
    config: {
      jobId,
      jobLevel,
      minItemLevel,
      maxItemLevel,
      ...(syncLevel === undefined ? {} : { syncLevel }),
      maximizeTenacity: false,
      objective,
      excludedSources: [],
      forcedGear: {},
      foodId,
      maxSearchMs,
    },
    maxSearchMs,
  };
}

function runInWorker(config, maxSearchMs, startedAt) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let peakRssBytes = processPeakRssBytes();
    let worker;
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
      const reason = error instanceof Error ? error : new Error(String(error));
      reason.elapsedMs = Math.round(performance.now() - startedAt);
      reason.peakRssBytes = Math.max(peakRssBytes, processPeakRssBytes());
      finish(() => {
        if (worker) void worker.terminate().then(() => reject(reason), () => reject(reason));
        else reject(reason);
      });
    };
    const updatePeakRss = () => {
      peakRssBytes = Math.max(peakRssBytes, processPeakRssBytes());
      return peakRssBytes;
    };
    const memoryMonitor = setInterval(() => {
      if (updatePeakRss() >= MAX_RSS_BYTES) {
        stopWithError(new Error(`Node 单职业验收 RSS 达到 ${MAX_RSS_BYTES} 字节保护线；搜索未报告成功`));
      }
    }, 50);
    const timeWatchdog = maxSearchMs === UNLIMITED_SEARCH_MS ? undefined : setTimeout(() => {
      stopWithError(new Error(`Node 单职业验收达到 ${maxSearchMs}ms 时限；搜索未完成最优性证明`));
    }, maxSearchMs);

    try {
      worker = new Worker(new URL("./single-worker.mjs", import.meta.url), {
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
      } else if (message?.type === "candidateCounts") {
        console.log(`[候选数] ${JSON.stringify(message.counts)}`);
      } else if (message?.type === "solverProgress") {
        console.log(`[求解器诊断] ${JSON.stringify(message.progress)}`);
      } else if (message?.type === "error") {
        const error = new Error(message.error?.message ?? "单职业搜索 worker 失败");
        error.name = message.error?.name ?? "Error";
        if (message.error?.stack) error.stack = message.error.stack;
        stopWithError(error);
      } else if (message?.type === "result") {
        const peak = updatePeakRss();
        if (performance.now() - startedAt >= maxSearchMs) {
          stopWithError(new Error(`Node 单职业验收达到 ${maxSearchMs}ms 时限；搜索未完成最优性证明`));
          return;
        }
        if (peak >= MAX_RSS_BYTES) {
          stopWithError(new Error(`Node 单职业验收 RSS 达到 ${MAX_RSS_BYTES} 字节保护线；搜索未报告成功`));
          return;
        }
        finish(() => resolve({
          result: message.result,
          solverStatuses: message.solverStatuses ?? [],
          peakRssBytes: peak,
        }));
        void worker.terminate();
      }
    });
    worker.once("error", stopWithError);
    worker.once("exit", (code) => {
      if (!settled) stopWithError(new Error(`单职业搜索 worker 退出（代码 ${code}），没有返回结果`));
    });
  });
}

function summarizeResult(config, result, solverStatuses, elapsedMs, peakRssBytes) {
  const statistics = result.statistics ?? {};
  const signatureBandProof = statistics.signatureBandProof === true;
  const exactBandInfeasibilityProof = solverStatuses.some(({ phase, status }) =>
    phase === "exact_damage_band_feasibility" && status === "Infeasible");
  const output = {
    scenario: {
      jobId: config.jobId,
      jobLevel: config.jobLevel,
      itemLevelRange: [config.minItemLevel, config.maxItemLevel],
      ...(config.syncLevel === undefined ? {} : { syncLevel: config.syncLevel }),
      objective: config.objective,
      foodId: config.foodId,
      maxSearchMs: config.maxSearchMs === UNLIMITED_SEARCH_MS ? "unlimited" : config.maxSearchMs,
    },
    gameData: {
      version: gameData.version,
      referenceCommit: gameData.provenance.commit,
      importedAt: gameData.provenance.importedAt,
    },
    proof: {
      complete: signatureBandProof || exactBandInfeasibilityProof,
      method: signatureBandProof
        ? "签名带 BigInt 上界证明"
        : exactBandInfeasibilityProof
        ? "HiGHS 精确带宽不可行性证明"
        : "未确认",
      signatureBandProof,
      solverStatuses,
      solverRuns: statistics.solverRuns,
      excludedSignatures: statistics.excludedSignatures,
      signatureBandChecks: statistics.signatureBandChecks,
    },
    result: {
      score: result.score,
      damagePerPotency: result.effects.damage,
      damagePerSecond: result.damagePerSecond,
      gcd: result.gcdTier,
      totalAttributes: result.stats,
      food: { id: result.food.id, name: result.food.name, itemLevel: result.food.level },
      equipment: result.gear.map((gear) => ({
        slot: gear.slot,
        id: gear.id,
        name: gear.name,
        itemLevel: gear.level,
        finalStats: gear.finalStats,
        materia: gear.melds.map(({ stat, value, grade }) => ({ stat, value, grade })),
      })),
    },
    search: {
      elapsedMs: Math.round(elapsedMs),
      solverElapsedMs: result.durationMs,
      searchedCandidates: result.searchedCandidates,
      modelPreparationMs: statistics.modelPreparationMs,
      solverWallMs: statistics.solverWallMs,
      variables: statistics.variables,
      constraints: statistics.constraints,
      candidateUpperBound: statistics.candidateUpperBound,
      conditionalResourceSupport: statistics.conditionalResourceSupport,
      memoryUsage: statistics.memoryUsage,
      peakRssBytes,
      rssLimitBytes: MAX_RSS_BYTES,
    },
  };
  output.sha256 = createHash("sha256").update(JSON.stringify(output)).digest("hex");
  return output;
}

async function main() {
  const { config, maxSearchMs } = makeConfig();
  console.log("Node 单职业验收配置：");
  console.log(JSON.stringify({
    ...config,
    maxSearchMs: maxSearchMs === UNLIMITED_SEARCH_MS ? "unlimited" : maxSearchMs,
    gameData: {
      version: gameData.version,
      referenceCommit: gameData.provenance.commit,
      importedAt: gameData.provenance.importedAt,
    },
    solver: "src/domain/optimizer.ts -> runOptimizationLocally -> HiGHS",
  }, null, 2));

  const startedAt = performance.now();
  const { result, solverStatuses, peakRssBytes } = await runInWorker(config, maxSearchMs, startedAt);
  const elapsedMs = performance.now() - startedAt;
  if (!result) {
    console.log(`没有满足全部约束的配装（${Math.round(elapsedMs)}ms；峰值 RSS ${peakRssBytes} 字节）。`);
    process.exitCode = 2;
    return;
  }

  const output = summarizeResult(config, result, solverStatuses, elapsedMs, peakRssBytes);
  console.log(`搜索完成（${Math.round(elapsedMs)}ms；最优性证明=${output.proof.complete}；方法=${output.proof.method}）。`);
  console.log(JSON.stringify(output, null, 2));
  if (!output.proof.complete) {
    throw new Error("搜索结果没有对应的完整签名带或精确 MIP 不可行性证明");
  }
}

main().catch((error) => {
  console.error(`Node 单职业验收失败：${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  if (error instanceof Error && error.elapsedMs !== undefined) {
    console.error(`已停止：${error.elapsedMs}ms，峰值 RSS ${error.peakRssBytes} 字节；未报告成功。`);
  }
  process.exitCode = 1;
});
