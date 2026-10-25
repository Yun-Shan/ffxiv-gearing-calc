import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { closeSync, createReadStream, openSync } from "node:fs";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { StringDecoder } from "node:string_decoder";
import { decodeGeneratedData } from "../../../src/data/binary/decode.ts";
import { compareHistoricalTiming, evaluateOptimizationTarget } from "./timing-acceptance.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, "../../..");
const RUNS_ROOT = path.join(ROOT, "docs", "search-optimization", "acceptance-runs");
const DEFAULT_TIMEOUT_MS = 300_000;
const CHILD_HEAP_CAP_MIB = 2_560;
const TARGET_MS_PER_JOB = 30_000;
let interruptedSignal = null;
let activeChild;
let forceTerminationTimer;

function optimizationTargetMs(jobCount) {
  return Math.max(0, jobCount) * TARGET_MS_PER_JOB;
}

function handleRunnerSignal(signal) {
  if (interruptedSignal !== null) {
    activeChild?.kill("SIGKILL");
    return;
  }
  interruptedSignal = signal;
  if (activeChild === undefined) return;
  activeChild.kill("SIGTERM");
  forceTerminationTimer = setTimeout(() => activeChild?.kill("SIGKILL"), 5_000);
  forceTerminationTimer.unref();
}

process.on("SIGINT", () => handleRunnerSignal("SIGINT"));
process.on("SIGTERM", () => handleRunnerSignal("SIGTERM"));

const ALL_NON_WEAPON_SLOTS = [
  "head", "body", "hands", "legs", "feet", "earrings", "necklace", "bracelet", "ring", "ring2",
];

function savedSoloThresholds(recordId, scores, matchingRecordCounts, historyRunId = "20261009T165822206Z", sourceFilename = "result.json") {
  return Object.fromEntries(Object.entries(scores).map(([job, minimum]) => [job, {
    minimum,
    historyLabel: "相同完整场景输入下已保存 Node 记录的最高 soloOptimum.objectiveScore",
    matchingRecordCount: matchingRecordCounts[job],
    source: {
      record: "docs/search-optimization/耗时优化记录.7z",
      archivedRunId: historyRunId,
      caseId: recordId,
      sourceFilename,
      jsonPointer: `/output/jobs/${job}/soloOptimum/objectiveScore`,
    },
  }]));
}

const CASES = [
  {
    id: "single-blm-sync735-730-795-damage",
    title: "BLM 单职业，同步 735，730–795，damage",
    jobs: ["BLM"], minItemLevel: 730, maxItemLevel: 795, syncLevel: 735,
    objective: "damage", metric: "damagePerPotency", minimum: 91.6344764121696,
    historyMs: 3025, historyLabel: "本轮全场景验收完整证明",
    nineRound: { minMs: 3673, averageMs: 4093, maxMs: 4266 },
    historySource: "docs/search-optimization/搜索耗时优化总结.md",
    commonSlots: [], foodStrategy: "independent", strategyTags: ["single", "job-count-1", "sync", "objective-damage"],
  },
  {
    id: "single-brd-unsynced-770-795-dps",
    title: "BRD 单职业，无同步，770–795，DPS",
    jobs: ["BRD"], minItemLevel: 770, maxItemLevel: 795,
    objective: "dps", metric: "damagePerSecond", minimum: 50.07705056381793,
    historyMs: 11237, historyLabel: "本轮全场景验收完整证明",
    nineRound: { minMs: 13729, averageMs: 15003, maxMs: 16010 },
    historySource: "docs/search-optimization/搜索耗时优化总结.md",
    commonSlots: [], foodStrategy: "independent", strategyTags: ["single", "job-count-1", "unsynced", "objective-dps"],
  },
  {
    id: "rdm-blm-780-795-shared-all-damage",
    title: "RDM+BLM，无同步，780–795，共享非武器装备与食物，damage",
    jobs: ["RDM", "BLM"], minItemLevel: 780, maxItemLevel: 795,
    objective: "damage", expectedRatio: { numerator: "2", denominator: "1" },
    soloObjectiveScoreThresholds: savedSoloThresholds("rdm-blm-780-795-shared-all-damage", { RDM: 134.83336963078128, BLM: 134.83336963078128 }, { RDM: 5, BLM: 5 }, "20261009T165758722Z"),
    historyMs: 1222, historyLabel: "本轮全场景验收完整证明",
    nineRound: { minMs: 1749, averageMs: 1825, maxMs: 1958 },
    historySource: "docs/search-optimization/搜索耗时优化总结.md",
    commonSlots: ALL_NON_WEAPON_SLOTS, foodStrategy: "shared", strategyTags: ["joint", "joint-2", "job-count-2", "unsynced", "shared-equipment", "shared-food", "objective-damage"],
  },
  {
    id: "rdm-blm-780-795-independent-damage",
    title: "RDM+BLM，无同步，780–795，不共享装备与食物，damage",
    jobs: ["RDM", "BLM"], minItemLevel: 780, maxItemLevel: 795,
    objective: "damage", expectedRatio: { numerator: "2", denominator: "1" },
    soloObjectiveScoreThresholds: savedSoloThresholds("rdm-blm-780-795-independent-damage", { RDM: 134.83336963078128, BLM: 134.83336963078128 }, { RDM: 6, BLM: 6 }),
    historyMs: 1326, historyLabel: "本轮全场景验收完整证明",
    nineRound: { minMs: 1843, averageMs: 1971, maxMs: 2081 },
    historySource: "docs/search-optimization/搜索耗时优化总结.md",
    commonSlots: [], foodStrategy: "independent", strategyTags: ["joint", "joint-2", "job-count-2", "unsynced", "unshared-equipment", "independent-food", "objective-damage"],
  },
  {
    id: "rpr-sam-sync735-rings-pair-dps",
    title: "RPR+SAM，同步 735，730–795，共享饰品和戒指对、食物，DPS",
    jobs: ["RPR", "SAM"], minItemLevel: 730, maxItemLevel: 795, syncLevel: 735,
    objective: "dps", expectedRatio: { numerator: "2", denominator: "1" },
    soloObjectiveScoreThresholds: savedSoloThresholds("rpr-sam-sync735-rings-pair-dps", { RPR: 28.645899062799366, SAM: 32.661898805812505 }, { RPR: 4, SAM: 4 }),
    historyMs: 8010, historyLabel: "本轮全场景验收完整证明",
    nineRound: { minMs: 11299, averageMs: 12003, maxMs: 12426 },
    historySource: "docs/search-optimization/搜索耗时优化总结.md",
    commonSlots: ["earrings", "necklace", "bracelet", "ring", "ring2"], foodStrategy: "shared",
    strategyTags: ["joint", "joint-2", "job-count-2", "sync", "shared-equipment", "shared-food", "objective-dps"],
  },
  {
    id: "rdm-pct-sync735-gcd-shared-armor-dps",
    title: "RDM+PCT，同步 735，730–795，共享防具与常规饰品、食物，受 GCD 约束，DPS",
    jobs: ["RDM", "PCT"], minItemLevel: 730, maxItemLevel: 795, syncLevel: 735,
    objective: "dps", expectedRatio: { numerator: "2", denominator: "1" },
    jobConstraints: { RDM: { gcdChoices: [2.48] }, PCT: { gcdChoices: [2.48, 2.5] } },
    soloObjectiveScoreThresholds: savedSoloThresholds("rdm-pct-sync735-gcd-shared-armor-dps", { RDM: 36.769120086402275, PCT: 36.769120086402275 }, { RDM: 4, PCT: 4 }),
    historyMs: 4789, historyLabel: "当前项目最快",
    nineRound: { minMs: 5893, averageMs: 6319, maxMs: 6597 },
    historySource: "docs/search-optimization/耗时优化记录.7z",
    commonSlots: ["head", "body", "hands", "legs", "feet", "earrings", "necklace", "bracelet"], foodStrategy: "shared",
    strategyTags: ["joint", "joint-2", "job-count-2", "sync", "shared-equipment", "shared-food", "gcd-constrained", "objective-dps"],
  },
  {
    id: "vpr-mch-sync735-rings-pair-dps",
    title: "VPR+MCH，同步 735，730–795，共享饰品和戒指对、食物，DPS",
    jobs: ["VPR", "MCH"], minItemLevel: 730, maxItemLevel: 795, syncLevel: 735,
    objective: "dps", expectedRatio: { numerator: "8673", denominator: "4337" },
    soloObjectiveScoreThresholds: savedSoloThresholds("vpr-mch-sync735-rings-pair-dps", { VPR: 33.22292791883143, MCH: 34.227896116543384 }, { VPR: 9, MCH: 15 }),
    historyMs: 35671, historyLabel: "本轮全场景验收完整证明",
    nineRound: { minMs: 54129, averageMs: 58434, maxMs: 60498 },
    historySource: "docs/search-optimization/搜索耗时优化总结.md",
    commonSlots: ["earrings", "necklace", "bracelet", "ring", "ring2"], foodStrategy: "shared",
    strategyTags: ["joint", "joint-2", "job-count-2", "sync", "shared-equipment", "shared-food", "objective-dps"],
  },
  {
    id: "vpr-mch-sync735-wide715-795-rings-dps",
    title: "VPR+MCH，同步 735，715–795 宽域，共享饰品和戒指对、食物，DPS",
    jobs: ["VPR", "MCH"], minItemLevel: 715, maxItemLevel: 795, syncLevel: 735,
    objective: "dps", expectedRatio: { numerator: "8673", denominator: "4337" },
    soloObjectiveScoreThresholds: savedSoloThresholds("vpr-mch-sync735-wide715-795-rings-dps", { VPR: 33.22292791883143, MCH: 34.227896116543384 }, { VPR: 3, MCH: 3 }, "20261009T175846780Z"),
    historyMs: 62765, historyLabel: "本轮全场景验收完整证明",
    nineRound: { minMs: 114703, averageMs: 116078, maxMs: 119181 },
    historySource: "docs/search-optimization/搜索耗时优化总结.md",
    commonSlots: ["earrings", "necklace", "bracelet", "ring", "ring2"], foodStrategy: "shared",
    strategyTags: ["joint", "joint-2", "job-count-2", "sync", "wide-range", "shared-equipment", "shared-food", "objective-dps", "stress"],
  },
  {
    id: "rdm-blm-pct-sync735-gcd-shared-all-dps",
    title: "RDM+BLM+PCT，同步 735，730–795，共享非武器装备与食物、受 GCD 约束，DPS",
    jobs: ["RDM", "BLM", "PCT"], minItemLevel: 730, maxItemLevel: 795, syncLevel: 735,
    objective: "dps", expectedRatio: { numerator: "3", denominator: "1" },
    jobConstraints: { RDM: { gcdChoices: [2.48] }, BLM: { gcdChoices: [2.48, 2.5] }, PCT: { gcdChoices: [2.48, 2.5] } },
    soloObjectiveScoreThresholds: savedSoloThresholds("rdm-blm-pct-sync735-gcd-shared-all-dps", { RDM: 36.769120086402275, BLM: 36.769120086402275, PCT: 36.769120086402275 }, { RDM: 6, BLM: 6, PCT: 6 }),
    historyMs: 5783, historyLabel: "历史最快",
    nineRound: { minMs: 8572, averageMs: 8838, maxMs: 9366 },
    commonSlots: ALL_NON_WEAPON_SLOTS, foodStrategy: "shared",
    strategyTags: ["joint", "joint-3", "job-count-3", "sync", "shared-equipment", "shared-food", "gcd-constrained", "objective-dps"],
  },
  {
    id: "brd-dnc-mch-sync735-shared-all-dps",
    title: "BRD+DNC+MCH，同步 735，730–795，共享非武器装备与食物，DPS",
    jobs: ["BRD", "DNC", "MCH"], minItemLevel: 730, maxItemLevel: 795, syncLevel: 735,
    objective: "dps", expectedRatio: { numerator: "3", denominator: "1" },
    soloObjectiveScoreThresholds: savedSoloThresholds("brd-dnc-mch-sync735-shared-all-dps", { BRD: 34.227896116543384, DNC: 34.227896116543384, MCH: 34.227896116543384 }, { BRD: 6, DNC: 6, MCH: 6 }),
    historyMs: 11227, historyLabel: "本轮全场景验收完整证明",
    nineRound: { minMs: 26173, averageMs: 27107, maxMs: 28478 },
    historySource: "docs/search-optimization/搜索耗时优化总结.md",
    commonSlots: ALL_NON_WEAPON_SLOTS, foodStrategy: "shared",
    strategyTags: ["joint", "joint-3", "job-count-3", "sync", "shared-equipment", "shared-food", "objective-dps"],
  },
  {
    id: "brd-dnc-mch-vpr-unsynced-independent-dps",
    title: "BRD+DNC+MCH+VPR，无同步，770–795，不共享装备与食物，DPS",
    jobs: ["BRD", "DNC", "MCH", "VPR"], minItemLevel: 770, maxItemLevel: 795,
    objective: "dps", expectedRatio: { numerator: "4", denominator: "1" },
    soloObjectiveScoreThresholds: savedSoloThresholds("brd-dnc-mch-vpr-unsynced-independent-dps", { BRD: 50.07705056381793, DNC: 50.07705056381793, MCH: 50.07705056381793, VPR: 48.5175189601382 }, { BRD: 4, DNC: 4, MCH: 4, VPR: 4 }),
    historyMs: 22919, historyLabel: "本轮全场景验收完整证明",
    nineRound: { minMs: 30886, averageMs: 31988, maxMs: 33120 },
    historySource: "docs/search-optimization/搜索耗时优化总结.md",
    commonSlots: [], foodStrategy: "independent",
    strategyTags: ["joint", "joint-4", "job-count-4", "unsynced", "unshared-equipment", "independent-food", "objective-dps"],
  },
  {
    id: "brd-dnc-mch-vpr-sync735-wide715-795-shared-accessories-dps",
    title: "BRD+DNC+MCH+VPR，同步 735，715–795 宽域，共享饰品和食物，DPS",
    jobs: ["BRD", "DNC", "MCH", "VPR"], minItemLevel: 715, maxItemLevel: 795, syncLevel: 735,
    objective: "dps", expectedRatio: { numerator: "18973495", denominator: "4744003" },
    soloObjectiveScoreThresholds: savedSoloThresholds("brd-dnc-mch-vpr-sync735-wide715-795-shared-accessories-dps", { BRD: 34.227896116543384, DNC: 34.227896116543384, MCH: 34.227896116543384, VPR: 33.22292791883143 }, { BRD: 4, DNC: 4, MCH: 4, VPR: 4 }, "20261009T175846780Z"),
    historyMs: 85205, historyLabel: "当前项目最快完整证明",
    nineRound: { minMs: 104913, averageMs: 111464, maxMs: 115853 },
    historySource: "docs/search-optimization/耗时优化记录.7z",
    commonSlots: ["earrings", "necklace", "bracelet", "ring", "ring2"], foodStrategy: "shared",
    strategyTags: ["joint", "joint-4", "job-count-4", "sync", "wide-range", "shared-equipment", "shared-food", "objective-dps", "stress"],
  },
  {
    id: "brd-dnc-mch-nin-vpr-sync735-independent-dps",
    title: "BRD+DNC+MCH+NIN+VPR，同步 735，715–795，不共享装备与食物，DPS",
    jobs: ["BRD", "DNC", "MCH", "NIN", "VPR"], minItemLevel: 715, maxItemLevel: 795, syncLevel: 735,
    objective: "dps", expectedRatio: { numerator: "5", denominator: "1" },
    soloObjectiveScoreThresholds: savedSoloThresholds("brd-dnc-mch-nin-vpr-sync735-independent-dps", { BRD: 34.227896116543384, DNC: 34.227896116543384, MCH: 34.227896116543384, NIN: 33.22292791883143, VPR: 33.22292791883143 }, { BRD: 4, DNC: 4, MCH: 4, NIN: 4, VPR: 4 }),
    historyMs: 16409, historyLabel: "当前项目最快完整证明",
    nineRound: { minMs: 20862, averageMs: 21842, maxMs: 22202 },
    historySource: "docs/search-optimization/耗时优化记录.7z",
    commonSlots: [], foodStrategy: "independent",
    strategyTags: ["joint", "joint-5", "job-count-5", "sync", "unshared-equipment", "independent-food", "objective-dps"],
  },
  {
    id: "brd-dnc-mch-nin-vpr-sync735-wide715-795-shared-accessories-dps",
    title: "BRD+DNC+MCH+NIN+VPR，同步 735，715–795 宽域，共享饰品和食物，DPS",
    jobs: ["BRD", "DNC", "MCH", "NIN", "VPR"], minItemLevel: 715, maxItemLevel: 795, syncLevel: 735,
    objective: "dps", expectedRatio: { numerator: "21682", denominator: "4337" },
    soloObjectiveScoreThresholds: savedSoloThresholds("brd-dnc-mch-nin-vpr-sync735-wide715-795-shared-accessories-dps", { BRD: 34.227896116543384, DNC: 34.227896116543384, MCH: 34.227896116543384, NIN: 33.22292791883143, VPR: 33.22292791883143 }, { BRD: 6, DNC: 6, MCH: 6, NIN: 6, VPR: 6 }, "20261009T175846780Z"),
    historyMs: 84577, historyLabel: "本轮全场景验收完整证明",
    nineRound: { minMs: 99495, averageMs: 104295, maxMs: 107112 },
    historySource: "docs/search-optimization/搜索耗时优化总结.md",
    commonSlots: ["earrings", "necklace", "bracelet", "ring", "ring2"], foodStrategy: "shared",
    strategyTags: ["joint", "joint-5", "job-count-5", "sync", "wide-range", "shared-equipment", "shared-food", "objective-dps", "stress"],
  },
  {
    id: "pld-war-drk-gnb-sync735-wide715-795-shared-all-dps",
    title: "PLD+WAR+DRK+GNB，同步 735，715–795 宽域，共享非武器装备与食物，DPS",
    jobs: ["PLD", "WAR", "DRK", "GNB"], minItemLevel: 715, maxItemLevel: 795, syncLevel: 735,
    objective: "dps", expectedRatio: { numerator: "4", denominator: "1" },
    soloObjectiveScoreThresholds: savedSoloThresholds("pld-war-drk-gnb-sync735-wide715-795-shared-all-dps", { PLD: 21.97532541211506, WAR: 22.3116902496236, DRK: 22.3116902496236, GNB: 21.97532541211506 }, { PLD: 2, WAR: 2, DRK: 2, GNB: 2 }, "20261010T080800000Z", "baseline.json"),
    historyMs: 56517, historyLabel: "本轮全场景验收完整证明",
    nineRound: { minMs: 79569, averageMs: 82531, maxMs: 85290 },
    historySource: "docs/search-optimization/搜索耗时优化总结.md",
    commonSlots: ALL_NON_WEAPON_SLOTS, foodStrategy: "shared",
    strategyTags: ["joint", "joint-4", "job-count-4", "sync", "wide-range", "tank-group", "shared-equipment", "shared-food", "objective-dps", "stress"],
  },
  {
    id: "whm-sch-ast-sge-sync735-wide715-795-shared-all-dps",
    title: "WHM+SCH+AST+SGE，同步 735，715–795 宽域，共享非武器装备与食物，DPS",
    jobs: ["WHM", "SCH", "AST", "SGE"], minItemLevel: 715, maxItemLevel: 795, syncLevel: 735,
    objective: "dps", expectedRatio: { numerator: "4", denominator: "1" },
    soloObjectiveScoreThresholds: savedSoloThresholds("whm-sch-ast-sge-sync735-wide715-795-shared-all-dps", { WHM: 36.73743006859162, SCH: 36.73743006859162, AST: 36.73743006859162, SGE: 36.73743006859162 }, { WHM: 2, SCH: 2, AST: 2, SGE: 2 }, "20261010T080800000Z", "baseline.json"),
    historyMs: 10914, historyLabel: "本轮全场景验收完整证明",
    nineRound: { minMs: 24587, averageMs: 26432, maxMs: 27334 },
    historySource: "docs/search-optimization/搜索耗时优化总结.md",
    commonSlots: ALL_NON_WEAPON_SLOTS, foodStrategy: "shared",
    strategyTags: ["joint", "joint-4", "job-count-4", "sync", "wide-range", "healer-group", "shared-equipment", "shared-food", "objective-dps", "stress"],
  },
  {
    id: "blm-smn-rdm-pct-sync735-wide715-795-shared-all-dps",
    title: "BLM+SMN+RDM+PCT，同步 735，715–795 宽域，共享非武器装备与食物，DPS",
    jobs: ["BLM", "SMN", "RDM", "PCT"], minItemLevel: 715, maxItemLevel: 795, syncLevel: 735,
    objective: "dps", expectedRatio: { numerator: "4", denominator: "1" },
    soloObjectiveScoreThresholds: savedSoloThresholds("blm-smn-rdm-pct-sync735-wide715-795-shared-all-dps", { BLM: 37.27741304836786, SMN: 37.27741304836786, RDM: 37.27741304836786, PCT: 37.27741304836786 }, { BLM: 2, SMN: 2, RDM: 2, PCT: 2 }, "20261010T080800000Z", "baseline.json"),
    historyMs: 15888, historyLabel: "当前项目最快完整证明",
    nineRound: { minMs: 19776, averageMs: 20780, maxMs: 21403 },
    historySource: "docs/search-optimization/耗时优化记录.7z",
    historySource: "docs/search-optimization/耗时优化记录.7z",
    commonSlots: ALL_NON_WEAPON_SLOTS, foodStrategy: "shared",
    strategyTags: ["joint", "joint-4", "job-count-4", "sync", "wide-range", "int-dps-group", "shared-equipment", "shared-food", "objective-dps", "stress"],
  },
];

const PACKAGE_MANIFEST_FILES = [
  "package.json",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "yarn.lock",
];
const REQUIRED_BINARY_DATA_SOURCE_FILES = [
  "src/data/binary/schema.ts",
  "src/data/binary/types.ts",
  "src/data/binary/encode.ts",
  "src/data/binary/decode.ts",
];
const RUNTIME_SOURCE_EXTENSION = /\.(?:[cm]?[jt]sx?)$/i;
const TEST_SOURCE_FILE = /(?:^|[.-])(?:test|spec)\.[^.]+$/i;

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function printUsage() {
  console.log(`用法：node docs/search-optimization/tools/run-acceptance.mjs [选项]

默认按列表顺序运行全部 ${CASES.length} 个有效速度验收条件。选项：
  --list                                  只列场景，不运行
  --case ID1,ID2                          只运行指定场景（可重复）
  --job-count N                           只运行包含 N 个职业的场景
  --strategy TAG1,TAG2                    按策略标签筛选（命中任一标签）
  --timeout-ms N|unlimited                每案最长运行时间，默认 ${DEFAULT_TIMEOUT_MS}
  --help                                  显示帮助

验收计时固定为：历史耗时低于 10 秒时增加 1 秒容忍，其余增加 10%。
优化目标预算为首个职业 0 秒，每增加一个职业增加 30 秒；目标状态会记录但不改变历史验收判定。

标签示例：single、joint、job-count-2、sync、unsynced、shared-equipment、
unshared-equipment、shared-food、independent-food、gcd-constrained、objective-dps。
过滤条件可组合使用；若组合结果为空，命令会报错而不会生成空验收记录。`);
}

function parseArgs(argv) {
  const options = { caseIds: [], strategies: [], jobCount: undefined, list: false, help: false,
    timeoutMs: DEFAULT_TIMEOUT_MS };
  const valueOptions = new Map([
    ["--case", "case"], ["--job-count", "jobCount"], ["--strategy", "strategy"],
    ["--timeout-ms", "timeoutMs"],
  ]);
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === "--list") { options.list = true; continue; }
    if (argument === "--help" || argument === "-h") { options.help = true; continue; }
    const equalIndex = argument.indexOf("=");
    const name = equalIndex < 0 ? argument : argument.slice(0, equalIndex);
    const key = valueOptions.get(name);
    if (!key) throw new Error(`不支持的参数：${argument}`);
    const value = equalIndex < 0 ? argv[++index] : argument.slice(equalIndex + 1);
    if (value === undefined || value === "") throw new Error(`${name} 缺少值`);
    if (key === "case") options.caseIds.push(...value.split(",").map((item) => item.trim()).filter(Boolean));
    else if (key === "strategy") options.strategies.push(...value.split(",").map((item) => item.trim()).filter(Boolean));
    else if (key === "jobCount") {
      const count = Number(value);
      if (!Number.isSafeInteger(count) || count < 1) throw new Error("--job-count 必须是正整数");
      options.jobCount = count;
    } else if (key === "timeoutMs") {
      if (value.trim().toLowerCase() === "unlimited") options.timeoutMs = null;
      else {
        const timeout = Number(value);
        if (!Number.isSafeInteger(timeout) || timeout <= 0) throw new Error("--timeout-ms 必须是正整数或 unlimited");
        options.timeoutMs = timeout;
      }
    }
  }
  options.caseIds = [...new Set(options.caseIds)];
  options.strategies = [...new Set(options.strategies)];
  return options;
}

function formatCase(caseItem) {
  const sync = caseItem.syncLevel === undefined ? "无同步" : `sync${caseItem.syncLevel}`;
  const common = caseItem.commonSlots.length === 0 ? "none" : caseItem.commonSlots.join(",");
  const expected = caseItem.expectedRatio
    ? `${caseItem.expectedRatio.numerator}/${caseItem.expectedRatio.denominator}`
    : caseItem.minimum !== undefined
      ? `${caseItem.metric} >= ${caseItem.minimum}`
      : "首次完整证明建立精确结果基线";
  const history = caseItem.historyMs === undefined ? "n/a" : `${caseItem.historyMs}ms`;
  const soloScores = caseItem.soloObjectiveScoreThresholds
    ? ` | soloObjectiveScore=${caseItem.jobs.map((job) => `${job}>=${caseItem.soloObjectiveScoreThresholds[job]?.minimum ?? "NO_HISTORY_MATCH"}`).join(",")}`
    : "";
  return `${caseItem.id} | ${caseItem.jobs.join("+")} | ${caseItem.minItemLevel}-${caseItem.maxItemLevel} ${sync} | common=${common} | food=${caseItem.foodStrategy} | ${caseItem.objective} | ${expected}${soloScores} | history=${history}${caseItem.historyLabel ? ` (${caseItem.historyLabel})` : ""} | target=${optimizationTargetMs(caseItem.jobs.length)}ms`;
}

function selectCases(options) {
  const caseById = new Map(CASES.map((caseItem) => [caseItem.id, caseItem]));
  const unknown = options.caseIds.filter((id) => !caseById.has(id));
  if (unknown.length) throw new Error(`未知场景 ID：${unknown.join(", ")}`);
  let selected = CASES.filter((caseItem) =>
    (options.caseIds.length === 0 || options.caseIds.includes(caseItem.id)) &&
    (options.jobCount === undefined || caseItem.jobs.length === options.jobCount) &&
    (options.strategies.length === 0 || options.strategies.some((tag) => caseItem.strategyTags.includes(tag)))
  );
  if (selected.length === 0) {
    const filters = [
      options.caseIds.length ? `case=${options.caseIds.join(",")}` : undefined,
      options.jobCount === undefined ? undefined : `job-count=${options.jobCount}`,
      options.strategies.length ? `strategy=${options.strategies.join(",")}` : undefined,
    ].filter(Boolean).join("; ");
    throw new Error(`过滤条件没有匹配任何有效场景（${filters || "无"}）`);
  }
  return selected;
}

function gitCommand(args) {
  const result = spawnSync("git", args, { cwd: ROOT, encoding: "utf8", windowsHide: true });
  if (result.error || result.status !== 0) {
    return { ok: false, error: result.error?.message ?? result.stderr?.trim() ?? `git exit ${result.status}` };
  }
  return { ok: true, stdout: result.stdout };
}

function getGitState() {
  const head = gitCommand(["rev-parse", "HEAD"]);
  const status = gitCommand(["status", "--porcelain=v1", "--untracked-files=all"]);
  const paths = status.ok
    ? status.stdout.split(/\r?\n/).filter(Boolean).map((line) => ({ status: line.slice(0, 2), path: line.slice(3) }))
    : [];
  return {
    head: head.ok ? head.stdout.trim() : null,
    dirty: paths.length > 0,
    changedPaths: paths,
    ...(head.ok ? {} : { headError: head.error }),
    ...(status.ok ? {} : { statusError: status.error }),
  };
}

function getRuntimeEnvironment() {
  const cpus = os.cpus();
  return {
    node: {
      version: process.version,
      v8Version: process.versions.v8,
      executable: process.execPath,
    },
    platform: process.platform,
    architecture: process.arch,
    cpu: {
      model: cpus[0]?.model ?? null,
      logicalCoreCount: cpus.length,
      availableParallelism: typeof os.availableParallelism === "function"
        ? os.availableParallelism()
        : null,
    },
    memoryBytes: {
      total: os.totalmem(),
      freeAtSuiteStart: os.freemem(),
    },
  };
}

async function walkFiles(directory) {
  const files = [];
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (error) { if (error?.code === "ENOENT") return files; throw error; }
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walkFiles(absolute));
    else if (entry.isFile()) files.push(absolute);
  }
  return files;
}

async function strategyFiles() {
  const sourceRoots = [
    path.join(ROOT, "src", "domain"),
    path.join(ROOT, "src", "data"),
    path.join(ROOT, "scripts", "node-tests"),
    path.join(ROOT, "docs", "search-optimization", "tools"),
  ];
  const runtimeFiles = (await Promise.all(sourceRoots.map(walkFiles))).flat()
    .filter((file) => RUNTIME_SOURCE_EXTENSION.test(file) && !TEST_SOURCE_FILE.test(path.basename(file)) &&
      !file.split(path.sep).includes("__tests__"));
  const packageFiles = PACKAGE_MANIFEST_FILES.map((file) => path.join(ROOT, file));
  const allFiles = [...new Set([...packageFiles, ...runtimeFiles])]
    .sort((left, right) => left.localeCompare(right));
  const available = [];
  for (const file of allFiles) {
    try { if ((await stat(file)).isFile()) available.push(file); } catch { /* optional runner files may not exist */ }
  }
  const missingBinarySources = REQUIRED_BINARY_DATA_SOURCE_FILES.filter((relative) =>
    !available.includes(path.join(ROOT, ...relative.split("/")))
  );
  if (missingBinarySources.length > 0) {
    throw new Error(`运行时二进制数据格式源码缺失：${missingBinarySources.join(", ")}`);
  }
  return available;
}

async function createStrategySnapshot(runDir) {
  const files = await strategyFiles();
  const records = [];
  for (const source of files) {
    const relative = path.relative(ROOT, source).split(path.sep).join("/");
    const bytes = await readFile(source);
    const target = path.join(runDir, "strategy-snapshot", ...relative.split("/"));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);
    records.push({ path: relative, sha256: sha256(bytes), bytes: bytes.byteLength, snapshot: `strategy-snapshot/${relative}` });
  }
  return records;
}

async function createDataSnapshot(runDir) {
  const source = path.join(ROOT, "src", "data", "generated-data.bin");
  const bytes = await readFile(source);
  const relative = "data-snapshot/generated-data.bin";
  const target = path.join(runDir, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, bytes);
  return { path: relative, sha256: sha256(bytes), bytes: bytes.byteLength, sourceBytes: bytes };
}

function makeInputIntegrityBaseline(strategySources, dataSnapshot) {
  return {
    capturedAt: new Date().toISOString(),
    strategySources: strategySources.map(({ path: sourcePath, sha256: digest, bytes }) => ({
      path: sourcePath,
      sha256: digest,
      bytes,
    })),
    generatedData: {
      path: "src/data/generated-data.bin",
      sha256: dataSnapshot.sha256,
      bytes: dataSnapshot.bytes,
    },
  };
}

async function captureRuntimeInputHashes() {
  const files = await strategyFiles();
  const strategySources = [];
  const captureErrors = [];
  for (const source of files) {
    const relative = path.relative(ROOT, source).split(path.sep).join("/");
    try {
      const bytes = await readFile(source);
      strategySources.push({ path: relative, sha256: sha256(bytes), bytes: bytes.byteLength });
    } catch (error) {
      if (error?.code !== "ENOENT") captureErrors.push({ path: relative, error: error?.message ?? String(error) });
    }
  }
  let dataBytes = null;
  const dataPath = "src/data/generated-data.bin";
  try { dataBytes = await readFile(path.join(ROOT, ...dataPath.split("/"))); }
  catch (error) { if (error?.code !== "ENOENT") captureErrors.push({ path: dataPath, error: error?.message ?? String(error) }); }
  return {
    checkedAt: new Date().toISOString(),
    strategySources,
    captureErrors,
    generatedData: dataBytes === null ? null : {
      path: "src/data/generated-data.bin",
      sha256: sha256(dataBytes),
      bytes: dataBytes.byteLength,
    },
  };
}

function diffInputHashes(baseline, observed) {
  const expectedFiles = new Map([
    ...baseline.strategySources.map((item) => [`strategy/${item.path}`, { ...item, kind: "strategy" }]),
    [`generated-data/${baseline.generatedData.path}`, { ...baseline.generatedData, kind: "generated-data" }],
  ]);
  const observedFiles = new Map([
    ...observed.strategySources.map((item) => [`strategy/${item.path}`, { ...item, kind: "strategy" }]),
    ...(observed.generatedData
      ? [[`generated-data/${observed.generatedData.path}`, { ...observed.generatedData, kind: "generated-data" }]]
      : []),
  ]);
  const keys = [...new Set([...expectedFiles.keys(), ...observedFiles.keys()])].sort();
  return keys.flatMap((key) => {
    const expected = expectedFiles.get(key);
    const actual = observedFiles.get(key);
    if (expected?.sha256 === actual?.sha256 && expected?.bytes === actual?.bytes) return [];
    return [{
      kind: expected?.kind ?? actual?.kind,
      path: expected?.path ?? actual?.path,
      status: expected === undefined ? "added" : actual === undefined ? "removed" : "changed",
      baselineSha256: expected?.sha256 ?? null,
      observedSha256: actual?.sha256 ?? null,
      baselineBytes: expected?.bytes ?? null,
      observedBytes: actual?.bytes ?? null,
    }];
  });
}

async function readDataMetadata(sourceBytes = undefined) {
  const file = "src/data/generated-data.bin";
  const bytes = sourceBytes ?? await readFile(path.join(ROOT, ...file.split("/")));
  const gameData = await decodeGeneratedData(bytes);
  return {
    file,
    version: gameData.version,
    referenceCommit: gameData.provenance.commit,
    importedAt: gameData.provenance.importedAt,
    sha256: sha256(bytes),
    bytes: bytes.byteLength,
  };
}

function timestampToken(date = new Date()) {
  return date.toISOString().replace(/[-:.]/g, "").replace("Z", "Z");
}

async function createRunDirectory() {
  await mkdir(RUNS_ROOT, { recursive: true });
  const base = timestampToken();
  for (let suffix = 0; suffix < 1000; suffix++) {
    const name = suffix === 0 ? base : `${base}-${suffix}`;
    const candidate = path.join(RUNS_ROOT, name);
    try {
      await mkdir(candidate);
      return { name, path: candidate };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
  }
  throw new Error("无法为本次验收创建唯一输出目录");
}

function childEnvironment(caseItem, timeoutMs) {
  const env = { ...process.env, FFXIV_PROFILE_TIMING: "1" };
  for (const name of Object.keys(env)) {
    if (name.startsWith("DATA_TEST_")) delete env[name];
  }
  for (const name of [
    "DATA_TEST_SPEED_MIN", "DATA_TEST_SPEED_MAX", "DATA_TEST_TOUGH_PERCENT",
    "DATA_TEST_MIN_TENACITY", "DATA_TEST_MAX_TOUGHNESS", "DATA_TEST_GCD_CHOICES",
  ]) delete env[name];
  if (caseItem.jobs.length === 1) {
    env.DATA_TEST_SINGLE_JOB = caseItem.jobs[0];
    env.DATA_TEST_SINGLE_MIN_ITEM_LEVEL = String(caseItem.minItemLevel);
    env.DATA_TEST_SINGLE_MAX_ITEM_LEVEL = String(caseItem.maxItemLevel);
    env.DATA_TEST_SINGLE_SYNC_LEVEL = caseItem.syncLevel === undefined ? "" : String(caseItem.syncLevel);
    env.DATA_TEST_SINGLE_OBJECTIVE = caseItem.objective;
    env.DATA_TEST_SINGLE_FOOD_ID = "0";
    env.DATA_TEST_SINGLE_TIMEOUT_MS = timeoutMs === null ? "unlimited" : String(timeoutMs);
  } else {
    env.DATA_TEST_JOBS = caseItem.jobs.join(",");
    env.DATA_TEST_COMMON_SLOTS = caseItem.commonSlots.length === 0 ? "none" : caseItem.commonSlots.join(",");
    env.DATA_TEST_FOOD_STRATEGY = caseItem.foodStrategy;
    env.DATA_TEST_OBJECTIVE = caseItem.objective;
    env.DATA_TEST_MIN_ITEM_LEVEL = String(caseItem.minItemLevel);
    env.DATA_TEST_MAX_ITEM_LEVEL = String(caseItem.maxItemLevel);
    env.DATA_TEST_SYNC_LEVEL = caseItem.syncLevel === undefined ? "" : String(caseItem.syncLevel);
    env.DATA_TEST_JOB_CONSTRAINTS = JSON.stringify(caseItem.jobConstraints ?? {});
    // The existing V3 entry caps finite budgets at 235 seconds. Larger suite deadlines
    // are enforced by this parent process and leave the V3 watchdog unlimited.
    env.DATA_TEST_V3_TIMEOUT_MS = timeoutMs === null || timeoutMs > 235_000
      ? "unlimited"
      : String(timeoutMs);
  }
  return env;
}

class ResultJsonParser {
  constructor() {
    this.decoder = new StringDecoder("utf8");
    this.pending = "";
    this.currentLine = "";
    this.candidate = undefined;
    this.lastResult = undefined;
  }

  add(chunk) {
    this.pending += this.decoder.write(chunk);
    let lineEnd;
    while ((lineEnd = this.pending.indexOf("\n")) >= 0) {
      const line = this.pending.slice(0, lineEnd).replace(/\r$/, "");
      this.pending = this.pending.slice(lineEnd + 1);
      this.consumeLine(line);
    }
  }

  finish() {
    this.pending += this.decoder.end();
    if (this.pending) this.consumeLine(this.pending.replace(/\r$/, ""));
    this.pending = "";
  }

  consumeLine(line) {
    if (!this.candidate) {
      const first = line.search(/\S/);
      if (first < 0 || line[first] !== "{") return;
      this.candidate = { text: "", depth: 0, inString: false, escaped: false };
      line = line.slice(first);
    }
    const candidate = this.candidate;
    candidate.text += `${line}\n`;
    for (const character of line) {
      if (candidate.inString) {
        if (candidate.escaped) candidate.escaped = false;
        else if (character === "\\") candidate.escaped = true;
        else if (character === '"') candidate.inString = false;
        continue;
      }
      if (character === '"') candidate.inString = true;
      else if (character === "{") candidate.depth++;
      else if (character === "}") candidate.depth--;
    }
    if (candidate.depth !== 0) return;
    try {
      const parsed = JSON.parse(candidate.text.trim());
      if (isResultObject(parsed)) this.lastResult = parsed;
    } catch {
      // Non-result JSON printed by the runner (for example its input configuration) is ignored.
    }
    this.candidate = undefined;
  }
}

class SolverProfileParser {
  constructor() {
    this.decoder = new StringDecoder("utf8");
    this.pending = "";
    this.events = [];
  }

  add(chunk) {
    this.pending += this.decoder.write(chunk);
    let lineEnd;
    while ((lineEnd = this.pending.indexOf("\n")) >= 0) {
      this.consumeLine(this.pending.slice(0, lineEnd).replace(/\r$/, ""));
      this.pending = this.pending.slice(lineEnd + 1);
    }
  }

  finish() {
    this.pending += this.decoder.end();
    if (this.pending) this.consumeLine(this.pending.replace(/\r$/, ""));
    this.pending = "";
  }

  consumeLine(line) {
    const prefix = "[求解器诊断] ";
    if (!line.startsWith(prefix)) return;
    try {
      const outer = JSON.parse(line.slice(prefix.length));
      if (typeof outer.message !== "string" || !outer.message.startsWith("PROFILE ")) return;
      const profile = JSON.parse(outer.message.slice("PROFILE ".length));
      this.events.push({
        sequence: this.events.length + 1,
        backend: outer.backend ?? null,
        model: outer.model ?? null,
        profile,
      });
    } catch {
      // Keep the raw log as the source of truth if a diagnostic line is truncated.
    }
  }
}

function isResultObject(value) {
  if (value === null || typeof value !== "object") return false;
  if (value.proof?.complete === true && value.normalizedJointValue && value.statistics) return true;
  return value.proof && value.result && value.statistics && value.scenario;
}

async function runChild(caseItem, runDir, timeoutMs, inputIntegrityBaseline) {
  const caseDir = path.join(runDir, "cases", caseItem.id);
  await mkdir(caseDir, { recursive: true });
  const scriptPath = caseItem.jobs.length === 1
    ? path.join(SCRIPT_DIR, "run-single.mjs")
    : path.join(ROOT, "scripts", "node-tests", "run-v3.mjs");
  const childArgs = [
    `--max-old-space-size=${CHILD_HEAP_CAP_MIB}`,
    "--experimental-strip-types",
    scriptPath,
  ];
  const runnerTimeoutMs = caseItem.jobs.length === 1 || timeoutMs === null || timeoutMs <= 235_000
    ? timeoutMs
    : null;
  const execution = {
    command: process.execPath,
    args: childArgs,
    cwd: ROOT,
    heapCapMiB: CHILD_HEAP_CAP_MIB,
    stdioCapture: "direct-file-descriptors",
    profileTiming: true,
    parentWatchdogTimeoutMs: timeoutMs,
    runnerSearchTimeoutMs: runnerTimeoutMs,
  };
  const caseConfig = {
    id: caseItem.id,
    title: caseItem.title,
    jobs: caseItem.jobs,
    itemLevelRange: [caseItem.minItemLevel, caseItem.maxItemLevel],
    ...(caseItem.syncLevel === undefined ? {} : { syncLevel: caseItem.syncLevel }),
    objective: caseItem.objective,
    commonSlots: caseItem.commonSlots,
    foodStrategy: caseItem.foodStrategy,
    jobConstraints: caseItem.jobConstraints ?? {},
    searchDefaults: {
      maximizeTenacity: false,
      excludedSources: [],
      forcedGear: {},
      foodId: 0,
    },
    expected: caseItem.expectedRatio
      ? { normalizedJointValueAtLeast: caseItem.expectedRatio }
      : caseItem.minimum !== undefined
        ? { [caseItem.metric]: { atLeast: caseItem.minimum } }
        : caseItem.establishExactBaseline ? { exactBaselineRequired: true } : null,
    soloObjectiveScoreAtLeast: caseItem.soloObjectiveScoreThresholds ?? null,
    missingSoloObjectiveScoreThresholdJobs: caseItem.jobs.filter((job) => !caseItem.soloObjectiveScoreThresholds?.[job]),
    historicalFastestMs: caseItem.historyMs ?? null,
    optimizationTargetMs: optimizationTargetMs(caseItem.jobs.length),
    historyLabel: caseItem.historyLabel ?? "最新已知耗时基线",
    historySource: caseItem.historySource ?? "docs/search-optimization/搜索耗时优化总结.md",
    strategyTags: caseItem.strategyTags,
    timeoutMs: timeoutMs ?? "unlimited",
    execution,
    process: caseItem.jobs.length === 1
      ? ["node", `--max-old-space-size=${CHILD_HEAP_CAP_MIB}`, "--experimental-strip-types", "docs/search-optimization/tools/run-single.mjs"]
      : ["node", `--max-old-space-size=${CHILD_HEAP_CAP_MIB}`, "--experimental-strip-types", "scripts/node-tests/run-v3.mjs"],
    environment: { FFXIV_PROFILE_TIMING: "1" },
    inputIntegrity: {
      suiteBaseline: inputIntegrityBaseline,
      before: null,
      beforeChangedPaths: [],
      after: null,
      afterChangedPaths: [],
    },
  };
  await writeFileJson(path.join(caseDir, "config.json"), caseConfig);

  const stdoutPath = path.join(caseDir, "stdout.log");
  const stderrPath = path.join(caseDir, "stderr.log");
  const before = await captureRuntimeInputHashes();
  const beforeChangedPaths = diffInputHashes(inputIntegrityBaseline, before);
  const runtimeInputIntegrity = {
    suiteBaseline: inputIntegrityBaseline,
    before,
    beforeChangedPaths,
    after: null,
    afterChangedPaths: [],
    changedPaths: beforeChangedPaths,
    status: beforeChangedPaths.length === 0 ? "preflight-matched" : "preflight-mismatch",
  };
  caseConfig.inputIntegrity = runtimeInputIntegrity;
  await writeFileJson(path.join(caseDir, "config.json"), caseConfig);

  if (beforeChangedPaths.length > 0) {
    const after = await captureRuntimeInputHashes();
    const afterChangedPaths = diffInputHashes(inputIntegrityBaseline, after);
    runtimeInputIntegrity.after = after;
    runtimeInputIntegrity.afterChangedPaths = afterChangedPaths;
    runtimeInputIntegrity.changedPaths = [...beforeChangedPaths, ...afterChangedPaths];
    runtimeInputIntegrity.status = "skipped-preflight-mismatch";
    caseConfig.inputIntegrity = runtimeInputIntegrity;
    await writeFileJson(path.join(caseDir, "config.json"), caseConfig);
    await Promise.all([
      writeFile(stdoutPath, "", { flag: "wx" }),
      writeFile(stderrPath, "", { flag: "wx" }),
    ]);
    const checks = [
      ...validateCase(caseItem, undefined, null, false),
      {
        name: "runtime-inputs-match-suite-baseline-before-case",
        passed: false,
        expected: "suite snapshot SHA-256",
        changedPaths: beforeChangedPaths,
      },
      {
        name: "runtime-inputs-match-suite-baseline-after-case",
        passed: afterChangedPaths.length === 0,
        expected: "suite snapshot SHA-256",
        changedPaths: afterChangedPaths,
      },
    ];
    const record = {
      id: caseItem.id,
      title: caseItem.title,
      scenario: caseConfig,
      startedAt: before.checkedAt,
      finishedAt: after.checkedAt,
      childStarted: false,
      childExitCode: null,
      childSignal: null,
      timedOut: false,
      spawnError: null,
      measuredSearchMs: null,
      historicalFastestMs: caseItem.historyMs ?? null,
      historyLabel: caseItem.historyLabel ?? "最新已知耗时基线",
      historySource: caseItem.historySource ?? "docs/search-optimization/搜索耗时优化总结.md",
      execution,
      runtimeInputIntegrity,
      soloObjectiveScores: summarizeSoloObjectiveScores(caseItem, undefined),
      strategy: describeStrategy(caseItem, undefined),
      solverProfiles: [],
      checks,
      passed: false,
      stdoutLog: `cases/${caseItem.id}/stdout.log`,
      stderrLog: `cases/${caseItem.id}/stderr.log`,
      error: "运行前源码或 generated-data.bin 与 suite 快照不一致，已跳过子进程。",
    };
    await writeFileJson(path.join(caseDir, "result.json"), { ...record, output: null });
    return record;
  }

  const stdoutFd = openSync(stdoutPath, "wx");
  let stderrFd;
  try {
    stderrFd = openSync(stderrPath, "wx");
  } catch (error) {
    closeSync(stdoutFd);
    throw error;
  }
  const parser = new ResultJsonParser();
  const profileParser = new SolverProfileParser();
  const start = new Date().toISOString();
  let child;
  try {
    child = spawn(process.execPath, childArgs, {
      cwd: ROOT,
      env: childEnvironment(caseItem, timeoutMs),
      stdio: ["ignore", stdoutFd, stderrFd],
      windowsHide: true,
    });
  } finally {
    closeSync(stdoutFd);
    closeSync(stderrFd);
  }
  activeChild = child;
  if (interruptedSignal !== null) child.kill("SIGTERM");
  let timedOut = false;
  let spawnError = null;
  let timer;
  if (timeoutMs !== null) {
    timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      const forceTimer = setTimeout(() => child.kill("SIGKILL"), 5000);
      forceTimer.unref();
    }, timeoutMs);
    timer.unref();
  }
  child.once("error", (error) => { spawnError = error; });
  const exit = await new Promise((resolve) => child.once("close", (code, signal) => resolve({ code, signal })));
  if (activeChild === child) activeChild = undefined;
  if (forceTerminationTimer) {
    clearTimeout(forceTerminationTimer);
    forceTerminationTimer = undefined;
  }
  if (timer) clearTimeout(timer);
  for await (const chunk of createReadStream(stdoutPath)) {
    parser.add(chunk);
    profileParser.add(chunk);
  }
  parser.finish();
  profileParser.finish();
  const after = await captureRuntimeInputHashes();
  const afterChangedPaths = diffInputHashes(inputIntegrityBaseline, after);
  runtimeInputIntegrity.after = after;
  runtimeInputIntegrity.afterChangedPaths = afterChangedPaths;
  runtimeInputIntegrity.changedPaths = [...beforeChangedPaths, ...afterChangedPaths];
  runtimeInputIntegrity.status = afterChangedPaths.length === 0 ? "matched-through-case" : "changed-during-or-after-case";
  caseConfig.inputIntegrity = runtimeInputIntegrity;
  await writeFileJson(path.join(caseDir, "config.json"), caseConfig);
  const result = parser.lastResult;
  const measuredSearchMs = measuredSearchTime(result);
  const targetMs = optimizationTargetMs(caseItem.jobs.length);
  const optimizationTarget = evaluateOptimizationTarget(measuredSearchMs, targetMs);
  const historicalComparison = compareHistoricalTiming({
    actualMs: measuredSearchMs,
    historicalBestMs: caseItem.historyMs,
    nineRoundMinMs: caseItem.nineRound?.minMs,
    nineRoundAverageMs: caseItem.nineRound?.averageMs,
    nineRoundMaxMs: caseItem.nineRound?.maxMs,
  });
  const checks = [
    ...validateCase(caseItem, result, exit.code, timedOut),
    {
      name: "optimization-target-met",
      passed: optimizationTarget.met,
      actualMs: optimizationTarget.actualMs,
      targetMs: optimizationTarget.targetMs,
      gapMs: optimizationTarget.gapMs,
    },
    {
      name: "historical-comparison-not-regressed",
      passed: historicalComparison.passed,
      status: historicalComparison.status,
      actualMs: historicalComparison.actualMs,
      historicalBestMs: historicalComparison.historicalBestMs,
      nineRound: historicalComparison.nineRound,
    },
    {
      name: "runtime-inputs-match-suite-baseline-before-case",
      passed: beforeChangedPaths.length === 0,
      expected: "suite snapshot SHA-256",
      changedPaths: beforeChangedPaths,
    },
    {
      name: "runtime-inputs-match-suite-baseline-after-case",
      passed: afterChangedPaths.length === 0,
      expected: "suite snapshot SHA-256",
      changedPaths: afterChangedPaths,
    },
  ];
  const resultPassed = checks
    .filter((check) => !["optimization-target-met", "historical-comparison-not-regressed"].includes(check.name))
    .every((check) => check.passed);
  const solverProfiles = profileParser.events;
  const strategy = describeStrategy(caseItem, result, solverProfiles);
  const record = {
    id: caseItem.id,
    title: caseItem.title,
    scenario: caseConfig,
    startedAt: start,
    finishedAt: new Date().toISOString(),
    childStarted: true,
    childExitCode: exit.code,
    childSignal: exit.signal,
    interrupted: interruptedSignal !== null,
    interruptionSignal: interruptedSignal,
    timedOut,
    spawnError: spawnError?.message ?? null,
    measuredSearchMs,
    optimizationTarget,
    optimizationTargetMs: targetMs,
    optimizationTargetMet: optimizationTarget.met,
    optimizationTargetGapMs: optimizationTarget.gapMs,
    historicalComparison,
    historicalFastestMs: caseItem.historyMs ?? null,
    historyLabel: caseItem.historyLabel ?? "最新已知耗时基线",
    historySource: caseItem.historySource ?? "docs/search-optimization/搜索耗时优化总结.md",
    execution,
    runtimeInputIntegrity,
    soloObjectiveScores: summarizeSoloObjectiveScores(caseItem, result),
    resultPassed,
    strategy,
    solverProfiles,
    checks,
    passed: checks.every((check) => check.passed),
    stdoutLog: `cases/${caseItem.id}/stdout.log`,
    stderrLog: `cases/${caseItem.id}/stderr.log`,
  };
  await writeFileJson(path.join(caseDir, "result.json"), {
    ...record,
    output: result ?? null,
    error: result ? null : (timedOut
      ? `进程超过 ${timeoutMs}ms 时限`
      : interruptedSignal !== null
        ? `验收运行器收到 ${interruptedSignal}，已保存中断前日志和 profile；搜索结果/证明未完成`
        : spawnError?.message ?? `未能从标准输出解析最终结果（exit=${exit.code}, signal=${exit.signal ?? "none"}）`),
  });
  return record;
}

function summarizeSoloObjectiveScores(caseItem, result) {
  if (caseItem.jobs.length < 2) return [];
  return caseItem.jobs.map((job) => {
    const threshold = caseItem.soloObjectiveScoreThresholds?.[job] ?? null;
    const soloActual = result?.jobs?.[job]?.soloOptimum?.objectiveScore;
    const jointActual = result?.jobs?.[job]?.joint?.objectiveScore;
    return {
      job,
      expectedMinimum: threshold?.minimum ?? null,
      actualSoloOptimum: Number.isFinite(soloActual) ? soloActual : null,
      actualJointObjectiveScore: Number.isFinite(jointActual) ? jointActual : null,
      historyLabel: threshold?.historyLabel ?? null,
      matchingRecordCount: threshold?.matchingRecordCount ?? null,
      source: threshold?.source ?? null,
      passed: threshold !== null && Number.isFinite(soloActual) && soloActual >= threshold.minimum,
    };
  });
}

function measuredSearchTime(result) {
  return result ? result.statistics.elapsedMs : null;
}

function exactRatioAtLeast(actual, minimum) {
  if (!actual || !minimum) return false;
  try {
    return BigInt(actual.numerator) * BigInt(minimum.denominator) >=
      BigInt(minimum.numerator) * BigInt(actual.denominator);
  } catch {
    return false;
  }
}

function validateCase(caseItem, result, exitCode, timedOut) {
  const checks = [
    { name: "child-exited-normally", passed: exitCode === 0 && !timedOut, actual: { exitCode, timedOut } },
    { name: "result-json-found", passed: result !== undefined, actual: result === undefined ? null : "parsed" },
    { name: "proof-complete", passed: result?.proof?.complete === true, actual: result?.proof?.complete ?? null },
  ];
  if (caseItem.jobs.length > 1) {
    for (const job of caseItem.jobs) {
      const threshold = caseItem.soloObjectiveScoreThresholds?.[job];
      const actual = result?.jobs?.[job]?.soloOptimum?.objectiveScore;
      const jointActual = result?.jobs?.[job]?.joint?.objectiveScore;
      checks.push({
        name: `solo-objective-score-at-least-history-${job}`,
        passed: threshold !== undefined && Number.isFinite(actual) && actual >= threshold.minimum,
        expectedMinimum: threshold?.minimum ?? null,
        historyLabel: threshold?.historyLabel ?? "未找到精确匹配的历史 Node 记录；未猜测阈值",
        matchingRecordCount: threshold?.matchingRecordCount ?? 0,
        source: threshold?.source ?? null,
        actualSoloOptimum: Number.isFinite(actual) ? actual : null,
        actualJointObjectiveScore: Number.isFinite(jointActual) ? jointActual : null,
      });
    }
  }
  if (result) {
    if (caseItem.expectedRatio) {
      checks.push({
        name: "exact-normalized-result-at-least-history",
        passed: exactRatioAtLeast(result.normalizedJointValue, caseItem.expectedRatio),
        expected: caseItem.expectedRatio,
        actual: result.normalizedJointValue ?? null,
      });
    } else if (caseItem.minimum !== undefined) {
      const actual = caseItem.jobs.length === 1 ? result.result?.[caseItem.metric] : undefined;
      checks.push({
        name: `${caseItem.metric}-at-least-history`,
        passed: typeof actual === "number" && Number.isFinite(actual) && actual >= caseItem.minimum,
        expectedMinimum: caseItem.minimum,
        actual: actual ?? null,
      });
    } else if (caseItem.establishExactBaseline) {
      const ratio = result.normalizedJointValue;
      let valid = false;
      try {
        valid = typeof ratio?.numerator === "string" && typeof ratio?.denominator === "string" &&
          BigInt(ratio.numerator) >= 0n && BigInt(ratio.denominator) > 0n;
      } catch { /* a malformed or inexact baseline is not accepted */ }
      checks.push({
        name: "exact-result-baseline-established",
        passed: valid,
        actual: ratio ?? null,
      });
    }


  }
  return checks;
}

function describeStrategy(caseItem, result, solverProfiles = []) {
  const exactSearchesByJob = {};
  const jointModelEvents = [];
  for (const event of solverProfiles) {
    const profile = event.profile;
    if (profile?.phase === "exact-search-summary" && typeof profile.job === "string") {
      (exactSearchesByJob[profile.job] ??= []).push({
        model: event.model,
        elapsedMs: profile.elapsedMs ?? null,
        solverRuns: profile.solverRuns ?? null,
        variables: profile.variables ?? null,
        constraints: profile.constraints ?? null,
        primaryResourceSupportsEnabled: profile.primaryResourceSupportsEnabled ?? false,
        mainStatResourceSupportEnabled: profile.mainStatResourceSupportEnabled ?? false,
        candidateUpperBound: profile.candidateUpperBound ?? null,
        conditionalResourceSupport: profile.conditionalResourceSupport ?? null,
      });
    }
    if ((typeof profile?.phase === "string" && profile.phase.startsWith("joint-")) ||
      (typeof event.model === "string" && event.model.startsWith("joint:"))) {
      jointModelEvents.push(event);
    }
  }
  return {
    entrypoint: caseItem.jobs.length === 1
      ? "docs/search-optimization/tools/run-single.mjs -> runOptimizationLocally -> exact MIP/signature-band proof"
      : "scripts/node-tests/run-v3.mjs -> runJointOptimizationLocally -> exact per-job baselines and joint proof",
    jobCount: caseItem.jobs.length,
    commonSlots: caseItem.commonSlots,
    foodStrategy: caseItem.foodStrategy,
    strategyTags: caseItem.strategyTags,
    exactSearchesByJob,
    jointModelEvents,
    orderedProfilePhases: solverProfiles.map((event) => ({
      sequence: event.sequence,
      phase: event.profile?.phase ?? "unlabeled-profile",
      backend: event.backend,
      model: event.model,
      job: event.profile?.job ?? null,
      elapsedMs: event.profile?.elapsedMs ?? event.profile?.totalMs ?? null,
      status: event.profile?.status ?? null,
      solverRuns: event.profile?.solverRuns ?? null,
      variables: event.profile?.variables ?? event.profile?.variableCount ?? null,
      constraints: event.profile?.constraints ?? event.profile?.rowCount ?? null,
      profile: event.profile,
    })),
    solverProfileEventCount: solverProfiles.length,
    solverProfiles,
    observedSearchStatistics: result?.statistics ?? null,
    sourceSnapshotDirectory: "../../strategy-snapshot",
  };
}

async function writeFileJson(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function summarizeOutcomes(cases) {
  const historical = {
    optimized: 0,
    "optimized-with-warning": 0,
    "no-impact": 0,
    regression: 0,
    unavailable: 0,
  };
  const optimizationTarget = { met: 0, missed: 0, incomplete: 0 };
  for (const record of cases) {
    const targetStatus = record.optimizationTarget?.status ?? "incomplete";
    optimizationTarget[targetStatus === "met" ? "met" : targetStatus === "missed" ? "missed" : "incomplete"]++;
    const historyStatus = record.historicalComparison?.status ?? "unavailable";
    historical[Object.hasOwn(historical, historyStatus) ? historyStatus : "unavailable"]++;
  }
  return {
    cases: cases.length,
    resultPassed: cases.filter((record) => record.resultPassed === true).length,
    accepted: cases.filter((record) => record.passed === true).length,
    optimizationTarget,
    historicalComparison: historical,
  };
}

function formatSeconds(milliseconds) {
  return milliseconds === null ? "未完成" : `${(milliseconds / 1_000).toFixed(2)}s`;
}

function formatCaseProgress(record, index, total) {
  const proofPassed = record.checks?.find((check) => check.name === "proof-complete")?.passed === true;
  return `[${index + 1}/${total}] ${record.id} ${formatSeconds(record.measuredSearchMs)}；时限${record.optimizationTarget?.label ?? "未完成"}；历史${record.historicalComparison?.label ?? "无法比较"}；结果${record.resultPassed ? "合法" : "非法"}；证明${proofPassed ? "完整" : "未完成"}`;
}

function renderMarkdown(suite) {
  const outcomes = summarizeOutcomes(suite.cases);
  const rows = suite.cases.map((record) => {
    const target = record.optimizationTarget;
    const proofPassed = record.checks?.find((check) => check.name === "proof-complete")?.passed === true;
    return `| ${record.id} | ${formatSeconds(record.measuredSearchMs)} / ${formatSeconds(target?.targetMs)} | ${target?.label ?? "未完成"} | ${record.historicalComparison?.label ?? "无法比较"} | ${record.resultPassed ? "合法" : "非法"} | ${proofPassed ? "完整" : "未完成"} |`;
  });
  const history = outcomes.historicalComparison;
  const lines = [
    "# Node 搜索优化验收",
    "",
    `- 运行时间：${suite.startedAt}；记录目录：\`${suite.runDirectory}\`；场景 ${outcomes.cases}。`,
    `- Git HEAD：\`${suite.repository.head ?? "unknown"}\`；dirty=${suite.repository.dirty}`,
    `- 游戏数据：\`${suite.gameData.version ?? "unknown"}\`；SHA-256 \`${suite.gameData.sha256}\`；参考 commit \`${suite.gameData.referenceCommit ?? "unknown"}\``,
    `- 策略快照文件：${suite.strategySources.length} 个；逐文件 SHA-256 和快照路径见 suite.json。`,
    `- 输入完整性基线：${suite.inputIntegrityBaseline.strategySources.length} 个策略文件和 generated-data.bin SHA-256；每案启动前与结束后重新计算并和基线比较。`,
    `- 联合场景历史单职业阈值：精确匹配保存 Node 记录的职业、品级范围、同步、目标及该职业约束后，逐职业取最高 soloOptimum.objectiveScore；未匹配项不猜测并会使验收失败。`,
    `- Node：${suite.runtime.node.version}（${suite.runtime.platform}/${suite.runtime.architecture}）；CPU：${suite.runtime.cpu.model ?? "unknown"}，逻辑核心 ${suite.runtime.cpu.logicalCoreCount}；物理内存 ${suite.runtime.memoryBytes.total} bytes。`,
    `- 优化时限：${TARGET_MS_PER_JOB / 1_000} 秒 × 职业数；达标 ${outcomes.optimizationTarget.met}，超时 ${outcomes.optimizationTarget.missed}，未完成 ${outcomes.optimizationTarget.incomplete}。`,
    `- 历史耗时：优化成功 ${history.optimized}；优化成功（提示）${history["optimized-with-warning"]}；耗时无影响 ${history["no-impact"]}；劣化 ${history.regression}；无法比较 ${history.unavailable}。`,
    `- 结果与证明：合法 ${outcomes.resultPassed}/${outcomes.cases}；综合通过 ${outcomes.accepted}/${outcomes.cases}。低于历史结果门槛、证明不完整或输入完整性失败均判为非法。`,
    "- 计时范围：领域搜索入口至完整结果返回前，直接读取 statistics.elapsedMs；旧历史基准保留原计时范围，跨口径分类仅作参考。",
    "- 历史分类：不慢于历史最快为“优化成功”；高于历史最快但低于九轮均值为“优化成功（提示）”；不低于均值且不超过九轮最大值为“耗时无影响”；高于九轮最大值为“劣化”。",
    `- 环境：Node ${suite.runtime.node.version}（${suite.runtime.platform}/${suite.runtime.architecture}）；CPU ${suite.runtime.cpu.model ?? "unknown"}。中断：${suite.interrupted ? suite.interruptionSignal ?? "是" : "否"}。`,
    "",
    "| 场景 | 本轮耗时 / 时限 | 时限判定 | 历史对比 | 结果 | 最优性证明 |",
    "|---|---:|---|---|---|---|",
    ...rows,
    "",
    `总体结果：**${suite.passed ? "通过" : "未通过"}**（${outcomes.accepted}/${outcomes.cases} 案通过）。`,
    "",
    "每案 `config.json` 保存完整输入、逐职业历史 objectiveScore 下限、来源及运行前后 SHA；`result.json` 保存逐职业期望值/实际值、证明状态、按出现顺序排列的求解器 profile 阶段和各项验收判定。每案开始前和结束后会重新计算领域代码、Node 搜索工具、二进制格式源码及 generated-data.bin 的 SHA；前置检查不匹配时跳过子进程，结束检查变化时该案失败，并记录变更路径和基线/观察 SHA。`stdout.log`/`stderr.log` 保存未经截断的原始过程日志。`strategy-snapshot/` 保存 `src/domain`、`src/data` 运行时源码、`scripts/node-tests`、`docs/search-optimization/tools` 下非测试运行时代码和根目录包清单的副本，包括未跟踪源码；`data-snapshot/generated-data.bin` 保存本次使用的运行时数据。",
    `详细输入、历史数值、结果分数、profile 与各项校验见每案的 config.json/result.json。`,
    "",
  ];
  return `${lines.join("\n")}\n`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) { printUsage(); return; }
  if (options.list) { for (const caseItem of CASES) console.log(formatCase(caseItem)); return; }
  const selected = selectCases(options);
  const run = await createRunDirectory();
  console.log(`搜索性能验收记录：${path.relative(ROOT, run.path).split(path.sep).join("/")}`);
  console.log(`将按顺序执行 ${selected.length} 个场景；原始 stdout/stderr 仅写入本次记录目录。`);

  const startedAt = new Date().toISOString();
  const runtime = getRuntimeEnvironment();
  const repository = getGitState();
  const strategySources = await createStrategySnapshot(run.path);
  const dataSnapshot = await createDataSnapshot(run.path);
  const gameData = await readDataMetadata(dataSnapshot.sourceBytes);
  delete dataSnapshot.sourceBytes;
  const inputIntegrityBaseline = makeInputIntegrityBaseline(strategySources, dataSnapshot);
  const suite = {
    schemaVersion: 6,
    timingScope: "domain-search-entry-to-result",
    runId: run.name,
    runDirectory: path.relative(ROOT, run.path).split(path.sep).join("/"),
    startedAt,
    finishedAt: null,
    options: {
      selectedCaseIds: selected.map((caseItem) => caseItem.id),
      jobCount: options.jobCount ?? null,
      strategies: options.strategies,
      timeoutMs: options.timeoutMs,
      targetMsPerJob: TARGET_MS_PER_JOB,
      historicalComparisonRule: "historical-best-vs-nine-round-average-and-range",
    },
    gameData,
    runtime,
    dataSnapshot,
    repository,
    strategySources,
    inputIntegrityBaseline,
    unmatchedSoloObjectiveScoreThresholds: selected.flatMap((caseItem) =>
      caseItem.jobs.filter((job) => caseItem.jobs.length > 1 && !caseItem.soloObjectiveScoreThresholds?.[job])
        .map((job) => ({ caseId: caseItem.id, job, reason: "没有相同输入条件的保存 Node 记录，不推测下限。" }))),
    cases: [],
    passed: false,
  };
  await writeFileJson(path.join(run.path, "suite.json"), suite);

  for (const [index, caseItem] of selected.entries()) {
    if (interruptedSignal !== null) break;
    console.log(`[${index + 1}/${selected.length}] ${caseItem.id} 开始`);
    try {
      const record = await runChild(caseItem, run.path, options.timeoutMs, inputIntegrityBaseline);
      suite.cases.push(record);
      console.log(formatCaseProgress(record, index, selected.length));
    } catch (error) {
      const targetMs = optimizationTargetMs(caseItem.jobs.length);
      const optimizationTarget = evaluateOptimizationTarget(null, targetMs);
      const historicalComparison = compareHistoricalTiming({
        actualMs: null,
        historicalBestMs: caseItem.historyMs,
        nineRoundMinMs: caseItem.nineRound?.minMs,
        nineRoundAverageMs: caseItem.nineRound?.averageMs,
        nineRoundMaxMs: caseItem.nineRound?.maxMs,
      });
      const failed = {
        id: caseItem.id,
        title: caseItem.title,
        scenario: {
          id: caseItem.id,
          title: caseItem.title,
          jobs: caseItem.jobs,
          itemLevelRange: [caseItem.minItemLevel, caseItem.maxItemLevel],
          ...(caseItem.syncLevel === undefined ? {} : { syncLevel: caseItem.syncLevel }),
          objective: caseItem.objective,
          commonSlots: caseItem.commonSlots,
          foodStrategy: caseItem.foodStrategy,
          jobConstraints: caseItem.jobConstraints ?? {},
          searchDefaults: { maximizeTenacity: false, excludedSources: [], forcedGear: {}, foodId: 0 },
        },
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        measuredSearchMs: null,
        optimizationTarget,
        optimizationTargetMs: targetMs,
        optimizationTargetMet: false,
        optimizationTargetGapMs: null,
        historicalComparison,
        historicalFastestMs: caseItem.historyMs ?? null,
        resultPassed: false,
        strategy: describeStrategy(caseItem, undefined),
        checks: [{ name: "case-execution", passed: false, error: error instanceof Error ? error.stack ?? error.message : String(error) }],
        passed: false,
      };
      suite.cases.push(failed);
      const failedDir = path.join(run.path, "cases", caseItem.id);
      await mkdir(failedDir, { recursive: true });
      await writeFileJson(path.join(failedDir, "config.json"), caseItem);
      await writeFileJson(path.join(failedDir, "result.json"), { ...failed, output: null });
      for (const logName of ["stdout.log", "stderr.log"]) {
        try { await writeFile(path.join(failedDir, logName), "", { flag: "wx" }); }
        catch (logError) { if (logError?.code !== "EEXIST") throw logError; }
      }
      console.error(`[${index + 1}/${selected.length}] ${caseItem.id} 执行失败：${failed.checks[0].error}`);
    }
    suite.outcomes = summarizeOutcomes(suite.cases);
    suite.passed = suite.cases.every((item) => item.passed) && suite.cases.length === selected.length;
    suite.finishedAt = new Date().toISOString();
    await writeFileJson(path.join(run.path, "suite.json"), suite);
    await writeFile(path.join(run.path, "suite.md"), renderMarkdown(suite), "utf8");
  }
  suite.outcomes = summarizeOutcomes(suite.cases);
  suite.passed = suite.cases.every((item) => item.passed) && suite.cases.length === selected.length;
  suite.interrupted = interruptedSignal !== null;
  suite.interruptionSignal = interruptedSignal;
  suite.finishedAt = new Date().toISOString();
  await writeFileJson(path.join(run.path, "suite.json"), suite);
  await writeFile(path.join(run.path, "suite.md"), renderMarkdown(suite), "utf8");
  const outcomes = summarizeOutcomes(suite.cases);
  const history = outcomes.historicalComparison;
  console.log(`验收${suite.passed ? "通过" : "未通过"}：结果合法 ${outcomes.resultPassed}/${outcomes.cases}，时限达标 ${outcomes.optimizationTarget.met}/${outcomes.cases}，历史 优化${history.optimized}/提示${history["optimized-with-warning"]}/无影响${history["no-impact"]}/劣化${history.regression}；记录 ${suite.runDirectory}`);
  if (!suite.passed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`搜索性能验收脚本失败：${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  process.exitCode = 1;
});
