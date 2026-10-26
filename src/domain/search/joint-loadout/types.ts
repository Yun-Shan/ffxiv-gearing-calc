import type { createIntegerDamageFactorEvaluator } from "../equipped-effects.ts";
import type { ExactMipOptions, ExactMipResult } from "../loadout-finder-exact-mip.ts";
import type { EquipInfo, FoodInfo, SharedSlotProjection } from "../types.ts";
import type { HighsCallbackTrace } from "../linear-mip.ts";
import type { BaselineExecutor } from "../parallel-baseline-executor.ts";

export type JointLoadoutJobV3 = {
  id: string;
  /** 槽位名称与 options.slots 对齐，从而允许不同职业使用不同槽位索引。 */
  slotNames: readonly string[];
  options: ExactMipOptions;
};

export type JointLoadoutV3Options = {
  jobs: readonly JointLoadoutJobV3[];
  /** 各职业之间共享的槽位名称或投影装备身份。 */
  commonSlots: readonly string[];
  /** 仍由单个完整求解候选提供支持的投影虚拟槽位。 */
  commonSlotProjections?: readonly SharedSlotProjection[];
  /** 优化器内部路径：将完整且未强制指定的共享戒指对拆分为两个槽位。 */
  factorizedSharedRingPair?: boolean;
  /** 精确模型的内部调优选项；省略时沿用默认的比值配对剪枝。 */
  ratioUpperPairPolicy?: "default" | "disabled";
  foodStrategy: "shared" | "independent";
  /** DPS 使用精确的乘积与 GCD 分数。 */
  objective: "damage" | "dps";
  /** 可选的墙钟时间预算，供测试和验收运行使用，最多为 235 秒。 */
  maxSearchMs?: number;
  /** 为受限内部 MIP 结果提供先进先出缓存，默认最多 2048 项。 */
  cacheLimit?: number;
  onProgress?: (message: string) => void;
  onSolverCallback?: (event: HighsCallbackTrace) => void;
  /** 可选的隔离工作线程执行器；直接调用方省略时沿用本地顺序执行路径。 */
  baselineExecutor?: BaselineExecutor;
  /** 在求解器调用之间及外层搜索节点处检查取消状态。 */
  isCancelled?: () => boolean;
};

export type JointLoadoutV3Result = {
  /** 各职业伤害除以该职业无共享约束最优值后的精确总和。 */
  value: { numerator: string; denominator: string; approximate: number };
  commonEquipments: Record<string, EquipInfo>;
  /** 每份选择都与对应职业原始 options.slots 中的槽位顺序一致。 */
  jobResults: Record<string, JointLoadoutJobResultV3>;
  optima: Record<string, JointLoadoutJobResultV3>;
  statistics: JointLoadoutV3Statistics;
  proof: {
    complete: true;
    objective: "damage" | "dps";
    optimalityScope: string;
    outerBound: string;
    innerSolverStatus: "Optimal" | "DualBound";
    formalCertificate: false;
    numericalLimitation: string;
    terminationReason: string;
  };
};

export type JointLoadoutJobResultV3 = ExactMipResult & {
  gcd: number;
  damagePerSecond: number;
};

export type JointLoadoutV3Statistics = {
  elapsedMs: number;
  timeLimitMs?: number;
  outerNodes: number;
  completeNodes: number;
  upperBoundPrunes: number;
  relaxedOptimaAttained: number;
  innerSolves: number;
  parentResultReuses: number;
  cacheHits: number;
  cacheMisses: number;
  cacheEntries: number;
  cacheLimit: number;
  rssBytes?: number;
  heapUsedBytes?: number;
};

export type Rational = { numerator: bigint; denominator: bigint };

export type CommonChoice = {
  key: string;
  equipments: Map<string, EquipInfo>;
};

export type FoodChoice = {
  key: string;
  foods: Map<string, FoodInfo | undefined>;
};

export type JobContext = {
  job: JointLoadoutJobV3;
  solverSlots: readonly (readonly EquipInfo[])[];
  indexByName: Map<string, number>;
  factorEvaluator: ReturnType<typeof createIntegerDamageFactorEvaluator>;
  attributeIndexes: Map<number, number>;
  equipAttributes: WeakMap<EquipInfo, readonly number[]>;
  optimum: ExactMipResult;
  optimumProduct: bigint;
  optimumGcd: number;
  active: boolean;
  constraints: ExactMipOptions["constraints"];
};

export type MutableStatistics = Omit<JointLoadoutV3Statistics, "elapsedMs" | "timeLimitMs" | "rssBytes" | "heapUsedBytes" | "cacheLimit">;

export type RingPairInfo = EquipInfo & { ringEquips: readonly [EquipInfo, EquipInfo] };
