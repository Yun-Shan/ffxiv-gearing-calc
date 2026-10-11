import assert from "node:assert/strict";
import {
  compareHistoricalTiming,
  evaluateOptimizationTarget,
  historicalTimingLabel,
} from "./timing-acceptance.mjs";

const checks = [];
function check(name, callback) {
  callback();
  checks.push(name);
}

const history = {
  historicalBestMs: 4_000,
  nineRoundMinMs: 4_200,
  nineRoundAverageMs: 5_000,
  nineRoundMaxMs: 5_800,
};

check("optimization target is independent and includes equality", () => {
  assert.equal(evaluateOptimizationTarget(60_000, 60_000).status, "met");
  assert.equal(evaluateOptimizationTarget(60_001, 60_000).status, "missed");
  assert.equal(evaluateOptimizationTarget(null, 60_000).status, "incomplete");
});

check("at or below the historical best is successful optimization", () => {
  const result = compareHistoricalTiming({ actualMs: 3_999, ...history });
  assert.equal(result.status, "optimized");
  assert.equal(result.passed, true);
  assert.equal(result.deltaFromAverageMs, -1_001);
});

check("slower than the best but below the nine-round average is a warned success", () => {
  const result = compareHistoricalTiming({ actualMs: 4_999, ...history });
  assert.equal(result.status, "optimized-with-warning");
  assert.equal(result.passed, true);
});

check("equal to the nine-round average has no material impact", () => {
  assert.equal(compareHistoricalTiming({ actualMs: 5_000, ...history }).status, "no-impact");
});

check("above the average but inside the observed range has no material impact", () => {
  assert.equal(compareHistoricalTiming({ actualMs: 5_500, ...history }).status, "no-impact");
});

check("above the nine-round maximum is degradation", () => {
  const result = compareHistoricalTiming({ actualMs: 5_801, ...history });
  assert.equal(result.status, "regression");
  assert.equal(result.passed, false);
});

check("missing or inconsistent historical data is not silently accepted", () => {
  assert.equal(compareHistoricalTiming({ actualMs: 4_500, ...history, nineRoundMaxMs: undefined }).status, "unavailable");
  assert.equal(compareHistoricalTiming({ actualMs: 4_500, ...history, nineRoundMinMs: 5_100 }).status, "unavailable");
});

check("historical labels remain short", () => {
  assert.equal(historicalTimingLabel("optimized-with-warning"), "优化成功（提示）");
  assert.equal(historicalTimingLabel("no-impact"), "耗时无影响");
  assert.equal(historicalTimingLabel("unknown"), "无法比较");
});

console.log(`耗时验收规则通过：${checks.length} 项`);