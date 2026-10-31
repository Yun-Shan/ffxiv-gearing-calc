import { useSyncExternalStore } from "react";
import {
  normalizeSearchStrategies,
  SEARCH_STRATEGY_IDS,
  type ResolvedSearchStrategies,
  type SearchStrategies,
  type SearchStrategyId,
  type SearchStrategyMode,
} from "@/domain/search/strategies";

const STORAGE_KEY = "ffxiv-gearing-calc:search-strategies:v1";
const DEFAULT_SETTINGS = normalizeSearchStrategies();

function readStorage(): string | null | undefined {
  try { return window.localStorage.getItem(STORAGE_KEY); }
  catch { return undefined; }
}

function readSettings(raw: string | null | undefined): ResolvedSearchStrategies {
  try {
    if (raw == null) return DEFAULT_SETTINGS;
    const stored: unknown = JSON.parse(raw);
    if (stored === null || typeof stored !== "object" || Array.isArray(stored)) return DEFAULT_SETTINGS;
    const value = stored as Record<string, unknown>;
    if (value.version !== 1) return DEFAULT_SETTINGS;
    return normalizeSearchStrategies(value.strategies);
  } catch {
    return DEFAULT_SETTINGS;
  }
}

let observedStorage = readStorage();
let settings = readSettings(observedStorage);
const listeners = new Set<() => void>();

function emitChange() {
  for (const listener of listeners) listener();
}

export function subscribeSearchStrategySettings(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1 && typeof window !== "undefined") {
    window.addEventListener("storage", onStorage);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== "undefined") {
      window.removeEventListener("storage", onStorage);
    }
  };
}

function onStorage(event: StorageEvent) {
  if (event.key !== STORAGE_KEY && event.key !== null) return;
  getSearchStrategySettings();
  emitChange();
}

export function getSearchStrategySettings(): ResolvedSearchStrategies {
  // The modal may be closed when another tab changes preferences. Refresh on
  // execution/open, while keeping a stable React snapshot for unchanged storage.
  const raw = readStorage();
  if (raw !== undefined && raw !== observedStorage) {
    observedStorage = raw;
    settings = readSettings(raw);
  }
  return settings;
}

export function useSearchStrategySettings(): ResolvedSearchStrategies {
  return useSyncExternalStore(subscribeSearchStrategySettings, getSearchStrategySettings, () => DEFAULT_SETTINGS);
}

export function setSearchStrategy(id: SearchStrategyId, mode: SearchStrategyMode): void {
  const next: SearchStrategies = { ...getSearchStrategySettings(), [id]: mode };
  settings = normalizeSearchStrategies(next);
  try {
    const raw = JSON.stringify({ version: 1, strategies: settings });
    window.localStorage.setItem(STORAGE_KEY, raw);
    observedStorage = raw;
  } catch {
    // Keep this tab's preference active when browser storage is unavailable.
  }
  emitChange();
}

export function resetSearchStrategies(): void {
  settings = normalizeSearchStrategies(Object.fromEntries(SEARCH_STRATEGY_IDS.map((id) => [id, "auto"])));
  try {
    const raw = JSON.stringify({ version: 1, strategies: settings });
    window.localStorage.setItem(STORAGE_KEY, raw);
    observedStorage = raw;
  } catch {
    // Defaults remain available for this tab even in restricted storage modes.
  }
  emitChange();
}
