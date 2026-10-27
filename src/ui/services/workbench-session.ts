import { assertForcedGearValue, jobSchemas } from "@/domain";
import type { SingleDraft } from "@/ui/pages/single-workbench/state/useSingleController";
import type { JointWorkbenchDraft } from "@/ui/pages/joint-workbench/joint-workbench-types";
import type {
  JointWorkbenchResult,
  SingleWorkbenchResult,
} from "./workbench-result";
import { currentDataVersion } from "./app-config";
import { applicationBase } from "./application-base";
import {
  uiJointOptimizationConfigError,
  uiOptimizationConfigError,
} from "./search-config";
import { validateJointResultView, validateResultView } from "./search-history";
import type { HistoryReplacementLink } from "./search-history";

export type WorkbenchSession =
  | { mode: "single"; phase: "conditions"; draft: SingleDraft }
  | {
      mode: "single";
      phase: "result";
      value: SingleWorkbenchResult;
      historyLink?: HistoryReplacementLink;
    }
  | { mode: "joint"; phase: "conditions"; draft: JointWorkbenchDraft }
  | { mode: "joint"; phase: "result"; value: JointWorkbenchResult };

export interface WorkbenchSessionOptions {
  /** A getter can model browsers that deny access to the Storage property itself. */
  storage?: Storage | (() => Storage);
  baseUrl?: string;
  dataVersion?: string;
}

const INVALID = "工作台刷新记录已损坏，已返回职业选择。";
const INCOMPATIBLE = "工作台刷新记录与当前版本不兼容，已返回职业选择。";
const UNAVAILABLE = "无法使用工作台刷新恢复，刷新后将返回职业选择。";
const slots = new Set([
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
]);
const materiaStats = new Set(["CRT", "DET", "DHT", "SKS", "SPS", "TEN", "PIE"]);

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function shape(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  return object(value) && Object.keys(value).every((key) => keys.includes(key));
}
function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
function optionalNumber(value: unknown): boolean {
  return value === undefined || finite(value);
}
function job(value: unknown): value is keyof typeof jobSchemas {
  return typeof value === "string" && Object.hasOwn(jobSchemas, value);
}
function list(
  value: unknown,
  predicate: (entry: unknown) => boolean,
): value is unknown[] {
  return Array.isArray(value) && value.every(predicate);
}

/** JSON must not silently discard functions, runtime objects, sparse entries or nonfinite values. */
function serializable(value: unknown, ancestors = new Set<object>()): boolean {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    value === undefined
  )
    return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || ancestors.has(value)) return false;
  if (
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) !== Object.prototype &&
    Object.getPrototypeOf(value) !== null
  )
    return false;
  if (Reflect.ownKeys(value).some((key) => typeof key === "symbol"))
    return false;
  ancestors.add(value);
  const valid = Array.isArray(value)
    ? Object.keys(value).length === value.length && Array.from({ length: value.length }, (_, index) => index).every(
        (index) =>
          Object.hasOwn(value, index) &&
          value[index] !== undefined &&
          serializable(value[index], ancestors),
      )
    : Object.values(value).every((entry) => serializable(entry, ancestors));
  ancestors.delete(value);
  return valid;
}

function range(value: unknown): boolean {
  if (
    !shape(value, [
      "minItemLevel",
      "maxItemLevel",
      "clanIndex",
      "sync",
      "syncDuty",
    ]) ||
    !finite(value.minItemLevel) ||
    !finite(value.maxItemLevel) ||
    !finite(value.clanIndex) ||
    (value.syncDuty !== undefined && typeof value.syncDuty !== "string")
  )
    return false;
  return (
    value.sync === undefined ||
    (shape(value.sync, ["kind", "value"]) &&
      (value.sync.kind === "jobLevel" || value.sync.kind === "itemLevel") &&
      finite(value.sync.value))
  );
}
function gcd(value: unknown): boolean {
  if (!object(value)) return false;
  if (value.mode === "any") return shape(value, ["mode"]);
  if (value.mode === "tiers")
    return (
      shape(value, ["mode", "tiers", "multiple"]) &&
      list(value.tiers, finite) &&
      (value.multiple === undefined || typeof value.multiple === "boolean") &&
      (value.multiple !== false || value.tiers.length <= 1)
    );
  return (
    value.mode === "speed" &&
    shape(value, ["mode", "min", "max"]) &&
    optionalNumber(value.min) &&
    optionalNumber(value.max)
  );
}
function food(value: unknown): boolean {
  return (
    object(value) &&
    ((value.mode === "auto" && shape(value, ["mode"])) ||
      (value.mode === "specific" &&
        shape(value, ["mode", "foodId"]) &&
        finite(value.foodId)))
  );
}
function tank(value: unknown): boolean {
  if (!object(value)) return false;
  if (value.strategy === "any" || value.strategy === "maximize")
    return shape(value, ["strategy"]);
  if (value.strategy === "tenacity")
    return (
      shape(value, ["strategy", "minimumTenacity"]) &&
      optionalNumber(value.minimumTenacity)
    );
  return (
    value.strategy === "reduction" &&
    shape(value, ["strategy", "minimumDamageReductionPercent"]) &&
    optionalNumber(value.minimumDamageReductionPercent)
  );
}
function condition(value: unknown, withRange: boolean): boolean {
  return (
    shape(
      value,
      withRange ? ["range", "gcd", "food", "tank"] : ["gcd", "food", "tank"],
    ) &&
    (!withRange || range(value.range)) &&
    gcd(value.gcd) &&
    food(value.food) &&
    tank(value.tank)
  );
}
function forced(value: unknown): boolean {
  if (!object(value)) return false;
  return Object.entries(value).every(([slot, entry]) => {
    if (!slots.has(slot)) return false;
    try {
      assertForcedGearValue(entry);
    } catch {
      return false;
    }
    if (entry === undefined || typeof entry === "number") return true;
    if ("customStats" in entry)
      return Object.entries(entry.customStats).every(
        ([stat, amount]) => materiaStats.has(stat) && finite(amount),
      );
    return entry.melds.every(
      (meld) =>
        meld === null ||
        (shape(meld, ["stat", "value", "grade", "slotIndex"]) &&
          materiaStats.has(meld.stat as string) &&
          finite(meld.value) &&
          finite(meld.grade) &&
          (meld.slotIndex === undefined ||
            (Number.isSafeInteger(meld.slotIndex) &&
              Number(meld.slotIndex) >= 0 &&
              Number(meld.slotIndex) < 5))),
    );
  });
}
function equipment(value: unknown, withSources: boolean): boolean {
  return (
    shape(
      value,
      withSources
        ? ["excludedSources", "excludedGearIds", "forcedGear"]
        : ["excludedGearIds", "forcedGear"],
    ) &&
    (!withSources ||
      list(value.excludedSources, (entry) => typeof entry === "string")) &&
    list(value.excludedGearIds, finite) &&
    forced(value.forcedGear)
  );
}
function singleDraft(value: unknown): boolean {
  return (
    shape(value, ["jobId", "condition", "equipment"]) &&
    job(value.jobId) &&
    condition(value.condition, true) &&
    equipment(value.equipment, true)
  );
}
function jointDraft(value: unknown): boolean {
  if (
    !shape(value, ["jobs", "conditions", "shared"]) ||
    !list(value.jobs, job) ||
    value.jobs.length === 0 ||
    new Set(value.jobs).size !== value.jobs.length ||
    !object(value.conditions) ||
    Object.keys(value.conditions).length !== value.jobs.length ||
    !value.jobs.every(
      (jobId) =>
        Object.hasOwn(value.conditions as object, jobId as string) &&
        condition(
          (value.conditions as Record<string, unknown>)[jobId as string],
          false,
        ),
    )
  )
    return false;
  const jobs = value.jobs;
  const shared = value.shared;
  if (
    !shape(shared, ["range", "foodStrategy", "food", "equipment"]) ||
    !range(shared.range) ||
    (shared.foodStrategy !== "shared" &&
      shared.foodStrategy !== "independent") ||
    !food(shared.food)
  )
    return false;
  const restrictions = shared.equipment;
  return (
    shape(restrictions, ["commonSlots", "shared", "jobs"]) &&
    list(
      restrictions.commonSlots,
      (entry) => typeof entry === "string" && slots.has(entry),
    ) &&
    equipment(restrictions.shared, true) &&
    object(restrictions.jobs) &&
    Object.entries(restrictions.jobs).every(
      ([jobId, entry]) => jobs.includes(jobId) && equipment(entry, false),
    )
  );
}
function historyLink(value: unknown): boolean {
  if (
    !shape(value, [
      "id",
      "startedAtISO",
      "dataVersion",
      "configSignature",
      "resultSignature",
    ]) ||
    typeof value.id !== "string" ||
    !value.id ||
    typeof value.startedAtISO !== "string" ||
    (value.dataVersion !== undefined &&
      typeof value.dataVersion !== "string") ||
    typeof value.configSignature !== "string" ||
    !value.configSignature ||
    typeof value.resultSignature !== "string" ||
    !value.resultSignature
  )
    return false;
  const date = new Date(value.startedAtISO);
  return (
    Number.isFinite(date.getTime()) && date.toISOString() === value.startedAtISO
  );
}
function result(value: unknown, mode: "single" | "joint"): boolean {
  if (
    !shape(value, ["mode", "config", "result", "dataVersion"]) ||
    value.mode !== mode ||
    typeof value.dataVersion !== "string"
  )
    return false;
  if (mode === "single")
    return (
      uiOptimizationConfigError(value.config) === undefined &&
      validateResultView(value.result) &&
      finite(value.result.statistics.elapsedMs)
    );
  return (
    uiJointOptimizationConfigError(value.config) === undefined &&
    validateJointResultView(
      value.result,
      (value.config as JointWorkbenchResult["config"]).jobs.map(
        ({ jobId }) => jobId,
      ),
    )
  );
}

export function sessionError(value: unknown): string | undefined {
  try {
    if (
      !serializable(value) ||
      !object(value) ||
      (value.mode !== "single" && value.mode !== "joint")
    )
      return INVALID;
    if (value.phase === "conditions")
      return shape(value, ["mode", "phase", "draft"]) &&
        (value.mode === "single"
          ? singleDraft(value.draft)
          : jointDraft(value.draft))
        ? undefined
        : INVALID;
    if (
      value.phase !== "result" ||
      !shape(
        value,
        value.mode === "single"
          ? ["mode", "phase", "value", "historyLink"]
          : ["mode", "phase", "value"],
      ) ||
      !result(value.value, value.mode) ||
      (value.historyLink !== undefined && !historyLink(value.historyLink))
    )
      return INVALID;
    return undefined;
  } catch {
    return INVALID;
  }
}

function key(options: WorkbenchSessionOptions): string {
  return `ffxiv-gearing-calc:workbench-session:${options.baseUrl ?? applicationBase()}`;
}
function storage(options: WorkbenchSessionOptions): Storage {
  return typeof options.storage === "function"
    ? options.storage()
    : (options.storage ?? window.sessionStorage);
}
export function clearWorkbenchSession(
  options: WorkbenchSessionOptions = {},
): void {
  try {
    storage(options).removeItem(key(options));
  } catch {
    /* Storage may be blocked. */
  }
}

/** Refresh eligibility belongs to document initialization; reading never consumes a snapshot. */
export function readWorkbenchSession(options: WorkbenchSessionOptions = {}): {
  session?: WorkbenchSession;
  warning?: string;
} {
  let raw: string | null;
  try {
    raw = storage(options).getItem(key(options));
  } catch {
    return { warning: UNAVAILABLE };
  }
  if (raw === null) return {};
  try {
    const record: unknown = JSON.parse(raw);
    if (
      !shape(record, ["schemaVersion", "currentDataVersion", "mode", "payload"])
    )
      throw new Error(INVALID);
    if (
      record.schemaVersion !== 1 ||
      record.currentDataVersion !== (options.dataVersion ?? currentDataVersion)
    )
      throw new Error(INCOMPATIBLE);
    if (
      sessionError(record.payload) ||
      !object(record.payload) ||
      record.payload.mode !== record.mode
    )
      throw new Error(INVALID);
    return { session: record.payload as WorkbenchSession };
  } catch (error) {
    clearWorkbenchSession(options);
    return {
      warning:
        error instanceof Error && error.message === INCOMPATIBLE
          ? INCOMPATIBLE
          : INVALID,
    };
  }
}

export function writeWorkbenchSession(
  session: WorkbenchSession,
  options: WorkbenchSessionOptions = {},
): string | undefined {
  try {
    const error = sessionError(session);
    if (error) throw new Error(error);
    storage(options).setItem(
      key(options),
      JSON.stringify({
        schemaVersion: 1,
        currentDataVersion: options.dataVersion ?? currentDataVersion,
        mode: session.mode,
        payload: session,
      }),
    );
    return undefined;
  } catch {
    // A stale successful snapshot must not masquerade as the latest committed state.
    clearWorkbenchSession(options);
    return UNAVAILABLE;
  }
}
