// Research-only, process-local source hook. Never imported by production.
// Real equipment/formulas are retained; the action profiles below are synthetic.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";

const root = new URL("../../../", import.meta.url);
const effectsUrl = new URL("src/domain/search/equipped-effects.ts", root).href;
const bridgeKey = Symbol.for("ffxiv.real-job-model.research-critical-factory");
const anchors = new Map([
  [194, { alpha: 13040, beta: 4000, gamma: 3200 }],
  [196, { alpha: 12200, beta: 4500, gamma: 2880 }],
  [200, { alpha: 11360, beta: 5000, gamma: 2640 }],
]);
const state = {
  sourceSha256: undefined, transformedSourceSha256: undefined,
  hookHits: 0, captureMatches: 0, criticalMatches: 0,
  evaluatorCreations: 0, researchEvaluatorCreations: 0,
  evaluatorCalls: 0, differentFromLegacy: 0, numericSafetyChecks: 0,
  maximumCritical: 0, profileCreations: {}, profileCalls: {},
};
let activeProfile;
let bootstrapped;
let modules;
const compiledProfiles = new Map();
const knownProfiles = new WeakSet();
const referenceEvaluators = new WeakMap();

function gcd(a, b) {
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}

function compileProfile(input) {
  if (knownProfiles.has(input)) return input;
  const { gcd: g, alpha, beta, gamma, duration } = input;
  for (const [name, value] of Object.entries({ gcd: g, alpha, beta, gamma, duration })) {
    assert.ok(Number.isSafeInteger(value) && value >= 0, `Invalid synthetic profile ${name}: ${value}`);
  }
  assert.ok(g > 0 && duration > 0 && alpha + beta + gamma > 0);
  const key = [g, alpha, beta, gamma, duration].join(":");
  if (compiledProfiles.has(key)) return compiledProfiles.get(key);
  const a = BigInt(alpha), b = BigInt(beta), c = BigInt(gamma);
  // Q(w) = 1e9 [alpha N + beta K + gamma c N], with w = CRT tier - 50.
  const rawCoefficients = [1020000000n * a + 1400000000n * b + 51000000n * c,
    450000n * a + 1000000n * b + 1042500n * c, 1000n * a + 500n * c, c];
  const divisor = rawCoefficients.reduce((value, coefficient) => gcd(value, coefficient), 0n);
  const coefficients = rawCoefficients.map(value => {
    const reduced = value / divisor;
    assert.ok(reduced <= BigInt(Number.MAX_SAFE_INTEGER), "Polynomial coefficient exceeds safe Number range");
    return Number(reduced);
  });
  const profile = Object.freeze({ gcd: g, alpha, beta, gamma, duration,
    synthetic: true, key, coefficientDivisor: String(divisor),
    coefficients: Object.freeze(coefficients), rawCoefficients: Object.freeze(rawCoefficients.map(String)),
    source: "Synthetic algebraic action profile; not an observed or recommended rotation" });
  compiledProfiles.set(key, profile);
  knownProfiles.add(profile);
  return profile;
}

/** Unknown GCDs explicitly reuse one synthetic anchor; no interpolation is implied. */
export function profileForGcd(g, anchorGcd = 200) {
  assert.ok(anchors.has(anchorGcd), "Unknown synthetic anchor");
  return compileProfile({ gcd: g, ...(anchors.get(g) ?? anchors.get(anchorGcd)), duration: 120 });
}

/** The next factory captures this immutable profile; existing evaluators keep theirs. */
export function setProfile(profile) {
  activeProfile = compileProfile(profile);
  return activeProfile;
}

export function polynomialAt(w, profile) {
  assert.ok(Number.isSafeInteger(w) && w >= 0, `Unsupported MNK CRT offset: ${w}`);
  const { coefficients } = compileProfile(profile);
  let result = coefficients[3];
  for (let index = 2; index >= 0; index--) {
    const multiplied = result * w;
    assert.ok(Number.isSafeInteger(multiplied), "Polynomial multiplication exceeds safe Number range");
    result = multiplied + coefficients[index];
    assert.ok(Number.isSafeInteger(result), "Polynomial addition exceeds safe Number range");
  }
  assert.ok(result > 0, "Critical research factor must be positive");
  state.numericSafetyChecks++;
  state.maximumCritical = Math.max(state.maximumCritical, result);
  return result;
}

function captureFactory(job) {
  state.evaluatorCreations++;
  if (job !== "MNK") return undefined;
  assert.ok(activeProfile, "Call setProfile before creating an MNK integer evaluator");
  const captured = activeProfile;
  state.researchEvaluatorCreations++;
  state.profileCreations[captured.key] = (state.profileCreations[captured.key] ?? 0) + 1;
  return (w, legacy) => {
    state.evaluatorCalls++;
    state.profileCalls[captured.key] = (state.profileCalls[captured.key] ?? 0) + 1;
    const result = polynomialAt(w, captured);
    if (result !== legacy) state.differentFromLegacy++;
    return result;
  };
}

function replaceOnce(source, needle, replacement, name) {
  const count = source.split(needle).length - 1;
  assert.equal(count, 1, `Research hook ${name} source match count`);
  state[name] = count;
  return source.replace(needle, replacement);
}

/** Must run before any production-domain import in this process. */
export async function bootstrap() {
  if (bootstrapped) return bootstrapped;
  bootstrapped = (async () => {
    const bytes = new Uint8Array(await readFile(new URL("src/data/generated-data.bin", root)));
    globalThis.__FFXIV_GENERATED_DATA_BINARY__ = bytes;
    assert.equal(globalThis[bridgeKey], undefined, "Research runtime bridge is already installed");
    globalThis[bridgeKey] = captureFactory;
    registerHooks({
      load(url, context, nextLoad) {
        const loaded = nextLoad(url, context);
        if (url !== effectsUrl) return loaded;
        assert.equal(++state.hookHits, 1, "Expected exactly one equipped-effects load");
        const original = typeof loaded.source === "string" ? loaded.source : Buffer.from(loaded.source).toString("utf8");
        state.sourceSha256 = createHash("sha256").update(original).digest("hex");
        assert.equal(state.sourceSha256, "3092c4defc8f86da7fd2eab56019c00122690f8ae6f0e215badfc693111d1ded",
          "Re-audit the research hook when production formulas change");
        let source = replaceOnce(original,
          "  const traitMultiplier = schema.traitDamageMultiplier;\n  const effects = (attributes: readonly number[]) => {",
          "  const traitMultiplier = schema.traitDamageMultiplier;\n" +
          "  const researchCritical = globalThis[Symbol.for(\"ffxiv.real-job-model.research-critical-factory\")](job);\n" +
          "  const effects = (attributes: readonly number[]) => {", "captureMatches");
        const critical = "1_000_000 + crtTier * (crtTier + (job === \"BLU\" ? 150 : 350))";
        source = replaceOnce(source, `      critical: ${critical},`,
          `      critical: researchCritical === undefined ? ${critical} : researchCritical(crtTier - 50, ${critical}),`, "criticalMatches");
        state.transformedSourceSha256 = createHash("sha256").update(source).digest("hex");
        return { ...loaded, source };
      },
    });
    setProfile(profileForGcd(200));
    const [data, effects, preparation, mip, context, attributes, attributeModel, initial] = await Promise.all([
      import(new URL("src/domain/data.ts", root)),
      import(effectsUrl),
      import(new URL("src/domain/optimizer/search-preparation.ts", root)),
      import(new URL("src/domain/search/loadout-finder-exact-mip.ts", root)),
      import(new URL("src/domain/optimizer/context.ts", root)),
      import(new URL("src/domain/search/exact-mip/attributes.ts", root)),
      import(new URL("src/domain/search/exact-mip/attribute-model.ts", root)),
      import(new URL("src/domain/search/exact-mip/initial-solution.ts", root)),
    ]);
    assert.equal(state.hookHits, 1, "equipped-effects was imported before bootstrap or hook did not run");
    modules = { gameData: data.gameData, effects, prepareSearch: preparation.prepareSearch,
      findBestLoadoutExactMip: mip.findBestLoadoutExactMip, context,
      getAttributeVector: attributes.getAttributeVector,
      buildLinearAttributeModel: attributeModel.buildLinearAttributeModel,
      greedyMipStart: initial.greedyMipStart };
    return modules;
  })();
  return bootstrapped;
}

export function factorProduct(factors) {
  const names = ["weaponDamage", "mainStat", "determination", "tenacity", "critical", "directHit"];
  return names.reduce((product, name) => {
    assert.ok(Number.isSafeInteger(factors[name]) && factors[name] > 0, `Unsafe integer factor ${name}`);
    return product * BigInt(factors[name]);
  }, 1n);
}

/** Independent explicit floating action sum, plus a unit-restored exact fraction. */
export function scoreVector(vector, profileInput, prepared) {
  assert.ok(modules, "Call bootstrap first");
  const profile = compileProfile(profileInput);
  const options = prepared.options ?? prepared;
  const job = prepared.jobId ?? options.job;
  const level = prepared.jobLevel ?? options.jobLevel;
  const clan = prepared.clanIndex ?? options.clanIndex ?? 0;
  assert.equal(job, "MNK", "Research polynomial is validated only for MNK");
  const contributions = Object.fromEntries([...options.statIndexes].map(([name, index]) => [name, vector[index] ?? 0]));
  const ordinary = modules.effects.equippedEffects(job, level, contributions, clan);
  assert.ok(ordinary);
  let evaluators = referenceEvaluators.get(prepared);
  if (evaluators === undefined) {
    evaluators = new Map();
    referenceEvaluators.set(prepared, evaluators);
  }
  let evaluate = evaluators.get(profile.key);
  if (evaluate === undefined) {
    const previous = activeProfile;
    activeProfile = profile;
    try {
      evaluate = modules.effects.createIntegerDamageFactorEvaluator(job, level, options.statIndexes, clan);
    } finally {
      activeProfile = previous;
    }
    evaluators.set(profile.key, evaluate);
  }
  const inherited = evaluate(vector);
  assert.ok(inherited);
  const w = modules.effects.equippedAttributeTier(job, level, "CRT", contributions.CRT ?? 0, clan) - 50;
  const factors = { ...inherited, critical: polynomialAt(w, profile) };
  const normal = 1 + ordinary.crtChance * (ordinary.crtDamage - 1);
  const actionFactor = profile.alpha * normal + profile.beta * ordinary.crtDamage +
    profile.gamma * ordinary.crtChance * normal;
  const damage = ordinary.damage / normal * actionFactor / profile.duration;
  const trait = BigInt(Math.round(factors.traitMultiplier * 1000000));
  assert.equal(Number(trait) / 1000000, factors.traitMultiplier, "Trait needs a finer exact denominator");
  const numerator = factorProduct(factors) * BigInt(profile.coefficientDivisor) * trait;
  const denominator = 40000000000000n * 1000000000n * BigInt(profile.duration) * 1000000n;
  const reconstructed = Number(numerator) / Number(denominator);
  assert.ok(Math.abs(reconstructed - damage) <= Math.max(1e-9, Math.abs(damage) * 1e-12), "Exact factor and explicit floating action sum differ");
  return { damage, gcd: ordinary.gcd, numerator, denominator, factors,
    criticalFactor: factors.critical, scale: profile.coefficientDivisor,
    actionFactor, ordinaryDamage: ordinary.damage, profileKey: profile.key };
}

export function diagnosticsSnapshot() {
  return structuredClone({ ...state, activeProfile,
    scope: "Process-local synthetic MNK critical factor; six-factor proof path retained; no production source writes" });
}
