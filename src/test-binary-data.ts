import { readFileSync } from "node:fs";
import { resolve } from "node:path";

declare global {
  // Vitest loads the real generated snapshot because Node cannot fetch Vite's ?url assets.
  var __FFXIV_GENERATED_DATA_BINARY__: Uint8Array | undefined;
}

globalThis.__FFXIV_GENERATED_DATA_BINARY__ = new Uint8Array(
  readFileSync(resolve(process.cwd(), "src/data/generated-data.bin")),
);
