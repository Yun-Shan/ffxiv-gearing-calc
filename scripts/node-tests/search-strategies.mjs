import { normalizeSearchStrategies } from "../../src/domain/search/strategies.ts";

/** Shared execution settings for the single-job and joint Node runners. */
export function parseSearchStrategies(env = process.env) {
  const raw = env.FFXIV_SEARCH_STRATEGIES;
  if (raw === undefined) return normalizeSearchStrategies();
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new TypeError("FFXIV_SEARCH_STRATEGIES 必须是包含 auto/on/off 设置的 JSON 对象");
  }
  return normalizeSearchStrategies(parsed);
}
