

export const LOG_SCALE = 1_000_000_000_000n;

export const FIXED_SCALE = 10n ** 30n;

export const LOG_TERMS = 40;

export function gcd(a: number, b: number): number {
  let left = Math.abs(a);
  let right = Math.abs(b);
  while (right !== 0) [left, right] = [right, left % right];
  return left;
}

export function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator - 1n) / denominator;
}

export function floorDiv(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  return remainder < 0n ? quotient - 1n : quotient;
}

export function atanhLogFixedBounds(num: bigint, den: bigint): readonly [bigint, bigint] {
  if (num === 0n) return [0n, 0n];
  if (num < 0n || den <= num) throw new RangeError("对数级数参数必须满足 0 <= num < den");
  let numPower = num;
  let denPower = den;
  const numSquared = num * num;
  const denSquared = den * den;
  let lower = 0n;
  for (let index = 0; index < LOG_TERMS; index++) {
    lower += (2n * FIXED_SCALE * numPower) /
      (denPower * BigInt(index * 2 + 1));
    numPower *= numSquared;
    denPower *= denSquared;
  }
  const omittedTerms = 2n * BigInt(LOG_TERMS);
  const nextDenominator = BigInt(LOG_TERMS * 2 + 1);
  const remainderUpper = ceilDiv(
    2n * FIXED_SCALE * numPower * denSquared,
    denPower * nextDenominator * (denSquared - numSquared),
  );
  return [lower, lower + omittedTerms + remainderUpper];
}

export function logRatioFixedBounds(numerator: bigint, denominator: bigint): readonly [bigint, bigint] {
  if (numerator <= 0n || denominator <= 0n) {
    throw new RangeError("对数有理数的分子和分母必须为正整数");
  }

  let exponent = numerator.toString(2).length - denominator.toString(2).length;
  if (exponent >= 0) {
    if (numerator < (denominator << BigInt(exponent))) exponent--;
  } else if ((numerator << BigInt(-exponent)) < denominator) {
    exponent--;
  }
  const exponentBigInt = BigInt(exponent);
  const mantissaNumerator = exponent >= 0
    ? numerator
    : numerator << BigInt(-exponent);
  const mantissaDenominator = exponent >= 0
    ? denominator << exponentBigInt
    : denominator;
  const [mantissaLower, mantissaUpper] = atanhLogFixedBounds(
    mantissaNumerator - mantissaDenominator,
    mantissaNumerator + mantissaDenominator,
  );
  const [lnTwoLower, lnTwoUpper] = atanhLogFixedBounds(1n, 3n);
  const lower = mantissaLower + (exponent >= 0 ? exponentBigInt * lnTwoLower : exponentBigInt * lnTwoUpper);
  const upper = mantissaUpper + (exponent >= 0 ? exponentBigInt * lnTwoUpper : exponentBigInt * lnTwoLower);
  return [lower, upper];
}

export function strictLogThresholdLoss(thresholdNumerator: bigint, denominator: bigint): bigint {
  if (thresholdNumerator <= 0n || thresholdNumerator > denominator) {
    throw new RangeError("联合搜索阈值必须属于 (0, 1]");
  }
  const [lower] = logRatioFixedBounds(thresholdNumerator, denominator);
  // 严格改进要求整数 Qdiff >= floor(L*ln(t))-K+1。约束行使用 baseline-loss-K，
  // 因此令 loss=-ell-1 即可编码该严格整数下界。
  const ell = floorDiv(LOG_SCALE * lower, FIXED_SCALE);
  return -ell - 1n;
}

export function roundedLog(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`伤害因子必须是正安全整数：${value}`);
  }
  const [lower, upper] = logRatioFixedBounds(BigInt(value), 1n);
  const roundFixed = (fixed: bigint) =>
    (fixed * LOG_SCALE + FIXED_SCALE / 2n) / FIXED_SCALE;
  const lowerRounded = roundFixed(lower);
  const upperRounded = roundFixed(upper);
  if (lowerRounded !== upperRounded) {
    throw new Error(`固定点对数区间过宽，无法安全量化因子 ${value}`);
  }
  const result = Number(lowerRounded);
  if (!Number.isSafeInteger(result)) {
    throw new RangeError(`固定点对数超出安全整数：${value}`);
  }
  return result;
}
