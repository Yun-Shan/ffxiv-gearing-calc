import type { HighsCallbackTrace, LinearMipProgress } from "./search/linear-mip.ts";

export type Stat =
  | "STR"
  | "DEX"
  | "INT"
  | "MND"
  | "VIT"
  | "CRT"
  | "DET"
  | "DHT"
  | "SKS"
  | "SPS"
  | "TEN"
  | "PIE"
  | "PDMG"
  | "MDMG"
  | "DLY";
/** 原始 Item BaseParam 中的主属性和副属性占位符，需结合选定职业结构解析。 */
export type GearStat = Stat | "main" | "secondary";
export type JobId =
  | "PLD"
  | "WAR"
  | "DRK"
  | "GNB"
  | "WHM"
  | "SCH"
  | "AST"
  | "SGE"
  | "MNK"
  | "DRG"
  | "NIN"
  | "SAM"
  | "RPR"
  | "VPR"
  | "BRD"
  | "MCH"
  | "DNC"
  | "BLM"
  | "BLU"
  | "SMN"
  | "RDM"
  | "PCT"
  | "BST";
export type GearSlot =
  | "weapon"
  | "offhand"
  | "head"
  | "body"
  | "hands"
  | "legs"
  | "feet"
  | "earrings"
  | "necklace"
  | "bracelet"
  | "ring"
  | "ring2";

export type Stats = Partial<Record<Stat, number>>;
export type GearStats = Partial<Record<GearStat, number>>;
export type CustomizableStat = Exclude<
  Stat,
  "STR" | "DEX" | "INT" | "MND" | "VIT" | "PDMG" | "MDMG" | "DLY"
>;

export interface ResistanceWeaponAdjust {
  maxTotalStats: number;
  maxEachStat: number;
  stats: CustomizableStat[];
}

export interface Gear {
  id: number;
  name: string;
  slot: GearSlot;
  rawSlot: number;
  level: number;
  equipLevel: number;
  equipLevelVariable?: true;
  roleId: number;
  jobCategory: number;
  stats: GearStats;
  /** 数据源中的特殊属性；仅匹配启用的 ItemSpecialBonus 时合并进 stats。 */
  specialStats?: GearStats;
  itemSpecialBonus?: number;
  /** ItemSpecialBonus 的参数，当前仅保留原始数据，不参与属性倍率计算。 */
  itemSpecialBonusParam?: number;
  materiaSlots: number;
  materiaAdvanced?: true;
  /** 装备的唯一属性限制；源数据缺少此字段时，运行时按 false 处理。 */
  unique?: boolean;
  customParameters?: CustomWeaponParameter[];
  resistanceWeaponAdjust?: ResistanceWeaponAdjust;
  source?: string;
  jobs: JobId[];
  weaponDamage?: number;
  sourceFile: string;
  dataSources?: DataSourceRef[];
}

export interface CustomWeaponParameter {
  materiaId: number;
  stat: CustomizableStat;
  bigValueIndex: number;
  smallValueIndex: number;
  bigValue: number;
  smallValue: number;
}

export interface Food {
  id: number;
  name: string;
  level: number;
  stats: Stats;
  statRates: Stats;
  best?: true;
  sourceFile: string;
  dataSources?: DataSourceRef[];
}

/** A calculated food snapshot with the complete applied effect. */
export interface FoodResult extends Food {
  /** Per-stat applied gain, including zero for a food stat unused by this job. */
  actualStats: Stats;
  /** Integer percentage: floor(sum(actualStats) / sum(stats) * 100). */
  utilization: number;
}

export interface Materia {
  stat: Exclude<Stat, "STR" | "DEX" | "INT" | "MND" | "VIT" | "PDMG" | "MDMG" | "DLY">;
  value: number;
  grade: number;
  /** Original slot index for imported fixed gear; optimizer output may omit it. */
  slotIndex?: number;
}

export interface JobSchema {
  id: JobId;
  name: string;
  isLimitedJob: boolean;
  role: "tank" | "healer" | "str" | "dex" | "int";
  mainStat: "STR" | "DEX" | "INT" | "MND" | "VIT";
  secondaryStat: "SKS" | "SPS" | "TEN" | "PIE" | "DHT";
  attackStat: "STR" | "DEX" | "INT" | "MND";
  stats: Stat[];
  statModifiers: Partial<Record<Stat | "hp" | "gcd", number>>;
  partyBonus?: number;
  gcdModifier: number;
  traitDamageMultiplier: number;
  /** 该职业支持的最高角色等级。 */
  maxJobLevel?: number;
  /** 上游将限制职业武器的品级权重设为零。 */
  ignoreWeaponItemLevel?: boolean;
  /** 优化器为该职业选择的初始品级范围。 */
  defaultItemLevel?: readonly [number, number];
  dataSources?: DataSourceRef[];
}

export interface DataProvenance {
  repository: string;
  commit: string;
  importedAt: string;
  sourceFiles: string[];
  sources?: DataSourceRef[];
}

export interface DataSourceRef {
  kind: "mcp" | "reference";
  server?: string;
  repository?: string;
  commit?: string;
  sheet?: string;
  fields?: string[];
  rowIds?: number[];
  gameVersion?: string;
  validatedVersion?: string;
  queriedAt?: string;
  importedAt?: string;
  note?: string;
  sourceFiles?: string[];
}

export interface LevelModifier {
  main: number;
  sub: number;
  div: number;
  det: number;
  detTrunc: number;
  ap: number;
  apTank: number;
  hp: number;
  vit: number;
  vitTank: number;
}

export interface CalculationInput {
  stats: Stats;
  job: JobSchema;
  level: number;
  weaponDamage: number;
  /** 族群基础属性索引；未提供时使用人族·中原之民。 */
  clanIndex?: number;
}

export interface Effects {
  crtChance: number;
  crtDamage: number;
  detDamage: number;
  dhtChance: number;
  tenDamage: number;
  tenMitigation: number;
  damage: number;
  gcd: number;
  hp: number;
  mp: number;
}

export interface MeldedGear extends Gear {
  /** 已将通用占位符解析为职业专属属性的装备数据。 */
  stats: Stats;
  melds: Materia[];
  finalStats: Stats;
}

export interface OptimizationConfig {
  jobId: JobId;
  minItemLevel: number;
  maxItemLevel: number;
  /** 将装备属性和武器伤害同步到此品级。 */
  syncLevel?: number;
  /** 底层搜索允许按此列表启用装备的 ItemSpecialBonus。领域入口暂按职业覆盖此值。 */
  enabledItemSpecialBonuses?: number[];
  /** 族群基础属性索引；未提供时使用 0（人族·中原之民）。 */
  clanIndex?: number;
  gcdTarget?: number;
  gcdChoices?: number[];
  speedMin?: number;
  speedMax?: number;
  minTenacity?: number;
  /** 基础属性、装备和食物合并后的最低坚韧值。 */
  toughnessMin?: number;
  toughnessMinPercent?: number;
  maximizeTenacity: boolean;
  objective?: "damage" | "dps";
  excludedSources: string[];
  excludedGearIds?: number[];
  forcedGear: Partial<Record<GearSlot, number>>;
  sharedSlots?: GearSlot[];
  foodId: number;
  /** 仅供测试和验收设置的执行时限；前端工作线程请求会忽略此字段。 */
  maxSearchMs?: number;
}

export type CommonGearSlot = GearSlot | "rings";

export interface JointOptimizationConfig {
  jobs: OptimizationConfig[];
  commonSlots: CommonGearSlot[];
  foodStrategy: "shared" | "independent";
  objective?: "damage" | "dps";
  /** 仅供测试和验收设置的执行时限；前端工作线程请求会忽略此字段。 */
  maxSearchMs?: number;
  cacheLimit?: number;
}

export interface SearchOptions {
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
  onCandidateCounts?: (counts: SearchCandidateCounts) => void;
  onSolverProgress?: (event: LinearMipProgress) => void;
  /** 显式启用后提供完整求解器回调快照，用于诊断。 */
  onSolverCallback?: (event: HighsCallbackTrace) => void;
}

export interface SearchCandidateCounts {
  jobId: JobId;
  /** 为求解器准备的精确槽位候选池中的候选数量。 */
  slots: { slot: string; count: number }[];
  foodCount: number;
}

/** A selected result slot references immutable complete replacement groups. */
export interface ResultGear extends MeldedGear {
  /** Complete alternatives, including all unique rings and the current selection. */
  replacementGroupKey?: string;
  /** Rings additionally reference the unique subset only for conflict checks. */
  uniqueReplacementGroupKey?: string;
}

export interface OptimizationResult {
  /** 用于基础属性、食物、伤害和 GCD 计算的职业等级。 */
  calculationLevel?: number;
  gear: ResultGear[];
  equivalentGear?: Record<string, readonly MeldedGear[]>;
  food: FoodResult;
  stats: Stats;
  effects: Effects;
  score: number;
  objective: "damage" | "dps";
  damagePerSecond: number;
  gcdTier: number;
  searchedCandidates: number;
  durationMs: number;
  maximumTenacity?: number;
  statistics?: object;
}

export interface JointOptimizationResult {
  jobResults: Partial<Record<JobId, OptimizationResult>>;
  optima: Partial<Record<JobId, OptimizationResult>>;
  commonGear: Partial<Record<CommonGearSlot, MeldedGear[]>>;
  commonFood?: Food;
  objective: "damage" | "dps";
  value: { numerator: string; denominator: string; approximate: number };
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
  statistics: {
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
}

export const combatSlots: GearSlot[] = [
  "weapon",
  "offhand",
  "head",
  "body",
  "hands",
  "legs",
  "feet",
  "earrings",
  "necklace",
  "bracelet",
  "ring",
  "ring2",
];
export const combatStats: Exclude<
  Stat,
  "STR" | "DEX" | "INT" | "MND" | "VIT" | "PDMG" | "MDMG" | "DLY"
>[] = ["CRT", "DET", "DHT", "SKS", "SPS", "TEN", "PIE"];
