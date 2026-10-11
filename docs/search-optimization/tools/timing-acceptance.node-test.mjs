import assert from "node:assert/strict";
import { evaluateTimingSamples, timingTolerance } from "./timing-acceptance.mjs";

const checks = [];
function check(name, callback) {
  callback();
  checks.push(name);
}

check("uses a fixed one-second tolerance below ten seconds", () => {
  assert.deepEqual(timingTolerance(4_000), {
    referenceMs: 4_000,
    toleranceMs: 1_000,
    maximumMs: 5_000,
    policy: "fixed-1000ms",
  });
});

check("does not repeat a run inside the paired snapshot tolerance", () => {
  const result = evaluateTimingSamples({ samplesMs: [5_000], referenceMs: 4_000, nineRoundMaximumMs: 5_300 });
  assert.equal(result.status, "pass-single");
  assert.equal(result.shouldRepeat, false);
  assert.equal(result.passed, true);
  assert.equal(result.nineRoundMaximumMs, 5_300);
});

check("requests nine total samples if an over-limit run is within the recorded maximum", () => {
  const result = evaluateTimingSamples({ samplesMs: [5_200], referenceMs: 4_000, nineRoundMaximumMs: 5_300 });
  assert.equal(result.status, "repeat-to-nine");
  assert.equal(result.shouldRepeat, true);
  assert.equal(result.sampleCount, 1);
});

check("accepts a nine-sample average within the paired snapshot tolerance", () => {
  const result = evaluateTimingSamples({
    samplesMs: [5_200, 4_800, 4_900, 4_850, 4_900, 4_950, 4_850, 4_900, 4_850],
    referenceMs: 4_000,
    nineRoundMaximumMs: 5_300,
  });
  assert.equal(result.status, "pass-average");
  assert.equal(result.passed, true);
  assert.ok(result.averageMs <= 5_000);
});

check("fails a nine-sample average above the paired snapshot tolerance", () => {
  const result = evaluateTimingSamples({
    samplesMs: [5_200, 5_100, 5_150, 5_050, 5_200, 5_100, 5_150, 5_050, 5_100],
    referenceMs: 4_000,
    nineRoundMaximumMs: 5_300,
  });
  assert.equal(result.status, "fail-average");
  assert.equal(result.passed, false);
});

check("fails without further samples when a run exceeds the recorded maximum", () => {
  const result = evaluateTimingSamples({ samplesMs: [5_301], referenceMs: 4_000, nineRoundMaximumMs: 5_300 });
  assert.equal(result.status, "fail-above-nine-round-maximum");
  assert.equal(result.shouldRepeat, false);
  assert.equal(result.passed, false);
});

check("marks timing unavailable without an exact historical snapshot replay", () => {
  const result = evaluateTimingSamples({ samplesMs: [12_000], referenceMs: null, nineRoundMaximumMs: 15_000 });
  assert.equal(result.status, "unavailable");
  assert.equal(result.passed, undefined);
  assert.equal(result.shouldRepeat, false);
});

console.log(`计时验收自检通过：${checks.length} 项`);
