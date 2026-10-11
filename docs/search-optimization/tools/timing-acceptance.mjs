const STATUS = Object.freeze({
  OPTIMIZED: "optimized",
  OPTIMIZED_WITH_WARNING: "optimized-with-warning",
  NO_IMPACT: "no-impact",
  REGRESSION: "regression",
  UNAVAILABLE: "unavailable",
});

const STATUS_LABELS = Object.freeze({
  [STATUS.OPTIMIZED]: "优化成功",
  [STATUS.OPTIMIZED_WITH_WARNING]: "优化成功（提示）",
  [STATUS.NO_IMPACT]: "耗时无影响",
  [STATUS.REGRESSION]: "劣化",
  [STATUS.UNAVAILABLE]: "无法比较",
});

export function historicalTimingLabel(status) {
  return STATUS_LABELS[status] ?? STATUS_LABELS[STATUS.UNAVAILABLE];
}

export function compareHistoricalTiming({
  actualMs,
  historicalBestMs,
  nineRoundMinMs,
  nineRoundAverageMs,
  nineRoundMaxMs,
}) {
  const inputs = [actualMs, historicalBestMs, nineRoundMinMs, nineRoundAverageMs, nineRoundMaxMs];
  if (inputs.some((value) => !Number.isFinite(value) || value < 0) ||
      nineRoundMinMs > nineRoundAverageMs || nineRoundAverageMs > nineRoundMaxMs) {
    return {
      status: STATUS.UNAVAILABLE,
      label: STATUS_LABELS[STATUS.UNAVAILABLE],
      passed: false,
      actualMs: Number.isFinite(actualMs) ? actualMs : null,
      historicalBestMs: Number.isFinite(historicalBestMs) ? historicalBestMs : null,
      nineRound: null,
      deltaFromAverageMs: null,
    };
  }

  let status;
  if (actualMs <= historicalBestMs) {
    status = STATUS.OPTIMIZED;
  } else if (actualMs < nineRoundAverageMs) {
    status = STATUS.OPTIMIZED_WITH_WARNING;
  } else if (actualMs <= nineRoundMaxMs) {
    status = STATUS.NO_IMPACT;
  } else {
    status = STATUS.REGRESSION;
  }

  return {
    status,
    label: STATUS_LABELS[status],
    passed: status !== STATUS.REGRESSION,
    actualMs,
    historicalBestMs,
    nineRound: {
      minMs: nineRoundMinMs,
      averageMs: nineRoundAverageMs,
      maxMs: nineRoundMaxMs,
    },
    deltaFromAverageMs: actualMs - nineRoundAverageMs,
  };
}

export function evaluateOptimizationTarget(actualMs, targetMs) {
  if (!Number.isFinite(targetMs) || targetMs < 0) {
    throw new TypeError("targetMs must be a non-negative finite number");
  }
  if (!Number.isFinite(actualMs) || actualMs < 0) {
    return {
      status: "incomplete",
      label: "未完成",
      met: false,
      actualMs: null,
      targetMs,
      gapMs: null,
    };
  }
  const met = actualMs <= targetMs;
  return {
    status: met ? "met" : "missed",
    label: met ? "达标" : "超时",
    met,
    actualMs,
    targetMs,
    gapMs: Math.max(0, actualMs - targetMs),
  };
}
