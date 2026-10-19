import { describe, expect, it } from "vitest";
import {
  foods,
  gears,
  jobSchemas,
  type JobId,
  type JointOptimizationConfig,
  type JointOptimizationResult,
  type OptimizationConfig,
  type OptimizationResult,
} from "@/domain";
import { validateSearchHistoryRecord } from "./search-history";

function config(jobId: JobId): OptimizationConfig {
  return {
    jobId,
    minItemLevel: 700,
    maxItemLevel: 800,
    maximizeTenacity: false,
    excludedSources: [],
    forcedGear: {},
    foodId: 0,
    objective: "damage",
  };
}

function result(): OptimizationResult {
  return {
    calculationLevel: 100,
    gear: [],
    food: { ...foods[0]!, actualStats: {}, utilization: 0 },
    stats: { CRT: 1200 },
    effects: {
      crtChance: 0.1,
      crtDamage: 1.5,
      detDamage: 1,
      dhtChance: 0.2,
      tenDamage: 1,
      tenMitigation: 0,
      damage: 1,
      gcd: 2.5,
      hp: 100,
      mp: 100,
    },
    score: 1,
    objective: "damage",
    damagePerSecond: 0.4,
    gcdTier: 2.5,
    searchedCandidates: 1,
    durationMs: 1,
  };
}

function completedSingleRecord() {
  return {
    id: "history-single-test",
    kind: "single",
    startedAtISO: "2026-10-03T09:00:00.000Z",
    finishedAtISO: "2026-10-03T09:00:01.000Z",
    dataVersion: "test-version",
    config: config("SAM"),
    status: "completed",
    result: result(),
  };
}

function jointResult(jobIds: readonly JobId[]): JointOptimizationResult {
  const resultByJob = Object.fromEntries(
    jobIds.map((jobId) => [jobId, result()]),
  );
  return {
    jobResults: resultByJob,
    optima: resultByJob,
    commonGear: {},
    objective: "damage",
    value: { numerator: "1", denominator: "1", approximate: 1 },
    proof: {
      complete: true,
      objective: "damage",
      optimalityScope: "测试范围",
      outerBound: "测试上界",
      innerSolverStatus: "Optimal",
      formalCertificate: false,
      numericalLimitation: "测试说明",
      terminationReason: "测试结束",
    },
    statistics: {
      elapsedMs: 1,
      timeLimitMs: 100,
      outerNodes: 1,
      completeNodes: 1,
      upperBoundPrunes: 0,
      relaxedOptimaAttained: 0,
      innerSolves: 1,
      parentResultReuses: 0,
      cacheHits: 0,
      cacheMisses: 1,
      cacheEntries: 1,
      cacheLimit: 100,
    },
  };
}

function jointConfig(): JointOptimizationConfig {
  return {
    jobs: [config("RDM"), config("BLM")],
    commonSlots: [],
    foodStrategy: "shared",
    objective: "damage",
  };
}

describe("搜索历史记录结构校验", () => {
  it("rejects unfinished records at the consumer validation boundary", () => {
    const valid = completedSingleRecord();
    expect(() => validateSearchHistoryRecord({ ...valid, status: "running", finishedAtISO: undefined, result: undefined })).toThrow("历史记录必须包含成功完成的结果");
    expect(() => validateSearchHistoryRecord({ ...valid, result: undefined })).toThrow("结果缺少必要字段");
  });
  it("接受带有实际职业ID和完整单职业结果的记录", () => {
    expect(jobSchemas.SAM).toBeDefined();
    expect(validateSearchHistoryRecord(completedSingleRecord()).kind).toBe(
      "single",
    );
  });

  it("要求完成结果包含有效等级但不按当前数据重新解释历史", () => {
    const current = completedSingleRecord();
    current.result = { ...result(), calculationLevel: 80 };
    expect(validateSearchHistoryRecord(current).kind).toBe("single");

    const missingCalculationLevel = completedSingleRecord();
    missingCalculationLevel.result = {
      ...result(),
      calculationLevel: undefined,
    };
    expect(() => validateSearchHistoryRecord(missingCalculationLevel)).toThrow(
      /结果缺少必要字段/,
    );

    const unsupported = completedSingleRecord();
    unsupported.result = { ...result(), calculationLevel: 77 };
    expect(validateSearchHistoryRecord(unsupported).kind).toBe("single");

    const exceedsJobCap = completedSingleRecord();
    exceedsJobCap.config = config("BLU");
    exceedsJobCap.result = { ...result(), calculationLevel: 100 };
    expect(validateSearchHistoryRecord(exceedsJobCap).kind).toBe("single");

    const malformed = completedSingleRecord();
    malformed.result = {
      ...result(),
      calculationLevel: "80",
    } as unknown as OptimizationResult;
    expect(() => validateSearchHistoryRecord(malformed)).toThrow(
      /结果缺少必要字段/,
    );
  });

  it("拒绝未知职业与会让结果面板读取失败的嵌套结果", () => {
    const unknownJob = completedSingleRecord();
    unknownJob.config = {
      ...config("SAM"),
      jobId: "NOT_A_JOB",
    } as unknown as OptimizationConfig;
    expect(() => validateSearchHistoryRecord(unknownJob)).toThrow(
      /配置缺少必要字段/,
    );

    const malformedEffect = completedSingleRecord();
    malformedEffect.result = {
      ...result(),
      effects: { ...result().effects, damage: "无效" },
    } as unknown as OptimizationResult;
    expect(() => validateSearchHistoryRecord(malformedEffect)).toThrow(
      /结果缺少必要字段/,
    );

    const malformedGear = completedSingleRecord();
    malformedGear.result = {
      ...result(),
      gear: [{}],
    } as unknown as OptimizationResult;
    expect(() => validateSearchHistoryRecord(malformedGear)).toThrow(
      /结果缺少必要字段/,
    );
  });

  it("requires the complete calculated food snapshot", () => {
    for (const field of ["actualStats", "utilization"] as const) {
      const record = completedSingleRecord();
      const invalidFood = { ...record.result!.food };
      delete (invalidFood as Partial<typeof invalidFood>)[field];
      expect(() => validateSearchHistoryRecord({ ...record, result: { ...record.result, food: invalidFood } })).toThrow(/结果缺少必要字段/);
    }
  });

  it("validates replacement group references and the two ring candidate groups", () => {
    const weapon = gears.find((gear) => gear.slot === "weapon")!;
    const selectedWeapon = {
      ...weapon,
      melds: [],
      finalStats: weapon.stats,
      replacementGroupKey: "weapon-candidates",
    };
    const validWeaponRecord = completedSingleRecord();
    validWeaponRecord.result = {
      ...result(),
      gear: [selectedWeapon],
      equivalentGear: { "weapon-candidates": [selectedWeapon] },
    };
    expect(validateSearchHistoryRecord(validWeaponRecord).kind).toBe("single");

    const missingGroup = completedSingleRecord();
    missingGroup.result = {
      ...result(),
      gear: [{ ...selectedWeapon, replacementGroupKey: "missing" }],
    };
    expect(() => validateSearchHistoryRecord(missingGroup)).toThrow(
      /结果缺少必要字段/,
    );

    const ring = gears.find((gear) => gear.slot === "ring")!;
    const ordinary = {
      ...ring,
      unique: false,
      melds: [],
      finalStats: ring.stats,
      replacementGroupKey: "all-rings",
      uniqueReplacementGroupKey: "unique-rings",
    };
    const anotherOrdinary = { ...ordinary, id: ordinary.id + 1 };
    const unique = { ...ordinary, id: ordinary.id + 2, unique: true };
    const ringGroups = {
      "all-rings": [ordinary, anotherOrdinary, unique],
      "unique-rings": [unique],
    };
    const ringRecord = completedSingleRecord();
    ringRecord.result = {
      ...result(),
      gear: [ordinary, { ...anotherOrdinary, slot: "ring2" }],
      equivalentGear: ringGroups,
    };
    expect(validateSearchHistoryRecord(ringRecord).kind).toBe("single");

    const malformedUniqueGroup = completedSingleRecord();
    malformedUniqueGroup.result = {
      ...ringRecord.result!,
      equivalentGear: {
        ...ringGroups,
        "unique-rings": [ordinary],
      },
    };
    expect(() => validateSearchHistoryRecord(malformedUniqueGroup)).toThrow(
      /结果缺少必要字段/,
    );
  });

  it("要求联合结果映射覆盖参与职业并校验求解统计字段", () => {
    const configValue = jointConfig();
    const validRecord = {
      id: "history-joint-test",
      kind: "joint",
      startedAtISO: "2026-10-03T09:00:00.000Z",
      finishedAtISO: "2026-10-03T09:00:01.000Z",
      dataVersion: "test-version",
      config: configValue,
      status: "completed",
      result: jointResult(configValue.jobs.map(({ jobId }) => jobId)),
    };
    expect(validateSearchHistoryRecord(validRecord).kind).toBe("joint");

    const missingJob = { ...validRecord, result: jointResult(["RDM"]) };
    expect(() => validateSearchHistoryRecord(missingJob)).toThrow(
      /结果缺少必要字段/,
    );

    const invalidStatistics = jointResult(
      configValue.jobs.map(({ jobId }) => jobId),
    );
    invalidStatistics.statistics.completeNodes = "很多" as unknown as number;
    expect(() =>
      validateSearchHistoryRecord({
        ...validRecord,
        result: invalidStatistics,
      }),
    ).toThrow(/结果缺少必要字段/);
  });

  it("接受没有显式搜索时限的领域联合结果结构", () => {
    const configValue = jointConfig();
    const generatedResult = jointResult(configValue.jobs.map(({ jobId }) => jobId));
    const { timeLimitMs: _timeLimitMs, ...statistics } = generatedResult.statistics;
    const domainResult: JointOptimizationResult = {
      ...generatedResult,
      statistics,
    };
    const record = {
      id: "history-joint-unbounded-test",
      kind: "joint",
      startedAtISO: "2026-10-03T09:00:00.000Z",
      finishedAtISO: "2026-10-03T09:00:01.000Z",
      dataVersion: "test-version",
      config: configValue,
      status: "completed",
      result: domainResult,
    };

    expect(validateSearchHistoryRecord(record).kind).toBe("joint");

    const invalidLimitResult: JointOptimizationResult = {
      ...domainResult,
      statistics: {
        ...statistics,
        timeLimitMs: "unbounded" as unknown as number,
      },
    };
    expect(() => validateSearchHistoryRecord({ ...record, result: invalidLimitResult }))
      .toThrow(/结果缺少必要字段/);
  });
});
