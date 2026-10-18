import { afterEach, describe, expect, it, vi } from "vitest";
import type { SearchRequest, SearchResponse } from "./worker-client.ts";
import type { OptimizationConfig } from "./types.ts";

const calculatorMock = vi.hoisted(() => ({
  calculateFeasibleGcdTiers: vi.fn((config: { enabledItemSpecialBonuses?: number[] }) =>
    config.enabledItemSpecialBonuses ?? [],
  ),
}));

vi.mock("./gcd-tier-calculator.ts", () => calculatorMock);

interface WorkerScopeMock {
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<SearchRequest>) => void | Promise<void>,
  ): void;
  postMessage(response: SearchResponse): void;
}

function configFor(
  jobId: OptimizationConfig["jobId"],
  enabledItemSpecialBonuses: number[],
): OptimizationConfig {
  return {
    jobId,
    minItemLevel: 0,
    maxItemLevel: 9999,
    maximizeTenacity: false,
    excludedSources: [],
    forcedGear: {},
    foodId: 0,
    enabledItemSpecialBonuses,
  };
}

describe("GCD worker ItemSpecialBonus defaults", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    calculatorMock.calculateFeasibleGcdTiers.mockClear();
  });

  it("overrides caller settings for Beastmaster and non-Beastmaster requests", async () => {
    const responses: SearchResponse[] = [];
    let onMessage: ((event: MessageEvent<SearchRequest>) => void | Promise<void>) | undefined;
    const scope: WorkerScopeMock = {
      addEventListener: (_type, listener) => {
        onMessage = listener;
      },
      postMessage: (response) => responses.push(response),
    };
    vi.stubGlobal("self", scope);
    vi.resetModules();
    await import("./gcd-optimizer.worker.ts");

    const send = async (config: OptimizationConfig): Promise<number[] | undefined> => {
      const listener = onMessage;
      if (listener === undefined) throw new Error("GCD worker 没有注册消息处理器");
      responses.length = 0;
      await listener({ data: { kind: "gcds", config } } as MessageEvent<SearchRequest>);
      const result = responses.find((response) => response.kind === "result");
      return result?.kind === "result" && Array.isArray(result.value)
        ? result.value as number[]
        : undefined;
    };

    expect(await send(configFor("BST", []))).toEqual([11]);
    expect(await send(configFor("PLD", [11]))).toEqual([]);
    expect(calculatorMock.calculateFeasibleGcdTiers).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ jobId: "BST", enabledItemSpecialBonuses: [11] }),
      expect.any(Object),
      expect.any(Object),
    );
    expect(calculatorMock.calculateFeasibleGcdTiers).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ jobId: "PLD", enabledItemSpecialBonuses: [] }),
      expect.any(Object),
      expect.any(Object),
    );
  });
});
