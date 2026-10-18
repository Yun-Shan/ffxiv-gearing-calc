import type { HighsCallbackTrace, LinearMipProgress } from "./linear-mip.ts";
import type { ExactMipOptions, ExactMipResult } from "./loadout-finder-exact-mip.ts";
import { hasCanonicalEvaluatorCandidateUpperBound } from "./exact-mip-candidate-upper-bound.ts";
import type { ParamInfo } from "./types.ts";
import type { Stat } from "../types.ts";
import { createBrowserBaselineWorker } from "./parallel-baseline-browser-adapter.ts";

export type BaselineExecutionControl = {
  remainingMs: () => number;
  isCancelled: () => boolean;
  /** 默认使用两个工作线程；小型精确共享域批次最多可请求四个。 */
  maxConcurrency?: number;
  /** 返回 true 时，在收到此结果后停止批次并终止其他活动任务。 */
  onTaskComplete?: (taskIndex: number, result: ExactMipResult | undefined) => boolean;
};

export type BaselineExecutor = ((
  tasks: readonly ExactMipOptions[],
  control: BaselineExecutionControl,
) => Promise<readonly (ExactMipResult | undefined)[] | undefined>) & {
  dispose?: () => Promise<void>;
};

/** 仅供工作线程使用的列式候选输入；候选对象会在线程内部重建。 */
export type SerializedEquipmentColumns = {
  slotOffsets: Uint32Array;
  itemIds: Float64Array;
  parameterOffsets: Uint32Array;
  parameterIds: Float64Array;
  parameterValues: Float64Array;
  ringSlotKinds: Uint8Array;
  ringSlotIndexes: Float64Array;
  uniqueKinds: Uint8Array;
};

export type SerializedFoodColumns = {
  offsets: Uint32Array;
  parameterIds: Float64Array;
  baseValues: Float64Array;
  hasBaseValues: Uint8Array;
  multipliers: Float64Array;
  maxValues: Float64Array;
};

export type SerializedBaselineOptions = {
  job: ExactMipOptions["job"];
  jobLevel: number;
  /** 族群基础属性索引；未提供时使用 0（人族·中原之民）。 */
  clanIndex?: number;
  attributeIds: readonly number[];
  statIndexes: readonly (readonly [Stat, number])[];
  slots: SerializedEquipmentColumns;
  foods: SerializedFoodColumns;
  constraints?: ExactMipOptions["constraints"];
  speedAttributeId?: number;
  toughnessAttributeId?: number;
  objective?: ExactMipOptions["objective"];
  candidateItemLevelRanges?: ExactMipOptions["candidateItemLevelRanges"];
  candidateResourceSupportProfile?: ExactMipOptions["candidateResourceSupportProfile"];
  resourceBudgetCandidateProfile?: ExactMipOptions["resourceBudgetCandidateProfile"];
  primaryResourceSupports?: true;
  mainStatResourceSupport?: true;
  enableCanonicalEvaluatorCandidateUpperBound?: true;
  maxSearchMs: number;
};

export type BaselineWorkerRequest = {
  options: SerializedBaselineOptions;
  callbacks: {
    progress: boolean;
    solverProgress: boolean;
    solverCallback: boolean;
  };
};

export type BaselineWorkerMessage =
  | { type: "progress"; message: string }
  | { type: "solverProgress"; progress: LinearMipProgress }
  | { type: "solverCallback"; trace: HighsCallbackTrace }
  | { type: "result"; result: SerializedBaselineResult | undefined }
  | { type: "error"; error: { name: string; message: string; stack?: string } };

export type SerializedBaselineResult = Omit<ExactMipResult, "selection" | "food"> & {
  selectionIndexes: readonly number[];
  foodIndex: number | undefined;
};

export type BaselineWorkerHandle = {
  postMessage: (request: BaselineWorkerRequest) => void;
  onMessage: (listener: (message: BaselineWorkerMessage) => void) => () => void;
  onError: (listener: (error: Error) => void) => () => void;
  onExit?: (listener: (code: number) => void) => () => void;
  terminate: () => void | Promise<unknown>;
};

type PooledWorker = {
  handle: BaselineWorkerHandle;
  busy: boolean;
  failureHandler?: (error: Error) => void;
  detachHealth?: () => void;
  disposed: boolean;
  removal?: Promise<void>;
};

// 执行器由一次联合搜索持有；空闲线程留给后续 V3 批次复用，
// 搜索释放执行器时再统一终止所有线程。
class BaselineWorkerPool {
  private readonly workers = new Set<PooledWorker>();
  private disposed = false;
  private disposePromise?: Promise<void>;
  private readonly createWorker: () => BaselineWorkerHandle;

  constructor(createWorker: () => BaselineWorkerHandle) {
    this.createWorker = createWorker;
  }

  acquire(maxWorkers: number): PooledWorker | undefined {
    if (this.disposed) throw new Error("基线工作线程池已关闭");
    let worker = [...this.workers].find((candidate) => !candidate.busy && !candidate.disposed);
    if (worker === undefined) {
      const availableWorkerCount = [...this.workers].filter((candidate) => !candidate.disposed).length;
      if (availableWorkerCount >= maxWorkers) return undefined;
      const handle = this.createWorker();
      worker = { handle, busy: false, disposed: false };
      const detachHealth: (() => void)[] = [];
      detachHealth.push(handle.onError((error) => this.failWorker(worker!, error)));
      if (handle.onExit !== undefined) {
        detachHealth.push(handle.onExit((code) => {
          this.failWorker(worker!, new Error(`基线工作线程提前退出（${code}）`));
        }));
      }
      worker.detachHealth = () => detachHealth.splice(0).forEach((detach) => detach());
      this.workers.add(worker);
    }
    worker.busy = true;
    return worker;
  }

  release(worker: PooledWorker): void {
    if (worker.disposed || this.disposed) return;
    worker.busy = false;
    worker.failureHandler = undefined;
  }

  async remove(worker: PooledWorker): Promise<void> {
    if (worker.removal !== undefined) return worker.removal;
    worker.disposed = true;
    worker.busy = false;
    worker.failureHandler = undefined;
    worker.detachHealth?.();
    worker.detachHealth = undefined;
    worker.removal = (async () => {
      try {
        await worker.handle.terminate();
      } catch {
        // 清理工作线程不能让已经证明完成的搜索变成失败。
      } finally {
        this.workers.delete(worker);
      }
    })();
    return worker.removal;
  }

  dispose(): Promise<void> {
    if (this.disposePromise !== undefined) return this.disposePromise;
    this.disposed = true;
    this.disposePromise = Promise.all([...this.workers].map((worker) => this.remove(worker)))
      .then(() => undefined);
    return this.disposePromise;
  }

  private failWorker(worker: PooledWorker, error: Error): void {
    const onFailure = worker.failureHandler;
    void this.remove(worker);
    onFailure?.(error);
  }
}

function serializedOptions(
  options: ExactMipOptions,
  remainingMs: number,
): SerializedBaselineOptions {
  const attributeIds = [...options.attributeIds];
  const relevantAttributes = new Set(attributeIds);
  let candidateCount = 0;
  let parameterCount = 0;
  const candidateParameters: (readonly ParamInfo[])[] = [];
  const slotOffsets = new Uint32Array(options.slots.length + 1);
  for (let slotIndex = 0; slotIndex < options.slots.length; slotIndex++) {
    const slot = options.slots[slotIndex]!;
    for (const equipment of slot) {
      candidateCount++;
      const parameters = options.equipmentAttributeExtractor?.(equipment) ?? equipment.baseParams;
      candidateParameters.push(parameters);
      parameterCount += parameters.reduce((count, parameter) =>
        count + Number(relevantAttributes.has(parameter.baseParamId)), 0);
    }
    if (candidateCount > 0xffff_ffff || parameterCount > 0xffff_ffff) {
      throw new RangeError("基线候选列超过 32 位索引范围");
    }
    slotOffsets[slotIndex + 1] = candidateCount;
  }

  const itemIds = new Float64Array(candidateCount);
  const parameterOffsetColumns = new Uint32Array(candidateCount + 1);
  const parameterIds = new Float64Array(parameterCount);
  const parameterValues = new Float64Array(parameterCount);
  const ringSlotKinds = new Uint8Array(candidateCount);
  const ringSlotIndexes = new Float64Array(candidateCount);
  const uniqueKinds = new Uint8Array(candidateCount);
  let candidateIndex = 0;
  let parameterIndex = 0;
  for (const slot of options.slots) {
    for (const equipment of slot) {
      itemIds[candidateIndex] = equipment.itemId;
      if (equipment.ringSlotIndex === undefined) ringSlotKinds[candidateIndex] = 0;
      else if (typeof equipment.ringSlotIndex === "number") {
        ringSlotKinds[candidateIndex] = 1;
        ringSlotIndexes[candidateIndex] = equipment.ringSlotIndex;
      } else ringSlotKinds[candidateIndex] = 2;
      if (equipment.isUnique === undefined) uniqueKinds[candidateIndex] = 0;
      else if (equipment.isUnique === false) uniqueKinds[candidateIndex] = 1;
      else if (equipment.isUnique === true) uniqueKinds[candidateIndex] = 2;
      else uniqueKinds[candidateIndex] = 3;
      // 在跨越工作线程边界前提取属性，因为提取器本身可能是闭包。
      for (const parameter of candidateParameters[candidateIndex]!) {
        if (!relevantAttributes.has(parameter.baseParamId)) continue;
        parameterIds[parameterIndex] = parameter.baseParamId;
        parameterValues[parameterIndex] = parameter.value;
        parameterIndex++;
      }
      candidateIndex++;
      parameterOffsetColumns[candidateIndex] = parameterIndex;
    }
  }

  let foodParameterCount = 0;
  for (const food of options.foods) {
    foodParameterCount += food.baseParams.reduce((count, parameter) =>
      count + Number(relevantAttributes.has(parameter.baseParamId)), 0);
    if (foodParameterCount > 0xffff_ffff) {
      throw new RangeError("基线食物属性列超过 32 位索引范围");
    }
  }
  const foodOffsets = new Uint32Array(options.foods.length + 1);
  const foodParameterIds = new Float64Array(foodParameterCount);
  const foodBaseValues = new Float64Array(foodParameterCount);
  const foodHasBaseValues = new Uint8Array(foodParameterCount);
  const foodMultipliers = new Float64Array(foodParameterCount);
  const foodMaxValues = new Float64Array(foodParameterCount);
  let foodParameterIndex = 0;
  for (let foodIndex = 0; foodIndex < options.foods.length; foodIndex++) {
    const food = options.foods[foodIndex]!;
    for (const parameter of food.baseParams) {
      if (!relevantAttributes.has(parameter.baseParamId)) continue;
      foodParameterIds[foodParameterIndex] = parameter.baseParamId;
      if (parameter.baseValue !== undefined && parameter.baseValue !== null) {
        foodBaseValues[foodParameterIndex] = parameter.baseValue;
        foodHasBaseValues[foodParameterIndex] = 1;
      }
      foodMultipliers[foodParameterIndex] = parameter.multiplier;
      foodMaxValues[foodParameterIndex] = parameter.maxValue;
      foodParameterIndex++;
    }
    foodOffsets[foodIndex + 1] = foodParameterIndex;
  }

  return {
    job: options.job,
    jobLevel: options.jobLevel,
    clanIndex: options.clanIndex ?? 0,
    attributeIds,
    statIndexes: [...options.statIndexes],
    slots: {
      slotOffsets,
      itemIds,
      parameterOffsets: parameterOffsetColumns,
      parameterIds,
      parameterValues,
      ringSlotKinds,
      ringSlotIndexes,
      uniqueKinds,
    },
    foods: {
      offsets: foodOffsets,
      parameterIds: foodParameterIds,
      baseValues: foodBaseValues,
      hasBaseValues: foodHasBaseValues,
      multipliers: foodMultipliers,
      maxValues: foodMaxValues,
    },
    ...(options.constraints === undefined ? {} : { constraints: options.constraints }),
    ...(options.speedAttributeId === undefined ? {} : { speedAttributeId: options.speedAttributeId }),
    ...(options.toughnessAttributeId === undefined ? {} : { toughnessAttributeId: options.toughnessAttributeId }),
    ...(options.objective === undefined ? {} : { objective: options.objective }),
    ...(options.candidateItemLevelRanges === undefined
      ? {}
      : { candidateItemLevelRanges: options.candidateItemLevelRanges }),
    ...(options.candidateResourceSupportProfile === undefined
      ? {}
      : { candidateResourceSupportProfile: options.candidateResourceSupportProfile }),
    ...(options.resourceBudgetCandidateProfile === undefined
      ? {}
      : { resourceBudgetCandidateProfile: options.resourceBudgetCandidateProfile }),
    ...(options.primaryResourceSupports === true ? { primaryResourceSupports: true as const } : {}),
    ...(options.mainStatResourceSupport === true ? { mainStatResourceSupport: true as const } : {}),
    ...(hasCanonicalEvaluatorCandidateUpperBound(options)
      ? { enableCanonicalEvaluatorCandidateUpperBound: true as const }
      : {}),
    maxSearchMs: Math.max(1, Math.floor(Math.min(
      remainingMs,
      options.maxSearchMs ?? 235_000,
    ))),
  };
}

function restoreResult(
  result: SerializedBaselineResult | undefined,
  task: ExactMipOptions,
): ExactMipResult | undefined {
  if (result === undefined) return undefined;
  if (result.selectionIndexes.length !== task.slots.length) {
    throw new Error("基线工作线程返回的槽位索引数量不匹配");
  }
  const selection = result.selectionIndexes.map((candidateIndex, slotIndex) => {
    const candidate = Number.isSafeInteger(candidateIndex) && candidateIndex >= 0
      ? task.slots[slotIndex]?.[candidateIndex]
      : undefined;
    if (candidate === undefined) {
      throw new Error(`基线工作线程返回了无效装备索引：${slotIndex}/${candidateIndex}`);
    }
    return candidate;
  });
  const food = result.foodIndex === undefined
    ? undefined
    : Number.isSafeInteger(result.foodIndex) && result.foodIndex >= 0
      ? task.foods[result.foodIndex]
      : undefined;
  if (result.foodIndex !== undefined && food === undefined) {
    throw new Error(`基线工作线程返回了无效食物索引：${result.foodIndex}`);
  }
  const { selectionIndexes: _selectionIndexes, foodIndex: _foodIndex, ...fields } = result;
  return { ...fields, selection, food };
}

async function runWithWorkers(
  tasks: readonly ExactMipOptions[],
  pool: BaselineWorkerPool,
  control: BaselineExecutionControl,
): Promise<readonly (ExactMipResult | undefined)[] | undefined> {
  if (tasks.length === 0) return [];
  const requestedConcurrency = control.maxConcurrency ?? 2;
  const normalizedConcurrency = Number.isFinite(requestedConcurrency)
    ? Math.floor(requestedConcurrency)
    : 2;
  const concurrency = Math.min(5, Math.max(1, normalizedConcurrency), tasks.length);
  const results: (ExactMipResult | undefined)[] = new Array(tasks.length).fill(undefined);
  const active = new Map<number, { worker: PooledWorker; detach: () => void }>();

  return await new Promise((resolve, reject) => {
    let nextIndex = 0;
    let completed = 0;
    let settled = false;
    const detachActiveTasks = () => {
      clearInterval(poll);
      for (const { worker, detach } of active.values()) {
        detach();
        worker.failureHandler = undefined;
      }
      active.clear();
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      detachActiveTasks();
      const normalizedError = error instanceof Error ? error : new Error(String(error));
      void pool.dispose().then(() => reject(normalizedError));
    };
    const succeed = (value: readonly (ExactMipResult | undefined)[] | undefined) => {
      if (settled) return;
      settled = true;
      clearInterval(poll);
      resolve(value);
    };
    const stopAfterCompletedTask = () => {
      if (settled) return;
      settled = true;
      clearInterval(poll);
      for (const { worker, detach } of active.values()) {
        detach();
        worker.failureHandler = undefined;
        // 立即将此线程标记为不可用，但不要让已完成任务等待其他线程的 MIP 或异步终止过程。
        void pool.remove(worker);
      }
      active.clear();
      resolve(results);
    };
    const poll = setInterval(() => {
      if (control.isCancelled()) {
        fail(Object.assign(new Error("搜索已取消"), { name: "AbortError" }));
      } else if (control.remainingMs() <= 0) {
        fail(new Error("V3 搜索超过时限，未完成最优性证明（单职业最优基线）；未返回近似结果"));
      }
    }, 10);

    const launch = () => {
      if (settled) return;
      if (control.isCancelled()) {
        fail(Object.assign(new Error("搜索已取消"), { name: "AbortError" }));
        return;
      }
      if (control.remainingMs() <= 0) {
        fail(new Error("V3 搜索超过时限，未完成最优性证明（单职业最优基线）；未返回近似结果"));
        return;
      }
      while (!settled && active.size < concurrency && nextIndex < tasks.length) {
        const index = nextIndex++;
        const task = tasks[index]!;
        let pooledWorker: PooledWorker | undefined;
        let request: BaselineWorkerRequest;
        try {
          request = {
            options: serializedOptions(task, control.remainingMs()),
            callbacks: {
              progress: task.onProgress !== undefined,
              solverProgress: task.onSolverProgress !== undefined,
              solverCallback: task.onSolverCallback !== undefined,
            },
          };
          pooledWorker = pool.acquire(concurrency);
          if (pooledWorker === undefined) return;
        } catch (error) {
          fail(error);
          return;
        }
        let taskSettled = false;
        const detachListeners: (() => void)[] = [];
        const detach = () => detachListeners.splice(0).forEach((remove) => remove());
        const finishTask = (error?: Error, result?: ExactMipResult) => {
          if (taskSettled || settled) return;
          taskSettled = true;
          detach();
          active.delete(index);
          if (error !== undefined) {
            fail(error);
            return;
          }
          pool.release(pooledWorker!);
          results[index] = result;
          completed++;
          let stop = false;
          try {
            stop = control.onTaskComplete?.(index, result) === true;
          } catch (callbackError) {
            fail(callbackError);
            return;
          }
          if (stop) stopAfterCompletedTask();
          else if (completed === tasks.length) succeed(results);
          else launch();
        };
        pooledWorker.failureHandler = (error) => finishTask(error);
        detachListeners.push(pooledWorker.handle.onMessage((message) => {
          try {
            if (message.type === "progress") task.onProgress?.(message.message);
            else if (message.type === "solverProgress") task.onSolverProgress?.(message.progress);
            else if (message.type === "solverCallback") task.onSolverCallback?.(message.trace);
            else if (message.type === "error") {
              const error = new Error(message.error.message);
              error.name = message.error.name;
              if (message.error.stack) error.stack = message.error.stack;
              finishTask(error);
          } else {
            finishTask(undefined, restoreResult(message.result, task));
          }
          } catch (error) {
            finishTask(error instanceof Error ? error : new Error(String(error)));
          }
        }));
        active.set(index, { worker: pooledWorker, detach });
        try {
          pooledWorker.handle.postMessage(request);
        } catch (error) {
          finishTask(error instanceof Error ? error : new Error(String(error)));
          return;
        }
      }
    };

    launch();
  });
}

export async function createParallelBaselineExecutor(): Promise<BaselineExecutor | undefined> {
  const runtimeProcess = (globalThis as typeof globalThis & {
    process?: { versions?: { node?: string } };
  }).process;
  if (typeof runtimeProcess?.versions?.node === "string") {
    const adapterUrl = new URL("./parallel-baseline-node-adapter.mjs", import.meta.url);
    const adapter = await import(/* @vite-ignore */ adapterUrl.href) as {
      createNodeBaselineWorker: () => BaselineWorkerHandle;
    };
    return createPooledExecutor(adapter.createNodeBaselineWorker);
  }
  if (typeof Worker === "function") {
    return createPooledExecutor(createBrowserBaselineWorker);
  }
  return undefined;
}

function createPooledExecutor(createWorker: () => BaselineWorkerHandle): BaselineExecutor {
  const pool = new BaselineWorkerPool(createWorker);
  let queue: Promise<void> = Promise.resolve();
  const execute: BaselineExecutor = (tasks, control) => {
    const result = queue.then(() => runWithWorkers(tasks, pool, control));
    queue = result.then(() => undefined, () => undefined);
    return result;
  };
  execute.dispose = async () => {
    await queue;
    await pool.dispose();
  };
  return execute;
}
