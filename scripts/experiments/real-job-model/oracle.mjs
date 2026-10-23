// Complete finite-domain real-equipment oracle. Action profiles are synthetic.
// The BigInt evaluator below does not use the hooked integer factor or cubic.
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { bootstrap, profileForGcd, scoreVector, diagnosticsSnapshot } from "./runtime.mjs";

const sha = value => createHash("sha256").update(typeof value === "string" || value instanceof Uint8Array ? value : JSON.stringify(value)).digest("hex");
const compare = (a, b) => a.numerator * b.denominator - b.numerator * a.denominator;
const integer = (value, name) => {
  assert.ok(Number.isSafeInteger(value), `Unsafe integer ${name}: ${value}`);
  return BigInt(value);
};
const floorDiv = (n, d) => {
  assert.ok(d > 0n);
  return n >= 0n ? n / d : -((-n + d - 1n) / d);
};
function gcd(a, b) {
  while (b !== 0n) [a, b] = [b, a % b];
  return a < 0n ? -a : a;
}
function serializeFraction(value) {
  const divisor = gcd(value.numerator, value.denominator);
  return { numerator: String(value.numerator / divisor), denominator: String(value.denominator / divisor),
    approximate: Number(value.numerator) / Number(value.denominator) };
}
function decimalFraction(value, name) {
  const numerator = Math.round(value * 1000000);
  assert.ok(Number.isSafeInteger(numerator), `Unsafe ${name}`);
  assert.equal(numerator / 1000000, value, `Inexact ${name}`);
  return { numerator: BigInt(numerator), denominator: 1000000n };
}

export function defaultOracleConfig(allFoods = false) {
  return { jobId: "MNK", minItemLevel: 790, maxItemLevel: 795,
    sync: { kind: "itemLevel", value: 735 }, clanIndex: 0,
    gcdChoices: [1.94, 1.96, 2], maximizeTenacity: false, objective: "damage",
    excludedSources: [], excludedGearIds: [], forcedGear: {}, sharedSlots: [],
    foodId: allFoods ? 0 : 49245 };
}
function newTracker() { return { best: undefined, keys: [], samples: [], count: 0 }; }
function consider(tracker, value, keyFactory, witnessFactory) {
  const comparison = tracker.best === undefined ? 1n : compare(value, tracker.best);
  if (comparison < 0n) return;
  if (comparison > 0n) {
    tracker.best = value;
    tracker.keys = [];
    tracker.samples = [];
    tracker.count = 0;
  }
  tracker.count++;
  tracker.keys.push(keyFactory());
  if (tracker.samples.length < 4) tracker.samples.push(witnessFactory());
}
function finishTracker(tracker) {
  if (tracker.best === undefined) return null;
  const keys = tracker.keys.sort();
  assert.equal(new Set(keys).size, keys.length, "Duplicate complete named-slot identity");
  return { score: serializeFraction(tracker.best), tiedIdentityCount: tracker.count,
    tiedIdentitySha256: sha(keys.join("\n")),
    identityConvention: "Named slots; ordered ring positions; complete equipment and physical food identities",
    samples: tracker.samples };
}

function independentEvaluator(gameData, prepared, baseStats) {
  const schema = gameData.jobSchemas.MNK;
  assert.equal(prepared.jobLevel, 100);
  assert.equal(schema.role, "str");
  assert.equal(schema.mainStat, "STR");
  const options = prepared.options;
  const mod = gameData.jobLevelModifiers[100];
  const main = integer(mod.main, "main"), sub = integer(mod.sub, "sub"), div = integer(mod.div, "div");
  const detDiv = integer(mod.det, "det divisor"), detTrunc = integer(mod.detTrunc, "det truncation");
  const ap = integer(mod.ap, "non-tank attack coefficient");
  const gcdModifier = integer(schema.statModifiers.gcd || 100, "gcd modifier");
  const party = decimalFraction(schema.partyBonus ?? 1.05, "party bonus");
  const trait = decimalFraction(schema.traitDamageMultiplier, "trait");
  const weaponBase = floorDiv(main * integer(schema.statModifiers.STR, "STR modifier"), 1000n);
  const contribution = (vector, name) => integer(vector[options.statIndexes.get(name) ?? -1] ?? 0, name);
  const total = (vector, name) => integer(baseStats[name] ?? (name === "TEN" ? mod.sub : 0), `base.${name}`) + contribution(vector, name);
  function actualGcd(vector) {
    const speedTier = floorDiv(130n * (total(vector, "SKS") - sub), div);
    return Number(floorDiv(floorDiv((1000n - speedTier) * 2500n, 1000n) * gcdModifier, 1000n));
  }
  function evaluate(vector, profile) {
    const offset = floorDiv(200n * (total(vector, "CRT") - sub), div);
    const chance = offset + 50n, critDamage = offset + 1400n;
    const normal = 1000000n + chance * (critDamage - 1000n);
    const directHit = 4000n + floorDiv(550n * (total(vector, "DHT") - sub), div);
    const determination = floorDiv(140n * (total(vector, "DET") - main) + 1000n * detDiv, detDiv * detTrunc) * detTrunc;
    const tenacity = 1000n + floorDiv(112n * (total(vector, "TEN") - sub), div);
    const partyMain = floorDiv(total(vector, "STR") * party.numerator, party.denominator);
    const mainStat = 100n + floorDiv(ap * (partyMain - main), main);
    const weaponDamage = weaponBase + contribution(vector, "PDMG");
    const common = weaponDamage * mainStat * determination * tenacity * directHit * trait.numerator;
    const commonDenominator = 40000000000000n * trait.denominator;
    // Independent explicit action sum: alpha N + beta K + gamma c N.
    const actionNumerator = integer(profile.alpha, "alpha") * normal * 1000n +
      integer(profile.beta, "beta") * critDamage * 1000000n +
      integer(profile.gamma, "gamma") * chance * normal;
    const newScore = { numerator: common * actionNumerator,
      denominator: commonDenominator * 1000000000n * integer(profile.duration, "duration") };
    const legacyDamage = { numerator: common * normal, denominator: commonDenominator * 1000000n };
    const g = actualGcd(vector);
    const legacyDps = { numerator: legacyDamage.numerator * 100n, denominator: legacyDamage.denominator * BigInt(g) };
    return { newScore, legacyDamage, legacyDps, gcd: g,
      independentFactors: Object.fromEntries(Object.entries({ weaponDamage, mainStat, determination, tenacity,
        directHit, criticalChanceNumerator: chance, criticalDamageNumerator: critDamage,
        normalCriticalNumerator: normal, actionNumerator }).map(([name, value]) => [name, String(value)])) };
  }
  return { actualGcd, evaluate };
}

function updateRanges(ranges, vector, names) {
  for (let index = 0; index < names.length; index++) {
    const name = names[index], value = vector[index] ?? 0;
    const prior = ranges[name];
    if (prior === undefined) ranges[name] = { min: value, max: value };
    else { prior.min = Math.min(prior.min, value); prior.max = Math.max(prior.max, value); }
  }
}

export async function evaluateOracle(config = defaultOracleConfig(), suppliedPrepared) {
  const startedAt = performance.now();
  const runtime = await bootstrap();
  const [{ hasUniqueRingConflict }, { equipmentIdentity }, { calculateBaseStats }] = await Promise.all([
    import("../../../src/domain/search/exact-mip/ring-domain.ts"),
    import("../../../src/domain/search/equipment-identity.ts"), import("../../../src/domain/rules.ts"),
  ]);
  assert.equal(config.jobId, "MNK");
  assert.equal(config.clanIndex ?? 0, 0);
  assert.equal(config.maximizeTenacity, false);
  for (const key of ["minTenacity", "toughnessMin", "toughnessMinPercent"]) assert.equal(config[key], undefined);
  const phase = performance.now();
  const prepared = suppliedPrepared ?? runtime.prepareSearch(config, {}, false, true, undefined, false);
  const preparationMs = performance.now() - phase;
  assert.ok(prepared.slots.every(slot => slot.candidates.length > 0));
  assert.ok(prepared.foods.length > 0);
  assert.ok(prepared.slots.every(slot => slot.candidates.every(candidate => candidate.resistanceWeaponAdjust === undefined)),
    "Oracle requires explicit enumeration of automatic Resistance weapon allocations");
  const gcds = [...new Set((config.gcdTarget ? [config.gcdTarget] : config.gcdChoices).map(g => Math.round(g * 100)))].sort((a, b) => a - b);
  assert.deepEqual(gcds, [194, 196, 200], "This oracle declares exactly three profiles");
  const profiles = new Map(gcds.map(g => [g, profileForGcd(g)]));
  const options = prepared.options;
  const base = calculateBaseStats(prepared.jobSchema, prepared.jobLevel, 0);
  const independent = independentEvaluator(runtime.gameData, prepared, base);
  const names = options.attributeIds.map((_, index) => [...options.statIndexes].find(([, value]) => value === index)[0]);
  const canonicalSlots = prepared.slots.map((slot, index) => ({ name: slot.name, index })).sort((a, b) => a.name.localeCompare(b.name));
  const slotKeys = prepared.slots.map(slot => slot.candidates.map(equipmentIdentity));
  const foodKeys = prepared.foods.map(food => food.physicalKey ?? JSON.stringify(food));
  const candidateSha256 = sha({ slots: options.slots, foods: options.foods });
  const selection = [], selectedIndexes = [];
  const global = newTracker(), legacyDamage = newTracker(), legacyDps = newTracker();
  const branches = new Map(gcds.map(g => [g, { newModel: newTracker(), legacyDamage: newTracker(), count: 0 }]));
  const counts = { equipmentCartesian: prepared.slots.reduce((n, slot) => n * BigInt(slot.candidates.length), 1n).toString(),
    enumeratedEquipmentSelections: 0, rejectedUniqueEquipmentSelections: 0, legalEquipmentSelections: 0,
    legalEquipmentFoodPairs: 0, rejectedGcdPairs: 0, rejectedSpeedPairs: 0, scoredPairs: 0 };
  const actualGcdCounts = {}, allLegalRanges = {}, allowedRanges = {};
  const verifiedVectors = new Map();
  let crossChecks = 0;
  const checkedGcds = new Set();
  function walk(index) {
    if (index < prepared.slots.length) {
      for (let candidate = 0; candidate < prepared.slots[index].candidates.length; candidate++) {
        selection[index] = prepared.slots[index].candidates[candidate];
        selectedIndexes[index] = candidate;
        walk(index + 1);
      }
      return;
    }
    counts.enumeratedEquipmentSelections++;
    if (hasUniqueRingConflict(selection)) { counts.rejectedUniqueEquipmentSelections++; return; }
    counts.legalEquipmentSelections++;
    for (let foodIndex = 0; foodIndex < prepared.foods.length; foodIndex++) {
      const food = prepared.foods[foodIndex];
      counts.legalEquipmentFoodPairs++;
      const vector = runtime.getAttributeVector(selection, food, options.attributeIds, undefined, options.statIndexes);
      const g = independent.actualGcd(vector);
      actualGcdCounts[g] = (actualGcdCounts[g] ?? 0) + 1;
      updateRanges(allLegalRanges, vector, names);
      const profile = profiles.get(g);
      if (!profile) { counts.rejectedGcdPairs++; continue; }
      const finalSpeed = (base.SKS ?? 0) + vector[options.statIndexes.get("SKS")];
      if ((config.speedMin !== undefined && finalSpeed < config.speedMin) || (config.speedMax !== undefined && finalSpeed > config.speedMax)) {
        counts.rejectedSpeedPairs++; continue;
      }
      const key = vector.join(",");
      let value = verifiedVectors.get(key);
      if (value === undefined) {
        value = independent.evaluate(vector, profile);
        const reference = scoreVector(vector, profile, prepared);
        assert.equal(compare(value.newScore, reference), 0n);
        assert.equal(Math.round(reference.gcd * 100), g);
        const floatingLegacy = Number(value.legacyDamage.numerator) / Number(value.legacyDamage.denominator);
        assert.ok(Math.abs(floatingLegacy - reference.ordinaryDamage) <= Math.max(1e-10, floatingLegacy * 1e-12));
        verifiedVectors.set(key, value);
        checkedGcds.add(g);
        crossChecks++;
      }
      assert.equal(value.gcd, g);
      counts.scoredPairs++;
      branches.get(g).count++;
      updateRanges(allowedRanges, vector, names);
      const keyFactory = () => JSON.stringify({ slots: canonicalSlots.map(({ name, index: slot }) =>
        [name, slotKeys[slot][selectedIndexes[slot]]]), food: foodKeys[foodIndex] });
      const witnessFactory = () => ({ gcd: g, profileKey: profile.key, vector: [...vector],
        contributions: Object.fromEntries(names.map((name, i) => [name, vector[i]])),
        food: { itemId: food.itemId, physicalKey: foodKeys[foodIndex] },
        slots: canonicalSlots.map(({ name, index: slot }) => ({ slot: name, itemId: selection[slot].itemId,
          variantKey: selection[slot].variantKey, candidateIdentity: slotKeys[slot][selectedIndexes[slot]] })),
        newScore: serializeFraction(value.newScore), legacyDamage: serializeFraction(value.legacyDamage),
        legacyDps: serializeFraction(value.legacyDps), independentFactors: value.independentFactors });
      consider(global, value.newScore, keyFactory, witnessFactory);
      consider(legacyDamage, value.legacyDamage, keyFactory, witnessFactory);
      consider(legacyDps, value.legacyDps, keyFactory, witnessFactory);
      consider(branches.get(g).newModel, value.newScore, keyFactory, witnessFactory);
      consider(branches.get(g).legacyDamage, value.legacyDamage, keyFactory, witnessFactory);
    }
  }
  const enumerationStartedAt = performance.now();
  walk(0);
  const enumerationMs = performance.now() - enumerationStartedAt;
  assert.equal(BigInt(counts.enumeratedEquipmentSelections), BigInt(counts.equipmentCartesian));
  assert.equal(counts.enumeratedEquipmentSelections, counts.legalEquipmentSelections + counts.rejectedUniqueEquipmentSelections);
  assert.equal(counts.legalEquipmentFoodPairs, counts.legalEquipmentSelections * prepared.foods.length);
  assert.equal(counts.legalEquipmentFoodPairs, counts.scoredPairs + counts.rejectedGcdPairs + counts.rejectedSpeedPairs);
  assert.equal(counts.scoredPairs, [...branches.values()].reduce((n, branch) => n + branch.count, 0));
  assert.deepEqual([...checkedGcds].sort(), gcds);
  const newWinner = global.samples[0], oldWinner = legacyDamage.samples[0];
  const parsed = q => ({ numerator: BigInt(q.numerator), denominator: BigInt(q.denominator) });
  const counterfactual = { newWinnerLegacyDamage: newWinner.legacyDamage,
    legacyDamageWinnerNewScore: oldWinner.newScore,
    strictRankingReversal: compare(parsed(newWinner.newScore), parsed(oldWinner.newScore)) > 0n &&
      compare(parsed(oldWinner.legacyDamage), parsed(newWinner.legacyDamage)) > 0n };
  const [binary, oracleSource, runtimeSource] = await Promise.all([
    readFile(new URL("../../../src/data/generated-data.bin", import.meta.url)), readFile(new URL(import.meta.url)),
    readFile(new URL("runtime.mjs", import.meta.url)),
  ]);
  return { scope: "Complete raw real-equipment enumeration for three declared synthetic MNK profiles",
    completeness: "Every raw equipment Cartesian selection and food was visited; only unique, GCD and speed constraints reject pairs",
    config, provenance: { runAt: new Date().toISOString(), node: process.version,
      repositoryCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
      gameVersion: runtime.gameData.version, binarySha256: sha(binary), oracleScriptSha256: sha(oracleSource),
      runtimeScriptSha256: sha(runtimeSource), candidateSha256,
      inputSha256: sha({ config, candidateSha256, profiles: [...profiles.values()] }) },
    prepared: { jobLevel: prepared.jobLevel, slots: prepared.slots.map(slot => ({ name: slot.name, count: slot.candidates.length })),
      foodIds: prepared.foods.map(food => food.itemId), rawPareto: false },
    profiles: [...profiles.values()], counts, actualGcdCounts,
    contributionRanges: { allLegal: allLegalRanges, allowed: allowedRanges }, global: finishTracker(global),
    branches: [...branches].map(([gcd, branch]) => ({ gcd, feasiblePairs: branch.count,
      newModel: finishTracker(branch.newModel), legacyDamage: finishTracker(branch.legacyDamage) })),
    legacyDamage: finishTracker(legacyDamage), legacyDps: finishTracker(legacyDps), counterfactual,
    verification: { independentBigIntFormula: true, independentFormulaUniqueVectors: verifiedVectors.size,
      independentFormulaCoveredPairs: counts.scoredPairs, runtimeScoreVectorCrossChecks: crossChecks,
      crossCheckGcds: [...checkedGcds].sort(),
      crossCheckScope: "Every distinct allowed attribute vector; all remaining pairs reuse an exactly equal checked vector",
      fixedGearsetValidation: "Performed separately for each MIP winner in run-case; oracle retains complete original candidate identities" },
    hookStatistics: diagnosticsSnapshot(),
    timing: { preparationMs, enumerationMs, totalMs: performance.now() - startedAt, meaning: "Complete enumeration oracle; no MIP invoked" } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let output, allFoods = false;
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--all-foods") allFoods = true;
    else if (args[index] === "--output") { assert.ok(args[index + 1]); output = args[++index]; }
    else throw new Error(`Unknown argument: ${args[index]}`);
  }
  const result = await evaluateOracle(defaultOracleConfig(allFoods));
  const encoded = `${JSON.stringify(result, null, 2)}\n`;
  if (output) { await mkdir(dirname(resolve(output)), { recursive: true }); await writeFile(output, encoded, "utf8"); }
  else process.stdout.write(encoded);
}
