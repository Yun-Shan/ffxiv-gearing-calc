// Research runner: production real candidates and exact proof path, synthetic MNK profiles.
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cpus, totalmem, platform, arch } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bootstrap, setProfile, profileForGcd, scoreVector, polynomialAt, diagnosticsSnapshot } from "./runtime.mjs";
import { pruneCandidates } from "./certificates.mjs";

const root = new URL("../../../", import.meta.url);
const choices = [1.94, 1.96, 2];
const scenarioNames = ["sync-fixed", "sync-foods", "meld-fixed", "meld-foods", "wide-fixed"];
const hash = value => createHash("sha256").update(typeof value === "string" || value instanceof Uint8Array ? value : JSON.stringify(value)).digest("hex");
const json = value => JSON.stringify(value, (_key, item) => typeof item === "bigint" ? String(item) : item, 2);
const compare = (a, b) => a.numerator * b.denominator - b.numerator * a.denominator;

export function scenarioConfig(scenario) {
  assert.ok(scenarioNames.includes(scenario), `Unknown scenario ${scenario}`);
  return { jobId: "MNK", minItemLevel: scenario === "wide-fixed" ? 780 : 790,
    maxItemLevel: 795, ...(scenario.startsWith("sync-") ? { sync: { kind: "itemLevel", value: 735 } } : {}),
    clanIndex: 0, gcdChoices: [...choices], maximizeTenacity: false, objective: "damage",
    excludedSources: [], excludedGearIds: [], forcedGear: {}, sharedSlots: [],
    foodId: scenario.endsWith("-foods") ? 0 : 49245 };
}

function serializeScore(score) {
  return { numerator: String(score.numerator), denominator: String(score.denominator),
    approximate: score.damage, criticalFactor: score.criticalFactor, scale: score.scale,
    actionFactor: score.actionFactor, ordinaryDamage: score.ordinaryDamage };
}

// Canonical candidate bounds use componentwise maxima. This polynomial has nonnegative
// coefficients, so it remains monotone on w >= 0; all other factors are unchanged.
function checkCanonicalBoundCompatibility(runtime, prepared, profile) {
  assert.equal(prepared.jobId, "MNK");
  assert.ok(profile.coefficients.every(coefficient => Number.isSafeInteger(coefficient) && coefficient >= 0));
  const crtIndex = prepared.options.statIndexes.get("CRT");
  assert.notEqual(crtIndex, undefined);
  const crtId = prepared.options.attributeIds[crtIndex];
  const rawMaximum = prepared.options.slots.reduce((sum, slot) => sum + Math.max(...slot.map(candidate =>
    candidate.baseParams.filter(param => param.baseParamId === crtId).reduce((subtotal, param) => subtotal + param.value, 0))), 0);
  const foodMaximum = Math.max(0, ...prepared.options.foods.map(food =>
    food.baseParams.filter(param => param.baseParamId === crtId).reduce((sum, param) => sum + param.maxValue, 0)));
  const maximum = rawMaximum + foodMaximum;
  assert.ok(Number.isSafeInteger(maximum));
  const minimumW = runtime.effects.equippedAttributeTier("MNK", prepared.jobLevel, "CRT", 0, 0) - 50;
  const maximumW = runtime.effects.equippedAttributeTier("MNK", prepared.jobLevel, "CRT", maximum, 0) - 50;
  assert.ok(minimumW >= 0 && maximumW >= minimumW);
  const maximumCritical = polynomialAt(maximumW, profile);
  assert.ok(Number.isSafeInteger(maximumCritical) && maximumCritical > 0);
  assert.ok(!prepared.options.slots.some(slot => slot.some(candidate => candidate.resistanceWeaponAdjust !== undefined)),
    "Research compatibility check does not cover automatic customizable weapons");
  return { proof: "Nonnegative cubic coefficients on w >= 0; all remaining integer factors unchanged",
    minimumW, maximumW, conservativeMaximumCrtContribution: maximum, maximumCritical };
}

function modelProgressCollector(progress, branch, events) {
  return event => {
    const model = events.models[event.model] ??= { events: 0 };
    model.events++;
    for (const key of ["variableCount", "rowCount", "nodes", "totalLpIterations", "status", "completed", "elapsedMs"])
      if (event[key] !== undefined) model[key] = event[key];
    if (event.message?.startsWith("PROFILE ")) {
      try {
        const value = JSON.parse(event.message.slice(8));
        // Bounded instrumentation; no unbounded solver log accumulation.
        if (events.profiles.length < 1000) events.profiles.push(value);
        else events.profilesOmitted++;
        progress(`${branch} profile ${value.phase ?? event.model}`);
      } catch { events.profileParseErrors++; }
    }
  };
}

async function verifyResult(runtime, modules, result, prepared, config, profile, originalIdentities) {
  assert.equal(result.selection.length, prepared.slots.length);
  const identities = result.selection.map((equipment, index) => {
    const identity = modules.equipmentCandidateIdentity(equipment);
    assert.ok(originalIdentities[index].has(identity), `Selected identity is outside original slot ${prepared.slots[index].name}`);
    return { slot: prepared.slots[index].name, itemId: equipment.itemId, identity };
  });
  assert.ok(result.food && prepared.options.foods.some(food => modules.foodIdentity(food) === modules.foodIdentity(result.food)));
  const vector = runtime.getAttributeVector(result.selection, result.food, prepared.options.attributeIds,
    prepared.options.equipmentAttributeExtractor, prepared.options.statIndexes);
  const score = scoreVector(vector, profile, prepared);
  assert.equal(Math.round(score.gcd * 100), profile.gcd);
  assert.ok(Math.abs(result.damage - score.damage) <= Math.max(1e-9, score.damage * 1e-12));
  const gear = result.selection.flatMap((equipment, index) => {
    const slot = prepared.slots[index].name;
    return slot === "rings"
      ? equipment.ringEquips.map((ring, ringIndex) => modules.candidateGearFromInfo(ring, ringIndex === 0 ? "ring" : "ring2", prepared))
      : [modules.candidateGearFromInfo(equipment, slot, prepared)];
  });
  assert.equal(gear.length, 11, "Research scenarios must produce a complete eleven-item MNK loadout");
  const seen = new Set();
  for (const item of gear) {
    assert.ok(!(item.unique === true && seen.has(item.id)), `Duplicate unique gear ${item.id}`);
    seen.add(item.id);
  }
  const fixedInput = { jobId: config.jobId, jobLevel: prepared.jobLevel,
    ...(config.sync ? { sync: config.sync } : {}), foodId: result.food.itemId,
    gears: gear.map(item => {
      const customStats = item.customParameters?.map(({ stat }) => stat) ?? item.resistanceWeaponAdjust?.stats;
      return customStats === undefined
        ? { id: item.id, materias: item.melds.map(meld => [meld.stat, meld.grade]) }
        : { id: item.id, materias: [], customStats: Object.fromEntries(customStats.map(stat =>
          [stat, (item.stats[stat] ?? 0) + item.melds.filter(meld => meld.stat === stat).reduce((sum, meld) => sum + meld.value, 0)])) };
    }) };
  const fixed = modules.calculateFixedGearset(fixedInput);
  const base = modules.calculateBaseStats(prepared.jobSchema, prepared.jobLevel, prepared.clanIndex);
  const checkedStats = [...prepared.jobSchema.stats, "PDMG", "MDMG", "DLY"];
  for (const stat of checkedStats) {
    const index = prepared.options.statIndexes.get(stat);
    assert.notEqual(index, undefined);
    assert.equal(fixed.stats[stat] ?? 0, (base[stat] ?? 0) + vector[index], `Fixed gearset and search vector differ for ${stat}`);
  }
  assert.equal(Math.round(fixed.effects.gcd * 100), profile.gcd);
  const ordinary = runtime.effects.equippedEffects("MNK", prepared.jobLevel,
    Object.fromEntries([...prepared.options.statIndexes].map(([stat, index]) => [stat, vector[index]])), prepared.clanIndex);
  assert.ok(Math.abs(fixed.effects.damage - ordinary.damage) <= Math.max(1e-10, ordinary.damage * 1e-12));
  return { score, serialized: { gcd: score.gcd, score: serializeScore(score), identities,
    foodId: result.food.itemId, vector, fixedGearsetInput: fixedInput, finalStats: fixed.stats,
    validation: { originalSlotMembership: true, originalFoodMembership: true, uniqueItems: true,
      completeElevenItems: true, exactRequestedGcd: true, fixedGearsetStatsMatch: true,
      ordinaryDamageMatch: true, researchFloatMatchesExactFraction: true } } };
}

/** Run in a fresh process for each sample; the budget includes cold bootstrap and preparation. */
export async function runCase({ scenario = "sync-fixed", mode = "off", maxTotalMs = 180000,
  onProgress = message => process.stderr.write(`${message}\n`) } = {}) {
  assert.ok(["off", "on", "certificate"].includes(mode), `Unknown mode ${mode}`);
  assert.ok(Number.isFinite(maxTotalMs) && maxTotalMs > 0);
  const config = scenarioConfig(scenario);
  const started = performance.now();
  const deadline = started + maxTotalMs;
  const startedAt = new Date().toISOString();
  const stageTimes = {};
  const output = { scope: "Real complete equipment candidate domain; synthetic MNK action profiles; isolated process-local objective hook",
    startedAt, scenario, mode, config, maxTotalMs, status: "incomplete", globalOptimalityProven: false,
    stageTimes, branches: [] };
  process.env.FFXIV_PROFILE_TIMING = "1";
  let runtime, prepared, best;
  try {
    onProgress(`${scenario}/${mode} cold bootstrap`);
    let phase = performance.now();
    runtime = await bootstrap();
    const [fixed, assembly, identity, candidates, rules, canonical] = await Promise.all([
      import(new URL("src/domain/fixed-gearset.ts", root)),
      import(new URL("src/domain/optimizer/result-assembly.ts", root)),
      import(new URL("src/domain/search/equipment-identity.ts", root)),
      import(new URL("src/domain/optimizer/equipment-candidates.ts", root)),
      import(new URL("src/domain/rules.ts", root)),
      import(new URL("src/domain/search/exact-mip-candidate-upper-bound.ts", root)),
    ]);
    const modules = { ...fixed, ...assembly, ...identity, ...candidates, ...rules };
    stageTimes.bootstrapMs = performance.now() - phase;
    phase = performance.now();
    const binary = await readFile(new URL("src/data/generated-data.bin", root));
    const highsPackage = JSON.parse(await readFile(new URL("node_modules/highs/package.json", root), "utf8"));
    output.provenance = { node: process.version, platform: platform(), arch: arch(),
      highsPackageVersion: highsPackage.version,
      cpu: cpus()[0]?.model, logicalCpuCount: cpus().length, totalSystemMemoryBytes: totalmem(),
      repositoryCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: fileURLToPath(root), encoding: "utf8" }).trim(),
      gameVersion: runtime.gameData.version, dataReferenceCommit: runtime.gameData.provenance.commit,
      binarySha256: hash(binary), runtimeSha256: hash(await readFile(new URL("runtime.mjs", import.meta.url))),
      runnerSha256: hash(await readFile(new URL("run-case.mjs", import.meta.url))),
      certificateSha256: hash(await readFile(new URL("certificates.mjs", import.meta.url))),
      supportSha256: hash(await readFile(new URL("docs/数学探索-证明与复现/docs/mathematical-analysis/theorems/coupled-product-support/support.mjs", root))) };
    stageTimes.provenanceMs = performance.now() - phase;
    phase = performance.now();
    onProgress(`${scenario}/${mode} preparing complete raw candidates`);
    prepared = runtime.prepareSearch(config, {}, false, true, undefined, false);
    stageTimes.candidatePreparationMs = performance.now() - phase;
    assert.ok(prepared.slots.every(slot => slot.candidates.length > 0), "A required gear slot has no candidate");
    assert.ok(prepared.foods.length > 0, "No food candidate");
    output.candidates = { slots: prepared.slots.map(slot => ({ slot: slot.name, count: slot.candidates.length })),
      total: prepared.searchedCandidates, foods: prepared.foods.length,
      paretoApplied: false, topKApplied: false, independentRingSlots: true };
    const originalIdentities = prepared.slots.map(slot => new Set(slot.candidates.map(modules.equipmentCandidateIdentity)));
    const profiles = choices.map(choice => profileForGcd(Math.round(choice * 100)));
    output.profiles = profiles;
    output.candidateSha256 = hash({ slots: prepared.options.slots, foods: prepared.options.foods });
    output.inputSha256 = hash({ config, candidateSha256: output.candidateSha256, profiles });
    for (const profile of profiles) {
      const branch = { gcd: profile.gcd / 100, profile, status: "not-started", optimalityProven: false };
      output.branches.push(branch);
      if (performance.now() >= deadline) continue;
      const branchStart = performance.now();
      const events = { models: {}, profiles: [], profilesOmitted: 0, profileParseErrors: 0 };
      branch.events = events;
      try {
        setProfile(profile);
        phase = performance.now();
        branch.canonicalCompatibility = checkCanonicalBoundCompatibility(runtime, prepared, profile);
        let options = { ...prepared.options,
          constraints: { ...prepared.options.constraints, gcd: profile.gcd / 100, gcdChoices: [profile.gcd / 100] },
          objective: "damage", evaluationFunction: vector => {
            const score = scoreVector(vector, profile, prepared);
            return { damage: score.damage, gcd: score.gcd };
          }, maxSearchMs: Math.max(1, deadline - performance.now()),
          isCancelled: () => performance.now() >= deadline,
          onProgress: message => onProgress(`${scenario}/${mode}/${branch.gcd} ${message}`),
          onSolverProgress: modelProgressCollector(onProgress, `${scenario}/${mode}/${branch.gcd}`, events),
          ...(mode === "off" ? { primaryResourceSupports: false, mainStatResourceSupport: false,
            candidateResourceSupportProfile: "disabled", resourceBudgetCandidateProfile: "disabled" }
            : { primaryResourceSupports: true, mainStatResourceSupport: true,
              candidateResourceSupportProfile: "compact-weighted", resourceBudgetCandidateProfile: "default" }) };
        if (mode !== "off") canonical.inheritCanonicalEvaluatorCandidateUpperBound(prepared.options, options);
        if (mode === "certificate") {
          const preprocessingStart = performance.now();
          const model = runtime.buildLinearAttributeModel(options);
          const seed = model && runtime.greedyMipStart(options, model, false,
            Math.min(deadline, performance.now() + 1000), options.isCancelled);
          branch.certificateSeedMs = performance.now() - preprocessingStart;
          if (seed) {
            const vector = runtime.getAttributeVector(seed.selection, seed.food, options.attributeIds,
              options.equipmentAttributeExtractor, options.statIndexes);
            const score = scoreVector(vector, profile, prepared);
            assert.equal(Math.round(score.gcd * 100), profile.gcd);
            branch.certificateIncumbent = { score: serializeScore(score),
              identities: seed.selection.map(modules.equipmentCandidateIdentity), foodId: seed.food?.itemId };
            const pruning = await pruneCandidates({ options, profile, incumbent: { ...seed, score }, modules: runtime });
            options = pruning.options;
            branch.certificate = pruning.statistics;
            branch.removedCandidates = pruning.removed.map(({ candidate, ...evidence }) =>
              ({ ...evidence, identity: modules.equipmentCandidateIdentity(candidate), itemId: candidate.itemId }));
          } else branch.certificate = { skipReason: "no-feasible-greedy-seed", removed: 0 };
          branch.certificateTotalMs = performance.now() - preprocessingStart;
          options.maxSearchMs = Math.max(1, deadline - performance.now());
        }
        branch.optionalPolicy = { canonicalMarker: canonical.hasCanonicalEvaluatorCandidateUpperBound(options),
          candidateUpperBoundGate: canonical.shouldEnableCanonicalCandidateUpperBound(options,
            canonical.hasCanonicalEvaluatorCandidateUpperBound(options)),
          primaryResourceSupports: options.primaryResourceSupports ?? "automatic",
          mainStatResourceSupport: options.mainStatResourceSupport ?? "automatic",
          candidateResourceSupportProfile: options.candidateResourceSupportProfile ?? "balanced",
          resourceBudgetCandidateProfile: options.resourceBudgetCandidateProfile ?? "default" };
        branch.optionPreparationMs = performance.now() - phase;
        onProgress(`${scenario}/${mode}/${branch.gcd} complete exact search`);
        phase = performance.now();
        const result = await runtime.findBestLoadoutExactMip(options);
        branch.searchMs = performance.now() - phase;
        if (result === undefined) {
          branch.status = "infeasible";
          branch.optimalityProven = true;
        } else {
          branch.statistics = result.statistics;
          phase = performance.now();
          const verified = await verifyResult(runtime, modules, result, prepared, config, profile, originalIdentities);
          branch.verificationMs = performance.now() - phase;
          branch.result = verified.serialized;
          branch.status = "optimal";
          branch.optimalityProven = true;
          if (best === undefined || compare(verified.score, best.score) > 0n)
            best = { score: verified.score, result: verified.serialized };
        }
      } catch (error) {
        branch.status = performance.now() >= deadline || /时限|未完成|未证明|cancel|time.?limit/i.test(error.message) ? "incomplete" : "failed";
        branch.error = { name: error.name, message: error.message, stack: error.stack };
        onProgress(`${scenario}/${mode}/${branch.gcd} ${branch.status}: ${error.message}`);
      }
      branch.elapsedMs = performance.now() - branchStart;
      branch.hookStatistics = diagnosticsSnapshot();
      if (["incomplete", "failed"].includes(branch.status)) break;
    }
    for (const profile of profiles)
      if (!output.branches.some(branch => branch.profile.gcd === profile.gcd))
        output.branches.push({ gcd: profile.gcd / 100, profile, status: "not-started", optimalityProven: false });
    output.globalOptimalityProven = output.branches.length === profiles.length && output.branches.every(branch => branch.optimalityProven);
    output.status = output.globalOptimalityProven ? (best ? "optimal" : "infeasible")
      : output.branches.some(branch => branch.status === "failed") ? "failed" : "incomplete";
    if (best) output[output.globalOptimalityProven ? "winner" : "bestObservedIncomplete"] = best.result;
  } catch (error) {
    output.status = performance.now() >= deadline ? "incomplete" : "failed";
    output.error = { name: error.name, message: error.message, stack: error.stack };
    onProgress(`${scenario}/${mode} ${output.status}: ${error.message}`);
  }
  output.hookStatistics = diagnosticsSnapshot();
  output.elapsedMs = performance.now() - started;
  output.finishedAt = new Date().toISOString();
  output.processMemoryBytes = process.memoryUsage();
  const usage = process.resourceUsage();
  output.processResourceUsage = { ...usage, maxRSSUnit: "KiB (Node/libuv ru_maxrss convention)",
    maxRSSScope: "OS process-lifetime high-water mark, including cold bootstrap and all completed branches; not a browser measurement" };
  return output;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const input = {};
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index], value = args[index + 1];
    assert.ok(["--scenario", "--mode", "--output", "--limit-ms"].includes(name) && value !== undefined, `Invalid CLI argument ${name}`);
    input[name.slice(2)] = value;
  }
  const result = await runCase({ scenario: input.scenario, mode: input.mode,
    ...(input["limit-ms"] ? { maxTotalMs: Number(input["limit-ms"]) } : {}) });
  const encoded = `${json(result)}\n`;
  if (input.output) {
    await mkdir(dirname(resolve(input.output)), { recursive: true });
    await writeFile(input.output, encoded, "utf8");
  }
  process.stdout.write(encoded);
  if (!["optimal", "infeasible"].includes(result.status)) process.exitCode = result.status === "incomplete" ? 2 : 1;
}
