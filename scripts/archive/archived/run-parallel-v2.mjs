import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));
const script = resolve(root, "../test.ts");
process.env.DATA_TEST_WORKERS ??= "4";
process.env.DATA_TEST_ALGORITHM ??= "v2";
const child = spawn(process.execPath, ["--max-old-space-size=4096", "--experimental-strip-types", script], {
  cwd: resolve(root, "../../.."),
  env: { ...process.env, DATA_TEST_WORKERS: process.env.DATA_TEST_WORKERS, DATA_TEST_DEBUG: "true" },
  stdio: "inherit",
});
child.once("exit", (code, signal) => {
  if (signal !== null) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
