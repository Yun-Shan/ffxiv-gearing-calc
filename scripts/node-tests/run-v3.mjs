import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { parseV3Config } from "./v3/config.mjs";
import { digestV3Output, buildV3Output } from "./v3/report.mjs";
import { UNLIMITED_SEARCH_MS } from "./v3/limits.mjs";
import { runInWorker } from "./v3/worker.mjs";

const generatedDataBytes = new Uint8Array(await readFile(
  new URL("../../src/data/generated-data.bin", import.meta.url),
));
globalThis.__FFXIV_GENERATED_DATA_BINARY__ = generatedDataBytes;
const [{ gameData }, { jobSchemas }, { slotsForJob }] = await Promise.all([
  import("../../src/domain/data.ts"),
  import("../../src/domain/jobs.ts"),
  import("../../src/domain/optimizer.ts"),
]);

async function main() {
  const parsed = parseV3Config({
    env: process.env,
    jobSchemas,
    slotsForJob,
    syncLevels: gameData.sync.levels,
  });
  const {
    jobs,
    commonSlots,
    foodStrategy,
    objective,
    maxSearchMs,
    jobConfigs,
  } = parsed;

  console.log("Node 多职业验收配置：");
  console.log(JSON.stringify({
    jobs: jobConfigs.map((config) => ({
      id: config.jobId,
      itemLevelRange: [config.minItemLevel, config.maxItemLevel],
      ...(config.sync === undefined ? {} : { sync: config.sync }),
      constraints: Object.fromEntries(Object.entries(config).filter(([name]) => [
        "gcdTarget", "gcdChoices", "speedMin", "speedMax", "toughnessMin",
        "toughnessMinPercent", "maximizeTenacity",
      ].includes(name))),
    })),
    commonSlots,
    foodStrategy,
    objective,
    maxSearchMs: maxSearchMs === UNLIMITED_SEARCH_MS ? "unlimited" : maxSearchMs,
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
  const { result, peakRssBytes } = await runInWorker(
    config,
    maxSearchMs,
    startedAt,
    generatedDataBytes,
  );
  const elapsedMs = performance.now() - startedAt;

  if (!result) {
    console.log(
      `搜索完成但没有满足全部约束的联合配装（${elapsedMs.toFixed(0)}ms，峰值 RSS ${peakRssBytes} 字节）。`,
    );
    process.exitCode = 2;
    return;
  }

  const output = buildV3Output(result, jobs, {
    maxSearchMs,
    elapsedMs,
    peakRssBytes,
  });
  const digest = digestV3Output(output);
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
