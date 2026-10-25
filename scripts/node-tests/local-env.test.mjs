import assert from "node:assert/strict";
import childProcess, { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { copyFile, mkdir, mkdtemp, rmdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { syncBuiltinESMExports } from "node:module";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadLocalEnv, requireLocalEnv } from "../local-env.mjs";
import { McpClient } from "../mcp-lumina/transport.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const requiredNames = ["FFXIV_MCP_LUMINA_COMMAND", "McpLumina__GamePath", "McpLumina__SchemaPath"];

async function fixture(t, content) {
  const scratch = join(root, ".tmp", "local-env-tests");
  await mkdir(scratch, { recursive: true });
  const directory = await mkdtemp(join(scratch, "project-"));
  const scripts = join(directory, "scripts");
  const cwd = join(directory, "other-cwd");
  await mkdir(scripts);
  await mkdir(cwd);
  await copyFile(new URL("../local-env.mjs", import.meta.url), join(scripts, "local-env.mjs"));
  if (content !== undefined) await writeFile(join(directory, "local.env"), content);
  t.after(async () => {
    for (const file of ["local.env", "scripts/local-env.mjs"]) {
      try {
        await unlink(join(directory, file));
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    await rmdir(scripts);
    await rmdir(cwd);
    await rmdir(directory);
  });
  return { directory, cwd, loader: pathToFileURL(join(scripts, "local-env.mjs")).href };
}

function runScript(project, source, overrides = {}) {
  const environment = { ...process.env };
  for (const name of [...requiredNames, "FFXIV_GEARING_ROOT", "FFXIV_MCP_LUMINA_CONCURRENCY", "McpLumina__LanguageDefault"])
    delete environment[name];
  return spawnSync(process.execPath, ["--input-type=module", "--eval", source], {
    cwd: project.cwd,
    env: { ...environment, ...overrides },
    encoding: "utf8",
    timeout: 10_000,
  });
}

test("local.env loads from the project directory and preserves quoted Windows paths", async (t) => {
  const project = await fixture(t, String.raw`
FFXIV_MCP_LUMINA_COMMAND='C:\MCP tools\lumina.exe'
McpLumina__GamePath='C:\Game\最终幻想XIV'
McpLumina__SchemaPath='C:\Source #1\EXDSchema'
FFXIV_GEARING_ROOT=reference/custom-gearing
FFXIV_MCP_LUMINA_CONCURRENCY=6
McpLumina__LanguageDefault=chs
`);
  const names = [...requiredNames, "FFXIV_GEARING_ROOT", "FFXIV_MCP_LUMINA_CONCURRENCY", "McpLumina__LanguageDefault"];
  const result = runScript(project, `
    import { loadLocalEnv } from ${JSON.stringify(project.loader)};
    loadLocalEnv();
    console.log(JSON.stringify(Object.fromEntries(${JSON.stringify(names)}.map(name => [name, process.env[name]]))));
  `);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    FFXIV_MCP_LUMINA_COMMAND: String.raw`C:\MCP tools\lumina.exe`,
    McpLumina__GamePath: String.raw`C:\Game\最终幻想XIV`,
    McpLumina__SchemaPath: String.raw`C:\Source #1\EXDSchema`,
    FFXIV_GEARING_ROOT: "reference/custom-gearing",
    FFXIV_MCP_LUMINA_CONCURRENCY: "6",
    McpLumina__LanguageDefault: "chs",
  });
});

test("existing process environment variables take precedence over local.env", async (t) => {
  const project = await fixture(t, "FFXIV_MCP_LUMINA_COMMAND=file-command\nMcpLumina__GamePath=file-game\n");
  const result = runScript(project, `
    import { loadLocalEnv } from ${JSON.stringify(project.loader)};
    loadLocalEnv();
    console.log(JSON.stringify([process.env.FFXIV_MCP_LUMINA_COMMAND, process.env.McpLumina__GamePath]));
  `, { FFXIV_MCP_LUMINA_COMMAND: "environment-command", McpLumina__GamePath: "" });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), ["environment-command", ""]);
});

test("a missing local.env is optional but other file errors are reported", async (t) => {
  const project = await fixture(t);
  const result = runScript(project, `
    import { loadLocalEnv } from ${JSON.stringify(project.loader)};
    loadLocalEnv();
    console.log("loaded without local.env");
  `);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "loaded without local.env");
  assert.throws(() => loadLocalEnv(project.directory), (error) => error.code !== "ENOENT");
});

test("required local settings reject missing, empty and whitespace-only values", () => {
  for (const name of requiredNames) {
    for (const value of [undefined, "", " \t "])
      assert.throws(() => requireLocalEnv(name, { [name]: value }), new RegExp(`${name}.*local\\.env`));
    assert.equal(requireLocalEnv(name, { [name]: "configured-path" }), "configured-path");
  }
});

test("data update and MCP query reject missing configuration before external work", async (t) => {
  const project = await fixture(t);
  for (const missing of requiredNames) {
    const result = runScript(project, `
      const { queryMcpLumina } = await import(${JSON.stringify(new URL("../query-mcp-lumina.mjs", import.meta.url).href)});
      const { updateData } = await import(${JSON.stringify(new URL("../update-data.mjs", import.meta.url).href)});
      const errors = [];
      for (const run of [() => queryMcpLumina(), () => updateData({ upstreamRoot: ${JSON.stringify(project.directory)} })]) {
        try { await run(); errors.push(null); } catch (error) { errors.push(error.message); }
      }
      console.log(JSON.stringify(errors));
    `, {
      FFXIV_MCP_LUMINA_COMMAND: process.execPath,
      McpLumina__GamePath: "fixture-game",
      McpLumina__SchemaPath: "fixture-schema",
      [missing]: "",
    });
    assert.equal(result.status, 0, result.stderr);
    for (const error of JSON.parse(result.stdout)) assert.match(error, new RegExp(`${missing}.*local\\.env`));
  }
});

test("MCP subprocess receives the supplied paths and default or explicit language", (t) => {
  const spawn = t.mock.method(childProcess, "spawn", () => {
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.kill = () => {};
    return child;
  });
  syncBuiltinESMExports();
  t.after(() => {
    spawn.mock.restore();
    syncBuiltinESMExports();
  });
  for (const language of [undefined, "en"]) {
    const client = new McpClient({
      command: "fixture-mcp-command",
      cwd: root,
      environment: {
        McpLumina__GamePath: "fixture-game-with-中文",
        McpLumina__SchemaPath: "fixture-schema-with-spaces",
        McpLumina__LanguageDefault: language,
      },
    });
    const [command, args, options] = spawn.mock.calls.at(-1).arguments;
    assert.equal(command, "fixture-mcp-command");
    assert.deepEqual(args, []);
    assert.equal(options.cwd, root);
    assert.deepEqual(options.env, {
      McpLumina__GamePath: "fixture-game-with-中文",
      McpLumina__SchemaPath: "fixture-schema-with-spaces",
      McpLumina__LanguageDefault: language ?? "chs",
    });
    client.close();
  }
});
