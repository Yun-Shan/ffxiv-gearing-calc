import type { ParamInfo } from "./types.ts";

export function equipmentAttributeValuesKey(
  attributes: readonly ParamInfo[],
): string {
  return attributes
    .map(({ baseParamId, value }) => `${baseParamId}:${value}`)
    .join("|");
}
