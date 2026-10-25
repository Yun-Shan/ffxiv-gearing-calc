import { afterEach, describe, expect, it, vi } from "vitest";
import type { SearchRequest, SearchResponse } from "./worker-client.ts";
import type { OptimizationConfig } from "./types.ts";

const calculatorMock = vi.hoisted(() => ({
  calculateFeasibleGcdTiers: vi.fn(() => [2.5]),
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
): OptimizationConfig {
  return {
    clanIndex: 0,
    objective: "damage",
    jobId,
    minItemLevel: 0,
    maxItemLevel: 9999,
    maximizeTenacity: false,
    foodId: 0,

  };
}

describe("GCD worker configuration", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    calculatorMock.calculateFeasibleGcdTiers.mockClear();
  });

  it("supplies empty equipment restrictions for requests that omit them", async () => {
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
    await import("./compute.worker.ts");

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

    expect(await send(configFor("BST"))).toEqual([2.5]);
    expect(await send(configFor("PLD"))).toEqual([2.5]);
    expect(calculatorMock.calculateFeasibleGcdTiers).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ jobId: "BST", excludedSources: [], excludedGearIds: [], forcedGear: {} }),
      expect.any(Object),
      expect.any(Object),
    );
    expect(calculatorMock.calculateFeasibleGcdTiers).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ jobId: "PLD", excludedSources: [], excludedGearIds: [], forcedGear: {} }),
      expect.any(Object),
      expect.any(Object),
    );
  });
});
