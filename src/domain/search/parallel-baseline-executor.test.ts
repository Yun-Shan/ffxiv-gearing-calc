import assert from "node:assert/strict";
import { test, vi } from "vitest";
import type {
  BaselineWorkerHandle,
  BaselineWorkerMessage,
  BaselineWorkerRequest,
} from "./parallel-baseline-executor.ts";
import type { ExactMipOptions } from "./loadout-finder-exact-mip.ts";
import { findBestLoadoutExactMip } from "./loadout-finder-exact-mip.ts";
import { solveSerializedBaseline } from "./parallel-baseline-solver.ts";
import { equippedEffects } from "./equipped-effects.ts";
import { markCanonicalEvaluatorCandidateUpperBound } from "./exact-mip-candidate-upper-bound.ts";
import type { Stat, Stats } from "../types.ts";
import type { EquipInfo, FoodInfo, ParamInfo } from "./types.ts";

const adapter = vi.hoisted(() => ({
  createNodeBaselineWorker: vi.fn(),
}));

vi.mock("../node/parallel-baseline-node-adapter.ts", () => ({
  createNodeBaselineWorker: adapter.createNodeBaselineWorker,
}));

import { createParallelBaselineExecutor } from "./parallel-baseline-executor.ts";

const task: ExactMipOptions = {
  clanIndex: 0,
  objective: "dps",
  job: "RDM",
  jobLevel: 100,
  attributeIds: [],
  statIndexes: new Map(),
  slots: [],
  foods: [],
  evaluationFunction: () => undefined,
  maxSearchMs: 5_000,
};

type TestWorkerHandle = BaselineWorkerHandle & {
  emitExit: (code: number) => void;
};

function workerHandle(
  respond: (
    post: (message: BaselineWorkerMessage) => void,
    request: BaselineWorkerRequest,
  ) => void,
  terminate: () => void | Promise<unknown>,
  emitError: (emit: (error: Error) => void) => void = () => undefined,
): TestWorkerHandle {
  const messageListeners = new Set<(message: BaselineWorkerMessage) => void>();
  const errorListeners = new Set<(error: Error) => void>();
  const exitListeners = new Set<(code: number) => void>();
  return {
    postMessage: (request) => {
      respond((message) => {
        for (const listener of messageListeners) listener(message);
      }, request);
      emitError((error) => {
        for (const listener of errorListeners) listener(error);
      });
    },
    onMessage: (listener) => {
      messageListeners.add(listener);
      return () => messageListeners.delete(listener);
    },
    onError: (listener) => {
      errorListeners.add(listener);
      return () => errorListeners.delete(listener);
    },
    onExit: (listener) => {
      exitListeners.add(listener);
      return () => exitListeners.delete(listener);
    },
    terminate,
    emitExit: (code) => {
      for (const listener of exitListeners) listener(code);
    },
  };
}

const control = {
  remainingMs: () => 5_000,
  isCancelled: () => false,
  maxConcurrency: 1,
};

const testAttributeIds = [-1, 1, 2, 3, 4, 5, 6];
const testStatIndexes = new Map<Stat, number>([
  ["MDMG", 0], ["INT", 1], ["CRT", 2], ["DET", 3], ["DHT", 4], ["SPS", 5], ["TEN", 6],
]);

function testEquipment(
  itemId: number,
  attributes: Record<number, number>,
  markers: Pick<EquipInfo, "ringSlotIndex" | "isUnique"> = {},
): EquipInfo {
  const baseParams: ParamInfo[] = Object.entries(attributes).map(([baseParamId, value]) => ({
    baseParamId: Number(baseParamId),
    value,
  }));
  return {
    itemId,
    itemLevel: 795,
    key: "test-key",
    variantKey: `variant-${itemId}`,
    baseParams,
    PDMG: 0,
    MDMG: 0,
    DLY: 0,
    ...markers,
  };
}

function exactOptionsForWorker(): ExactMipOptions {
  const weapon = testEquipment(100, {
    [-1]: 160, 1: 2600, 2: 550, 3: 500, 4: 400, 5: 300, 6: 300, 99: 1234,
  });
  const strongUniqueFirst = testEquipment(200, {
    1: 570, 2: 280, 3: 260, 4: 220, 5: 100, 6: 110, 99: 4321,
  }, { ringSlotIndex: 0, isUnique: true });
  const weakFirst = { ...testEquipment(201, {
    1: 520, 2: 240, 3: 230, 4: 200, 5: 90, 6: 100,
  }, { ringSlotIndex: 0, isUnique: false }), itemLevel: 735 };
  const sameUniqueSecond = { ...strongUniqueFirst, ringSlotIndex: 1 as const };
  const otherUniqueSecond = testEquipment(202, {
    1: 560, 2: 270, 3: 250, 4: 210, 5: 95, 6: 105,
  }, { ringSlotIndex: 1, isUnique: true });
  const foodA: FoodInfo = {
    itemId: 5001, itemLevel: 795, key: "food-a", physicalKey: "physical-a",
    baseParams: [
      { baseParamId: 1, baseValue: 900, multiplier: 1.1, maxValue: 90 },
      { baseParamId: 2, multiplier: 1.1, maxValue: 90 },
      { baseParamId: 99, baseValue: 700, multiplier: 1.2, maxValue: 120 },
    ],
  };
  const foodB: FoodInfo = {
    itemId: 5002, itemLevel: 795, key: "food-b", physicalKey: "physical-b",
    baseParams: [
      { baseParamId: 1, multiplier: 1.1, maxValue: 90 },
      { baseParamId: 3, baseValue: 500, multiplier: 1.1, maxValue: 90 },
    ],
  };
  return markCanonicalEvaluatorCandidateUpperBound({
    clanIndex: 0,
    job: "RDM",
    jobLevel: 100,
    attributeIds: testAttributeIds,
    statIndexes: testStatIndexes,
    slots: [[weapon], [strongUniqueFirst, weakFirst], [sameUniqueSecond, otherUniqueSecond]],
    foods: [foodA, foodB],
    candidateItemLevelRanges: [{ min: 775, max: 795 }],
    evaluationFunction: (attributes) => {
      const contributions: Stats = {};
      for (const [stat, index] of testStatIndexes) contributions[stat] = attributes[index] ?? 0;
      const effects = equippedEffects("RDM", 100, contributions);
      return effects === undefined ? undefined : { damage: effects.damage, gcd: effects.gcd };
    },
    objective: "damage",
    maxSearchMs: 20_000,
  });
}

test("executor retains and reuses a worker across batches until search disposal", async () => {
  let created = 0;
  let terminated = 0;
  adapter.createNodeBaselineWorker.mockImplementation(() => {
    created++;
    return workerHandle(
      (post) =>
        queueMicrotask(() => post({ type: "result", result: undefined })),
      () => {
        terminated++;
      },
    );
  });

  const executor = await createParallelBaselineExecutor();
  assert.ok(executor);
  try {
    assert.deepEqual(await executor([task], control), [undefined]);
    // 两个批次之间，搜索可能会在主线程上执行超过一秒的精确计算。
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    assert.deepEqual(await executor([task], control), [undefined]);
    assert.equal(created, 1, "the second batch should reuse the first worker");
    assert.equal(terminated, 0, "an idle worker remains owned by this search");
  } finally {
    await executor.dispose?.();
  }
  assert.equal(
    terminated,
    1,
    "disposing the search terminates its retained worker",
  );
});

test("executor runs five bounded baseline tasks concurrently when requested", async () => {
  let active = 0;
  let maximumActive = 0;
  adapter.createNodeBaselineWorker.mockImplementation(() => workerHandle((post) => {
    active++;
    maximumActive = Math.max(maximumActive, active);
    setTimeout(() => {
      active--;
      post({ type: "result", result: undefined });
    }, 25);
  }, () => undefined));

  const executor = await createParallelBaselineExecutor();
  assert.ok(executor);
  try {
    assert.deepEqual(await executor([task, task, task, task, task], {
      ...control,
      maxConcurrency: 5,
    }), [undefined, undefined, undefined, undefined, undefined]);
    assert.equal(maximumActive, 5);
  } finally {
    await executor.dispose?.();
  }
});

test("task completion can stop a batch early and remove active workers for reuse", async () => {
  let created = 0;
  let terminated = 0;
  const pendingTimers = new Set<ReturnType<typeof setTimeout>>();
  const postedJobs: string[] = [];
  const completedJobs: string[] = [];
  adapter.createNodeBaselineWorker.mockImplementation(() => {
    created++;
    return workerHandle((post, request) => {
      const job = request.options.job;
      postedJobs.push(job);
      const delayMs = job === "RDM" ? 5 : 150;
      const timer = setTimeout(() => {
        pendingTimers.delete(timer);
        completedJobs.push(job);
        post({ type: "result", result: undefined });
      }, delayMs);
      pendingTimers.add(timer);
    }, () => {
      terminated++;
      for (const timer of pendingTimers) clearTimeout(timer);
      pendingTimers.clear();
    });
  });

  const executor = await createParallelBaselineExecutor();
  assert.ok(executor);
  const completions: number[] = [];
  try {
    const partialResults = await executor([task, { ...task, job: "WHM" }], {
      ...control,
      maxConcurrency: 2,
      onTaskComplete: (taskIndex) => {
        completions.push(taskIndex);
        return true;
      },
    });
    assert.deepEqual(partialResults, [undefined, undefined],
      "uncompleted positions are explicitly undefined in the partial result array");
    assert.deepEqual(postedJobs, ["RDM", "WHM"],
      "both workers start before the first task completes");
    assert.deepEqual(completedJobs, ["RDM"]);
    assert.deepEqual(completions, [0],
      "the slow task must not be processed after early completion");
    assert.equal(terminated, 1,
      "the active slow worker is terminated without awaiting its MIP");

    await new Promise((resolve) => setTimeout(resolve, 180));
    assert.deepEqual(completedJobs, ["RDM"],
      "the terminated worker cannot emit its delayed result later");
    assert.deepEqual(completions, [0]);

    assert.deepEqual(await executor([task], control), [undefined]);
    assert.equal(created, 2,
      "the idle completed worker remains reusable after the other worker is removed");
  } finally {
    for (const timer of pendingTimers) clearTimeout(timer);
    await executor.dispose?.();
  }
  assert.equal(terminated, 2,
    "disposal terminates the reused worker after the early stop removed its peer");
});

test("compact baseline columns preserve the exact optimum and restore original candidate identities", async () => {
  const options = exactOptionsForWorker();
  const expected = await findBestLoadoutExactMip(options);
  assert.ok(expected);
  let postedRequest: BaselineWorkerRequest | undefined;
  adapter.createNodeBaselineWorker.mockImplementation(() => workerHandle((post, request) => {
    postedRequest = request;
    void solveSerializedBaseline(request.options, {}).then(
      (result) => post({ type: "result", result }),
      (caught) => {
        const error = caught instanceof Error ? caught : new Error(String(caught));
        post({ type: "error", error: { name: error.name, message: error.message } });
      },
    );
  }, () => undefined));

  const executor = await createParallelBaselineExecutor();
  assert.ok(executor);
  try {
    const results = await executor([options], control);
    assert.ok(results);
    const [actual] = results;
    assert.ok(actual);
    assert.equal(actual.damage, expected.damage);
    assert.deepEqual(actual.statistics.conditionalResourceSupport,
      expected.statistics.conditionalResourceSupport,
      "worker and local models must use the same item-level resource supports");
    assert.deepEqual(actual.selection.map((equipment) => equipment.itemId),
      expected.selection.map((equipment) => equipment.itemId));
    actual.selection.forEach((equipment, index) => {
      assert.strictEqual(equipment, expected.selection[index],
        "the executor must restore the exact original equipment object");
    });
    assert.strictEqual(actual.food, expected.food,
      "the executor must restore the exact original food object");
    assert.ok(!(actual.selection[1]!.itemId === actual.selection[2]!.itemId &&
      actual.selection[1]!.isUnique === true), "unique ring metadata must remain enforced");

    assert.ok(postedRequest);
    assert.ok(postedRequest.options.slots.itemIds instanceof Float64Array);
    assert.ok(postedRequest.options.slots.itemLevels instanceof Float64Array);
    assert.deepEqual(Array.from(postedRequest.options.slots.itemLevels), [795, 795, 735, 795, 795],
      "item levels on both sides of the resource prior must survive serialization");
    assert.equal(postedRequest.options.enableCanonicalEvaluatorCandidateUpperBound, true,
      "the internal canonical-evaluator optimization flag must cross the compact worker boundary");
    assert.deepEqual(postedRequest.options.candidateItemLevelRanges, [{ min: 775, max: 795 }],
      "the internal item-level resource prior must cross the compact worker boundary");
    assert.ok(postedRequest.options.slots.parameterIds instanceof Float64Array);
    assert.equal("baseParams" in postedRequest.options.slots, false,
      "candidate objects must not cross the worker boundary");
    assert.deepEqual(Array.from(postedRequest.options.slots.ringSlotKinds), [0, 1, 1, 1, 1]);
    assert.deepEqual(Array.from(postedRequest.options.slots.uniqueKinds), [0, 2, 1, 2, 2]);
    assert.equal(postedRequest.options.slots.parameterIds.includes(99), false,
      "attributes outside the exact solver vector should be omitted");
    assert.equal(postedRequest.options.foods.parameterIds.includes(99), false,
      "food attributes outside the exact solver vector should be omitted");
    assert.equal("physicalKey" in postedRequest.options.foods, false,
      "food identity metadata should remain on the caller side");
  } finally {
    await executor.dispose?.();
  }
});

test("worker serialization applies custom equipment attributes and restores original candidate references", async () => {
  const baseOptions = exactOptionsForWorker();
  const options: ExactMipOptions = {
    ...baseOptions,
    equipmentAttributeExtractor: (equipment) => equipment.baseParams
      .filter((parameter) => parameter.baseParamId !== 4)
      .map((parameter) => parameter.baseParamId === 2 && equipment.itemId === 201
        ? { ...parameter, value: parameter.value + 400 }
        : parameter),
  };
  const expected = await findBestLoadoutExactMip(options);
  assert.ok(expected);
  let postedRequest: BaselineWorkerRequest | undefined;
  adapter.createNodeBaselineWorker.mockImplementation(() => workerHandle((post, request) => {
    postedRequest = request;
    void solveSerializedBaseline(request.options, {}).then(
      (result) => post({ type: "result", result }),
      (caught) => {
        const error = caught instanceof Error ? caught : new Error(String(caught));
        post({ type: "error", error: { name: error.name, message: error.message } });
      },
    );
  }, () => undefined));

  const executor = await createParallelBaselineExecutor();
  assert.ok(executor);
  try {
    const results = await executor([options], control);
    assert.ok(results);
    const [actual] = results;
    assert.ok(actual);
    assert.equal(actual.damage, expected.damage);
    assert.deepEqual(actual.selection.map((equipment) => equipment.itemId),
      expected.selection.map((equipment) => equipment.itemId));
    actual.selection.forEach((equipment, index) => {
      assert.strictEqual(equipment, expected.selection[index],
        "worker results must resolve through the source slot index to the original object");
      assert.ok(options.slots[index]!.includes(equipment));
    });

    assert.ok(postedRequest);
    assert.equal(postedRequest.options.slots.parameterIds.includes(4), false,
      "the worker columns must contain the extracted attributes rather than raw equipment parameters");
    const weakCandidateIndex = 2;
    const parameterStart = postedRequest.options.slots.parameterOffsets[weakCandidateIndex]!;
    const parameterEnd = postedRequest.options.slots.parameterOffsets[weakCandidateIndex + 1]!;
    const weakCandidateAttributes = Array.from({ length: parameterEnd - parameterStart }, (_, offset) => {
      const parameterIndex = parameterStart + offset;
      return {
        id: postedRequest!.options.slots.parameterIds[parameterIndex],
        value: postedRequest!.options.slots.parameterValues[parameterIndex],
      };
    });
    assert.ok(weakCandidateAttributes.some(({ id, value }) => id === 2 && value === 640),
      "the parent must apply candidate-specific extractor values before posting columns");
  } finally {
    await executor.dispose?.();
  }
});

test("compact baseline columns preserve internal resource-support policy", async () => {
  let postedRequest: BaselineWorkerRequest | undefined;
  adapter.createNodeBaselineWorker.mockImplementation(() => workerHandle((post, request) => {
    postedRequest = request;
    post({ type: "result", result: undefined });
  }, () => undefined));
  const executor = await createParallelBaselineExecutor();
  assert.ok(executor);
  try {
    await executor([{
      ...task,
      candidateResourceSupportProfile: "disabled",
      mainStatResourceSupport: true,
    }], control);
    assert.equal(postedRequest?.options.candidateResourceSupportProfile, "disabled",
      "the job-count policy must survive compact baseline serialization");
    assert.equal(postedRequest?.options.mainStatResourceSupport, true,
      "the targeted main-stat baseline policy must survive worker serialization");
  } finally {
    await executor.dispose?.();
  }
});

test("executor replaces an idle worker immediately while its termination is pending", async () => {
  let created = 0;
  let firstWorker: TestWorkerHandle | undefined;
  let firstTerminationStarted = false;
  let finishFirstTermination!: () => void;
  const firstTermination = new Promise<void>((resolve) => {
    finishFirstTermination = resolve;
  });
  adapter.createNodeBaselineWorker.mockImplementation(() => {
    created++;
    const worker = workerHandle(
      (post) =>
        queueMicrotask(() => post({ type: "result", result: undefined })),
      () => {
        if (created === 1) {
          firstTerminationStarted = true;
          return firstTermination;
        }
      },
    );
    if (created === 1) firstWorker = worker;
    return worker;
  });

  const executor = await createParallelBaselineExecutor();
  assert.ok(executor);
  try {
    assert.deepEqual(await executor([task], control), [undefined]);
    assert.ok(firstWorker);
    firstWorker.emitExit(17);
    assert.equal(firstTerminationStarted, true);

    let remainingChecks = 0;
    assert.deepEqual(
      await executor([task], {
        ...control,
        remainingMs: () => (remainingChecks++ < 2 ? 5_000 : 0),
      }),
      [undefined],
    );
    assert.equal(
      created,
      2,
      "the removed worker must not consume replacement capacity",
    );
  } finally {
    finishFirstTermination();
    await executor.dispose?.();
  }
});

test.each([
  {
    name: "worker error",
    respond: (post: (message: BaselineWorkerMessage) => void) =>
      queueMicrotask(() =>
        post({
          type: "error",
          error: { name: "Error", message: "synthetic worker failure" },
        }),
      ),
    remainingMs: () => 5_000,
    isCancelled: () => false,
    emitError: () => undefined,
    expectedError: /synthetic worker failure/,
  },
  {
    name: "worker error event",
    respond: () => undefined,
    remainingMs: () => 5_000,
    isCancelled: () => false,
    emitError: (emit: (error: Error) => void) =>
      queueMicrotask(() => emit(new Error("synthetic worker event failure"))),
    expectedError: /synthetic worker event failure/,
  },
  {
    name: "deadline timeout",
    respond: () => undefined,
    remainingMs: (() => {
      let calls = 0;
      return () => (calls++ < 2 ? 5_000 : 0);
    })(),
    isCancelled: () => false,
    emitError: () => undefined,
    expectedError: /搜索超过时限/,
  },
  {
    name: "cancellation",
    respond: () => undefined,
    remainingMs: () => 5_000,
    isCancelled: (() => {
      let calls = 0;
      return () => calls++ > 0;
    })(),
    emitError: () => undefined,
    expectedError: /搜索已取消/,
  },
])(
  "executor waits for worker cleanup after $name",
  async ({ respond, remainingMs, isCancelled, emitError, expectedError }) => {
    let terminateWorker!: () => void;
    let terminationStarted = false;
    const terminationGate = new Promise<void>((resolve) => {
      terminateWorker = resolve;
    });
    adapter.createNodeBaselineWorker.mockImplementation(() =>
      workerHandle(
        respond,
        () => {
          terminationStarted = true;
          return terminationGate;
        },
        emitError,
      ),
    );

    const executor = await createParallelBaselineExecutor();
    assert.ok(executor);
    try {
      const run = executor([task], { ...control, remainingMs, isCancelled });
      let settled = false;
      void run.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        },
      );
      await new Promise((resolve) => setTimeout(resolve, 30));
      assert.equal(
        terminationStarted,
        true,
        "failure should start terminating the worker",
      );
      assert.equal(
        settled,
        false,
        "the batch rejects only after worker termination finishes",
      );
      terminateWorker();
      await assert.rejects(run, expectedError);
    } finally {
      terminateWorker();
      await executor.dispose?.();
    }
  },
);
