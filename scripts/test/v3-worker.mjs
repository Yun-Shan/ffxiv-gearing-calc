import { parentPort, workerData } from "node:worker_threads";
import {
  createDamageGcdVectorEvaluator,
  equippedSpeedRangeForGcd,
  equippedToughnessForMitigationPercent,
} from "./equipped-effects.ts";
import { findBestJointLoadoutV3 } from "./loadout-finder-v3.ts";

try {
  const jobs = workerData.jobs.map((candidateExport) => {
    const statIndexes = new Map(candidateExport.statIndexes);
    const evaluationFunction = createDamageGcdVectorEvaluator(
      candidateExport.job,
      candidateExport.jobLevel,
      statIndexes,
      candidateExport.maxContributions,
    );
    const attributeIndex = new Map(
      candidateExport.attributeIds.map((id, index) => [id, index]),
    );
    const equipmentAttributeExtractor = (equipment) => [
      ...equipment.baseParams.filter((param) =>
        attributeIndex.has(param.baseParamId),
      ),
      {
        baseParamId: candidateExport.weaponDamageId,
        value: equipment[candidateExport.weaponDamageStat],
      },
    ];
    return {
      id: candidateExport.job,
      slotNames: candidateExport.slotNames,
      options: {
        job: candidateExport.job,
        jobLevel: candidateExport.jobLevel,
        attributeIds: candidateExport.attributeIds,
        statIndexes,
        slots: candidateExport.slots,
        foods: candidateExport.foods,
        constraints: candidateExport.constraints,
        speedAttributeId: candidateExport.speedAttributeId,
        toughnessAttributeId: candidateExport.toughnessAttributeId,
        gcdToSpeedRange: (gcd) =>
          equippedSpeedRangeForGcd(
            candidateExport.job,
            candidateExport.jobLevel,
            gcd,
          ),
        toughnessPercentToMinimum: (percentage) =>
          equippedToughnessForMitigationPercent(
            candidateExport.job,
            candidateExport.jobLevel,
            percentage,
          ),
        equipmentAttributeExtractor,
        evaluationFunction,
        onSolverProgress: (event) => parentPort?.postMessage({ type: "solver-progress", event }),
      },
    };
  });

  const result = await findBestJointLoadoutV3({
    jobs,
    commonSlots: workerData.commonSlots,
    foodStrategy: workerData.foodStrategy,
    objective: workerData.objective,
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
