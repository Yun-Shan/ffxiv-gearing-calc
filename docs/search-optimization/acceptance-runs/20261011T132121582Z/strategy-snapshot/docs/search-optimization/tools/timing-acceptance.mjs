export const DEFAULT_TIMING_ROUND_COUNT = 9;

export function timingTolerance(referenceMs) {
  if (!Number.isFinite(referenceMs) || referenceMs < 0) {
    throw new TypeError("referenceMs must be a non-negative finite number");
  }
  const toleranceMs = referenceMs < 10_000 ? 1_000 : referenceMs * 0.1;
  return {
    referenceMs,
    toleranceMs,
    maximumMs: referenceMs + toleranceMs,
    policy: referenceMs < 10_000 ? "fixed-1000ms" : "10-percent",
  };
}

export function evaluateTimingSamples({
  samplesMs,
  referenceMs,
  nineRoundMaximumMs,
  requiredSamples = DEFAULT_TIMING_ROUND_COUNT,
}) {
  if (!Array.isArray(samplesMs) || samplesMs.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new TypeError("samplesMs must contain only non-negative finite numbers");
  }
  if (!Number.isSafeInteger(requiredSamples) || requiredSamples < 1) {
    throw new TypeError("requiredSamples must be a positive integer");
  }
  if (referenceMs === null || referenceMs === undefined) {
    return {
      status: "unavailable",
      shouldRepeat: false,
      nineRoundMaximumMs: nineRoundMaximumMs ?? null,
      requiredSamples,
      sampleCount: samplesMs.length,
      samplesMs: [...samplesMs],
      averageMs: samplesMs.length === 0 ? null : average(samplesMs),
      reason: "没有对应历史最快代码快照的同机复测值。",
    };
  }

  const limit = timingTolerance(referenceMs);
  const firstMs = samplesMs[0];
  if (firstMs === undefined) {
    return {
      ...limit,
      status: "incomplete",
      shouldRepeat: false,
      requiredSamples,
      sampleCount: 0,
      samplesMs: [],
      averageMs: null,
      reason: "没有取得首轮搜索耗时。",
    };
  }

  if (!Number.isFinite(nineRoundMaximumMs) || nineRoundMaximumMs < 0 || firstMs > nineRoundMaximumMs) {
    return summarize(limit, samplesMs, requiredSamples, "fail-above-nine-round-maximum", false,
      "首轮耗时超过同机历史快照容忍线和已记录九轮最长耗时。", false, nineRoundMaximumMs ?? null);
  }

  if (samplesMs.length < requiredSamples) {
    return summarize(limit, samplesMs, requiredSamples, "repeat-to-nine", true,
      "首轮仍落在九轮已观测范围内；继续补测至规定轮数后按均值判定。", null, nineRoundMaximumMs);
  }

  const averageMs = average(samplesMs);
  const passed = averageMs <= limit.maximumMs;
  return summarize(limit, samplesMs, requiredSamples, passed ? "pass-average" : "fail-average", false,
    passed
      ? "补测均值位于同机历史快照容忍线内。"
      : "补测均值仍超过同机历史快照容忍线。",
    passed,
    nineRoundMaximumMs,
    averageMs);
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function summarize(limit, samplesMs, requiredSamples, status, shouldRepeat, reason, passed, nineRoundMaximumMs = null, averageMs = average(samplesMs)) {
  return {
    ...limit,
    nineRoundMaximumMs,
    status,
    shouldRepeat,
    requiredSamples,
    sampleCount: samplesMs.length,
    samplesMs: [...samplesMs],
    averageMs,
    passed,
    reason,
  };
}
