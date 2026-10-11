import { calculateBaseStats, combatStats, getGearStatCap, jobSchemas } from "../domain";
import type {
  CommonGearSlot,
  Effects,
  Food,
  Gear,
  GearSlot,
  JobId,
  JointOptimizationConfig,
  JointOptimizationResult,
  MeldedGear,
  Materia,
  OptimizationConfig,
  OptimizationResult,
  Stat,
  Stats,
} from "../domain";

const DATABASE_NAME = "ffxiv-gearing-calc";
const DATABASE_VERSION = 1;
const STORE_NAME = "search-history";
const STAT_IDS = new Set<Stat>([
  "STR", "DEX", "INT", "MND", "VIT", "CRT", "DET", "DHT", "SKS", "SPS", "TEN", "PIE", "PDMG", "MDMG", "DLY",
]);
const MATERIA_STAT_IDS = new Set<Stat>(["CRT", "DET", "DHT", "SKS", "SPS", "TEN", "PIE"]);
const GEAR_SLOT_IDS = new Set<GearSlot>([
  "weapon", "offhand", "head", "body", "hands", "legs", "feet", "earrings", "necklace", "bracelet", "ring", "ring2",
]);
const COMMON_SLOT_IDS = new Set<CommonGearSlot>([...GEAR_SLOT_IDS, "rings"]);
const EFFECT_FIELDS: readonly (keyof Effects)[] = [
  "crtChance", "crtDamage", "detDamage", "dhtChance", "tenDamage", "tenMitigation", "damage", "gcd", "hp", "mp",
];

export type SearchHistoryKind = "single" | "joint";
export type SearchHistoryStatus =
  | "running"
  | "completed"
  | "cancelled"
  | "no-result"
  | "failed"
  | "interrupted";

interface SearchHistoryBase {
  id: string;
  startedAtISO: string;
  finishedAtISO?: string;
  dataVersion: string;
  status: SearchHistoryStatus;
  error?: string;
}

export type SearchHistoryRecord =
  | (SearchHistoryBase & {
      kind: "single";
      config: OptimizationConfig;
      gcdMode?: SingleGcdMode;
      result?: OptimizationResult;
    })
  | (SearchHistoryBase & {
      kind: "joint";
      config: JointOptimizationConfig;
      result?: JointOptimizationResult;
    });

export type CreateSearchHistoryInput =
  | { kind: "single"; config: OptimizationConfig; gcdMode?: SingleGcdMode; dataVersion: string }
  | { kind: "joint"; config: JointOptimizationConfig; dataVersion: string };

export type SingleGcdMode = "any" | "tiers" | "speed";

export type FinishSearchHistoryInput =
  | { status: "completed"; result: OptimizationResult | JointOptimizationResult }
  | { status: "failed"; error: string }
  | { status: "cancelled" | "no-result" | "interrupted"; error?: string };

export class SearchHistoryStorageError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SearchHistoryStorageError";
  }
}

let databasePromise: Promise<IDBDatabase> | undefined;

function storageError(operation: string, cause: unknown): SearchHistoryStorageError {
  const detail = cause instanceof SearchHistoryStorageError
    ? cause.message
    : cause instanceof DOMException
      ? ({
          QuotaExceededError: "浏览器本地存储空间不足。",
          SecurityError: "浏览器阻止访问本地搜索记录。",
          NotAllowedError: "浏览器拒绝访问本地搜索记录。",
          VersionError: "本地搜索记录版本不兼容。",
        } as Record<string, string>)[cause.name] ?? "浏览器本地数据库操作失败。"
      : cause instanceof Error
        ? cause.message
        : "发生未知存储错误。";
  return new SearchHistoryStorageError(`无法${operation}本地搜索记录：${detail}`, { cause });
}

function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;
  if (typeof window === "undefined" || !window.indexedDB) {
    return Promise.reject(
      new SearchHistoryStorageError("当前浏览器不支持本地搜索记录存储功能。"),
    );
  }

  databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
    let request: IDBOpenDBRequest;
    let settled = false;
    try {
      request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    } catch (error) {
      databasePromise = undefined;
      reject(storageError("打开", error));
      return;
    }

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onerror = () => {
      if (settled) return;
      settled = true;
      databasePromise = undefined;
      reject(storageError("打开", request.error ?? new Error("IndexedDB 打开请求失败。")));
    };
    request.onblocked = () => {
      if (settled) return;
      settled = true;
      databasePromise = undefined;
      reject(storageError("打开", new Error("数据库升级被其他页面阻塞，请关闭其他项目页面后重试。")));
    };
    request.onsuccess = () => {
      const database = request.result;
      if (settled) {
        database.close();
        return;
      }
      settled = true;
      database.onversionchange = () => {
        database.close();
        databasePromise = undefined;
      };
      resolve(database);
    };
  });
  return databasePromise;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new SearchHistoryStorageError(`搜索记录数据无效：${message}`);
}

function isJobId(value: unknown): value is JobId {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(jobSchemas, value);
}

function isStats(value: unknown): value is Stats {
  return isObject(value) && Object.entries(value).every(([stat, amount]) => STAT_IDS.has(stat as Stat) && isFiniteNumber(amount));
}

function isFood(value: unknown): value is Food {
  return isObject(value) && isSafeInteger(value.id) && typeof value.name === "string" && value.name.trim().length > 0 &&
    isSafeInteger(value.level) && isStats(value.stats) && isStats(value.statRates) &&
    typeof value.sourceFile === "string" && value.sourceFile.length > 0 &&
    (value.best === undefined || value.best === true);
}

function isMateria(value: unknown): value is Materia {
  return isObject(value) && typeof value.stat === "string" && MATERIA_STAT_IDS.has(value.stat as Stat) &&
    isFiniteNumber(value.value) && isSafeInteger(value.grade);
}

function isCustomWeaponParameter(value: unknown): boolean {
  return isObject(value) && isSafeInteger(value.materiaId) && typeof value.stat === "string" &&
    MATERIA_STAT_IDS.has(value.stat as Stat) && isSafeInteger(value.bigValueIndex) &&
    isSafeInteger(value.smallValueIndex) && isFiniteNumber(value.bigValue) && isFiniteNumber(value.smallValue);
}

function isGear(value: unknown): value is Gear {
  return isObject(value) && isSafeInteger(value.id) && typeof value.name === "string" && value.name.trim().length > 0 &&
    typeof value.slot === "string" && GEAR_SLOT_IDS.has(value.slot as GearSlot) &&
    isSafeInteger(value.rawSlot) && isSafeInteger(value.level) && isSafeInteger(value.equipLevel) &&
    isSafeInteger(value.roleId) && isSafeInteger(value.jobCategory) && isStats(value.stats) &&
    isSafeInteger(value.materiaSlots) && value.materiaSlots >= 0 &&
    (value.materiaAdvanced === undefined || value.materiaAdvanced === true) &&
    (value.unique === undefined || typeof value.unique === "boolean") &&
    (value.hq === undefined || value.hq === true) &&
    (value.customizable === undefined || value.customizable === true) &&
    (value.customParameters === undefined || (Array.isArray(value.customParameters) && value.customParameters.every(isCustomWeaponParameter))) &&
    (value.source === undefined || typeof value.source === "string") &&
    Array.isArray(value.jobs) && value.jobs.every(isJobId) &&
    (value.weaponDamage === undefined || isFiniteNumber(value.weaponDamage)) &&
    typeof value.sourceFile === "string" && value.sourceFile.length > 0;
}

function isMeldedGear(value: unknown): value is MeldedGear {
  if (!isObject(value) || !isGear(value) || !Array.isArray(value.melds) || !value.melds.every(isMateria) || !isStats(value.finalStats)) return false;
  for (const stat of Object.keys(value.finalStats)) {
    if (!combatStats.includes(stat as (typeof combatStats)[number])) continue;
    try {
      // ResultPanel calls isGearBaseStatAtCap for these values. Validate the
      // same domain lookup now so malformed historical gear cannot throw at render time.
      getGearStatCap(value, stat as Stat);
    } catch {
      return false;
    }
  }
  return true;
}

function validateOptimizationConfig(value: unknown): value is OptimizationConfig {
  if (!isObject(value)) return false;
  return (
    isJobId(value.jobId) &&
    isFiniteNumber(value.minItemLevel) && isFiniteNumber(value.maxItemLevel) &&
    typeof value.maximizeTenacity === "boolean" &&
    Array.isArray(value.excludedSources) && value.excludedSources.every((item) => typeof item === "string") &&
    isObject(value.forcedGear) && Object.entries(value.forcedGear).every(([slot, id]) => GEAR_SLOT_IDS.has(slot as GearSlot) && (id === undefined || isSafeInteger(id))) &&
    isFiniteNumber(value.foodId) &&
    (value.jobLevel === undefined || isFiniteNumber(value.jobLevel)) &&
    (value.syncLevel === undefined || isFiniteNumber(value.syncLevel)) &&
    (value.gcdTarget === undefined || isFiniteNumber(value.gcdTarget)) &&
    (value.gcdChoices === undefined || (Array.isArray(value.gcdChoices) && value.gcdChoices.every(isFiniteNumber))) &&
    (value.speedMin === undefined || isFiniteNumber(value.speedMin)) &&
    (value.speedMax === undefined || isFiniteNumber(value.speedMax)) &&
    (value.minTenacity === undefined || isFiniteNumber(value.minTenacity)) &&
    (value.toughnessMin === undefined || isFiniteNumber(value.toughnessMin)) &&
    (value.toughnessMinPercent === undefined || isFiniteNumber(value.toughnessMinPercent)) &&
    (value.objective === undefined || value.objective === "damage" || value.objective === "dps") &&
    (value.excludedGearIds === undefined || (Array.isArray(value.excludedGearIds) && value.excludedGearIds.every(isSafeInteger))) &&
    (value.sharedSlots === undefined || (Array.isArray(value.sharedSlots) && value.sharedSlots.every((slot) => typeof slot === "string" && GEAR_SLOT_IDS.has(slot as GearSlot)))) &&
    (value.maxSearchMs === undefined || isFiniteNumber(value.maxSearchMs))
  );
}

function supportsResultLevel(config: OptimizationConfig): boolean {
  const job = jobSchemas[config.jobId];
  const level = config.jobLevel ?? job.maxJobLevel ?? 100;
  try {
    // ResultPanel reapplies food using these base stats. Use the domain's own
    // supported-level check so a stale or damaged level cannot throw at render time.
    calculateBaseStats(job, level);
    return true;
  } catch {
    return false;
  }
}

function validateJointConfig(value: unknown): value is JointOptimizationConfig {
  if (!isObject(value)) return false;
  return (
    Array.isArray(value.jobs) && value.jobs.length >= 2 && value.jobs.every(validateOptimizationConfig) &&
    new Set(value.jobs.map((job) => (job as OptimizationConfig).jobId)).size === value.jobs.length &&
    Array.isArray(value.commonSlots) && value.commonSlots.every((item) => typeof item === "string" && COMMON_SLOT_IDS.has(item as CommonGearSlot)) &&
    (value.foodStrategy === "shared" || value.foodStrategy === "independent") &&
    (value.objective === undefined || value.objective === "damage" || value.objective === "dps") &&
    (value.maxSearchMs === undefined || isFiniteNumber(value.maxSearchMs)) &&
    (value.cacheLimit === undefined || isFiniteNumber(value.cacheLimit))
  );
}

function validateSingleResult(value: unknown): value is OptimizationResult {
  if (!isObject(value)) return false;
  const effects = value.effects;
  return (
    Array.isArray(value.gear) && value.gear.every(isMeldedGear) && isFood(value.food) && isStats(value.stats) && isObject(effects) &&
    EFFECT_FIELDS.every((field) => isFiniteNumber(effects[field])) &&
    isFiniteNumber(value.score) && (value.objective === "damage" || value.objective === "dps") &&
    isFiniteNumber(value.damagePerSecond) && isFiniteNumber(value.gcdTier) &&
    isFiniteNumber(value.searchedCandidates) && isFiniteNumber(value.durationMs) &&
    (value.maximumTenacity === undefined || isFiniteNumber(value.maximumTenacity)) &&
    (value.statistics === undefined || isObject(value.statistics))
  );
}

const JOINT_STATISTIC_FIELDS = [
  "elapsedMs", "timeLimitMs", "outerNodes", "completeNodes", "upperBoundPrunes",
  "relaxedOptimaAttained", "innerSolves", "parentResultReuses", "cacheHits", "cacheMisses",
  "cacheEntries", "cacheLimit",
] as const;

function isOptimizationMap(value: unknown, requiredJobs: readonly JobId[]): boolean {
  if (!isObject(value)) return false;
  const entries = Object.entries(value);
  return entries.length === requiredJobs.length && entries.every(([jobId, result]) => isJobId(jobId) && validateSingleResult(result)) &&
    requiredJobs.every((jobId) => Object.prototype.hasOwnProperty.call(value, jobId));
}

function isCommonGearMap(value: unknown): boolean {
  if (!isObject(value)) return false;
  return Object.entries(value).every(([slot, gear]) => {
    if (!COMMON_SLOT_IDS.has(slot as CommonGearSlot) || !Array.isArray(gear) || !gear.every(isMeldedGear)) return false;
    return slot === "rings" ? gear.length === 2 : gear.length === 1;
  });
}

function validateJointResult(value: unknown, config: JointOptimizationConfig): value is JointOptimizationResult {
  if (!isObject(value)) return false;
  const requiredJobs = config.jobs.map(({ jobId }) => jobId);
  const proof = value.proof;
  const statistics = value.statistics;
  return (
    isOptimizationMap(value.jobResults, requiredJobs) && isOptimizationMap(value.optima, requiredJobs) && isCommonGearMap(value.commonGear) &&
    (value.commonFood === undefined || isFood(value.commonFood)) &&
    (value.objective === "damage" || value.objective === "dps") && isObject(value.value) &&
    typeof value.value.numerator === "string" && typeof value.value.denominator === "string" &&
    isFiniteNumber(value.value.approximate) && isObject(proof) && proof.complete === true &&
    proof.objective === value.objective && typeof proof.optimalityScope === "string" &&
    typeof proof.outerBound === "string" &&
    (proof.innerSolverStatus === "Optimal" || proof.innerSolverStatus === "DualBound") &&
    proof.formalCertificate === false && typeof proof.numericalLimitation === "string" &&
    typeof proof.terminationReason === "string" && isObject(statistics) &&
    JOINT_STATISTIC_FIELDS.every((field) => isFiniteNumber(statistics[field])) &&
    (statistics.rssBytes === undefined || isFiniteNumber(statistics.rssBytes)) &&
    (statistics.heapUsedBytes === undefined || isFiniteNumber(statistics.heapUsedBytes))
  );
}

function validateRecord(value: unknown): SearchHistoryRecord {
  assert(isObject(value), "记录必须是对象。");
  assert(typeof value.id === "string" && value.id.length > 0, "缺少记录编号。");
  assert(value.kind === "single" || value.kind === "joint", "职业类型无效。");
  assert(isIsoDate(value.startedAtISO), "开始时间不是有效 ISO 日期。");
  assert(value.finishedAtISO === undefined || isIsoDate(value.finishedAtISO), "结束时间不是有效 ISO 日期。");
  assert(typeof value.dataVersion === "string" && value.dataVersion.length > 0, "缺少数据版本。");
  assert(
    value.status === "running" || value.status === "completed" || value.status === "cancelled" ||
      value.status === "no-result" || value.status === "failed" || value.status === "interrupted",
    "搜索状态无效。",
  );
  assert(value.status === "running" ? value.finishedAtISO === undefined : isIsoDate(value.finishedAtISO), "搜索结束时间与状态不匹配。");
  assert(value.error === undefined || typeof value.error === "string", "错误信息格式无效。");

  if (value.kind === "single") {
    assert(
      value.gcdMode === undefined || value.gcdMode === "any" || value.gcdMode === "tiers" || value.gcdMode === "speed",
      "GCD 约束模式无效。",
    );
    assert(validateOptimizationConfig(value.config), "单职业配置缺少必要字段或类型错误。");
    if (value.status === "completed") {
      assert(supportsResultLevel(value.config), "成功记录的职业等级不受当前数据支持。");
      assert(validateSingleResult(value.result), "单职业成功结果缺少必要字段或类型错误。");
    }
  } else {
    assert(validateJointConfig(value.config), "联合配置缺少必要字段或类型错误。");
    if (value.status === "completed") {
      assert(value.config.jobs.every(supportsResultLevel), "成功记录中有职业等级不受当前数据支持。");
      assert(validateJointResult(value.result, value.config), "联合成功结果缺少必要字段或类型错误。");
    }
  }
  if (value.status === "failed") assert(typeof value.error === "string" && value.error.length > 0, "失败记录缺少错误信息。");
  if (value.status !== "completed") assert(value.result === undefined, "非成功记录不能包含结果。");
  return value as unknown as SearchHistoryRecord;
}

/** Validates an IndexedDB record before exposing it to history consumers. */
export function validateSearchHistoryRecord(value: unknown): SearchHistoryRecord {
  return validateRecord(value);
}

function requestTransaction<T>(
  mode: IDBTransactionMode,
  makeRequest: (store: IDBObjectStore) => IDBRequest<T>,
  operation: string,
): Promise<T> {
  return openDatabase().then((database) => new Promise<T>((resolve, reject) => {
    let transaction: IDBTransaction;
    let request: IDBRequest<T>;
    let hasResult = false;
    let result: T;
    let settled = false;
    const fail = (cause: unknown) => {
      if (settled) return;
      settled = true;
      reject(storageError(operation, cause));
    };

    try {
      transaction = database.transaction(STORE_NAME, mode);
      request = makeRequest(transaction.objectStore(STORE_NAME));
    } catch (error) {
      fail(error);
      return;
    }
    request.onsuccess = () => {
      result = request.result;
      hasResult = true;
    };
    request.onerror = () => fail(request.error ?? new Error("本地数据库请求失败。"));
    transaction.onerror = () => fail(transaction.error ?? new Error("本地数据库事务失败。"));
    transaction.onabort = () => fail(transaction.error ?? new Error("本地数据库事务已中止。"));
    transaction.oncomplete = () => {
      if (settled) return;
      if (!hasResult) {
        fail(new Error("IndexedDB 事务完成但没有返回数据。"));
        return;
      }
      settled = true;
      resolve(result);
    };
  }));
}

function makeId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export async function createSearchHistory(input: CreateSearchHistoryInput): Promise<SearchHistoryRecord> {
  if (input.kind === "single") assert(validateOptimizationConfig(input.config), "单职业配置缺少必要字段或类型错误。");
  else assert(validateJointConfig(input.config), "联合配置缺少必要字段或类型错误。");
  assert(typeof input.dataVersion === "string" && input.dataVersion.length > 0, "缺少数据版本。");

  const record = validateRecord({
    id: makeId(),
    kind: input.kind,
    startedAtISO: new Date().toISOString(),
    dataVersion: input.dataVersion,
    config: input.config,
    ...(input.kind === "single" && input.gcdMode ? { gcdMode: input.gcdMode } : {}),
    status: "running",
  });
  await requestTransaction<IDBValidKey>(
    "readwrite",
    (store) => store.add(record),
    "创建",
  );
  return record;
}

export async function getSearchHistoryRecord(id: string): Promise<SearchHistoryRecord | undefined> {
  const value = await requestTransaction<unknown>(
    "readonly",
    (store) => store.get(id),
    "读取",
  );
  return value === undefined ? undefined : validateRecord(value);
}

export async function listSearchHistory(kind?: SearchHistoryKind): Promise<SearchHistoryRecord[]> {
  const values = await requestTransaction<unknown[]>(
    "readonly",
    (store) => store.getAll(),
    "读取",
  );
  return values
    .map(validateRecord)
    .filter((record) => kind === undefined || record.kind === kind)
    .sort((left, right) =>
      Date.parse(right.startedAtISO) - Date.parse(left.startedAtISO) || right.id.localeCompare(left.id),
    );
}

export async function updateSearchHistory(
  id: string,
  update: FinishSearchHistoryInput,
): Promise<SearchHistoryRecord> {
  const database = await openDatabase();
  return new Promise<SearchHistoryRecord>((resolve, reject) => {
    let transaction: IDBTransaction | undefined;
    let nextRecord: SearchHistoryRecord | undefined;
    let settled = false;
    const fail = (cause: unknown) => {
      if (settled) return;
      settled = true;
      reject(cause instanceof SearchHistoryStorageError ? cause : storageError("更新", cause));
      try {
        transaction?.abort();
      } catch {
        // The transaction may already be complete or aborted.
      }
    };

    try {
      const activeTransaction = database.transaction(STORE_NAME, "readwrite");
      transaction = activeTransaction;
      const store = activeTransaction.objectStore(STORE_NAME);
      const read = store.get(id);
      read.onerror = () => fail(read.error ?? new Error("本地数据库搜索记录读取失败。"));
      read.onsuccess = () => {
        try {
          if (read.result === undefined) {
            throw new SearchHistoryStorageError(`无法更新本地搜索记录：找不到记录 ${id}。`);
          }
          const existing = validateRecord(read.result);
          if (existing.status !== "running") {
            throw new SearchHistoryStorageError(`无法更新本地搜索记录：记录 ${id} 已经结束。`);
          }
          if (update.status === "completed") {
            const validResult = existing.kind === "single"
              ? validateSingleResult(update.result)
              : validateJointResult(update.result, existing.config);
            assert(validResult, "结果类型与职业类型不匹配或结果数据无效。");
          }
          if (update.status === "failed") assert(update.error.trim().length > 0, "失败记录缺少错误信息。");

          const next = {
            ...existing,
            status: update.status,
            finishedAtISO: new Date().toISOString(),
            result: update.status === "completed" ? update.result : undefined,
            error: update.status === "failed" || update.status === "interrupted" ? update.error : undefined,
          };
          nextRecord = validateRecord(next);
          const write = store.put(nextRecord);
          write.onerror = () => fail(write.error ?? new Error("本地数据库搜索记录写入失败。"));
        } catch (error) {
          fail(error);
        }
      };
      activeTransaction.onerror = () => fail(activeTransaction.error ?? new Error("本地数据库更新事务失败。"));
      activeTransaction.onabort = () => fail(activeTransaction.error ?? new Error("本地数据库更新事务已中止。"));
      activeTransaction.oncomplete = () => {
        if (settled) return;
        if (!nextRecord) {
          fail(new Error("本地数据库更新事务完成但没有保存记录。"));
          return;
        }
        settled = true;
        resolve(nextRecord);
      };
    } catch (error) {
      fail(error);
    }
  });
}

export const finishSearchHistory = updateSearchHistory;
