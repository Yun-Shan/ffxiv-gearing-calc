import { createHash } from "node:crypto";
import { fork } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { Worker } from "node:worker_threads";
import { performance } from "node:perf_hooks";

function processPeakRssBytes() {
  const operatingSystemPeakKiB = process.resourceUsage().maxRSS;
  return Math.max(
    process.memoryUsage.rss(),
    Number.isFinite(operatingSystemPeakKiB) ? operatingSystemPeakKiB * 1024 : 0,
  );
}

const defaultJobs = ["RDM", "BLM"];
const jobs = (process.env.DATA_TEST_JOBS ?? defaultJobs.join(","))
  .split(",")
  .map((job) => job.trim())
  .filter(Boolean);
if (jobs.length < 2 || new Set(jobs).size !== jobs.length) {
  throw new Error("DATA_TEST_JOBS 必须包含至少两个不重复的职业缩写");
}

const jobConstraintEnvironmentNames = {
  gcd: "DATA_TEST_GCD",
  speedMin: "DATA_TEST_SPEED_MIN",
  speedMax: "DATA_TEST_SPEED_MAX",
  gcdChoices: "DATA_TEST_GCD_CHOICES",
  toughnessMinPercent: "DATA_TEST_TOUGH_PERCENT",
  toughMin: "DATA_TEST_TOUGH_MIN",
  maxToughnessMode: "DATA_TEST_MAX_TOUGHNESS",
};
const jobConstraintOverrides = new Map();
const rawJobConstraints = process.env.DATA_TEST_JOB_CONSTRAINTS;
if (rawJobConstraints !== undefined && rawJobConstraints.trim() !== "") {
  let parsedJobConstraints;
  try {
    parsedJobConstraints = JSON.parse(rawJobConstraints);
  } catch (error) {
    throw new Error(`DATA_TEST_JOB_CONSTRAINTS 不是有效 JSON：${String(error)}`);
  }
  if (
    parsedJobConstraints === null ||
    typeof parsedJobConstraints !== "object" ||
    Array.isArray(parsedJobConstraints)
  ) {
    throw new Error("DATA_TEST_JOB_CONSTRAINTS 必须是以职业缩写为键的对象");
  }
  for (const [job, constraints] of Object.entries(parsedJobConstraints)) {
    if (!jobs.includes(job)) {
      throw new Error(`DATA_TEST_JOB_CONSTRAINTS 包含未选择的职业：${job}`);
    }
    if (
      constraints === null ||
      typeof constraints !== "object" ||
      Array.isArray(constraints)
    ) {
      throw new Error(`${job} 的约束必须是对象`);
    }
    const overrides = {};
    for (const [name, value] of Object.entries(constraints)) {
      if (!Object.hasOwn(jobConstraintEnvironmentNames, name)) {
        throw new Error(`${job} 的约束字段不受支持：${name}`);
      }
      if (name === "maxToughnessMode") {
        if (typeof value !== "boolean") {
          throw new Error(`${job}.maxToughnessMode 必须是布尔值`);
        }
      } else if (name === "gcdChoices") {
        if (
          !Array.isArray(value) ||
          value.length === 0 ||
          value.some((gcd) => typeof gcd !== "number" || !Number.isFinite(gcd) || gcd <= 0) ||
          new Set(value).size !== value.length
        ) {
          throw new Error(`${job}.gcdChoices 必须是无重复的正有限数字数组`);
        }
      } else if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new Error(`${job}.${name} 必须是有限数字`);
      }
      overrides[name] = value;
    }
    jobConstraintOverrides.set(job, overrides);
  }
}

const foodStrategy = process.env.DATA_TEST_FOOD_STRATEGY ?? "shared";
if (foodStrategy !== "shared" && foodStrategy !== "independent") {
  throw new Error("DATA_TEST_FOOD_STRATEGY 必须是 shared 或 independent");
}
const objective = process.env.DATA_TEST_OBJECTIVE ?? "damage";
if (objective !== "damage" && objective !== "dps") {
  throw new Error("DATA_TEST_OBJECTIVE 必须是 damage 或 dps");
}
function sha256Json(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

const candidateCachePath = process.env.DATA_TEST_CANDIDATE_CACHE_PATH
  ? resolve(process.env.DATA_TEST_CANDIDATE_CACHE_PATH)
  : undefined;
const candidateScenario = Object.fromEntries(Object.entries(process.env)
  .filter(([name]) => name.startsWith("DATA_TEST_") && ![
    "DATA_TEST_CANDIDATE_CACHE_PATH",
    "DATA_TEST_PROGRESS_OUTPUT_PATH",
    "DATA_TEST_V3_TIMEOUT_MS",
  ].includes(name))
  .sort(([left], [right]) => left.localeCompare(right)));
const candidateScenarioHash = sha256Json(candidateScenario);

const testScript = fileURLToPath(new URL("./test.ts", import.meta.url));
async function exportCandidates(job) {
  const child = fork(testScript, [], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATA_TEST_JOB: job,
      DATA_TEST_EXPORT_V3: "true",
      ...Object.fromEntries(
        Object.entries(jobConstraintOverrides.get(job) ?? {}).map(([name, value]) => [
          jobConstraintEnvironmentNames[name],
          String(value),
        ]),
      ),
    },
    execArgv: ["--experimental-strip-types", "--max-old-space-size=2560"],
    serialization: "advanced",
    stdio: ["inherit", "inherit", "inherit", "ipc"],
  });
  return await new Promise((resolve, reject) => {
    let candidateExport;
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      callback();
    };
    child.once("message", (message) => {
      if (message?.type !== "v3-candidate-export" || !message.candidateExport) {
        finish(() => reject(new Error(`${job} 候选进程返回了无法识别的消息`)));
        child.kill();
        return;
      }
      candidateExport = message.candidateExport;
      if (candidateExport.job !== job) {
        finish(() => reject(new Error(`${job} 候选导出职业不匹配：${candidateExport.job}`)));
        child.kill();
      }
    });
    child.once("error", (error) => finish(() => reject(error)));
    child.once("exit", (code, signal) => {
      if (settled) return;
      if (code === 0 && candidateExport !== undefined) {
        finish(() => resolve(candidateExport));
      } else {
        const reason = signal ? `信号 ${signal}` : `退出代码 ${code}`;
        finish(() => reject(new Error(`${job} 候选生成进程${reason}，没有导出候选`)));
      }
    });
  });
}

let candidateExports;
if (candidateCachePath !== undefined) {
  try {
    const cached = JSON.parse(await readFile(candidateCachePath, "utf8"));
    if (cached.schemaVersion !== 1 || cached.candidateScenarioHash !== candidateScenarioHash ||
      JSON.stringify(cached.candidateScenario) !== JSON.stringify(candidateScenario)) {
      throw new Error(`候选缓存的场景配置与当前 DATA_TEST_* 设置不匹配：${candidateCachePath}`);
    }
    if (!Array.isArray(cached.candidateExports) || cached.candidateExports.length !== jobs.length ||
      cached.candidateExports.some((candidate, index) => candidate?.job !== jobs[index])) {
      throw new Error(`候选缓存的职业列表与当前 DATA_TEST_JOBS 不匹配：${candidateCachePath}`);
    }
    if (cached.candidateHash !== sha256Json(cached.candidateExports)) {
      throw new Error(`候选缓存的内容哈希校验失败：${candidateCachePath}`);
    }
    candidateExports = cached.candidateExports;
    console.log(`重放候选缓存：${candidateCachePath}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

if (candidateExports === undefined) {
  candidateExports = [];
  for (const job of jobs) {
    const startedAt = performance.now();
    const candidateExport = await exportCandidates(job);
    candidateExports.push(candidateExport);
    const slotSummary = candidateExport.slotNames
      .map((slot, index) => {
        const counts = candidateExport.candidateCounts?.[slot];
        return `${slot}=${candidateExport.slots[index]?.length ?? 0}` +
          (counts === undefined
            ? ""
            : ` (剪枝前 ${counts.beforePruning}，剪枝后 ${counts.afterPruning})`);
      })
      .join(", ");
    console.log(
      `${job} 候选生成完成（${(performance.now() - startedAt).toFixed(0)}ms，计时不纳入 V3 搜索）：${slotSummary}`,
    );
  }
  if (candidateCachePath !== undefined) {
    await mkdir(dirname(candidateCachePath), { recursive: true });
    await writeFile(candidateCachePath, JSON.stringify({
      schemaVersion: 1,
      candidateScenario,
      candidateScenarioHash,
      candidateHash: sha256Json(candidateExports),
      candidateExports,
    }));
    console.log(`已写入候选缓存：${candidateCachePath}`);
  }
}
const candidateHash = sha256Json(candidateExports);
console.log(`候选输入 SHA-256：${candidateHash}`);

const commonSlotsRaw = process.env.DATA_TEST_COMMON_SLOTS;
let commonSlots;
if (commonSlotsRaw?.trim().toLowerCase() === "none") {
  commonSlots = [];
} else if (commonSlotsRaw === undefined || commonSlotsRaw.trim() === "") {
  const firstJobSlots = candidateExports[0].slotNames;
  const otherJobSlots = candidateExports.slice(1).map((candidate) =>
    new Set(candidate.slotNames),
  );
  commonSlots = firstJobSlots.filter(
    (slot) =>
      slot !== "MainHand" &&
      slot !== "OffHand" &&
      otherJobSlots.every((slotSet) => slotSet.has(slot)),
  );
} else {
  commonSlots = commonSlotsRaw.split(",").map((slot) => slot.trim()).filter(Boolean);
  if (new Set(commonSlots).size !== commonSlots.length) {
    throw new Error("DATA_TEST_COMMON_SLOTS 不能包含重复槽位");
  }
}
for (const slot of commonSlots) {
  const missingJobs = candidateExports
    .filter((candidate) => !candidate.slotNames.includes(slot))
    .map((candidate) => candidate.job);
  if (missingJobs.length > 0) {
    throw new Error(`${slot} 不是所有职业都可用的槽位：${missingJobs.join(", ")}`);
  }
}
console.log(`V3 联合职业：${jobs.join(", " )}`);
console.log(`通用槽位：${commonSlots.length === 0 ? "（无）" : commonSlots.join(", ")}`);
console.log(`食物策略：${foodStrategy}`);
console.log(`优化目标：${objective}`);
console.log("MIP 后端：HiGHS（单 worker）");
console.log(`各职业约束：${JSON.stringify(Object.fromEntries(
  candidateExports.map((candidate) => [candidate.job, candidate.constraints]),
))}`);

// The current user goal allows four minutes; leave five seconds for shutdown.
const maxSearchMs = Number(process.env.DATA_TEST_V3_TIMEOUT_MS ?? 235_000);
if (!Number.isFinite(maxSearchMs) || maxSearchMs <= 0 || maxSearchMs > 235_000) {
  throw new Error("DATA_TEST_V3_TIMEOUT_MS 必须大于 0 且不超过 235000");
}
const maxRssBytes = Math.floor(3.5 * 1024 * 1024 * 1024);
const searchStartedAt = performance.now();
let peakRssBytes = processPeakRssBytes();
const solverProgressEvents = [];
const progressMessages = [];
const solverProgressPreviewCounts = new Map();

function summarizeSolverProgress(events) {
  const progressByModel = new Map();
  for (const event of events) {
    const summary = progressByModel.get(event.model) ?? {
      backend: event.backend,
      incumbentCallbacks: 0,
      boundCallbacks: 0,
      logCallbacks: 0,
    };
    if (event.kind === "incumbent") {
      summary.incumbentCallbacks++;
      summary.firstIncumbentMs ??= event.elapsedMs;
      summary.lastIncumbentMs = event.elapsedMs;
      summary.lastObjectiveValue = event.objectiveValue ?? summary.lastObjectiveValue;
    } else if (event.kind === "bound") {
      summary.boundCallbacks++;
      summary.firstBoundMs ??= event.elapsedMs;
      summary.lastBoundMs = event.elapsedMs;
    } else if (event.kind === "log") {
      summary.logCallbacks++;
    }
    summary.lastBestBound = event.bestBound ?? summary.lastBestBound;
    summary.lastNodes = event.nodes ?? summary.lastNodes;
    progressByModel.set(event.model, summary);
  }

  for (const summary of progressByModel.values()) {
    if (summary.lastBestBound !== undefined && summary.lastObjectiveValue !== undefined) {
      summary.lastObservedRelativeGap = Math.abs(summary.lastBestBound - summary.lastObjectiveValue)
        / Math.max(1, Math.abs(summary.lastObjectiveValue));
    }
  }
  return Object.fromEntries(progressByModel);
}

async function saveSolverProgress({ elapsedMs, complete, reason } = {}) {
  const nativeProgressSummary = summarizeSolverProgress(solverProgressEvents);
  console.log(`原生进度回调摘要：${JSON.stringify(nativeProgressSummary, null, 2)}`);
  if (process.env.DATA_TEST_PROGRESS_OUTPUT_PATH) {
    const progressOutputPath = resolve(process.env.DATA_TEST_PROGRESS_OUTPUT_PATH);
    await mkdir(dirname(progressOutputPath), { recursive: true });
    await writeFile(progressOutputPath, JSON.stringify({
      solver: "highs",
      candidateHash,
      candidateScenarioHash,
      elapsedMs,
      complete,
      ...(reason === undefined ? {} : { reason }),
      peakRssBytes,
      nativeProgressSummary,
      progressMessages,
      events: solverProgressEvents,
    }, null, 2));
    console.log(`原生回调时间序列：${progressOutputPath}`);
  }
  return nativeProgressSummary;
}

const searchResult = await new Promise((resolve, reject) => {
  let settled = false;
  let worker;
  const finish = (callback) => {
    if (settled) return;
    settled = true;
    clearInterval(memoryMonitor);
    clearTimeout(timeWatchdog);
    callback();
  };
  const memoryMonitor = setInterval(() => {
    const currentRssBytes = processPeakRssBytes();
    peakRssBytes = Math.max(peakRssBytes, currentRssBytes);
    if (currentRssBytes >= maxRssBytes) {
      void worker?.terminate();
      finish(() => reject(new Error(
        `V3 搜索进程 RSS 达到 ${maxRssBytes} 字节保护线，已停止且未声称最优`,
      )));
    }
  }, 20);
  const timeWatchdog = setTimeout(() => {
    peakRssBytes = Math.max(peakRssBytes, processPeakRssBytes());
    void worker?.terminate();
    finish(() => reject(new Error(`V3 搜索达到 ${maxSearchMs}ms 时限，未完成最优性证明`)));
  }, maxSearchMs);

  try {
    worker = new Worker(new URL("./v3-worker.mjs", import.meta.url), {
      workerData: {
        jobs: candidateExports,
        commonSlots,
        foodStrategy,
        objective,
        maxSearchMs,
      },
      resourceLimits: { maxOldGenerationSizeMb: 2560 },
    });
  } catch (error) {
    finish(() => reject(error));
    return;
  }
  peakRssBytes = Math.max(peakRssBytes, processPeakRssBytes());
  worker.on("message", (message) => {
    if (message?.type === "progress") {
      progressMessages.push({
        receivedAtMs: performance.now() - searchStartedAt,
        message: message.message,
      });
      console.log(message.message);
      return;
    }
    if (message?.type === "solver-progress") {
      if (message.event && typeof message.event === "object") {
        const event = {
          ...message.event,
          receivedAtMs: performance.now() - searchStartedAt,
        };
        solverProgressEvents.push(event);
        const key = `${message.event.backend}:${message.event.model}:${message.event.kind}`;
        const count = (solverProgressPreviewCounts.get(key) ?? 0) + 1;
        solverProgressPreviewCounts.set(key, count);
        if (message.event.kind === "incumbent" ||
          (message.event.kind === "bound" && (count === 1 || count % 25 === 0)) ||
          (message.event.kind === "log" && message.event.message?.startsWith("PROFILE "))) {
          console.log(`原生回调 ${message.event.backend} ${message.event.model} ${message.event.kind}：${JSON.stringify(event)}`);
        }
      }
      return;
    }
    if (message?.type === "error") {
      const error = new Error(message.error?.message ?? "V3 工作线程失败");
      error.name = message.error?.name ?? "Error";
      if (message.error?.stack) error.stack = message.error.stack;
      finish(() => reject(error));
      void worker.terminate();
      return;
    }
    if (message?.type === "result") {
      peakRssBytes = Math.max(peakRssBytes, processPeakRssBytes());
      finish(() => resolve(message.result));
      void worker.terminate();
    }
  });
  worker.once("error", (error) => finish(() => reject(error)));
  worker.once("exit", (code) => {
    if (!settled) {
      finish(() => reject(new Error(`V3 工作线程退出（代码 ${code}）`)));
    }
  });
}).catch(async (error) => {
  const elapsedMs = performance.now() - searchStartedAt;
  peakRssBytes = Math.max(peakRssBytes, processPeakRssBytes());
  await saveSolverProgress({
    elapsedMs,
    complete: false,
    reason: error instanceof Error ? error.message : String(error),
  });
  console.error(`V3 未完成：${JSON.stringify({
    elapsedMs: Math.round(elapsedMs),
    peakRssBytes,
    reason: error instanceof Error ? error.message : String(error),
  })}`);
  throw error;
});

const elapsedMs = performance.now() - searchStartedAt;
const nativeProgressSummary = await saveSolverProgress({ elapsedMs, complete: true });
if (searchResult === undefined) {
  console.log(`V3 搜索统计：${JSON.stringify({
    elapsedMs: Math.round(elapsedMs),
    peakRssBytes,
  }, null, 2)}`);
  console.log("V3 未找到满足所有职业约束的联合配装，因此没有最优性结果。");
  process.exitCode = 2;
} else {
const slotLabels = {
  MainHand: "主手",
  OffHand: "副手",
  Head: "头部",
  Body: "身体",
  Gloves: "手部",
  Legs: "腿部",
  Feet: "脚部",
  Ears: "耳饰",
  Neck: "项链",
  Wrists: "手镯",
  Finger: "戒指",
};
const jobOutput = {};
for (const candidateExport of candidateExports) {
  const jobResult = searchResult.jobResults?.[candidateExport.job];
  if (jobResult === undefined) continue;
  const itemNames = candidateExport.itemNames ?? {};
  const equipment = [];
  jobResult.selection.forEach((selected, slotIndex) => {
    const slotName = candidateExport.slotNames[slotIndex] ?? `slot-${slotIndex}`;
    const items = Array.isArray(selected.ringEquips)
      ? selected.ringEquips
      : [selected];
    items.forEach((item, itemIndex) => {
      equipment.push({
        slot: items.length > 1
          ? `${slotLabels[slotName] ?? slotName}${itemIndex + 1}`
          : slotLabels[slotName] ?? slotName,
        itemId: item.itemId,
        name: itemNames[item.itemId] ?? null,
        itemLevel: item.itemLevel,
        attributes: item.baseParams,
        weaponDamage: {
          physical: item.PDMG,
          magical: item.MDMG,
          delay: item.DLY,
        },
      });
    });
  });
  const food = jobResult.food;
  jobOutput[candidateExport.job] = {
    damage: jobResult.damage,
    gcd: jobResult.gcd,
    damagePerSecond: jobResult.damagePerSecond,
    soloDamage: searchResult.optima[candidateExport.job]?.damage,
    soloDamagePerSecond: searchResult.optima[candidateExport.job]?.damagePerSecond,
    food: food === undefined
      ? null
      : {
          itemId: food.itemId,
          name: itemNames[food.itemId] ?? null,
          itemLevel: food.itemLevel,
          attributes: food.baseParams,
        },
    equipment,
  };
}

console.log(`V3 联合目标值：${JSON.stringify(searchResult.value)}`);
console.log(`V3 各职业结果：${JSON.stringify(jobOutput, null, 2)}`);
console.log(`V3 结果 SHA-256：${sha256Json({ value: searchResult.value, jobs: jobOutput })}`);
console.log(`V3 证明信息：${JSON.stringify(searchResult.proof, null, 2)}`);
const profileEvents = solverProgressEvents.flatMap((event) => {
  if (event.kind !== "log" || !event.message?.startsWith("PROFILE ")) return [];
  try {
    return [{ model: event.model, receivedAtMs: event.receivedAtMs, ...JSON.parse(event.message.slice("PROFILE ".length)) }];
  } catch {
    return [{ model: event.model, receivedAtMs: event.receivedAtMs, message: event.message }];
  }
});
console.log(`V3 分阶段计时：${JSON.stringify(profileEvents, null, 2)}`);
console.log(`V3 统计：${JSON.stringify({
  elapsedMs: Math.round(elapsedMs),
  peakRssBytes,
  solver: "highs",
  candidateHash,
  nativeProgressSummary,
  commonSlots: searchResult.statistics?.commonSlots,
  statistics: searchResult.statistics,
}, null, 2)}`);
if (searchResult.proof?.complete === true) {
  console.log(
    `最优性状态：${searchResult.proof.objective ?? objective} 候选空间内搜索已完成；内部 MIP 状态为 ${searchResult.proof.innerSolverStatus ?? "未提供"}。` +
      (searchResult.proof.formalCertificate === false
        ? " 内层 MIP 的最优状态没有独立形式化证书。"
        : ""),
  );
} else {
  console.log("最优性状态：搜索未提供完成证明，当前结果不能宣称为最优。");
  process.exitCode = 2;
}
}
