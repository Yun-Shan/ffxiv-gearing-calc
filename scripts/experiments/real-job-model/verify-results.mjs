// Post-benchmark validation. Never run concurrently with performance samples.
// Certificate completions are evaluated independently with BigInt game formulas.
import assert from "node:assert/strict";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bootstrap } from "./runtime.mjs";

const hash = value => createHash("sha256").update(typeof value === "string" || value instanceof Uint8Array ? value : JSON.stringify(value)).digest("hex");
const compare = (a, b) => a.numerator * b.denominator - b.numerator * a.denominator;
function rational(value, allowZero = false) {
  assert.ok(value && /^\d+$/.test(String(value.numerator)) && /^\d+$/.test(String(value.denominator)), "Invalid rational encoding");
  const result = { numerator: BigInt(value.numerator), denominator: BigInt(value.denominator) };
  assert.ok(result.denominator > 0n && (allowZero ? result.numerator >= 0n : result.numerator > 0n));
  return result;
}
function equalScore(a, b, message) { assert.equal(compare(rational(a), rational(b)), 0n, message); }
function nonnegative(value, name) { assert.ok(Number.isFinite(value) && value >= 0, `Invalid ${name}`); }
function checkScore(score) {
  const q = rational(score);
  assert.ok(Number.isFinite(score.approximate) && score.approximate > 0);
  const expected = Number(q.numerator) / Number(q.denominator);
  assert.ok(Math.abs(score.approximate - expected) <= Math.max(1e-9, expected * 1e-12));
  if (score.criticalFactor !== undefined) assert.ok(Number.isSafeInteger(score.criticalFactor) && score.criticalFactor > 0);
  if (score.scale !== undefined) assert.ok(/^\d+$/.test(score.scale) && BigInt(score.scale) > 0n);
}
function checkHook(hook) {
  assert.ok(hook);
  for (const name of ["hookHits", "captureMatches", "criticalMatches"]) assert.equal(hook[name], 1, `${name} must equal one`);
  assert.ok(Number.isSafeInteger(hook.evaluatorCalls) && hook.evaluatorCalls > 0);
  assert.equal(hook.differentFromLegacy, hook.evaluatorCalls);
  assert.ok(hook.numericSafetyChecks >= hook.evaluatorCalls);
  assert.ok(Number.isSafeInteger(hook.maximumCritical) && hook.maximumCritical > 0);
  assert.match(hook.sourceSha256, /^[a-f0-9]{64}$/);
  assert.match(hook.transformedSourceSha256, /^[a-f0-9]{64}$/);
  assert.notEqual(hook.sourceSha256, hook.transformedSourceSha256);
}
function checkValidation(validation) {
  for (const name of ["originalSlotMembership", "originalFoodMembership", "uniqueItems", "completeElevenItems",
    "exactRequestedGcd", "fixedGearsetStatsMatch", "ordinaryDamageMatch", "researchFloatMatchesExactFraction"])
    assert.equal(validation?.[name], true, `Result validation ${name}`);
  assert.ok(Object.values(validation).every(value => value === true));
}
function validateCase(entry) {
  const { value: run, file } = entry;
  assert.equal(run.status, "optimal", `${file} did not complete`);
  assert.equal(run.globalOptimalityProven, true);
  assert.equal(run.bestObservedIncomplete, undefined);
  assert.equal(run.config.jobId, "MNK");
  assert.equal(run.config.clanIndex, 0);
  assert.deepEqual(run.config.gcdChoices, [1.94, 1.96, 2]);
  assert.equal(run.config.objective, "damage");
  assert.ok(["off", "on", "certificate"].includes(run.mode));
  assert.match(run.inputSha256, /^[a-f0-9]{64}$/);
  assert.match(run.candidateSha256, /^[a-f0-9]{64}$/);
  assert.equal(run.candidates.paretoApplied, false);
  assert.equal(run.candidates.topKApplied, false);
  assert.equal(run.candidates.independentRingSlots, true);
  assert.equal(run.candidates.slots.reduce((n, slot) => n + slot.count, 0), run.candidates.total);
  assert.ok(run.candidates.slots.every(slot => Number.isSafeInteger(slot.count) && slot.count > 0));
  assert.ok(Number.isSafeInteger(run.candidates.foods) && run.candidates.foods > 0);
  checkHook(run.hookStatistics);
  nonnegative(run.elapsedMs, "total elapsed time");
  Object.entries(run.stageTimes).forEach(([name, value]) => nonnegative(value, name));
  assert.equal(run.branches.length, 3);
  assert.deepEqual(run.branches.map(branch => Math.round(branch.gcd * 100)).sort(), [194, 196, 200]);
  let maximum;
  for (const branch of run.branches) {
    assert.equal(branch.optimalityProven, true);
    assert.ok(["optimal", "infeasible"].includes(branch.status));
    checkHook(branch.hookStatistics);
    assert.equal(branch.profile.gcd, Math.round(branch.gcd * 100));
    assert.equal(branch.profile.synthetic, true);
    nonnegative(branch.elapsedMs, "branch elapsed time");
    nonnegative(branch.searchMs, "branch search time");
    if (branch.status === "infeasible") { assert.equal(branch.result, undefined); continue; }
    checkValidation(branch.result.validation);
    checkScore(branch.result.score);
    assert.equal(Math.round(branch.result.gcd * 100), branch.profile.gcd);
    assert.equal(branch.result.identities.length, 11);
    assert.equal(new Set(branch.result.identities.map(identity => identity.slot)).size, 11);
    assert.equal(branch.result.fixedGearsetInput.gears.length, 11);
    assert.ok(branch.result.vector.every(Number.isSafeInteger));
    assert.ok(Object.values(branch.result.finalStats).every(value => Number.isFinite(value) && value >= 0));
    assert.equal(typeof branch.statistics.signatureBandProof, "boolean");
    assert.ok(branch.statistics.solverRuns >= 1);
    assert.ok(branch.statistics.excludedSignatures >= 1);
    assert.ok(branch.statistics.variables > 0 && branch.statistics.constraints > 0);
    assert.ok(Number.isSafeInteger(branch.statistics.maximumSurrogate));
    if (branch.statistics.nextSurrogate !== undefined) assert.ok(Number.isSafeInteger(branch.statistics.nextSurrogate));
    for (const key of ["elapsedMs", "modelPreparationMs", "greedyMipStartMs", "solverWallMs", "otherSearchMs", "signatureBandElapsedMs"])
      if (branch.statistics[key] !== undefined) nonnegative(branch.statistics[key], key);
    // Either BigInt band exhaustion or a completed full feasibility solve closes the proof.
    if (!branch.statistics.signatureBandProof) assert.ok(branch.statistics.solverRuns >= 2);
    assert.equal(branch.statistics.primaryResourceSupportsEnabled, run.mode !== "off");
    if (maximum === undefined || compare(rational(branch.result.score), rational(maximum)) > 0n) maximum = branch.result.score;
    if (run.mode === "certificate") {
      assert.ok(branch.certificate);
      const removed = branch.removedCandidates ?? [];
      assert.equal(branch.certificate.removed, removed.length);
      if (branch.certificate.candidatesBefore !== undefined)
        assert.equal(branch.certificate.candidatesBefore - branch.certificate.candidatesAfter, removed.length);
      if (removed.length) assert.ok(branch.certificateIncumbent);
      for (const evidence of removed) {
        assert.ok(Number.isSafeInteger(evidence.slotIndex) && evidence.slotIndex >= 0 && evidence.slotIndex < 11);
        const upper = rational({ numerator: evidence.upperNumerator, denominator: evidence.upperDenominator }, true);
        const incumbent = BigInt(evidence.incumbentProduct);
        assert.ok(upper.numerator < incumbent * upper.denominator, "Certificate deletion is not strict");
      }
    }
  }
  assert.ok(maximum);
  checkValidation(run.winner.validation);
  checkScore(run.winner.score);
  equalScore(run.winner.score, maximum, "Winner is not the largest restored cross-GCD score");
  assert.ok(run.branches.some(branch => branch.result && branch.result.gcd === run.winner.gcd &&
    compare(rational(branch.result.score), rational(run.winner.score)) === 0n));
}

// This independent evaluator intentionally reconstructs the explicit action sum,
// including every integer floor. It does not call any hooked factor evaluator.
function makeIndependentEvaluator(gameData, prepared, base) {
  const schema = gameData.jobSchemas.MNK, mod = gameData.jobLevelModifiers[100];
  assert.equal(prepared.jobLevel, 100);
  assert.equal(schema.role, "str");
  assert.equal(schema.mainStat, "STR");
  assert.equal(schema.traitDamageMultiplier, 1);
  assert.equal(schema.partyBonus ?? 1.05, 1.05);
  const floor = (n, d) => { assert.ok(d > 0n && n >= 0n); return n / d; };
  const main = BigInt(mod.main), sub = BigInt(mod.sub), div = BigInt(mod.div), det = BigInt(mod.det), trunc = BigInt(mod.detTrunc);
  const contribution = (v, name) => BigInt(v[prepared.options.statIndexes.get(name) ?? -1] ?? 0);
  const total = (v, name) => BigInt(base[name] ?? (name === "TEN" ? mod.sub : 0)) + contribution(v, name);
  function actualGcd(v) {
    const speed = floor(130n * (total(v, "SKS") - sub), div);
    return Number(floor(floor((1000n - speed) * 2500n, 1000n) * BigInt(schema.statModifiers.gcd || 100), 1000n));
  }
  function evaluate(v, profile) {
    const w = floor(200n * (total(v, "CRT") - sub), div), c = w + 50n, k = w + 1400n;
    const normal = 1000000n + c * (k - 1000n);
    const d = floor(140n * (total(v, "DET") - main) + 1000n * det, det * trunc) * trunc;
    const h = 4000n + floor(550n * (total(v, "DHT") - sub), div);
    const t = 1000n + floor(112n * (total(v, "TEN") - sub), div);
    const m = 100n + floor(BigInt(mod.ap) * (floor(total(v, "STR") * 105n, 100n) - main), main);
    const weapon = floor(main * BigInt(schema.statModifiers.STR), 1000n) + contribution(v, "PDMG");
    const action = BigInt(profile.alpha) * normal * 1000n + BigInt(profile.beta) * k * 1000000n + BigInt(profile.gamma) * c * normal;
    const divisor = BigInt(profile.coefficientDivisor);
    assert.equal(action % divisor, 0n, "Independent action numerator is not divisible by recorded scale");
    const common = weapon * m * d * t * h;
    return { numerator: common * action, denominator: 40000000000000n * 1000000000n * BigInt(profile.duration),
      product: common * (action / divisor), gcd: actualGcd(v) };
  }
  return { actualGcd, evaluate };
}

function tracker() { return { best: undefined, ties: [] }; }
function consider(target, score, witness) {
  const comparison = target.best ? compare(score, target.best) : 1n;
  if (comparison < 0n) return;
  if (comparison > 0n) { target.best = score; target.ties = []; }
  target.ties.push(witness());
}

async function validateSyncDomain(scenario, entries, oracle, runtime, modules) {
  const config = entries[0].value.config;
  const prepared = runtime.prepareSearch(config, {}, false, true, undefined, false);
  const options = prepared.options;
  const candidateSha256 = hash({ slots: options.slots, foods: options.foods });
  assert.equal(candidateSha256, entries[0].value.candidateSha256);
  assert.equal(candidateSha256, oracle.provenance.candidateSha256);
  assert.equal(oracle.provenance.inputSha256, entries[0].value.inputSha256);
  const independent = makeIndependentEvaluator(runtime.gameData, prepared, modules.calculateBaseStats(prepared.jobSchema, prepared.jobLevel, 0));
  const profiles = new Map(entries[0].value.profiles.map(profile => [profile.gcd, profile]));
  const identities = options.slots.map(slot => slot.map(modules.equipmentCandidateIdentity));
  const identityToCandidate = options.slots.map((slot, index) => new Map(slot.map((candidate, i) => [identities[index][i], candidate])));
  const slotOrder = prepared.slots.map((slot, index) => ({ name: slot.name, index })).sort((a, b) => a.name.localeCompare(b.name));
  const foodKeys = options.foods.map(food => food.physicalKey ?? JSON.stringify(food));
  const evidenceByGcd = new Map([...profiles.keys()].map(g => [g, new Map()]));
  const records = [];
  for (const entry of entries.filter(item => item.value.mode === "certificate")) {
    for (const branch of entry.value.branches) {
      const removed = branch.removedCandidates ?? [];
      if (!removed.length) continue;
      const incumbent = branch.certificateIncumbent;
      assert.equal(incumbent.identities.length, options.slots.length);
      const selection = incumbent.identities.map((identity, slot) => {
        const candidate = identityToCandidate[slot].get(identity);
        assert.ok(candidate, "Certificate incumbent is outside original slot");
        return candidate;
      });
      assert.equal(modules.hasUniqueRingConflict(selection), false);
      const foods = options.foods.filter(food => food.itemId === incumbent.foodId);
      assert.equal(foods.length, 1);
      const vector = runtime.getAttributeVector(selection, foods[0], options.attributeIds, undefined, options.statIndexes);
      const exact = independent.evaluate(vector, branch.profile);
      assert.equal(exact.gcd, branch.profile.gcd);
      equalScore(exact, incumbent.score, "Recorded certificate incumbent score differs from independent formula");
      for (const evidence of removed) {
        assert.ok(identityToCandidate[evidence.slotIndex].has(evidence.identity), "Deleted candidate was not in original slot");
        assert.notEqual(incumbent.identities[evidence.slotIndex], evidence.identity, "Certificate removed its pinned incumbent");
        assert.equal(BigInt(evidence.incumbentProduct), exact.product);
        const record = { file: entry.file, gcd: branch.profile.gcd, evidence, incumbent: exact,
          upper: rational({ numerator: evidence.upperNumerator, denominator: evidence.upperDenominator }, true),
          completionsChecked: 0, trueMaximumProduct: 0n };
        records.push(record);
        const key = `${evidence.slotIndex}:${evidence.identity}`;
        const map = evidenceByGcd.get(branch.profile.gcd);
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(record);
      }
    }
  }
  const counts = { equipmentCartesian: options.slots.reduce((n, slot) => n * BigInt(slot.length), 1n), enumerated: 0,
    uniqueRejected: 0, legalEquipment: 0, legalFoodPairs: 0, allowedFoodPairs: 0, rejectedGcdPairs: 0,
    certificateCompletionChecks: 0, tiedIdentityRetentionChecks: 0 };
  const selection = [], indexes = [];
  const global = tracker();
  const branches = new Map([...profiles.keys()].map(g => [g, { tracker: tracker(), feasiblePairs: 0 }]));
  const values = new Map();
  function walk(slot) {
    if (slot < options.slots.length) {
      for (let index = 0; index < options.slots[slot].length; index++) {
        selection[slot] = options.slots[slot][index]; indexes[slot] = index; walk(slot + 1);
      }
      return;
    }
    counts.enumerated++;
    if (modules.hasUniqueRingConflict(selection)) { counts.uniqueRejected++; return; }
    counts.legalEquipment++;
    for (let foodIndex = 0; foodIndex < options.foods.length; foodIndex++) {
      const food = options.foods[foodIndex];
      counts.legalFoodPairs++;
      const vector = runtime.getAttributeVector(selection, food, options.attributeIds, undefined, options.statIndexes);
      const g = independent.actualGcd(vector), profile = profiles.get(g);
      if (!profile) { counts.rejectedGcdPairs++; continue; }
      assert.equal(config.speedMin, undefined);
      assert.equal(config.speedMax, undefined);
      const key = vector.join(",");
      let exact = values.get(key);
      if (!exact) { exact = independent.evaluate(vector, profile); values.set(key, exact); }
      counts.allowedFoodPairs++;
      branches.get(g).feasiblePairs++;
      const witness = () => ({ key: JSON.stringify({ slots: slotOrder.map(({ name, index }) =>
        [name, identities[index][indexes[index]]]), food: foodKeys[foodIndex] }),
        identities: identities.map((slotKeys, index) => slotKeys[indexes[index]]), gcd: g });
      consider(global, exact, witness);
      consider(branches.get(g).tracker, exact, witness);
      const map = evidenceByGcd.get(g);
      for (let slotIndex = 0; slotIndex < selection.length; slotIndex++) {
        for (const record of map.get(`${slotIndex}:${identities[slotIndex][indexes[slotIndex]]}`) ?? []) {
          assert.ok(compare(exact, record.incumbent) < 0n, "Deleted candidate has a legal completion at or above certificate incumbent");
          assert.ok(record.upper.numerator >= exact.product * record.upper.denominator,
            "Recorded certificate upper bound is below a true independent complete factor product");
          record.completionsChecked++;
          record.trueMaximumProduct = record.trueMaximumProduct > exact.product ? record.trueMaximumProduct : exact.product;
          counts.certificateCompletionChecks++;
        }
      }
    }
  }
  walk(0);
  assert.equal(BigInt(counts.enumerated), counts.equipmentCartesian);
  assert.equal(counts.enumerated, counts.uniqueRejected + counts.legalEquipment);
  assert.equal(counts.legalFoodPairs, counts.legalEquipment * options.foods.length);
  assert.equal(counts.allowedFoodPairs + counts.rejectedGcdPairs, counts.legalFoodPairs);
  assert.equal(counts.enumerated, oracle.counts.enumeratedEquipmentSelections);
  assert.equal(counts.legalFoodPairs, oracle.counts.legalEquipmentFoodPairs);
  assert.equal(counts.allowedFoodPairs, oracle.counts.scoredPairs);
  equalScore(global.best, oracle.global.score, "Re-enumerated global score differs from saved independent oracle");
  function checkTies(target, saved) {
    const keys = target.ties.map(tie => tie.key).sort();
    assert.equal(new Set(keys).size, keys.length);
    assert.equal(keys.length, saved.tiedIdentityCount);
    assert.equal(hash(keys.join("\n")), saved.tiedIdentitySha256);
  }
  checkTies(global, oracle.global);
  for (const [g, branch] of branches) {
    const saved = oracle.branches.find(item => item.gcd === g);
    assert.equal(branch.feasiblePairs, saved.feasiblePairs);
    equalScore(branch.tracker.best, saved.newModel.score, "Re-enumerated per-GCD score differs from oracle");
    checkTies(branch.tracker, saved.newModel);
    for (const entry of entries) {
      const result = entry.value.branches.find(item => item.profile.gcd === g).result;
      equalScore(result.score, branch.tracker.best, "MIP score differs from independent oracle");
      for (const tied of branch.tracker.ties) {
        for (const record of records.filter(record => record.file === entry.file && record.gcd === g)) {
          assert.notEqual(tied.identities[record.evidence.slotIndex], record.evidence.identity, "An optimal tied identity was removed");
          counts.tiedIdentityRetentionChecks++;
        }
      }
    }
  }
  for (const entry of entries) equalScore(entry.value.winner.score, global.best, "MIP global winner differs from oracle");
  return { scenario, completeRawEnumeration: true, counts: { ...counts, equipmentCartesian: String(counts.equipmentCartesian) },
    distinctAllowedVectors: values.size, allPerGcdAndGlobalScoresMatchOracle: true, allTiedIdentitiesPreserved: true,
    scope: "Every original legal completion at each certificate's own fixed GCD; no cross-GCD candidate exclusion is implied",
    certificateRecords: records.map(record => ({ file: record.file, gcd: record.gcd,
      slotIndex: record.evidence.slotIndex, identity: record.evidence.identity, method: record.evidence.method,
      completionsChecked: record.completionsChecked, trueMaximumProduct: String(record.trueMaximumProduct),
      recordedUpperNumerator: String(record.upper.numerator), recordedUpperDenominator: String(record.upper.denominator),
      incumbentProduct: String(record.incumbent.product), independentlyVerified: true,
      emptyFixedGcdCompletionDomain: record.completionsChecked === 0 })) };
}

export async function verifyResults(directory) {
  const started = performance.now(), destination = resolve(directory);
  const files = (await readdir(destination)).filter(file => file.endsWith(".json") && file !== "verification.json").sort();
  const documents = new Map();
  const fileHashes = {};
  for (const file of files) {
    const encoded = await readFile(join(destination, file));
    documents.set(file, JSON.parse(encoded)); fileHashes[file] = hash(encoded);
  }
  const entries = [...documents].filter(([, value]) => value.scenario && value.mode).map(([file, value]) => ({ file, value }));
  assert.ok(entries.length > 0, "No completed case JSON documents found");
  for (const [file, value] of documents) if (Array.isArray(value.entries)) {
    for (const entry of value.entries) {
      const actual = documents.get(entry.file);
      assert.ok(actual, `${file} refers to a missing sample`);
      assert.equal(entry.sha256, fileHashes[entry.file], "Suite file digest mismatch");
      assert.equal(actual.scenario, entry.scenario, "Suite sample lost scenario identity");
      assert.equal(actual.mode, entry.mode);
      assert.equal(entry.exitCode, 0, "Suite child did not complete successfully");
      assert.equal(entry.killedByWatchdog, false);
      nonnegative(entry.coldProcessWallMs, "cold process time");
    }
  }
  const groups = new Map();
  for (const entry of entries) {
    validateCase(entry);
    const peers = groups.get(entry.value.scenario) ?? [];
    if (peers.length) {
      const first = peers[0].value;
      for (const key of ["inputSha256", "candidateSha256"]) assert.equal(entry.value[key], first[key], `Inconsistent ${key}`);
      for (const key of ["config", "profiles", "candidates"]) assert.deepEqual(entry.value[key], first[key]);
      for (const key of ["binarySha256", "repositoryCommit", "node", "gameVersion", "runtimeSha256",
        "runnerSha256", "certificateSha256", "supportSha256", "highsPackageVersion"])
        assert.equal(entry.value.provenance[key], first.provenance[key], `Inconsistent provenance ${key}`);
      equalScore(entry.value.winner.score, first.winner.score, "Same-scenario cross-mode global score mismatch");
      for (const branch of entry.value.branches) {
        const reference = first.branches.find(item => item.profile.gcd === branch.profile.gcd);
        assert.equal(branch.status, reference.status);
        if (branch.result) equalScore(branch.result.score, reference.result.score, "Same-scenario per-GCD score mismatch");
      }
    }
    peers.push(entry); groups.set(entry.value.scenario, peers);
  }
  const runtime = await bootstrap();
  const [{ hasUniqueRingConflict }, { equipmentCandidateIdentity }, { calculateBaseStats }] = await Promise.all([
    import("../../../src/domain/search/exact-mip/ring-domain.ts"),
    import("../../../src/domain/search/equipment-identity.ts"), import("../../../src/domain/rules.ts"),
  ]);
  const modules = { hasUniqueRingConflict, equipmentCandidateIdentity, calculateBaseStats };
  const sync = [];
  for (const [scenario, oracleName] of [["sync-fixed", "oracle-fixed.json"], ["sync-foods", "oracle-foods.json"]]) {
    assert.ok(groups.has(scenario), `Missing ${scenario} benchmark cases`);
    assert.ok(groups.get(scenario).some(entry => entry.value.mode === "certificate"), `Missing ${scenario} certificate cases`);
    const oracle = documents.get(oracleName);
    assert.ok(oracle, `Missing ${oracleName}`);
    assert.equal(oracle.verification.independentBigIntFormula, true);
    assert.deepEqual(oracle.verification.crossCheckGcds, [194, 196, 200]);
    sync.push(await validateSyncDomain(scenario, groups.get(scenario), oracle, runtime, modules));
  }
  return { status: "passed", runAt: new Date().toISOString(), casesChecked: entries.length,
    scopes: { allCaseInputsAndCrossModeExactScores: true, allCaseCompletionAndValidationFlags: true,
      syncRawDomainIndependentEnumeration: true, syncCertificateBoundsAndStrictRemoval: true,
      meldAndWideCertificateBounds: "Not exhaustively enumerated; these domains rely on certificate theorem and full MIP comparison" },
    scenarios: [...groups].map(([scenario, peers]) => ({ scenario, files: peers.map(entry => entry.file),
      inputSha256: peers[0].value.inputSha256, perGcdAndGlobalScoresAgree: true })),
    sync, fileSha256: fileHashes, verifierSha256: hash(await readFile(new URL(import.meta.url))),
    elapsedMs: performance.now() - started };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const value = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
  const directory = value("--directory", args[0] && !args[0].startsWith("--") ? args[0] : "docs/research/职业循环建模/real-candidate-results");
  const result = await verifyResults(directory);
  const encoded = `${JSON.stringify(result, null, 2)}\n`;
  await writeFile(value("--output", join(directory, "verification.json")), encoded, "utf8");
  process.stdout.write(encoded);
}
