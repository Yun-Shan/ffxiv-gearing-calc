import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadLocalEnv, requireLocalEnv } from "./local-env.mjs";
import { supportedJobIds } from "./mcp-lumina-import.mjs";
import { queryMcpLumina } from "./query-mcp-lumina.mjs";
import { validateMcpQueryResult } from "./data-update/mcp-snapshot.mjs";
import { createPayload } from "./data-update/payload-assembly.mjs";
import { validateGenerationData } from "./data-update/generation-validation.mjs";
import {
  projectRuntimeData,
  writeRuntimeGeneratedData,
} from "./data-update/runtime-data.mjs";
import {
  prepareUpstream,
  referenceRepository,
} from "./data-update/upstream-reference.mjs";

const root = resolve(import.meta.dirname, "..");
const defaultUpstreamRoot = resolve(root, "reference", "ffxiv-gearing");
const defaultOutputPath = resolve(root, "src", "data", "generated-data.bin");
const supportedJobs = supportedJobIds;

export { projectRuntimeData, writeRuntimeGeneratedData };

export async function buildGeneratedData(payload, options = {}) {
  validateGenerationData(payload);
  return writeRuntimeGeneratedData(projectRuntimeData(payload), options);
}

function rejectObsoleteDataUpdateInputs(args = process.argv.slice(2)) {
  const obsoleteEnvironment = [
    "FFXIV_MCP_LUMINA_SNAPSHOT",
    "FFXIV_MCP_LUMINA_SCOPE",
  ].filter((name) => process.env[name] !== undefined);
  if (obsoleteEnvironment.length)
    throw new Error(`MCP 快照文件和查询范围配置已移除（${obsoleteEnvironment.join(", ")}）；请清除旧配置并运行 npm run data:update`);
  const obsoleteOptions = args.filter((argument) =>
    argument === "--offline" || argument === "--item-special-bonus-data-only" ||
    argument === "--snapshot" || argument.startsWith("--snapshot=") ||
    argument === "--scope" || argument.startsWith("--scope=") ||
    argument === "--mcp-snapshot" || argument.startsWith("--mcp-snapshot="),
  );
  if (obsoleteOptions.length)
    throw new Error(`已移除数据更新选项：${obsoleteOptions.join(", ")}；完整数据更新请运行 npm run data:update`);
  if (args.length)
    throw new Error(`数据更新不接受命令行参数：${args.join(" ")}；请运行 npm run data:update`);
}

export async function updateData({ upstreamRoot: upstreamRootOption, outputPath: outputPathOption } = {}) {
  loadLocalEnv();
  rejectObsoleteDataUpdateInputs(arguments.length === 0 ? process.argv.slice(2) : []);
  // Fail before cloning/pulling the reference checkout when local setup is absent.
  for (const name of ["FFXIV_MCP_LUMINA_COMMAND", "McpLumina__GamePath", "McpLumina__SchemaPath"])
    requireLocalEnv(name);
  const context = {
    root,
    upstreamRoot: resolve(upstreamRootOption ?? process.env.FFXIV_GEARING_ROOT ?? defaultUpstreamRoot),
    outputPath: resolve(outputPathOption ?? defaultOutputPath),
    repository: referenceRepository,
    importedAt: new Date().toISOString(),
  };
  context.commit = await prepareUpstream(context);
  const queryResult = await queryMcpLumina({ upstreamRoot: context.upstreamRoot });
  const mcpSnapshot = validateMcpQueryResult(queryResult);
  const built = await createPayload(mcpSnapshot, context);
  const generated = await buildGeneratedData(built.payload, { outputPath: context.outputPath });
  console.log(`剔除 ${built.excludedGearCounts.belowLevelAndItemLevel} 件同时满足穿戴等级低于 50 且品级低于 90 的装备，另剔除 ${built.excludedGearCounts.referenceSources} 件参考来源包含古董系列或军票的装备。`);
  console.log(
    `Imported ${generated.gearCount} gears, ${built.payload.foods.length} foods and ${supportedJobs.length} jobs from ${context.commit.slice(0, 12)}. ${built.mcpSummary}`,
  );
  console.log(`Generated ${context.outputPath} (${generated.bytes.byteLength} bytes); physical groups: ${JSON.stringify(generated.physicalGroupCounts)}; main-stat indexes: ${JSON.stringify(generated.mainStatIndexCounts)} (${generated.mainStatIndexBytes} bytes); binary sections: ${JSON.stringify(generated.sectionSizes)}.`);
  return { payload: built.payload, generated, outputPath: context.outputPath };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  await updateData();
