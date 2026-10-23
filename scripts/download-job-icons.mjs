import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { inflateSync } from "node:zlib";
import { allowsGenericQueries } from "./mcp-query-validation.mjs";
import { decodeGeneratedData } from "../src/data/binary/decode.ts";

const root = resolve(import.meta.dirname, "..");
const generatedDataPath = resolve(root, "src", "data", "generated-data.bin");
const assetDir = resolve(root, "public", "assets", "jobs");
const iconsModulePath = resolve(root, "src", "ui", "job-icons.ts");
const snapshotPath = resolve(assetDir, "source.json");
const defaultCommand = "F:\\Workspace\\VisualStudio\\ffxiv\\mcp\\mcp-ffxiv-lumina\\publish\\mcp-lumina.exe";
const command = process.env.FFXIV_MCP_LUMINA_COMMAND ?? defaultCommand;
const concurrency = Math.max(1, Number(process.env.FFXIV_MCP_LUMINA_CONCURRENCY ?? 4));
const apiUrl = "https://v2.xivapi.com/api/asset";
const mcpFields = ["Name", "Abbreviation", "IsLimitedJob"];

function parseJsonRpcBuffer(state) {
  const messages = [];
  while (state.buffer.length) {
    const contentLength = /^\s*Content-Length:\s*(\d+)\s*\r?\n\r?\n/i.exec(state.buffer);
    if (contentLength) {
      const length = Number(contentLength[1]);
      const start = contentLength[0].length;
      if (Buffer.byteLength(state.buffer.slice(start), "utf8") < length) break;
      const bodyBuffer = Buffer.from(state.buffer.slice(start), "utf8").subarray(0, length);
      state.buffer = Buffer.from(state.buffer.slice(start), "utf8").subarray(length).toString("utf8");
      messages.push(JSON.parse(bodyBuffer.toString("utf8")));
      continue;
    }
    const newline = state.buffer.indexOf("\n");
    if (newline < 0) break;
    const line = state.buffer.slice(0, newline).trim();
    state.buffer = state.buffer.slice(newline + 1);
    if (line) messages.push(JSON.parse(line));
  }
  return messages;
}

class McpClient {
  constructor() {
    this.nextId = 1;
    this.pending = new Map();
    this.terminatedError = null;
    this.state = { buffer: "" };
    const configuredTimeout = Number(process.env.FFXIV_MCP_LUMINA_REQUEST_TIMEOUT_MS ?? 30_000);
    this.requestTimeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : 30_000;
    this.process = spawn(command, [], {
      cwd: root,
      stdio: ["pipe", "pipe", "inherit"],
      env: {
        ...process.env,
        McpLumina__GamePath: process.env.McpLumina__GamePath ?? "F:\\Game\\FF14\\最终幻想XIV",
        McpLumina__LanguageDefault: process.env.McpLumina__LanguageDefault ?? "chs",
        McpLumina__SchemaPath: process.env.McpLumina__SchemaPath ?? "F:\\Workspace\\VisualStudio\\ffxiv\\mcp\\EXDSchema",
      },
    });
    this.process.on("error", (error) => this.fail(new Error("启动 Lumina MCP 子进程失败", { cause: error })));
    this.process.on("exit", (code, signal) => {
      this.fail(new Error(`Lumina MCP 子进程已终止（exit code: ${code ?? "无"}, signal: ${signal ?? "无"}）`));
    });
    this.process.on("close", (code, signal) => {
      this.fail(new Error(`Lumina MCP 子进程已关闭（exit code: ${code ?? "无"}, signal: ${signal ?? "无"}）`));
    });
    this.process.stdin.on("error", (error) => this.fail(new Error("写入 Lumina MCP 子进程失败", { cause: error })));
    this.process.stdout.on("data", (chunk) => {
      this.state.buffer += chunk.toString("utf8");
      let messages;
      try {
        messages = parseJsonRpcBuffer(this.state);
      } catch (error) {
        this.fail(new Error(`Lumina MCP 返回了无效 JSON-RPC：${error.message}`, { cause: error }));
        return;
      }
      for (const message of messages) {
        if (message.id === undefined) continue;
        if (message.error) this.finishRequest(message.id, new Error(`${message.error.code ?? "MCP"}: ${message.error.message}`));
        else this.finishRequest(message.id, null, message.result);
      }
    });
  }

  fail(error) {
    if (this.terminatedError) return;
    this.terminatedError = error;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(this.terminatedError);
    }
    this.pending.clear();
  }

  finishRequest(id, error, result) {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    clearTimeout(pending.timer);
    if (error) pending.reject(error);
    else pending.resolve(result);
  }

  request(method, params) {
    if (this.terminatedError) return Promise.reject(this.terminatedError);
    const id = this.nextId++;
    return new Promise((resolveRequest, rejectRequest) => {
      const timer = setTimeout(() => {
        this.finishRequest(id, new Error(`Lumina MCP 请求 ${method} 超时（${this.requestTimeoutMs}ms）`));
      }, this.requestTimeoutMs);
      this.pending.set(id, { resolve: resolveRequest, reject: rejectRequest, timer });
      try {
        this.process.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`, (error) => {
          if (error) this.fail(new Error(`发送 Lumina MCP 请求 ${method} 失败`, { cause: error }));
        });
      } catch (error) {
        this.finishRequest(id, new Error(`发送 Lumina MCP 请求 ${method} 失败`, { cause: error }));
      }
    });
  }

  notify(method, params) {
    if (this.terminatedError) throw this.terminatedError;
    try {
      this.process.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`, (error) => {
        if (error) this.fail(new Error(`发送 Lumina MCP 通知 ${method} 失败`, { cause: error }));
      });
    } catch (error) {
      this.fail(new Error(`发送 Lumina MCP 通知 ${method} 失败`, { cause: error }));
      throw this.terminatedError;
    }
  }

  async initialize() {
    const result = await this.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "ffxiv-gearing-calc-job-icons", version: "1.0.0" },
    });
    this.notify("notifications/initialized", {});
    return result;
  }

  async callTool(name, args) {
    const raw = await this.request("tools/call", { name, arguments: args });
    if (raw?.isError) throw new Error(`Lumina MCP 工具 ${name} 返回错误：${JSON.stringify(raw)}`);
    const text = raw?.content?.find((entry) => entry.type === "text")?.text;
    if (!text) throw new Error(`Lumina MCP 工具 ${name} 未返回文本 JSON`);
    let value;
    try {
      value = JSON.parse(text);
    } catch (error) {
      throw new Error(`Lumina MCP 工具 ${name} 返回了无法解析的 JSON：${text.slice(0, 200)}`, { cause: error });
    }
    return { value, raw };
  }

  close() {
    this.fail(new Error("Lumina MCP 客户端已关闭"));
    this.process.stdin.end();
    this.process.kill();
  }
}

async function mapConcurrent(values, limit, action) {
  const results = new Array(values.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= values.length) return;
      results[index] = await action(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker));
  return results;
}

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function validatePng(buffer) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (buffer.length < 45 || !buffer.subarray(0, 8).equals(signature))
    throw new Error("响应不是完整 PNG 文件");

  let offset = 8;
  let width;
  let height;
  let hasIdat = false;
  let hasIend = false;
  const compressed = [];
  while (offset < buffer.length) {
    if (offset + 12 > buffer.length) throw new Error("PNG chunk 头部不完整");
    const length = buffer.readUInt32BE(offset);
    const typeStart = offset + 4;
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const chunkEnd = dataEnd + 4;
    if (chunkEnd > buffer.length) throw new Error("PNG chunk 超出文件长度");
    const type = buffer.toString("ascii", typeStart, dataStart);
    const expectedCrc = buffer.readUInt32BE(dataEnd);
    const actualCrc = crc32(buffer.subarray(typeStart, dataEnd));
    if (actualCrc !== expectedCrc) throw new Error(`PNG ${type} chunk CRC 校验失败`);

    if (offset === 8 && (type !== "IHDR" || length !== 13)) throw new Error("PNG 缺少有效的首个 IHDR chunk");
    if (type === "IHDR") {
      width = buffer.readUInt32BE(dataStart);
      height = buffer.readUInt32BE(dataStart + 4);
      if (width === 0 || height === 0) throw new Error("PNG 宽高不能为 0");
    } else if (type === "IDAT") {
      hasIdat = true;
      compressed.push(buffer.subarray(dataStart, dataEnd));
    } else if (type === "IEND") {
      if (length !== 0) throw new Error("PNG IEND chunk 必须为空");
      hasIend = true;
      if (chunkEnd !== buffer.length) throw new Error("PNG IEND 后存在多余数据");
    }
    offset = chunkEnd;
    if (hasIend) break;
  }
  if (!width || !height || !hasIdat || !hasIend) throw new Error("PNG 缺少必要的 IHDR、IDAT 或 IEND chunk");
  const decoded = inflateSync(Buffer.concat(compressed));
  if (decoded.length === 0) throw new Error("PNG 图像数据为空");
  return { width, height, byteLength: buffer.length };
}

function digest(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function makeXivApiUrl(rowId) {
  const url = new URL(apiUrl);
  url.searchParams.set("path", `ui/icon/062000/0621${String(rowId).padStart(2, "0")}.tex`);
  url.searchParams.set("format", "png");
  return url.toString();
}

function validateGeneratedJob(jobId, job) {
  if (!job || !Number.isSafeInteger(job.id) || job.id <= 0 ||
      typeof job.name !== "string" || !job.name.trim() || job.abbreviation !== jobId)
    throw new Error(`generated-data.bin 中 ${jobId} 的 ClassJob 目录数据无效`);
  return job;
}

async function queryClassJobs(jobIds, generatedData) {
  const client = new McpClient();
  try {
    if (command.includes("\\")) {
      try {
        await access(command);
      } catch {
        throw new Error(`找不到 Lumina MCP 可执行文件：${command}。请设置 FFXIV_MCP_LUMINA_COMMAND。`);
      }
    }

    const initialization = await client.initialize();
    const health = await client.callTool("health", {});
    if (!allowsGenericQueries(health.value))
      throw new Error(`Lumina MCP 通用查询不可用：${JSON.stringify(health.value)}`);

    const description = await client.callTool("describe_sheet", { sheet: "ClassJob" });
    const fields = new Set((description.value.columns ?? []).map((column) => column.name));
    for (const field of mcpFields) {
      if (!fields.has(field)) throw new Error(`ClassJob 缺少 ${field} 字段，拒绝生成职业图标映射`);
    }
    if (description.value.gameVersion !== health.value.gameVersion)
      throw new Error("ClassJob Schema 与 MCP health 游戏版本不一致");

    const jobSearchQueries = await mapConcurrent(jobIds, concurrency, async (jobId) => {
      const expectedJob = validateGeneratedJob(jobId, generatedData.jobs[jobId]);
      const query = {
        sheet: "ClassJob",
        query: jobId,
        textFields: "Abbreviation",
        returnFields: mcpFields.join(","),
        limit: 200,
        languages: "chs",
      };
      const response = await client.callTool("search_rows", query);
      const matches = (response.value.results ?? []).filter((row) => row.fields?.Abbreviation === jobId);
      if (matches.length !== 1) throw new Error(`MCP ClassJob ${jobId} 应精确匹配一行，实际 ${matches.length} 行`);
      const row = matches[0];
      const rowId = Number(row.rowId);
      if (!Number.isInteger(rowId) || rowId <= 0) throw new Error(`MCP ClassJob ${jobId} 返回了无效行 ID`);
      if (rowId !== expectedJob.id)
        throw new Error(`MCP ClassJob ${jobId} 当前行 ID ${rowId} 与生成数据 ${expectedJob.id} 不一致`);
      if (row.fields.Name !== expectedJob.name || row.fields.Abbreviation !== expectedJob.abbreviation)
        throw new Error(`MCP ClassJob ${jobId} 当前名称或缩写与生成数据不一致`);
      if (response.value.gameVersion !== health.value.gameVersion)
        throw new Error(`MCP ClassJob ${jobId} 查询批次游戏版本不一致`);
      return {
        jobId,
        rowId,
        name: row.fields.Name,
        abbreviation: row.fields.Abbreviation,
        isLimitedJob: row.fields.IsLimitedJob,
        gameVersion: response.value.gameVersion,
        queriedAt: response.value.timestamp,
        request: { tool: "search_rows", arguments: query },
        response: response.raw,
      };
    });

    return {
      initialization,
      health,
      description,
      jobSearchQueries,
    };
  } finally {
    client.close();
  }
}

async function downloadIcon(job) {
  const requestedUrl = makeXivApiUrl(job.rowId);
  const requestedAt = new Date().toISOString();
  const response = await fetch(requestedUrl);
  const downloadedAt = new Date().toISOString();
  if (!response.ok) throw new Error(`XIVAPI 下载 ${job.jobId} 失败：HTTP ${response.status} ${response.statusText}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const dimensions = validatePng(bytes);
  return {
    jobId: job.jobId,
    rowId: job.rowId,
    bytes,
    metadata: {
      file: `${job.jobId}.png`,
      sha256: digest(bytes),
      ...dimensions,
      source: {
        service: "XIVAPI",
        apiVersion: "v2",
        requestedUrl,
        finalUrl: response.url,
        requestedAt,
        downloadedAt,
        contentType: response.headers.get("content-type"),
        etag: response.headers.get("etag"),
        lastModified: response.headers.get("last-modified"),
        apiVersionHeader: response.headers.get("x-api-version") ?? response.headers.get("x-xivapi-version"),
        gameVersionHeader: response.headers.get("x-game-version"),
      },
    },
  };
}

function buildIconsModule(jobs) {
  const lines = jobs.map(({ jobId }) => `  ${JSON.stringify(jobId)}: ${JSON.stringify(`/assets/jobs/${jobId}.png`)},`);
  return [
    'import type { JobId } from "../domain";',
    "",
    "export const jobIcons: Record<JobId, string> = {",
    ...lines,
    "};",
    "",
  ].join("\n");
}

async function main() {
  const generatedData = await decodeGeneratedData(await readFile(generatedDataPath));
  const jobIds = Object.keys(generatedData.jobs ?? {});
  if (jobIds.length !== 23) throw new Error(`当前生成数据应包含 23 个职业，实际 ${jobIds.length} 个`);
  if (new Set(jobIds).size !== jobIds.length) throw new Error("职业 ID 重复");

  const queried = await queryClassJobs(jobIds, generatedData);
  const verifiedJobs = queried.jobSearchQueries.map(({ jobId, rowId }) => ({ jobId, rowId }));
  const downloaded = await mapConcurrent(verifiedJobs, concurrency, downloadIcon);
  const downloadedAt = new Date().toISOString();

  const source = {
    schemaVersion: 1,
    generatedAt: downloadedAt,
    mcp: {
      server: "ffxiv-mcp-lumina",
      transport: "stdio",
      gameVersion: queried.health.value.gameVersion,
      validatedVersion: queried.health.value.validatedVersion,
      schemaVersion: queried.description.value.schema?.version ?? null,
      queryTime: queried.health.value.timestamp,
      versionWarnings: queried.health.value.warnings ?? [],
      healthResponse: queried.health.raw,
      describeSheet: {
        request: { tool: "describe_sheet", arguments: { sheet: "ClassJob" } },
        response: queried.description.raw,
      },
      abbreviationSearches: queried.jobSearchQueries,
    },
    xivapi: {
      service: "XIVAPI",
      apiVersion: "v2",
      endpoint: apiUrl,
      assetPattern: "ui/icon/062000/0621{ClassJob rowId padded to 2 digits}.tex",
      requestedAt: downloaded.map((entry) => entry.metadata.source.requestedAt).sort()[0],
      completedAt: downloadedAt,
      gameVersion: null,
      gameVersionNote: "XIVAPI asset responses did not expose a game-version header; ClassJob row IDs are tied to the MCP gameVersion above.",
      icons: Object.fromEntries(downloaded.map(({ jobId, rowId, metadata }) => [jobId, { rowId, ...metadata }])),
    },
    client: queried.initialization?.serverInfo ?? queried.initialization,
  };

  await mkdir(assetDir, { recursive: true });
  await Promise.all(downloaded.map(({ jobId, bytes }) => writeFile(resolve(assetDir, `${jobId}.png`), bytes)));
  await writeFile(snapshotPath, `${JSON.stringify(source, null, 2)}\n`, "utf8");
  await writeFile(iconsModulePath, buildIconsModule(downloaded), "utf8");
  console.log(JSON.stringify({
    outputDirectory: assetDir,
    metadata: snapshotPath,
    mapping: iconsModulePath,
    count: downloaded.length,
    gameVersion: source.mcp.gameVersion,
    jobs: downloaded.map(({ jobId, rowId, metadata }) => ({ jobId, rowId, file: metadata.file, dimensions: `${metadata.width}x${metadata.height}` })),
  }));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
