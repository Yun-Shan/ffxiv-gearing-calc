import { performance } from "node:perf_hooks";
import { Worker } from "node:worker_threads";
import { MAX_RSS_BYTES, UNLIMITED_SEARCH_MS } from "./limits.mjs";

export function processPeakRssBytes(processApi = process) {
  const operatingSystemPeakKiB = processApi.resourceUsage().maxRSS;
  return Math.max(
    processApi.memoryUsage.rss(),
    Number.isFinite(operatingSystemPeakKiB) ? operatingSystemPeakKiB * 1024 : 0,
  );
}

export function runInWorker(config, maxSearchMs, startedAt, dataBinary, dependencies = {}) {
  const {
    Worker: WorkerConstructor = Worker,
    performance: clock = performance,
    setTimeout: setTimeoutTimer = setTimeout,
    clearTimeout: clearTimeoutTimer = clearTimeout,
    setInterval: setIntervalTimer = setInterval,
    clearInterval: clearIntervalTimer = clearInterval,
    processPeakRssBytes: samplePeakRss = processPeakRssBytes,
    logger = console,
    maxRssBytes = MAX_RSS_BYTES,
    workerURL = new URL("../v3-worker.mjs", import.meta.url),
  } = dependencies;

  return new Promise((resolve, reject) => {
    let worker;
    let settled = false;
    let peakRssBytes = samplePeakRss();
    const finish = (callback) => {
      if (settled) return false;
      settled = true;
      clearIntervalTimer(memoryMonitor);
      clearTimeoutTimer(timeWatchdog);
      callback();
      return true;
    };
    const stopWithError = (error) => {
      if (settled) return;
      settled = true;
      clearIntervalTimer(memoryMonitor);
      clearTimeoutTimer(timeWatchdog);
      const reason = error instanceof Error ? error : new Error(String(error));
      reason.elapsedMs = Math.round(clock.now() - startedAt);
      reason.peakRssBytes = Math.max(peakRssBytes, samplePeakRss());
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
      peakRssBytes = Math.max(peakRssBytes, samplePeakRss());
      return peakRssBytes;
    };
    const memoryMonitor = setIntervalTimer(() => {
      if (updatePeakRss() >= maxRssBytes) {
        stopWithError(new Error(
          `Node 验收峰值 RSS 达到 ${maxRssBytes} 字节保护线，已停止且未报告成功`,
        ));
      }
    }, 20);
    const timeWatchdog = maxSearchMs === UNLIMITED_SEARCH_MS ? undefined : setTimeoutTimer(() => {
      updatePeakRss();
      stopWithError(new Error(
        `Node 验收总耗时达到 ${maxSearchMs}ms 时限，已停止且未完成最优性证明`,
      ));
    }, maxSearchMs);

    try {
      worker = new WorkerConstructor(workerURL, {
        workerData: { config, dataBinary },
        resourceLimits: { maxOldGenerationSizeMb: 2560 },
      });
    } catch (error) {
      stopWithError(error);
      return;
    }
    updatePeakRss();

    worker.on("message", (message) => {
      if (message?.type === "progress") {
        logger.log(`[搜索进度] ${message.message}`);
        return;
      }
      if (message?.type === "solverProgress") {
        logger.log(`[求解器诊断] ${JSON.stringify(message.progress)}`);
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
        if (clock.now() - startedAt >= maxSearchMs) {
          stopWithError(new Error(
            `Node 验收总耗时达到 ${maxSearchMs}ms 时限，已停止且未报告成功`,
          ));
          return;
        }
        if (peak >= maxRssBytes) {
          stopWithError(new Error(
            `Node 验收峰值 RSS 达到 ${maxRssBytes} 字节保护线，已停止且未报告成功`,
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
