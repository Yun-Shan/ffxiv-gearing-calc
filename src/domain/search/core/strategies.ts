/** Optional optimizations; proof obligations and the complete feasible domain are never switches. */
export const SEARCH_STRATEGY_IDS = [
  "candidateDominance",
  "factorReachability",
  "speedFoodProjection",
  "foodProductBound",
  "candidateUpperBound",
  "resourceSupports",
  "conditionalResourceSupports",
  "resourceBudgetCandidateBounds",
  "sharedStateSearch",
  "utilityEquivalence",
  "materiaFamilyProjection",
  "equalityQuotient",
  "jointRatioPairBounds",
  "jointSharedBounds",
  "jointFactorCuts",
  "ringSymmetry",
  "feasibleSeeds",
  "restrictedResultReuse",
] as const;

export type SearchStrategyId = typeof SEARCH_STRATEGY_IDS[number];
export type SearchStrategyMode = "auto" | "on" | "off";
export type SearchStrategies = Readonly<Partial<Record<SearchStrategyId, SearchStrategyMode>>>;
export type ResolvedSearchStrategies = Readonly<Record<SearchStrategyId, SearchStrategyMode>>;

const strategyIds = new Set<string>(SEARCH_STRATEGY_IDS);

/** Copy and freeze at execution boundaries so an ongoing search keeps its original policy. */
export function normalizeSearchStrategies(input?: unknown): ResolvedSearchStrategies {
  if (input !== undefined && (input === null || typeof input !== "object" || Array.isArray(input))) {
    throw new TypeError("搜索策略必须是 auto/on/off 配置对象");
  }
  const settings = Object.fromEntries(SEARCH_STRATEGY_IDS.map((id) => [id, "auto"])) as Record<SearchStrategyId, SearchStrategyMode>;
  for (const [id, mode] of Object.entries(input ?? {})) {
    if (!strategyIds.has(id)) throw new TypeError(`未知搜索策略：${id}`);
    if (mode !== "auto" && mode !== "on" && mode !== "off") {
      throw new TypeError(`搜索策略 ${id} 必须为 auto、on 或 off`);
    }
    settings[id as SearchStrategyId] = mode;
  }
  return Object.freeze(settings);
}

/** Call only after checking mathematical applicability; `on` overrides performance routing alone. */
export function strategyEnabled(settings: SearchStrategies | undefined, id: SearchStrategyId, automatic = true): boolean {
  const mode = settings?.[id] ?? "auto";
  return mode === "on" || (mode === "auto" && automatic);
}
