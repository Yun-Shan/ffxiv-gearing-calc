/// <reference path="./highs-runtime.d.ts" />

import loadHighs from "highs";
import highsWasmUrl from "highs/runtime?url";

export function loadBrowserHighs(): ReturnType<typeof loadHighs> {
  return loadHighs({ locateFile: () => highsWasmUrl });
}
