import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { queryMcpLumina } from "./mcp-lumina/orchestrate-query.mjs";

export { queryMcpLumina };

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const removedOptions = process.argv.slice(2).filter((argument) =>
    argument === "--offline" || argument === "--item-special-bonus-data-only" ||
    argument === "--snapshot" || argument.startsWith("--snapshot=") ||
    argument === "--scope" || argument.startsWith("--scope=") ||
    argument === "--mcp-snapshot" || argument.startsWith("--mcp-snapshot="),
  );
  if (removedOptions.length)
    throw new Error(`已移除独立 MCP 查询选项：${removedOptions.join(", ")}；请运行 npm run data:update`);
  throw new Error("此模块仅供完整数据更新流程调用；请运行 npm run data:update");
}
