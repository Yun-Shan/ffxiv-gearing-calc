/**
 * 有限域验证工具：把 docs/mathematical-analysis/canonical-evaluator-reference.md §3 的
 * 整数档位模型与 canonical evaluator 逐点对照。
 *
 * 坐标约定（重要）：本文件所有 `g`、阈值、基线、预算都是**属性贡献**（装备+食物），
 * 不是角色面板总值。面板总值 = 基础属性 + 贡献，其中 base(CRT/DHT/TEN) = sub、
 * base(DET) = main（参考模型 §2.1）；`tier(level, job, stat, g)` 的 `g` 是贡献。
 *
 * 覆盖范围：有限定义域（全部支持等级 × 全部职业 × 指定贡献区间 × 有限属性集合）。
 * 证明作用：这些覆盖点上的证书。它不是一般性证明；一般性证明在对应定理 README 中。
 *
 * 运行：node --experimental-strip-types <script>
 * 依赖：Node 的类型剥离（直接 import 生产 .ts 源码）与生成数据字节注入
 *      （src/domain/data.ts 优先读取 globalThis.__FFXIV_GENERATED_DATA_BINARY__）。
 */
import { readFileSync } from "node:fs";

export const repoRoot = new URL("../../../", import.meta.url);
export const generatedDataUrl = new URL("src/data/generated-data.bin", repoRoot);

// 文档中登记的等级参数；生成数据变化时本表必须同步，verify 脚本会断言一致。
export const DOCUMENTED_LEVEL_PARAMS = Object.freeze({
  50: { main: 202, sub: 341, div: 341, det: 202, detTrunc: 5 },
  60: { main: 218, sub: 354, div: 600, det: 600, detTrunc: 2 },
  70: { main: 292, sub: 364, div: 900, det: 900, detTrunc: 1 },
  80: { main: 340, sub: 380, div: 1300, det: 1300, detTrunc: 1 },
  90: { main: 390, sub: 400, div: 1900, det: 1900, detTrunc: 1 },
  100: { main: 440, sub: 420, div: 2780, det: 2780, detTrunc: 1 },
});

let cachedData;
let cachedCanonical;

/** 载入生成数据（只读，不修改任何文件）。 */
export async function loadGameData() {
  if (cachedData !== undefined) return cachedData;
  const bytes = new Uint8Array(readFileSync(generatedDataUrl));
  globalThis.__FFXIV_GENERATED_DATA_BINARY__ = bytes;
  const { decodeGeneratedData } = await import(
    new URL("src/data/binary-format.mjs", repoRoot).href
  );
  cachedData = await decodeGeneratedData(bytes);
  return cachedData;
}

/** 直接载入生产 canonical evaluator（不是重新实现）。 */
export async function loadCanonicalEvaluator() {
  if (cachedCanonical !== undefined) return cachedCanonical;
  await loadGameData();
  cachedCanonical = await import(
    new URL("src/domain/search/equipped-effects.ts", repoRoot).href
  );
  return cachedCanonical;
}

export function gcd(left, right) {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b !== 0) [a, b] = [b, a % b];
  return a;
}

/** 精确整数 floor 除法（q > 0）；用 BigInt 避免任何浮点边界误差。 */
export function floorDiv(numerator, denominator) {
  const n = BigInt(numerator);
  const q = BigInt(denominator);
  if (q <= 0n) throw new RangeError("floorDiv 的分母必须为正");
  let quotient = n / q;
  if (n % q !== 0n && n < 0n) quotient -= 1n;
  return Number(quotient);
}

export function ceilDiv(numerator, denominator) {
  const n = BigInt(numerator);
  const q = BigInt(denominator);
  if (q <= 0n) throw new RangeError("ceilDiv 的分母必须为正");
  const quotient = n / q;
  const remainder = n % q;
  if (remainder === 0n) return Number(quotient);
  // BigInt 除法向零截断：n > 0 时向上取整需 +1；n < 0 时商已经是 ceil。
  return Number(n > 0n ? quotient + 1n : quotient);
}

/**
 * 三属性与 TEN 的通用档位参数：t(g) = c + mult * floor((a * g + b) / q)。
 * 这些参数由 canonical-evaluator-reference.md §3 给出。
 */
export function tierParameters(level, job, stat) {
  const levelParams = DOCUMENTED_LEVEL_PARAMS[level];
  if (levelParams === undefined) throw new RangeError(`未登记的等级 ${level}`);
  const blu = job === "BLU";
  switch (stat) {
    case "CRT":
      return { a: 200, b: 0, q: levelParams.div, c: 50 + (blu ? 200 : 0), mult: 1 };
    case "DHT":
      return { a: 550, b: 0, q: levelParams.div, c: blu ? 200 : 0, mult: 1 };
    case "DET":
      return {
        a: 140,
        b: 1000 * levelParams.det,
        q: levelParams.det * levelParams.detTrunc,
        c: 0,
        mult: levelParams.detTrunc,
      };
    case "TEN":
      return { a: 112, b: 0, q: levelParams.div, c: 1000, mult: 1 };
    default:
      throw new RangeError(`不支持的属性 ${stat}`);
  }
}

/** 整数档位模型 t(g)。 */
export function tier(level, job, stat, contribution) {
  const { a, b, q, c, mult } = tierParameters(level, job, stat);
  return c + mult * floorDiv(a * contribution + b, q);
}

/** 使 t(g) >= k 成立的最小 g（可能为负；调用方按定义域裁剪到 0）。 */
export function firstContributionWithTierAtLeast(level, job, stat, k) {
  const { a, b, q, c, mult } = tierParameters(level, job, stat);
  // mult * floor((a g + b)/q) >= k - c  <=>  floor((a g + b)/q) >= ceil((k - c)/mult)
  const needed = ceilDiv(k - c, mult);
  return ceilDiv(needed * q - b, a);
}

/** 跳档成本序列的周期参数：t(g + P) = t(g) + shift。 */
export function tierPeriod(level, job, stat) {
  const { a, q, mult } = tierParameters(level, job, stat);
  const divisor = gcd(a, q);
  return { period: q / divisor, shift: (mult * a) / divisor, divisor };
}

/** 精确副属性因子。 */
export function criticalFactor(tierValue, job) {
  return 1_000_000 + tierValue * (tierValue + (job === "BLU" ? 150 : 350));
}

export function directHitFactor(tierValue) {
  return 4000 + tierValue;
}

export function determinationFactor(tierValue) {
  return tierValue;
}

export function factorsAt(level, job, contributions) {
  const tCrt = tier(level, job, "CRT", contributions.CRT);
  const tDht = tier(level, job, "DHT", contributions.DHT);
  const tDet = tier(level, job, "DET", contributions.DET);
  return {
    crtTier: tCrt,
    dhtTier: tDht,
    detTier: tDet,
    critical: criticalFactor(tCrt, job),
    directHit: directHitFactor(tDht),
    determination: determinationFactor(tDet),
    product: BigInt(criticalFactor(tCrt, job)) *
      BigInt(directHitFactor(tDht)) *
      BigInt(determinationFactor(tDet)),
  };
}

export function assert(condition, message) {
  if (!condition) throw new Error(`断言失败：${message}`);
}
