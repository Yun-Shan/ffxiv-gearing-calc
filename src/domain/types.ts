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
  /** Optional on historical result snapshots created before icons were stored in the binary catalog. */
  icon?: number;
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
}

/** Gear decoded from the current generated catalog always has a validated icon ID. */
export interface GeneratedGear extends Gear {
  icon: number;
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
  /** Optional on historical result snapshots created before icons were stored in the binary catalog. */
  icon?: number;
  name: string;
  level: number;
  stats: Stats;
  statRates: Stats;
  best?: true;
}

/** Food decoded from the current generated data always has a validated icon ID. */
export interface GeneratedFood extends Food {
  icon: number;
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
  mainStat: "STR" | "DEX" | "INT" | "MND";
  secondaryStat: "SKS" | "SPS" | "TEN" | "PIE" | "DHT";
  stats: Stat[];
  statModifiers: Partial<Record<Stat | "hp" | "gcd", number>> & { gcdReason?: string };
  partyBonus?: number;
  gcdModifier: number;
  traitDamageMultiplier: number;
  /** 该职业支持的最高角色等级。 */
  maxJobLevel?: number;
  /** 上游将限制职业武器的品级权重设为零。 */
  ignoreWeaponItemLevel?: boolean;
  /** 优化器为该职业选择的初始品级范围。 */
  defaultItemLevel?: readonly [number, number];
}

export interface GeneratedJob {
  /** ClassJob Row ID used to calculate the icon ID. */
  id: number;
  name: string;
  abbreviation: JobId;
}

export type SyncTarget =
  | { kind: "jobLevel"; value: number }
  | { kind: "itemLevel"; value: number };

export interface SyncLevelRule {
  jobLevel: number;
  minItemLevel: number;
  defaultItemLevel: number;
}

export interface SyncDutyOption {
  name: string;
  target: SyncTarget;
}

export interface SyncDutyGroup {
  name: string;
  options: SyncDutyOption[];
}

export interface SyncData {
  levels: SyncLevelRule[];
  groups: SyncDutyGroup[];
}

/** Small runtime generation summary; detailed source checks stay in the generator. */
export interface DataProvenance {
  repository: string;
  commit: string;
  importedAt: string;
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
  /** 不启用、仅同步等级或同步到指定品级。 */
  sync?: SyncTarget;
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
  forcedGear: ForcedGearMap;
  sharedSlots?: GearSlot[];
  foodId: number;
  /** 仅供测试和验收设置的执行时限；前端工作线程请求会忽略此字段。 */
  maxSearchMs?: number;
}

/** A locked item can retain automatic holes or a fixed absolute custom weapon allocation. */
export type ForcedGearValue =
  | number
  | { id: number; melds: readonly (Materia | null)[] }
  | { id: number; customStats: Stats };

export type ForcedGearMap = Partial<Record<GearSlot, ForcedGearValue>>;

function assertForcedGearId(id: unknown): void {
  if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) {
    throw new TypeError("强制装备 ID 必须是正安全整数");
  }
}

/** Runtime guard for JSON/worker input, where TypeScript types are no longer available. */
export function assertForcedGearValue(
  value: unknown,
): asserts value is ForcedGearValue | undefined {
  if (value === undefined) return;
  if (typeof value === "number") {
    assertForcedGearId(value);
    return;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("强制装备配置必须是物品 ID 或装备对象");
  }
  const record = value as Record<string, unknown>;
  assertForcedGearId(record.id);
  const keys = Object.keys(record);
  const hasMelds = Object.hasOwn(record, "melds");
  const hasCustomStats = Object.hasOwn(record, "customStats");
  if (
    hasMelds === hasCustomStats ||
    keys.some((key) => key !== "id" && key !== "melds" && key !== "customStats") ||
    (hasMelds && !Array.isArray(record.melds)) ||
    (hasCustomStats && (
      typeof record.customStats !== "object" ||
      record.customStats === null ||
      Array.isArray(record.customStats)
    ))
  ) {
    throw new TypeError("强制装备对象必须且只能包含有效的 ID 与 melds 或 customStats");
  }
}

export function forcedGearId(value: ForcedGearValue | undefined): number | undefined {
  return typeof value === "number" ? value : value?.id;
}

/** Returns a detached snapshot suitable for mutable UI drafts or worker requests. */
export function cloneForcedGearValue(
  value: ForcedGearValue | undefined,
): ForcedGearValue | undefined {
  if (value === undefined || typeof value === "number") return value;
  if ("melds" in value) {
    return {
      id: value.id,
      melds: value.melds.map((meld) => meld === null ? null : { ...meld }),
    };
  }
  return { id: value.id, customStats: { ...value.customStats } };
}

/** Clone a complete force map without retaining mutable values or undefined entries. */
export function cloneForcedGearMap(force: ForcedGearMap): ForcedGearMap {
  return Object.fromEntries(
    Object.entries(force).flatMap(([slot, value]) => {
      const copy = cloneForcedGearValue(value);
      return copy === undefined ? [] : [[slot, copy]];
    }),
  );
}

function equalRecord(left: object, right: object): boolean {
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord).sort();
  const rightKeys = Object.keys(rightRecord).sort();
  return leftKeys.length === rightKeys.length && leftKeys.every((key, index) =>
    key === rightKeys[index] && Object.is(leftRecord[key], rightRecord[key]),
  );
}

/** Compares a fixed restriction by value; object property order has no meaning. */
export function forcedGearEqual(
  left: ForcedGearValue | undefined,
  right: ForcedGearValue | undefined,
): boolean {
  if (left === right) return true;
  if (left === undefined || right === undefined) return false;
  if (typeof left === "number" || typeof right === "number") {
    return typeof left === "number" && typeof right === "number" && left === right;
  }
  if (left.id !== right.id) return false;
  const leftHasMelds = "melds" in left;
  const rightHasMelds = "melds" in right;
  if (leftHasMelds !== rightHasMelds) return false;
  if (leftHasMelds && rightHasMelds) {
    return left.melds.length === right.melds.length && left.melds.every((meld, index) => {
      const other = right.melds[index];
      return meld === null || other === null
        ? meld === other
        : meld !== undefined && other !== undefined && equalRecord(meld, other);
    });
  }
  if ("customStats" in left && "customStats" in right) {
    return equalRecord(left.customStats, right.customStats);
  }
  return false;
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
