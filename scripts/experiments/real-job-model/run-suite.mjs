// Serial cold-process ABBA runs. Never run different benchmark cases concurrently.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const arg = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const scenarios = arg("--scenarios", "sync-fixed,meld-fixed").split(",");
const modes = arg("--modes", "off,on,on,off").split(",");
const destination = resolve(arg("--output-dir", "docs/research/职业循环建模/real-candidate-results"));
const label = arg("--label", "abba");
const timeoutMs = Number(arg("--timeout-ms", "210000"));
assert.ok(Number.isFinite(timeoutMs) && timeoutMs > 0);
await mkdir(destination, { recursive: true });
const plannedFiles = [join(destination, `${label}-summary.json`), ...scenarios.flatMap(scenario =>
  modes.flatMap((mode, index) => ["json", "stderr.txt"].map(extension =>
    join(destination, `${label}-${scenario}-${index + 1}-${mode}.${extension}`))))];
for (const path of plannedFiles) {
  let exists = true;
  try { await access(path); } catch (error) { if (error.code === "ENOENT") exists = false; else throw error; }
  assert.ok(!exists, `Preserve prior evidence; choose a new --label or --output-dir: ${path}`);
}
const entries = [];
for (const scenario of scenarios) {
  for (let index = 0; index < modes.length; index++) {
    const mode = modes[index];
    const stem = `${label}-${scenario}-${index + 1}-${mode}`;
    const output = join(destination, `${stem}.json`);
    let exists = true;
    try { await access(output); } catch (error) { if (error.code === "ENOENT") exists = false; else throw error; }
    assert.ok(!exists, `Preserve prior evidence; choose a new --label or --output-dir: ${output}`);
    const childArgs = [join(here, "run-case.mjs"), "--scenario", scenario, "--mode", mode, "--output", output];
    process.stderr.write(`Starting ${stem}\n`);
    const start = performance.now();
    const childResult = await new Promise((resolveResult, reject) => {
      const child = spawn(process.execPath, childArgs, { cwd: resolve(here, "../../.."), windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "", stderr = "", killedByWatchdog = false;
      child.stdout.on("data", chunk => { stdout += chunk; });
      child.stderr.on("data", chunk => { stderr += chunk; process.stderr.write(chunk); });
      const watchdog = setTimeout(() => { killedByWatchdog = true; child.kill(); }, timeoutMs);
      child.once("error", error => { clearTimeout(watchdog); reject(error); });
      child.once("close", (exitCode, signal) => {
        clearTimeout(watchdog);
        resolveResult({ exitCode, signal, killedByWatchdog, stdout, stderr });
      });
    });
    const coldProcessWallMs = performance.now() - start;
    await writeFile(join(destination, `${stem}.stderr.txt`), childResult.stderr);
    let result;
    try {
      result = JSON.parse(await readFile(output, "utf8"));
      assert.equal(result.scenario, scenario, "Unexpected child scenario");
      assert.equal(result.mode, mode, "Unexpected child mode");
      assert.ok(Date.parse(result.startedAt) >= Date.now() - coldProcessWallMs - 1000,
        "The result belongs to an earlier run");
    } catch (error) {
      result = { status: childResult.killedByWatchdog ? "incomplete" : "failed",
        failure: childResult.killedByWatchdog ? "parent-watchdog" : "child-failed-without-valid-result",
        resultReadError: error.message,
        exitCode: childResult.exitCode, signal: childResult.signal, stdoutTail: childResult.stdout.slice(-4000) };
      await writeFile(output, `${JSON.stringify(result, null, 2)}\n`);
    }
    entries.push({ scenario, mode, sample: index + 1, file: `${stem}.json`, coldProcessWallMs,
      exitCode: childResult.exitCode, killedByWatchdog: childResult.killedByWatchdog,
      sha256: createHash("sha256").update(await readFile(output)).digest("hex"), result });
    await writeFile(join(destination, `${label}-summary.json`), `${JSON.stringify({ runAt: new Date().toISOString(),
      timing: "Serial independent cold Node processes; wall includes startup, import/data decode, candidate preparation, all GCD branches, validation, and JSON writing.",
      timeoutMs, scenarios, modes, entries }, null, 2)}\n`);
    process.stderr.write(`Finished ${stem}: ${result.status ?? "see result"}, ${Math.round(coldProcessWallMs)} ms\n`);
    if (![0, 2].includes(childResult.exitCode) && !childResult.killedByWatchdog) throw new Error(`Child failed: ${stem}`);
  }
}
process.stdout.write(`${JSON.stringify({ destination, runs: entries.length,
  timings: entries.map(({ scenario, mode, coldProcessWallMs }) => ({ scenario, mode, coldProcessWallMs })) }, null, 2)}\n`);
