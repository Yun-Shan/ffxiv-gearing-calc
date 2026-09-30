import { parentPort, workerData } from "node:worker_threads";
import {
  createDamageGcdVectorEvaluator,
  equippedSpeedRangeForGcd,
  equippedToughnessForMitigationPercent,
} from "./equipped-effects.ts";
import { findBestLoadoutExactMip } from "./loadout-finder-exact-mip.ts";

try {
  const statIndexes = new Map(workerData.statIndexes);
  const evaluationFunction = createDamageGcdVectorEvaluator(
    workerData.job,
    workerData.jobLevel,
    statIndexes,
    workerData.maxContributions,
  );
  const attributeIndex = new Map(
    workerData.attributeIds.map((id, index) => [id, index]),
  );
  const equipmentAttributeExtractor = (equipment) => [
    ...equipment.baseParams.filter((param) =>
      attributeIndex.has(param.baseParamId),
    ),
    { baseParamId: workerData.weaponDamageId, value: equipment[workerData.weaponDamageStat] },
  ];
  const result = await findBestLoadoutExactMip({
    job: workerData.job,
    jobLevel: workerData.jobLevel,
    attributeIds: workerData.attributeIds,
    statIndexes,
    slots: workerData.slots,
    foods: workerData.foods,
    constraints: workerData.constraints,
    speedAttributeId: workerData.speedAttributeId,
    toughnessAttributeId: workerData.toughnessAttributeId,
    gcdToSpeedRange: (gcd) =>
      equippedSpeedRangeForGcd(workerData.job, workerData.jobLevel, gcd),
    toughnessPercentToMinimum: (percentage) =>
      equippedToughnessForMitigationPercent(
        workerData.job,
        workerData.jobLevel,
        percentage,
      ),
    equipmentAttributeExtractor,
    evaluationFunction,
    maxSearchMs: workerData.maxSearchMs,
    onProgress: (message) => parentPort?.postMessage({ type: "progress", message }),
  });
  parentPort?.postMessage({ type: "result", result });
} catch (error) {
  parentPort?.postMessage({
    type: "error",
    error: error instanceof Error
      ? { name: error.name, message: error.message, stack: error.stack }
      : { name: "Error", message: String(error) },
  });
}
