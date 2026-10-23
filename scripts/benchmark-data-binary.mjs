import os from "node:os";
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { decodeGeneratedData } from "../src/data/binary/decode.ts";

const assetPath = new URL("../src/data/generated-data.bin", import.meta.url);
const bytes = new Uint8Array(await readFile(assetPath));
const rounds = Number(process.argv[2] ?? 7);
const jobId = process.env.DATA_BENCHMARK_JOB ?? "RDM";
if (!Number.isSafeInteger(rounds) || rounds < 1 || rounds > 100)
  throw new Error("轮数必须是 1 到 100 之间的整数");

function lowerBound(indexes, levels, target, includeTarget) {
  let left = 0;
  let right = indexes.length;
  while (left < right) {
    const middle = (left + right) >>> 1;
    const level = levels[indexes[middle]];
    if (includeTarget ? level <= target : level < target) left = middle + 1;
    else right = middle;
  }
  return left;
}

function summarize(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return {
    medianMs: Number(sorted[Math.floor(sorted.length / 2)].toFixed(3)),
    p95Ms: Number(sorted[Math.ceil(sorted.length * 0.95) - 1].toFixed(3)),
    minMs: Number(sorted[0].toFixed(3)),
  };
}

async function measureRound() {
  const timings = {};
  let activeRecordParts;
  const fullStart = performance.now();
  const data = await decodeGeneratedData(bytes, {
    onTiming(phase, milliseconds) {
      if (phase === "gearSourceMetadataMs" || phase === "gearOtherRecordFieldsMs") {
        if (activeRecordParts) activeRecordParts[phase] += milliseconds;
      } else {
        timings[phase] = milliseconds;
      }
    },
  });
  const job = data.jobSchemas[jobId];
  if (!job) throw new Error(`快照中不存在基准职业 ${jobId}`);
  const [minItemLevel, maxItemLevel] = job.defaultItemLevel;
  const indexes = data.gearIndexesByMainStat[job.mainStat];
  const lower = lowerBound(indexes, data.gearLevelByRecordIndex, minItemLevel, false);
  const upper = lowerBound(indexes, data.gearLevelByRecordIndex, maxItemLevel, true);
  const selectedOrdinals = new Set(indexes.subarray(lower, upper));
  const selectedRecordParts = {
    gearSourceMetadataMs: 0,
    gearOtherRecordFieldsMs: 0,
  };

  let startedAt = performance.now();
  activeRecordParts = selectedRecordParts;
  for (let offset = lower; offset < upper; offset++)
    data.getGearAtRecordIndex(indexes[offset]);
  activeRecordParts = undefined;
  timings.selectedMainStatRangeMs = performance.now() - startedAt;

  const remainingRecordParts = {
    gearSourceMetadataMs: 0,
    gearOtherRecordFieldsMs: 0,
  };
  startedAt = performance.now();
  activeRecordParts = remainingRecordParts;
  for (let ordinal = 0; ordinal < data.gearLevelByRecordIndex.length; ordinal++)
    if (!selectedOrdinals.has(ordinal)) data.getGearAtRecordIndex(ordinal);
  activeRecordParts = undefined;
  timings.remainingGearRecordsMs = performance.now() - startedAt;
  timings.selectedGearSourceMetadataMs = selectedRecordParts.gearSourceMetadataMs;
  timings.selectedGearOtherFieldDecodeMs = selectedRecordParts.gearOtherRecordFieldsMs;
  timings.remainingGearSourceMetadataMs = remainingRecordParts.gearSourceMetadataMs;
  timings.remainingGearOtherFieldDecodeMs = remainingRecordParts.gearOtherRecordFieldsMs;
  timings.fullGearSourceMetadataMs =
    timings.selectedGearSourceMetadataMs + timings.remainingGearSourceMetadataMs;
  timings.fullGearOtherFieldDecodeMs =
    timings.selectedGearOtherFieldDecodeMs + timings.remainingGearOtherFieldDecodeMs;
  timings.fullGearRecordBodiesMs =
    timings.selectedMainStatRangeMs + timings.remainingGearRecordsMs;
  timings.completeDecodeMs = performance.now() - fullStart;
  timings.selectedGearCount = upper - lower;
  timings.selectedMainStat = job.mainStat;
  timings.gearCount = data.gearLevelByRecordIndex.length;
  timings.dataVersion = data.version;
  timings.indexBytes = Object.values(data.gearIndexesByMainStat)
    .reduce((total, index) => total + index.byteLength, 0);
  timings.physicalGroupCounts = Object.fromEntries(
    Object.entries(data.gearPhysicalGroupRanges)
      .map(([group, range]) => [group, range.count]),
  );
  return timings;
}

await measureRound();
globalThis.gc?.();
const samples = [];
for (let round = 0; round < rounds; round++) {
  samples.push(await measureRound());
  globalThis.gc?.();
}

const phaseNames = [
  "containerIntegrityAndCrcMs",
  "nonGearDataBinaryMs",
  "equipmentStringsMs",
  "equipmentDirectoryMs",
  "mainStatIndexDecodeMs",
  "equipmentRecordRangesMs",
  "gearCatalogDirectoryAndIndexesMs",
  "initializationTotalMs",
  "selectedMainStatRangeMs",
  "selectedGearSourceMetadataMs",
  "selectedGearOtherFieldDecodeMs",
  "remainingGearRecordsMs",
  "remainingGearSourceMetadataMs",
  "remainingGearOtherFieldDecodeMs",
  "fullGearSourceMetadataMs",
  "fullGearOtherFieldDecodeMs",
  "fullGearRecordBodiesMs",
  "completeDecodeMs",
];
const first = samples[0];
console.log(JSON.stringify({
  assetBytes: bytes.byteLength,
  node: process.version,
  platform: `${os.platform()} ${os.release()} ${os.arch()}`,
  cpu: os.cpus()[0]?.model ?? "unknown",
  rounds,
  selectedJob: jobId,
  selectedMainStat: first?.selectedMainStat,
  selectedGearCount: first?.selectedGearCount,
  gearCount: first?.gearCount,
  dataVersion: first?.dataVersion,
  indexBytes: first?.indexBytes,
  physicalGroupCounts: first?.physicalGroupCounts,
  timings: Object.fromEntries(phaseNames.map((phase) => [
    phase,
    summarize(samples.map((sample) => sample[phase])),
  ])),
}, null, 2));
