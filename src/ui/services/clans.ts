/**
 * 种族与族群名称、顺序沿用参考项目的 races/clans 定义，
 * 与运行时基础属性表 clanStats 的索引一一对应。
 */
export interface RaceClans {
  name: string;
  clans: readonly [string, string];
}

export const raceClans: readonly RaceClans[] = [
  { name: "人族", clans: ["中原之民", "高地之民"] },
  { name: "精灵族", clans: ["森林之民", "黑影之民"] },
  { name: "拉拉菲尔族", clans: ["平原之民", "沙漠之民"] },
  { name: "猫魅族", clans: ["逐日之民", "护月之民"] },
  { name: "鲁加族", clans: ["北洋之民", "红焰之民"] },
  { name: "敖龙族", clans: ["晨曦之民", "暮晖之民"] },
  { name: "硌狮族", clans: ["掠日之民", "迷踪之民"] },
  { name: "维埃拉族", clans: ["密林之民", "山林之民"] },
];

export const clanLabels: readonly string[] = raceClans.flatMap((race) =>
  race.clans.map((clan) => `${race.name} · ${clan}`),
);

/** 默认族群：人族·中原之民。 */
export const defaultClanIndex = 0;

export function clanLabel(clanIndex: number): string {
  return clanLabels[clanIndex] ?? "未知种族";
}
