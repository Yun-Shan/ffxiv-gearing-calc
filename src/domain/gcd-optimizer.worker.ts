import type { SearchRequest, SearchResponse } from "./worker-client";

const workerScope = self as unknown as {
  postMessage(response: SearchResponse): void;
  addEventListener(type: "message", listener: (event: MessageEvent<SearchRequest>) => void): void;
};

workerScope.addEventListener("message", async (event) => {
  const request = event.data;
  if (request.kind !== "gcds") {
    workerScope.postMessage({ kind: "error", message: "GCD 工作线程收到不支持的请求", name: "TypeError" });
    return;
  }
  try {
    workerScope.postMessage({ kind: "progress", message: "正在启动 GCD 快速计算" });
    const [{ calculateFeasibleGcdTiers }, { calculationJobLevelFor, gearOptionsFor, slotsForJob }] = await Promise.all([
      import("./gcd-tier-calculator.ts"),
      import("./gear-options.ts"),
    ]);
    workerScope.postMessage({ kind: "progress", message: "GCD 快速计算模块已就绪" });
    const value = calculateFeasibleGcdTiers(request.config, {
      onProgress: (message) => workerScope.postMessage({ kind: "progress", message }),
    }, {
      getJobLevel: calculationJobLevelFor,
      gearOptionsFor,
      slotsForJob,
    });
    workerScope.postMessage({ kind: "result", value });
  } catch (caught) {
    const error = caught instanceof Error ? caught : new Error(String(caught));
    workerScope.postMessage({ kind: "error", message: error.message, name: error.name });
  }
});

workerScope.postMessage({ kind: "ready" });
