import { loadEnvFile } from "node:process";

const localEnvPath = new URL("../local.env", import.meta.url);

/** Resolve the local file from this module so invocation cwd does not matter. */
export function loadLocalEnv(path = localEnvPath) {
  try {
    loadEnvFile(path);
  } catch (error) {
    // CI/build users can supply environment variables without a local file.
    if (error.code !== "ENOENT") throw error;
  }
}

export function requireLocalEnv(name, environment = process.env) {
  const value = environment[name];
  if (typeof value !== "string" || value.trim() === "")
    throw new Error(`缺少本地配置 ${name}。请复制 local.env.example 为 local.env 并填写，或设置同名环境变量。`);
  return value;
}
