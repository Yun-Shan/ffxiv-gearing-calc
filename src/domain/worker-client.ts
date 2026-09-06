import { optimize } from "./optimizer";
import type { OptimizationConfig, OptimizationResult } from "./types";
import type { WorkerRequest, WorkerResponse } from "./optimizer.worker";

interface PendingRequest {
  resolve: (value: WorkerResponse) => void;
  reject: (error: Error) => void;
}

interface WorkerHandle {
  worker: Worker;
  pending: Map<number, PendingRequest>;
  nextId: number;
}

const handles: WorkerHandle[] = [];

function getWorkerCount(): number {
  const envValue = (globalThis as { __optimizerWorkerCount?: number }).__optimizerWorkerCount;
  if (typeof envValue === "number" && Number.isFinite(envValue) && envValue > 0) return Math.floor(envValue);
  if (typeof navigator !== "undefined" && typeof navigator.hardwareConcurrency === "number") {
    return Math.max(1, Math.min(4, navigator.hardwareConcurrency - 1));
  }
  return 2;
}

function createWorker(): Worker {
  return new Worker(new URL("./optimizer.worker.ts", import.meta.url), { type: "module" });
}

function ensureWorkers(count: number): WorkerHandle[] {
  while (handles.length < count) {
    const worker = createWorker();
    const handle: WorkerHandle = { worker, pending: new Map(), nextId: 1 };
    worker.addEventListener("message", (event: MessageEvent<WorkerResponse>) => {
      const pending = handle.pending.get(event.data.id);
      if (!pending) return;
      handle.pending.delete(event.data.id);
      pending.resolve(event.data);
    });
    worker.addEventListener("error", (event) => {
      for (const pending of handle.pending.values()) pending.reject(new Error(event.message));
      handle.pending.clear();
    });
    handles.push(handle);
  }
  return handles;
}

function chooseHandle(handles: WorkerHandle[]): WorkerHandle {
  let best = handles[0];
  for (let index = 1; index < handles.length; index++) {
    if (handles[index].pending.size < best.pending.size) best = handles[index];
  }
  return best;
}

// 将一个任务拆分为 N 份，每份递交不同 worker，取最优结果。
// 拆分策略以首个装备档档位（如武器、头部）的候选为准，
// 这保证不同子任务的领域状态集互不包含，最优全局解一定是某个子任务的最优。
function partitionConfig(config: OptimizationConfig, slotCount: number): OptimizationConfig[] {
  if (slotCount <= 1) return [config];
  return Array.from({ length: slotCount }, (_, partition) => {
    const forcedGear = { ...config.forcedGear };
    // 递归定义：在各子任务中禁用其他分区的首位候选，避免跨子任务重复。
    // 由于我们在领域函数里使用 forcedGear，只需在首位限定各子任务的选择。
    return { ...config, forcedGear };
  });
}

// 进一步优化：逐个子任务限定不同的首位装备。
// 此函数需要知道首位为武器位，且领域函数能够记住首位选择。
function partitionByWeapon(config: OptimizationConfig, weaponIds: number[]): OptimizationConfig[] {
  if (weaponIds.length <= 1) return [config];
  return weaponIds.map((weaponId) => ({
    ...config,
    forcedGear: { ...config.forcedGear, weapon: weaponId },
  }));
}

export interface OptimizeInWorkerOptions {
  workerCount?: number;
  // 可选的首位装备 ID，用于拆分任务。为空时不拆分，只使用一个 worker。
  partitionWeaponIds?: number[];
}

export async function optimizeInWorker(
  config: OptimizationConfig,
  options: OptimizeInWorkerOptions = {},
): Promise<{ result: OptimizationResult | undefined; durationMs: number }> {
  const count = options.workerCount ?? getWorkerCount();
  const weaponIds = options.partitionWeaponIds;
  const partitions = weaponIds && weaponIds.length > 0
    ? partitionByWeapon(config, weaponIds)
    : [config];

  if (typeof Worker === "undefined") {
    // 环境不支持 Worker（如 Node.js 测试），同步调用。
    const started = performance.now();
    let best: OptimizationResult | undefined;
    for (const partition of partitions) {
      const result = optimize(partition);
      if (result && (!best || result.score > best.score)) best = result;
    }
    return { result: best, durationMs: performance.now() - started };
  }

  const workers = ensureWorkers(Math.min(count, partitions.length));
  const started = performance.now();
  const responses = await Promise.all(partitions.map(async (partition) => {
    const handle = chooseHandle(workers);
    const id = handle.nextId++;
    return new Promise<WorkerResponse>((resolve, reject) => {
      handle.pending.set(id, { resolve, reject });
      const request: WorkerRequest = { id, config: partition };
      handle.worker.postMessage(request);
    });
  }));
  let best: OptimizationResult | undefined;
  for (const response of responses) {
    if (response.result && (!best || response.result.score > best.score)) best = response.result;
  }
  return { result: best, durationMs: performance.now() - started };
}
