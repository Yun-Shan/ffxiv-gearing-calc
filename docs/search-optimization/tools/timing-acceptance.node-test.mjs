import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { TIMING_BASELINE } from "./timing-baseline.mjs";
import ACCEPTANCE_BASELINE from "./acceptance-baseline.json" with { type: "json" };
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

check("elapsed values are used directly without validation", () => {
  assert.equal(evaluateOptimizationTarget(-1, 60_000).actualMs, -1);
  assert.equal(compareHistoricalTiming({ actualMs: -1, ...history }).actualMs, -1);
  assert.equal(compareHistoricalTiming({ actualMs: null, ...history }).status, "unavailable");
});

check("historical labels remain short", () => {
  assert.equal(historicalTimingLabel("optimized-with-warning"), "优化成功（提示）");
  assert.equal(historicalTimingLabel("no-impact"), "耗时无影响");
  assert.equal(historicalTimingLabel("unknown"), "无法比较");
});

check("missing historical data fails the comparison", () => {
  assert.equal(compareHistoricalTiming({ actualMs: 25_000, historicalBestMs: 33_000 }).passed, false);
});

check("all formal cases read their complete nine-round measurements from the current baseline", () => {
  assert.equal(TIMING_BASELINE.rounds, 9);
  assert.equal(TIMING_BASELINE.searchCount, 198);
  assert.equal(TIMING_BASELINE.searchCount, TIMING_BASELINE.rounds * TIMING_BASELINE.caseCount);
  const runner = fileURLToPath(new URL("./run-acceptance.mjs", import.meta.url));
  const rows = execFileSync(process.execPath, [runner, "--list"], { encoding: "utf8" }).trim().split(/\r?\n/);
  assert.equal(rows.length, TIMING_BASELINE.caseCount);
  assert.equal(Object.keys(TIMING_BASELINE.cases).length, rows.length);
  for (const row of rows) {
    const [id] = row.split(" | ");
    const value = TIMING_BASELINE.cases[id];
    assert.equal(value.samplesMs.length, 9);
    assert.ok(value.samplesMs.every((sample) => Number.isFinite(sample) && sample > 0));
    assert.equal(value.minMs, Math.min(...value.samplesMs));
    assert.equal(value.averageMs, value.samplesMs.reduce((sum, sample) => sum + sample, 0) / 9);
    assert.equal(value.maxMs, Math.max(...value.samplesMs));
    assert.ok(row.includes(`history=${value.minMs}ms`));
    assert.ok(compareHistoricalTiming({
      actualMs: value.maxMs, historicalBestMs: value.minMs,
      nineRoundMinMs: value.minMs, nineRoundAverageMs: value.averageMs, nineRoundMaxMs: value.maxMs,
    }).passed);
  }
});

check("current result baselines cover the same cases and preserve exact solo denominators", () => {
  assert.equal(ACCEPTANCE_BASELINE.verifiedSearches, 198);
  assert.equal(ACCEPTANCE_BASELINE.dataSha256, TIMING_BASELINE.dataSha256);
  assert.deepEqual(Object.keys(ACCEPTANCE_BASELINE.cases), Object.keys(TIMING_BASELINE.cases));
  for (const item of Object.values(ACCEPTANCE_BASELINE.cases)) {
    if (item.configuration.jobs.length === 1) {
      assert.ok(BigInt(item.exact.single.numerator) > 0n);
      assert.ok(BigInt(item.exact.single.denominator) > 0n);
      continue;
    }
    assert.deepEqual(Object.keys(item.exact.jobs), item.configuration.jobs.map((job) => job.jobId));
    let numerator = 0n;
    let denominator = 1n;
    for (const { solo, joint } of Object.values(item.exact.jobs)) {
      for (const value of [solo, joint]) {
        assert.ok(BigInt(value.numerator) > 0n);
        assert.ok(BigInt(value.denominator) > 0n);
      }
      const n = BigInt(joint.numerator) * BigInt(solo.denominator);
      const d = BigInt(joint.denominator) * BigInt(solo.numerator);
      numerator = numerator * d + n * denominator;
      denominator *= d;
    }
    const expected = item.expected.normalizedJointValue;
    assert.deepEqual(item.exact.normalized, expected);
    assert.equal(numerator * BigInt(expected.denominator), denominator * BigInt(expected.numerator));
  }
});

console.log(`耗时验收规则通过：${checks.length} 项`);
