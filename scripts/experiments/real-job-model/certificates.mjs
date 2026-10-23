// Research-only strict candidate upper bounds; uncertain/budget-limited cases stay.
import { factorProduct, polynomialAt, setProfile } from "./runtime.mjs";
import { prepareSupport } from "../../../docs/数学探索-证明与复现/docs/mathematical-analysis/theorems/coupled-product-support/support.mjs";
import { inheritCanonicalEvaluatorCandidateUpperBound } from "../../../src/domain/search/exact-mip-candidate-upper-bound.ts";

const safe = value => Number.isSafeInteger(value) && value >= 0;
const greater = (a, b) => a.n * b.d > b.n * a.d;
export async function pruneCandidates({ options, profile: inputProfile, incumbent, modules, limits = {} }) {
  const started = performance.now();
  const maxMs = limits.maxMs ?? 1500;
  const maxQueries = limits.maxQueries ?? 20000;
  const maxNodes = limits.maxNodesPerCandidate ?? 128;
  const maxPreparedPoints = limits.maxPreparedPoints ?? 200000;
  const statistics = {
    strategy: "full-product-det-dht-amgm-crt-support",
    candidatesBefore: options.slots.reduce((sum, slot) => sum + slot.length, 0),
    candidatesAfter: 0, removed: 0, independentRemoved: 0, amgmRemoved: 0,
    independentQueries: 0, amgmQueries: 0, upperQueries: 0,
    crtNodes: 0, attemptedCandidateTests: 0, supportBuilds: 0,
    supportSegments: 0, preparedPoints: 0, budgetExhausted: false,
    foodRelaxation: "Independent maximum caps; no food identity removed",
    uniqueRelaxation: "Cross-slot unique and ring compatibility relaxed only in upper bounds",
  };
  const removed = [];
  const finish = (slots = options.slots) => {
    statistics.elapsedMs = performance.now() - started;
    statistics.candidatesAfter = slots.reduce((sum, slot) => sum + slot.length, 0);
    statistics.removed = removed.length;
    const resultOptions = removed.length === 0 ? options :
      inheritCanonicalEvaluatorCandidateUpperBound(options, { ...options, slots });
    return { options: resultOptions, statistics, removed };
  };
  const skip = reason => { statistics.skipReason = reason; return finish(); };
  if (!(Number.isFinite(maxMs) && maxMs > 0) ||
      ![maxQueries, maxNodes, maxPreparedPoints].every(safe)) return skip("invalid-budget");
  if (options.job !== "MNK" || options.constraints?.maxToughnessMode === true)
    return skip("unsupported-job-or-unfixed-tenacity");
  if (options.slots.some(slot => slot.length === 0 ||
      slot.some(candidate => candidate.resistanceWeaponAdjust !== undefined)))
    return skip("empty-slot-or-variable-weapon");
  const profile = setProfile(inputProfile);
  if (incumbent?.score?.profileKey !== profile.key ||
      incumbent.selection.length !== options.slots.length ||
      incumbent.selection.some((candidate, slot) => !options.slots[slot].includes(candidate)))
    return skip("incumbent-profile-or-identity-mismatch");
  const incumbentProduct = factorProduct(incumbent.score.factors);
  const level = modules.gameData.jobLevelModifiers[options.jobLevel];
  if (!level || !safe(level.det) || !safe(level.div) || level.det === 0 || level.div === 0)
    return skip("unsupported-level-parameters");
  const bases = modules.gameData.baseStats;
  if (bases.CRT !== "sub" || bases.DET !== "main" || bases.DHT !== "sub")
    return skip("unsupported-substat-bases");
  const crtIndex = options.statIndexes.get("CRT");
  const detIndex = options.statIndexes.get("DET");
  const dhtIndex = options.statIndexes.get("DHT");
  if ([crtIndex, detIndex, dhtIndex].some(index => !Number.isInteger(index) || index < 0))
    return skip("missing-substat-index");
  const D0 = BigInt(incumbent.score.factors.determination);
  const H0 = BigInt(incumbent.score.factors.directHit);
  const det = BigInt(level.det), div = BigInt(level.div);
  // D <= 1000 + 140 DET/det; H <= 4000 + 550 DHT/div.
  // L = D/D0 + H/H0 has an exact rational affine upper envelope.
  const detWeight = 140n * H0 * div;
  const dhtWeight = 550n * D0 * det;
  const intercept = (1000n * H0 + 4000n * D0) * det * div;
  const affineDenominator = D0 * H0 * det * div;
  const linear = vector => detWeight * BigInt(vector[detIndex]) + dhtWeight * BigInt(vector[dhtIndex]);
  const expired = () => {
    const stopped = options.isCancelled?.() === true || performance.now() - started >= maxMs ||
      statistics.upperQueries >= maxQueries;
    if (stopped) statistics.budgetExhausted = true;
    return stopped;
  };
  const foodCaps = options.attributeIds.map(() => 0);
  const idToIndex = new Map(options.attributeIds.map((id, index) => [id, index]));
  for (const food of options.foods) {
    const caps = options.attributeIds.map(() => 0);
    for (const parameter of food.baseParams) {
      if (!safe(parameter.maxValue) || !Number.isFinite(parameter.multiplier) ||
          parameter.multiplier < 1 || !safe(parameter.baseValue ?? 0)) return skip("unsafe-food-metadata");
      const index = idToIndex.get(parameter.baseParamId);
      if (index !== undefined) {
        caps[index] += parameter.maxValue;
        if (!safe(caps[index])) return skip("unsafe-food-cap-sum");
      }
    }
    for (let index = 0; index < caps.length; index++) foodCaps[index] = Math.max(foodCaps[index], caps[index]);
  }
  const vectors = [];
  try {
    let count = 0;
    for (const slot of options.slots) {
      const slotVectors = [];
      for (const candidate of slot) {
        if ((count++ & 255) === 0 && expired()) return finish();
        const vector = modules.getAttributeVector([candidate], undefined, options.attributeIds,
          options.equipmentAttributeExtractor, options.statIndexes);
        if (vector.length !== options.attributeIds.length || !vector.every(safe)) return skip("unsafe-equipment-vector");
        slotVectors.push(vector);
      }
      vectors.push(slotVectors);
    }
  } catch { return skip("equipment-vector-unavailable"); }
  const maxima = vectors.map(slot => options.attributeIds.map((_, index) =>
    slot.reduce((maximum, vector) => Math.max(maximum, vector[index]), 0)));
  const totals = options.attributeIds.map((_, index) =>
    maxima.reduce((sum, vector) => sum + vector[index], 0) + foodCaps[index]);
  if (!totals.every(safe)) return skip("unsafe-total-upper-vector");
  statistics.affineEnvelopeChecks = 0;
  for (const [stat, index, denominator, interceptValue, slope] of [
    ["DET", detIndex, det, 1000n, 140n], ["DHT", dhtIndex, div, 4000n, 550n],
  ]) {
    for (let contribution = 0; contribution <= totals[index]; contribution++) {
      if ((contribution & 255) === 0 && expired()) return finish();
      const tier = modules.effects.equippedAttributeTier(options.job, options.jobLevel, stat, contribution, options.clanIndex ?? 0);
      const value = BigInt(tier + (stat === "DHT" ? 4000 : 0));
      statistics.affineEnvelopeChecks++;
      if (value * denominator > interceptValue * denominator + slope * BigInt(contribution))
        return skip("actual-factor-exceeds-continuous-envelope");
    }
  }
  const groups = vectors.map(slot => slot.map(vector => [vector[crtIndex], linear(vector)]));
  const evaluate = modules.effects.createIntegerDamageFactorEvaluator(options.job,
    options.jobLevel, options.statIndexes, options.clanIndex ?? 0);
  const slots = options.slots.map(slot => [...slot]);
  for (let slotIndex = 0; slotIndex < options.slots.length; slotIndex++) {
    if (expired()) break;
    const others = groups.filter((_, index) => index !== slotIndex);
    const work = others.reduce((sum, group) => sum + group.length, 0);
    if (statistics.preparedPoints + work > maxPreparedPoints) { statistics.budgetExhausted = true; break; }
    statistics.preparedPoints += work;
    const support = prepareSupport(others);
    if (support === null) continue;
    statistics.supportBuilds++;
    statistics.supportSegments += support.segments;
    const kept = [], slot = options.slots[slotIndex];
    for (let candidateIndex = 0; candidateIndex < slot.length; candidateIndex++) {
      const candidate = slot[candidateIndex];
      if (expired()) { kept.push(...slot.slice(candidateIndex)); break; }
      if (candidate === incumbent.selection[slotIndex]) {
        kept.push(candidate);
        statistics.incumbentPins = (statistics.incumbentPins ?? 0) + 1;
        continue;
      }
      const vector = vectors[slotIndex][candidateIndex];
      const upperVector = totals.map((value, index) => value - maxima[slotIndex][index] + vector[index]);
      let upperFactors, independent;
      try { upperFactors = evaluate(upperVector); independent = factorProduct(upperFactors); }
      catch { kept.push(candidate); continue; }
      statistics.independentQueries++;
      statistics.upperQueries++;
      let method, certifiedUpper = { n: 0n, d: 1n }, closedLeaves = 0;
      if (independent < incumbentProduct) {
        method = "independent-coordinate";
        certifiedUpper = { n: independent, d: 1n };
      } else {
        const productConstant = BigInt(upperFactors.weaponDamage) * BigInt(upperFactors.mainStat) * BigInt(upperFactors.tenacity);
        // Translate every completion to its CRT plus the same maximum food cap.
        // This is at least its true CRT; its DET/DHT caps are also overestimates.
        const fixedCrt = vector[crtIndex] + foodCaps[crtIndex];
        const constant = intercept + linear(vector) + linear(foodCaps);
        const stack = [[support.minCost + fixedCrt, support.maxCost + fixedCrt]];
        let nodes = 0, complete = true;
        while (stack.length > 0) {
          if (expired() || nodes >= maxNodes) { complete = false; break; }
          const [lo, hi] = stack.pop();
          nodes++; statistics.crtNodes++; statistics.amgmQueries++; statistics.upperQueries++;
          const supported = support.query(lo - fixedCrt, hi - fixedCrt);
          if (supported === null) { closedLeaves++; continue; }
          let bound;
          try {
            const w = modules.effects.equippedAttributeTier(options.job, options.jobLevel, "CRT", hi, options.clanIndex ?? 0) - 50;
            const qHi = BigInt(polynomialAt(w, profile));
            const lNumerator = constant * supported.d + supported.n;
            const lDenominator = affineDenominator * supported.d;
            if (lNumerator < 0n || lDenominator <= 0n) throw new Error("Invalid affine upper bound");
            bound = { n: productConstant * qHi * D0 * H0 * lNumerator * lNumerator,
              d: 4n * lDenominator * lDenominator };
          } catch { complete = false; break; }
          if (bound.n < incumbentProduct * bound.d) {
            closedLeaves++;
            if (greater(bound, certifiedUpper)) certifiedUpper = bound;
            continue;
          }
          if (lo === hi) { complete = false; break; }
          const middle = lo + Math.floor((hi - lo) / 2);
          stack.push([lo, middle], [middle + 1, hi]);
        }
        if (complete && stack.length === 0) method = "det-dht-amgm-crt-support";
      }
      statistics.attemptedCandidateTests++;
      if (method === undefined) { kept.push(candidate); continue; }
      if (method === "independent-coordinate") statistics.independentRemoved++;
      else statistics.amgmRemoved++;
      removed.push({ slotIndex, candidate, method, closedLeaves,
        upperNumerator: String(certifiedUpper.n), upperDenominator: String(certifiedUpper.d),
        incumbentProduct: String(incumbentProduct) });
    }
    slots[slotIndex] = kept;
  }
  return finish(slots);
}
