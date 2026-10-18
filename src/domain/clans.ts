import { gameData } from "./data.ts";

/** 游戏数据中可选的族群（种族内分支）数量，运行时基础属性表决定。 */
export const clanCount = Math.max(
  0,
  ...Object.values(gameData.clanStats).map((values) => values?.length ?? 0),
);

/** 默认族群：人族·中原之民。 */
export const defaultClanIndex = 0;

export function assertClanIndex(clanIndex: number): number {
  if (
    !Number.isSafeInteger(clanIndex) ||
    clanIndex < 0 ||
    clanIndex >= clanCount
  ) {
    throw new RangeError(`族群序号无效：${clanIndex}`);
  }
  return clanIndex;
}
