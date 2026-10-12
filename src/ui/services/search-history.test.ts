import { describe, expect, it } from "vitest";
import { foods, jobSchemas, type JobId, type JointOptimizationConfig, type OptimizationConfig, type OptimizationResult } from "../../domain/index";
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
  };
}

function result(): OptimizationResult {
  return {
    gear: [],
    food: foods[0]!,
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

function jointResult(jobIds: readonly JobId[]) {
  const resultByJob = Object.fromEntries(jobIds.map((jobId) => [jobId, result()]));
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
  it("接受带有实际职业ID和完整单职业结果的记录", () => {
    expect(jobSchemas.SAM).toBeDefined();
    expect(validateSearchHistoryRecord(completedSingleRecord()).kind).toBe("single");
  });

  it("拒绝未知职业与会让结果面板读取失败的嵌套结果", () => {
    const unknownJob = completedSingleRecord();
    unknownJob.config = { ...config("SAM"), jobId: "NOT_A_JOB" } as unknown as OptimizationConfig;
    expect(() => validateSearchHistoryRecord(unknownJob)).toThrow(/配置缺少必要字段/);

    const malformedEffect = completedSingleRecord();
    malformedEffect.result = { ...result(), effects: { ...result().effects, damage: "无效" } } as unknown as OptimizationResult;
    expect(() => validateSearchHistoryRecord(malformedEffect)).toThrow(/结果缺少必要字段/);

    const malformedGear = completedSingleRecord();
    malformedGear.result = { ...result(), gear: [{}] } as unknown as OptimizationResult;
    expect(() => validateSearchHistoryRecord(malformedGear)).toThrow(/结果缺少必要字段/);
  });

  it("仅拒绝无法安全展示的完成记录等级，仍允许保留失败尝试", () => {
    const invalidConfig = { ...config("SAM"), jobLevel: 999 };
    const running = {
      ...completedSingleRecord(),
      config: invalidConfig,
      status: "running",
      finishedAtISO: undefined,
      result: undefined,
    };
    expect(validateSearchHistoryRecord(running).status).toBe("running");

    const failed = {
      ...running,
      status: "failed",
      finishedAtISO: "2026-10-03T09:00:01.000Z",
      error: "不支持的职业等级",
    };
    expect(validateSearchHistoryRecord(failed).status).toBe("failed");

    const completed = { ...completedSingleRecord(), config: invalidConfig };
    expect(() => validateSearchHistoryRecord(completed)).toThrow(/职业等级不受当前数据支持/);
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
    expect(() => validateSearchHistoryRecord(missingJob)).toThrow(/结果缺少必要字段/);

    const unsupportedLevelConfig: JointOptimizationConfig = {
      ...configValue,
      jobs: [{ ...configValue.jobs[0]!, jobLevel: 999 }, configValue.jobs[1]!],
    };
    expect(() => validateSearchHistoryRecord({
      ...validRecord,
      config: unsupportedLevelConfig,
    })).toThrow(/职业等级不受当前数据支持/);

    const invalidStatistics = jointResult(configValue.jobs.map(({ jobId }) => jobId));
    invalidStatistics.statistics.completeNodes = "很多" as unknown as number;
    expect(() => validateSearchHistoryRecord({ ...validRecord, result: invalidStatistics })).toThrow(/结果缺少必要字段/);
  });
});
