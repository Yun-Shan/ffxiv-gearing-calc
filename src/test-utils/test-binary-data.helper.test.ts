import { readFileSync } from "node:fs";
import { resolve } from "node:path";

declare global {
  // Node 无法读取 Vite 的 ?url 资源，因此由 Vitest 加载实际生成的数据快照。
  var __FFXIV_GENERATED_DATA_BINARY__: Uint8Array | undefined;
}

globalThis.__FFXIV_GENERATED_DATA_BINARY__ = new Uint8Array(
  readFileSync(resolve(process.cwd(), "src/data/generated-data.bin")),
);
