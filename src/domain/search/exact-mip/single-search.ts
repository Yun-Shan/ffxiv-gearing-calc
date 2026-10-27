import { prepareSignatureFeasibility } from "./signature-feasibility.ts";
import type { ExactMipOptions } from "./types.ts";
import type { ExactMipResult } from "./types.ts";
import { throwIfCancelled } from "../cancellation.ts";
import { inheritCanonicalEvaluatorCandidateUpperBound } from "../exact-mip-candidate-upper-bound.ts";
import { prepareFoodProductBound } from "./food-product-bound.ts";
import { hasCanonicalEvaluatorCandidateUpperBound } from "../exact-mip-candidate-upper-bound.ts";
import { shouldEnableCanonicalCandidateUpperBound } from "../exact-mip-candidate-upper-bound.ts";
import { isProfileTimingEnabled } from "../core/diagnostics.ts";
import type { GreedyMipStart } from "./initial-solution.ts";
import type { ExactMipSearchStatistics } from "./types.ts";
import type { CandidateUpperBoundResult } from "./candidate-bounds.ts";
import type { EquipInfo } from "../types.ts";
import { prepareExactMipModel } from "./model-preparation.ts";
import { buildLinearAttributeModel } from "./attribute-model.ts";
import { greedyMipStart } from "./initial-solution.ts";
import { pruneCandidatesByIncumbentUpperBound } from "./candidate-bounds.ts";
import { createIntegerDamageFactorEvaluator } from "../equipped-effects.ts";
import { sparseMipStart } from "./initial-solution.ts";
import { prepareResourceBudgetCandidateBounds } from "./candidate-bounds.ts";
import { completeFeasibleMipStart } from "./initial-solution.ts";
import type { LoadoutSearchResult } from "../search-types.ts";
import type { IntegerDamageFactors } from "../equipped-effects.ts";
import type { LinearMipSolution } from "../linear-mip.ts";
import { factorObjectiveLogScore } from "./factor-model.ts";
import { candidateUpperBoundCannotImproveIncumbent } from "../exact-mip-candidate-upper-bound.ts";
import { addRows } from "../core/model-builder.ts";
import { solveIntegerModel } from "../core/highs-solver.ts";
import { prepareMateriaFamilies, materiaModelFamilies } from "./materia-families.ts";
import type { MateriaFamilyProjectionStatistics } from "../core/materia-family-projection.ts";
import { validateMipSolution } from "../core/solution-validation.ts";
import { addRangeConstraint } from "./attribute-model.ts";
import { addTerm } from "../core/model-builder.ts";
import { SURROGATE_OBJECTIVE_SCALE } from "./model-preparation.ts";
import { hasStrictlyBetterFactorCombination } from "../signature-band.ts";
import type { FactorClass } from "./types.ts";
import { slotsForResultWithResistanceAllocations } from "./result-decoding.ts";
import { foodForResult } from "./result-decoding.ts";
import { getAttributeVector } from "./attributes.ts";
import { betterFactors } from "./factor-model.ts";
import { getMemoryUsageSnapshot } from "../memory-usage.ts";
import { assertClanIndex } from "../../clans.ts";

export async function findBestLoadoutExactMip(
  options: ExactMipOptions,
): Promise<ExactMipResult | undefined> {
  const startedAt = performance.now();
  throwIfCancelled(options.isCancelled);
  assertClanIndex(options.clanIndex);
  if (options.objective !== "damage" && options.objective !== "dps")
    throw new TypeError("搜索目标必须为 damage 或 dps");
  const maxSearchMs = options.maxSearchMs;
  if (maxSearchMs !== undefined && (!Number.isFinite(maxSearchMs) || maxSearchMs <= 0)) {
    throw new RangeError("maxSearchMs 必须是正有限值");
  }
  const searchDeadline = maxSearchMs === undefined ? Number.POSITIVE_INFINITY : startedAt + maxSearchMs;
  const preparationBudgetBaseMs = maxSearchMs ?? 110_000;
  const timeLimitReached = () =>
    maxSearchMs !== undefined && performance.now() - startedAt >= maxSearchMs;
  const modelPreparationStartedAt = performance.now();
  const candidateUpperBoundCandidateCount = options.slots.reduce((total, slot) => total + slot.length, 0);
  const canonicalCandidateUpperBoundTrusted = hasCanonicalEvaluatorCandidateUpperBound(options);
  const candidateUpperBoundEnabled = shouldEnableCanonicalCandidateUpperBound(
    options,
    canonicalCandidateUpperBoundTrusted,
  );
  const primaryResourceSupportsEnabled = candidateUpperBoundEnabled;
  if (isProfileTimingEnabled() && options.onSolverProgress !== undefined) {
    options.onSolverProgress({
      backend: "HiGHS",
      model: `${options.job}:candidate_upper_bound_gate`,
      kind: "log",
      message: `PROFILE ${JSON.stringify({
        phase: "candidate-upper-bound-gate",
        job: options.job,
        candidateCount: candidateUpperBoundCandidateCount,
        trustedCanonicalEvaluator: canonicalCandidateUpperBoundTrusted,
        enabled: candidateUpperBoundEnabled,
        resourceBudgetCandidateProfile: options.resourceBudgetCandidateProfile ?? "default",
      })}`,
    });
  }
  let modelOptions = options;
  let initialMipStart: GreedyMipStart | undefined;
  let candidateUpperBound: ExactMipSearchStatistics["candidateUpperBound"];
  let candidateUpperFactorsBySlot: CandidateUpperBoundResult["candidateUpperFactorsBySlot"] | undefined;
  const incumbentCandidateUpperBoundCuts = new Set<string>();
  const resourceBudgetCandidateUpperBoundCuts = new Set<string>();
  let resourceBudgetCandidateScoreUpperBySlot: readonly ReadonlyMap<EquipInfo, bigint>[] | undefined;
  let resourceBudgetCandidateBound: ExactMipSearchStatistics["resourceBudgetCandidateBound"];
  let foodProductBound: ExactMipSearchStatistics["foodProductBound"];
  let greedyMipStartMs = 0;
  let modelPreparationMs = 0;
  let prepared: Awaited<ReturnType<typeof prepareExactMipModel>> | undefined;
  if (candidateUpperBoundEnabled) {
    let initialModel = buildLinearAttributeModel(options);
    if (initialModel === undefined) return undefined;
    const initialBuildMs = performance.now() - modelPreparationStartedAt;
    const greedyStartedAt = performance.now();
    const candidateUseDps = options.objective === "dps";
    const candidateGreedyStart = greedyMipStart(
      options,
      initialModel,
      candidateUseDps,
      Math.min(searchDeadline, performance.now() + 1_000),
      () => options.isCancelled?.() === true || timeLimitReached(),
    );
    greedyMipStartMs = performance.now() - greedyStartedAt;
    let candidateBoundMs = 0;
    const remainingAfterGreedyMs = searchDeadline - performance.now();
    if (candidateGreedyStart !== undefined && remainingAfterGreedyMs > 1_000) {
      const candidateBoundStartedAt = performance.now();
      const boundDeadline = Math.min(
        searchDeadline,
        performance.now() + Math.min(10_000, remainingAfterGreedyMs - 1_000),
      );
      let pruning: CandidateUpperBoundResult | undefined;
      try {
        pruning = pruneCandidatesByIncumbentUpperBound(
          options,
          initialModel,
          createIntegerDamageFactorEvaluator(options.job, options.jobLevel, options.statIndexes, options.clanIndex),
          candidateUseDps,
          candidateGreedyStart,
          boundDeadline,
          () => options.isCancelled?.() === true,
        );
      } catch {
        // 上界不确定只会错过一次优化；原始模型仍会证明结果。
      }
      candidateBoundMs = performance.now() - candidateBoundStartedAt;
      if (pruning !== undefined) {
        candidateUpperFactorsBySlot = pruning.candidateUpperFactorsBySlot;
        candidateUpperBound = {
          candidatesBefore: pruning.candidatesBefore,
          candidatesAfter: pruning.candidatesAfter,
          elapsedMs: pruning.elapsedMs,
        };
        if (pruning.candidatesAfter < pruning.candidatesBefore) {
          modelOptions = { ...options, slots: pruning.slots };
          initialModel = undefined;
        }
      }
    }
    const fullPreparationStartedAt = performance.now();
    prepared = await prepareExactMipModel(
      modelOptions,
      // 在较宽的规范基线中保留更强的主属性和加权资源支撑约束。
      primaryResourceSupportsEnabled,
      modelOptions === options ? initialModel : undefined,
    );
    const fullPreparationMs = performance.now() - fullPreparationStartedAt;
    modelPreparationMs = initialBuildMs + candidateBoundMs + fullPreparationMs;
    if (prepared !== undefined && modelOptions !== options && candidateGreedyStart !== undefined) {
      const hint = sparseMipStart(
        modelOptions.slots,
        modelOptions.foods,
        prepared.model.slotVariables,
        prepared.model.foodVariables,
        candidateGreedyStart.selection,
        candidateGreedyStart.food,
      );
      initialMipStart = hint === undefined
        ? undefined
        : { ...candidateGreedyStart, hint };
    } else {
      initialMipStart = candidateGreedyStart;
    }
  } else {
    const ordinaryPreparationStartedAt = performance.now();
    prepared = await prepareExactMipModel(
      options,
      primaryResourceSupportsEnabled,
    );
    modelPreparationMs = performance.now() - ordinaryPreparationStartedAt;
  }
  throwIfCancelled(options.isCancelled);
  if (prepared === undefined) return undefined;
  const { model, groups, factorEvaluator, useDps, qByVariable,
    mainAttribute, weaponAttribute, detAttribute, tenAttribute, crtAttribute, dhtAttribute, speedAttribute } = prepared;
  if (candidateUpperBoundEnabled && candidateUpperFactorsBySlot !== undefined && options.job !== "BLU" &&
      options.resourceBudgetCandidateProfile !== "disabled") {
    const remainingAfterModelMs = searchDeadline - performance.now() - 1_000;
    if (remainingAfterModelMs > 0) {
      const resourceBudgetStartedAt = performance.now();
      const resourceBudgetDeadline = Math.min(
        searchDeadline - 1_000,
        performance.now() + Math.min(250, Math.max(1, preparationBudgetBaseMs * 0.02)),
      );
      const resourceBudgetBounds = prepareResourceBudgetCandidateBounds(
        { ...modelOptions, slots: modelOptions.slots },
        model,
        groups,
        new Map([
          ["main", mainAttribute], ["weapon", weaponAttribute], ["det", detAttribute],
          ["ten", tenAttribute], ["crt", crtAttribute], ["dht", dhtAttribute], ["gcd", speedAttribute],
        ]),
        resourceBudgetDeadline,
        () => options.isCancelled?.() === true,
      );
      const elapsedMs = performance.now() - resourceBudgetStartedAt;
      modelPreparationMs += elapsedMs;
      if (resourceBudgetBounds !== undefined) {
        resourceBudgetCandidateScoreUpperBySlot = resourceBudgetBounds.bySlot;
        resourceBudgetCandidateBound = {
          candidates: resourceBudgetBounds.candidateCount,
          supportCount: resourceBudgetBounds.supportCount,
          preparationMs: resourceBudgetBounds.elapsedMs,
        };
        if (isProfileTimingEnabled() && options.onSolverProgress !== undefined) {
          options.onSolverProgress({
            backend: "HiGHS",
            model: `${options.job}:resource_budget_candidate_bound`,
            kind: "log",
            message: `PROFILE ${JSON.stringify({
              phase: "resource-budget-candidate-upper-bound",
              job: options.job,
              profile: options.resourceBudgetCandidateProfile ?? "default",
              candidates: resourceBudgetBounds.candidateCount,
              supportCount: resourceBudgetBounds.supportCount,
              preparationMs: resourceBudgetBounds.elapsedMs,
            })}`,
          });
        }
      }
    }
  }
  if (!candidateUpperBoundEnabled) {
    const greedyMipStartStartedAt = performance.now();
    initialMipStart = greedyMipStart(options, model, useDps,
      Math.min(searchDeadline, performance.now() + 100),
      () => options.isCancelled?.() === true || timeLimitReached());
    greedyMipStartMs = performance.now() - greedyMipStartStartedAt;
  }
  if (initialMipStart !== undefined) {
    const completeHint = completeFeasibleMipStart(
      modelOptions,
      model,
      groups,
      factorEvaluator,
      initialMipStart,
      {
        main: mainAttribute,
        det: detAttribute,
        ten: tenAttribute,
        crt: crtAttribute,
        dht: dhtAttribute,
        gcd: speedAttribute,
      },
    );
    initialMipStart = { ...initialMipStart, hint: completeHint };
  }
  const foodBound = prepareFoodProductBound(
    inheritCanonicalEvaluatorCandidateUpperBound(options, modelOptions), prepared, initialMipStart,
    { deadline: Math.min(searchDeadline, performance.now() + 500) },
  );
  foodProductBound = foodBound.statistics;
  modelPreparationMs += foodBound.statistics.elapsedMs;
  if (foodBound.rows.length > 0) model.rows.push(...foodBound.rows);
  if (isProfileTimingEnabled() && options.onSolverProgress !== undefined) {
    options.onSolverProgress({
      backend: "HiGHS", model: `${options.job}:food_product_bound`, kind: "log",
      message: `PROFILE ${JSON.stringify({ phase: "food-product-bound", job: options.job, ...foodProductBound })}`,
    });
  }
  const materiaPreparation = prepareMateriaFamilies(modelOptions);
  modelPreparationMs += materiaPreparation.elapsedMs;
  const materiaFamilies = materiaModelFamilies(materiaPreparation, model);
  const materiaStatistics: NonNullable<ExactMipSearchStatistics["materiaFamilies"]> = {
    preparedFamilies: materiaFamilies.length, preparationPoints: materiaPreparation.points,
    rejectedGroups: materiaPreparation.rejectedGroups, preparationMs: materiaPreparation.elapsedMs, solveRequests: 0, requests: [],
  };
  if (isProfileTimingEnabled() && options.onSolverProgress !== undefined) options.onSolverProgress({
    backend: "HiGHS", model: `${options.job}:materia_families`, kind: "log",
    message: `PROFILE ${JSON.stringify({ phase: "materia-family-preparation", job: options.job,
      families: materiaFamilies.length, points: materiaPreparation.points, rejectedGroups: materiaPreparation.rejectedGroups,
      elapsedMs: materiaPreparation.elapsedMs, skipReason: materiaPreparation.skipReason })}`,
  });
  const initialStart = initialMipStart?.hint;
  const { signatureBandGroups, isPossiblyFeasibleFactorTuple } =
    prepareSignatureFeasibility(options, prepared);
  const excludedSignatures: string[][] = [];
  const toughnessIndex = options.toughnessAttributeId === undefined
    ? undefined
    : model.idToIndex.get(options.toughnessAttributeId);
  if (options.constraints?.maxToughnessMode === true && toughnessIndex === undefined) {
    throw new RangeError("最高坚韧模式需要配置坚韧属性 id");
  }
  throwIfCancelled(options.isCancelled);
  let solverRuns = 0;
  let solverWallMs = 0;
  let maximumSurrogate = Number.NEGATIVE_INFINITY;
  let nextSurrogate: number | undefined;
  let best: { result: LoadoutSearchResult; factors: IntegerDamageFactors; toughness?: number } | undefined;
  let maximumToughness: number | undefined;
  const solverName = "HiGHS";
  const solveModel = async (
    objective: Map<string, number>,
    phaseName: string,
    minimumSurrogate?: number,
  ): Promise<LinearMipSolution> => {
    throwIfCancelled(options.isCancelled);
    const remainingMs = maxSearchMs === undefined
      ? undefined
      : maxSearchMs - (performance.now() - startedAt);
    if (remainingMs !== undefined && remainingMs <= 0) {
      throw new Error("精确 MIP 搜索达到时限，未完成最优性证明");
    }
    const rows = [...model.rows];
    const strictImprovementCandidateVariables = new Set<string>();
    if (phaseName === "exact_damage_band_feasibility" && best !== undefined &&
        options.job !== "BLU" && candidateUpperFactorsBySlot !== undefined) {
      const incumbentLogScore = BigInt(factorObjectiveLogScore(best.factors, useDps));
      const roundingSlack = BigInt(groups.length);
      for (let slotIndex = 0; slotIndex < modelOptions.slots.length; slotIndex++) {
        const candidates = modelOptions.slots[slotIndex]!;
        const candidateBounds = candidateUpperFactorsBySlot[slotIndex];
        const resourceCandidateBounds = resourceBudgetCandidateScoreUpperBySlot?.[slotIndex];
        const variables = model.slotVariables[slotIndex]!;
        if (candidateBounds === undefined || candidates.length !== variables.length) continue;
        for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex++) {
          const candidate = candidates[candidateIndex]!;
          const upperFactors = candidateBounds.get(candidate);
          const independentBoundProvesNoImprovement = upperFactors !== undefined &&
            candidateUpperBoundCannotImproveIncumbent(best.factors, upperFactors, useDps);
          const resourceScoreUpper = resourceCandidateBounds?.get(candidate);
          const resourceBoundProvesNoImprovement = resourceScoreUpper !== undefined &&
            resourceScoreUpper + roundingSlack < incumbentLogScore;
          if (!independentBoundProvesNoImprovement && !resourceBoundProvesNoImprovement) continue;
          strictImprovementCandidateVariables.add(variables[candidateIndex]!);
          if (resourceBoundProvesNoImprovement) {
            resourceBudgetCandidateUpperBoundCuts.add(variables[candidateIndex]!);
          }
        }
      }
      for (const variable of strictImprovementCandidateVariables) {
        incumbentCandidateUpperBoundCuts.add(variable);
      }
    }
    const solveBounds = strictImprovementCandidateVariables.size === 0
      ? model.bounds
      : model.bounds.map((bound) => strictImprovementCandidateVariables.has(bound.name)
        ? { ...bound, max: 0 }
        : bound);
    if (minimumSurrogate !== undefined) {
      const maximumOffset = groups.reduce((total, group) =>
        total + Math.max(...group.classes.map((factorClass) => factorClass.q)), 0);
      addRows(
        rows,
        "surrogate_band_cutoff",
        qByVariable,
        ">=",
        minimumSurrogate - maximumOffset,
      );
    }
    excludedSignatures.forEach((signature, index) => {
      addRows(rows, `nogood_${index}`, signature.map((variable) => [variable, 1] as const), "<=", signature.length - 1);
    });
    throwIfCancelled(options.isCancelled);
    const solverCallStartedAt = performance.now();
    let materiaRequestStatistics: MateriaFamilyProjectionStatistics | undefined;
    const output = await solveIntegerModel({
      name: phaseName,
      objective,
      rows,
      variables: solveBounds,
      binaryVariables: model.binaryVars,
      integerVariables: model.generalVars,
      ...(materiaFamilies.length === 0 ? {} : { materiaFamilies,
        onMateriaFamilyProjection: (statistics: MateriaFamilyProjectionStatistics) => { materiaRequestStatistics = statistics; } }),
      isCancelled: options.isCancelled,
      timeLimitMs: remainingMs,
      ...(initialStart === undefined || excludedSignatures.length > 0
        ? {}
        : { solutionHint: initialStart }),
      ...(options.onSolverProgress === undefined
        ? {}
        : { onProgress: options.onSolverProgress }),
      ...(options.onSolverCallback === undefined ? {} : { onCallback: options.onSolverCallback }),
    });
    materiaStatistics.solveRequests++;
    if (materiaRequestStatistics !== undefined && materiaStatistics.requests.length < 64) materiaStatistics.requests.push(materiaRequestStatistics);
    solverWallMs += performance.now() - solverCallStartedAt;
    throwIfCancelled(options.isCancelled);
    solverRuns++;
    throwIfCancelled(options.isCancelled);
    if (output.Status === "Optimal") validateMipSolution(rows, solveBounds, output.Columns);
    options.onProgress?.(`${solverName} ${phaseName} 状态=${output.Status}；目标=${output.ObjectiveValue}`);
    return output;
  };
  const setRange = (variable: string, minimum?: number, maximum?: number) => {
    addRangeConstraint(model.rows, `max_ten_${model.rows.length}`, variable, minimum, maximum);
  };

  if (options.constraints?.maxToughnessMode === true) {
    const tenVariable = model.finalVariables[toughnessIndex!]!;
    const phaseOne = await solveModel(new Map([[tenVariable, 1]]), "maximum_tenacity");
    if (phaseOne.Status === "Infeasible") return undefined;
    if (phaseOne.Status !== "Optimal") throw new Error(`最高坚韧阶段未证明最优：${phaseOne.Status}`);
    const maximumTenacity = phaseOne.Columns[tenVariable]?.Primal;
    if (!Number.isSafeInteger(maximumTenacity)) throw new Error("最高坚韧阶段返回了非整数解");
    maximumToughness = maximumTenacity;
    setRange(tenVariable, maximumTenacity, maximumTenacity);
  }

  const objective = new Map<string, number>();
  // q 是整数；采用二进制缩放可保持系数精确，并使目标步长为 1/65,536，
  // 其精度超过 HiGHS 默认 1e-6 MIP 容差的 15 倍。
  for (const [variable, coefficient] of qByVariable) {
    addTerm(objective, variable, coefficient / SURROGATE_OBJECTIVE_SCALE);
  }
  let firstSurrogate: number | undefined;
  let signatureBandChecks = 0;
  let signatureBandElapsedMs = 0;
  let signatureBandProof = false;
  let lastSignatureBandIncumbent: string | undefined;
  let lastSignatureBandMayContainBetter = true;
  // 得分是七个取整对数因子的总和，取整误差不超过因子数量。
  // 因此，签名得分若低于代理最优值超过此误差带，就不可能在精确因子比较中胜出。
  const errorBand = groups.length;
  while (true) {
    throwIfCancelled(options.isCancelled);
    if (firstSurrogate !== undefined && best !== undefined) {
      const incumbentKey = [
        best.factors.weaponDamage,
        best.factors.mainStat,
        best.factors.determination,
        best.factors.tenacity,
        best.factors.critical,
        best.factors.directHit,
        best.factors.gcdCentiseconds,
      ].join(":");
      if (incumbentKey !== lastSignatureBandIncumbent) {
        signatureBandChecks++;
        const bandStartedAt = performance.now();
        lastSignatureBandMayContainBetter = hasStrictlyBetterFactorCombination({
          groups: signatureBandGroups,
          objective: useDps ? "dps" : "damage",
          incumbent: best.factors,
          qMinimum: firstSurrogate - errorBand,
          qMaximum: firstSurrogate,
          deadline: timeLimitReached,
          isPossiblyFeasible: isPossiblyFeasibleFactorTuple,
        });
        signatureBandElapsedMs += performance.now() - bandStartedAt;
        lastSignatureBandIncumbent = incumbentKey;
      }
      if (timeLimitReached()) {
        throw new Error("精确 MIP 搜索达到时限，未完成最优性证明");
      }
      if (!lastSignatureBandMayContainBetter) {
        signatureBandProof = true;
        options.onProgress?.("签名带 BigInt 组合上界证明无更优伤害因子，跳过完整 MIP 带宽可行性求解");
        break;
      }
    }
    const output = firstSurrogate === undefined
      ? await solveModel(objective, "exact_damage_initial")
      : await solveModel(new Map(), "exact_damage_band_feasibility", firstSurrogate - errorBand);
    if (output.Status === "Infeasible") {
      if (best === undefined) {
        return undefined;
      }
      break;
    }
    if (output.Status !== "Optimal") throw new Error(`精确 MIP 搜索未证明最优：${output.Status}`);
    const selectedSignature: string[] = [];
    const selectedFactors: Partial<Record<keyof IntegerDamageFactors, number>> = {};
    let surrogate = 0;
    for (const group of groups) {
      let chosen: FactorClass | undefined;
      for (const factorClass of group.classes) {
        if ((output.Columns[factorClass.variable]?.Primal ?? 0) > 0.5) {
          chosen = factorClass;
          selectedSignature.push(factorClass.variable);
          break;
        }
      }
      if (chosen === undefined) throw new Error(`MIP 解缺少因子组 ${group.name}`);
      if (group.name === "weapon") selectedFactors.weaponDamage = chosen.value;
      if (group.name === "main") selectedFactors.mainStat = chosen.value;
      if (group.name === "det") selectedFactors.determination = chosen.value;
      if (group.name === "ten") selectedFactors.tenacity = chosen.value;
      if (group.name === "crt") selectedFactors.critical = chosen.value;
      if (group.name === "dht") selectedFactors.directHit = chosen.value;
      if (group.name === "gcd") selectedFactors.gcdCentiseconds = chosen.value;
      surrogate += chosen.q;
    }
    const selection = slotsForResultWithResistanceAllocations(
      modelOptions.slots,
      model.slotVariables,
      model.resistanceAllocationVariables,
      output.Columns,
    );
    const food = foodForResult(options.foods, model.foodVariables, output.Columns);
    const attributes = getAttributeVector(selection, food, options.attributeIds, options.equipmentAttributeExtractor, options.statIndexes);
    const rawAttributes = new Array<number>(options.attributeIds.length).fill(0);
    const attributeIndexes = new Map(options.attributeIds.map((id, index) => [id, index]));
    for (const equipment of selection) {
      const params = options.equipmentAttributeExtractor?.(equipment) ?? equipment.baseParams;
      for (const param of params) {
        const index = attributeIndexes.get(param.baseParamId);
        if (index !== undefined) rawAttributes[index] += param.value;
      }
      for (const allocation of equipment.resistanceAllocation ?? []) {
        const index = attributeIndexes.get(allocation.baseParamId);
        if (index !== undefined) rawAttributes[index] += allocation.value;
      }
    }
    for (let index = 0; index < options.attributeIds.length; index++) {
      const expectedRaw = rawAttributes[index]!;
      const expectedFinal = attributes[index]!;
      const mipRaw = Math.round(output.Columns[model.rawVariables[index]!]?.Primal ?? 0);
      const mipFinal = Math.round(output.Columns[model.finalVariables[index]!]?.Primal ?? 0);
      if (mipRaw !== expectedRaw || mipFinal !== expectedFinal) {
        throw new Error(
          `MIP 属性重建不一致：属性 ${options.attributeIds[index]}，装备=${mipRaw}/${expectedRaw}，含食物=${mipFinal}/${expectedFinal}`,
        );
      }
      const range = model.ranges.get(index);
      if (range !== undefined &&
          ((range.min !== undefined && expectedFinal < range.min) ||
           (range.max !== undefined && expectedFinal > range.max))) {
        throw new Error(`MIP 返回属性 ${options.attributeIds[index]}=${expectedFinal}，不满足约束范围`);
      }
    }
    const factors = factorEvaluator(attributes);
    if (factors === undefined) throw new Error("精确 MIP 返回的属性向量无法评估");
    for (const name of ["weaponDamage", "mainStat", "determination", "tenacity", "critical", "directHit", "gcdCentiseconds"] as const) {
      if (factors[name] !== selectedFactors[name]) {
        throw new Error(`MIP 因子与正式公式不一致：${name}=${selectedFactors[name]}，正式值=${factors[name]}`);
      }
    }
    const evaluation = options.evaluationFunction(attributes);
    if (evaluation === undefined || !Number.isFinite(evaluation.damage) || !Number.isFinite(evaluation.gcd)) {
      throw new Error("MIP 返回的配装无法计算伤害或 GCD");
    }
    const requestedGcds = options.constraints?.gcdChoices ??
      (options.constraints?.gcd === undefined ? undefined : [options.constraints.gcd]);
    if (requestedGcds !== undefined && !requestedGcds.some((gcdChoice) =>
      Math.round(gcdChoice * 100) === factors.gcdCentiseconds)) {
      throw new Error(`精确 MIP 返回 GCD=${factors.gcdCentiseconds / 100}，不在请求集合 ${requestedGcds.join(", ")} 中`);
    }
    const candidate = { result: { selection, food, damage: evaluation.damage }, factors, toughness: toughnessIndex === undefined ? undefined : attributes[toughnessIndex] };
    if (maximumToughness !== undefined && candidate.toughness !== maximumToughness) {
      throw new Error(`最高坚韧阶段固定值不一致：${candidate.toughness}，预期 ${maximumToughness}`);
    }
    if (best === undefined || betterFactors(factors, best.factors, useDps)) best = candidate;
    if (firstSurrogate === undefined) {
      firstSurrogate = surrogate;
      maximumSurrogate = surrogate;
    } else {
      nextSurrogate = surrogate;
      if (surrogate < firstSurrogate - errorBand) {
        throw new Error(`${solverName} 返回了不满足 surrogate 带宽约束的签名`);
      }
    }
    excludedSignatures.push(selectedSignature);
    options.onProgress?.(`精确候选已核验 ${excludedSignatures.length} 个；固定点上界=${surrogate}`);
    if (timeLimitReached()) {
      throw new Error("精确 MIP 搜索达到时限，未完成最优性证明");
    }
  }
  if (best === undefined) return undefined;
  const statistics = createStatistics();
  if (options.onSolverProgress !== undefined && isProfileTimingEnabled()) {
    options.onSolverProgress({
      backend: "HiGHS",
      model: `exact_search_${options.job}`,
      kind: "log",
      message: `PROFILE ${JSON.stringify({
        phase: "exact-search-summary",
        job: options.job,
        ...statistics,
      })}`,
    });
  }
  return {
    ...best.result,
    ...(options.constraints?.maxToughnessMode === true && best.toughness !== undefined
      ? { maximumToughness: best.toughness }
      : {}),
    statistics,
  };

  function createStatistics(): ExactMipSearchStatistics {
    const elapsedMs = performance.now() - startedAt;
    return {
      elapsedMs,
      ...(isProfileTimingEnabled() ? {
        modelPreparationMs,
        greedyMipStartMs,
        solverWallMs,
        otherSearchMs: Math.max(0,
          elapsedMs - modelPreparationMs - greedyMipStartMs - solverWallMs - signatureBandElapsedMs),
      } : {}),
      ...(candidateUpperBound === undefined ? {} : { candidateUpperBound }),
      ...(resourceBudgetCandidateBound === undefined ? {} : { resourceBudgetCandidateBound }),
      resourceBudgetCandidateCuts: resourceBudgetCandidateUpperBoundCuts.size,
      primaryResourceSupportsEnabled: prepared!.primaryResourceSupportsEnabled,
      ...(foodProductBound === undefined ? {} : { foodProductBound }),
      materiaFamilies: materiaStatistics,
      solverRuns,
      incumbentCandidateUpperBoundCuts: incumbentCandidateUpperBoundCuts.size,
      excludedSignatures: excludedSignatures.length,
      signatureBandChecks,
      signatureBandElapsedMs,
      signatureBandProof,
      variables: model!.bounds.length,
      constraints: model!.rows.length + excludedSignatures.length,
      reachableFactorClassesRemoved: prepared!.reachableFactorClassesRemoved,
      reachableAttributePruningSkipped: prepared!.reachableAttributePruningSkipped,
      reachableWeaponFactorClassesRemoved: prepared!.reachableWeaponFactorClassesRemoved,
      reachableWeaponPruningSkipped: prepared!.reachableWeaponPruningSkipped,
      maximumSurrogate,
      nextSurrogate,
      memoryUsage: getMemoryUsageSnapshot(),
      ...(prepared!.conditionalResourceSupport === undefined
        ? {}
        : { conditionalResourceSupport: prepared!.conditionalResourceSupport }),
    };
  }
}
