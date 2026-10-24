/// <reference path="./highs-runtime.d.ts" />

import loadHighs from "highs";
import highsWasmUrl from "highs/runtime?url";

export async function loadBrowserHighs(): ReturnType<typeof loadHighs> {
  try {
    return await loadHighs({ locateFile: () => highsWasmUrl });
  } catch (cause) {
    // Emscripten's raw error includes build flags that an end user cannot act on.
    throw new Error("计算组件加载失败，请重新加载页面后重试。", { cause });
  }
}
