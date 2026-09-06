import { writeFile, mkdir } from "node:fs/promises";
import { createInterface } from "node:readline";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const outputPath = resolve(
  process.env.FFXIV_MCP_LUMINA_SNAPSHOT ?? resolve(root, "src", "data", "mcp-lumina.snapshot.json"),
);
const lines = createInterface({ input: process.stdin });
let input = "";
for await (const line of lines) {
  input = line;
  break;
}
lines.close();
let snapshot;
try {
  snapshot = JSON.parse(input);
} catch (error) {
  throw new Error("标准输入不是有效的 MCP 查询产物 JSON", { cause: error });
}
if (snapshot?.server !== "ffxiv-mcp-lumina" || snapshot?.schemaVersion !== 1)
  throw new Error("MCP 查询产物必须声明 server=ffxiv-mcp-lumina 和 schemaVersion=1");
if (!snapshot.gameVersion || !snapshot.queriedAt)
  throw new Error("MCP 查询产物缺少 gameVersion 或 queriedAt");
await mkdir(resolve(outputPath, ".."), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(snapshot)}\n`, "utf8");
console.log(`Wrote MCP query artifact to ${outputPath}`);
