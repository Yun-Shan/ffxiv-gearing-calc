/** Reference obsolete flags take precedence over the original source label. */
export function referenceGearSource(gear) {
  if (gear.obsolete === true) return "已废弃";
  const source = gear.source;
  if (source?.endsWith("→雇员探险")) return "雇员探险";
  if (source === "点数/哲学→无限城古迹、日影地修炼所、野营地") return "迷宫挑战/无限城古迹、日影地修炼所、野营地";
  if (source?.endsWith("→诗学") || source?.endsWith("/诗学")) return "点数/诗学";
  if (source?.endsWith("→战利品")) return "怪物狩猎战利品";
  if (source?.endsWith("→兵团")) return "兵团徽章";
  if (source?.endsWith("→同盟")) return "同盟徽章";
  return source;
}

/** Match the original reference label before obsolete-source remapping. */
export function excludeReferenceGearSource(gear) {
  return gear.source?.includes("古董系列") === true || gear.source?.includes("军票") === true;
}

/** Keep either threshold boundary, using the final normalized game levels. */
export function includeGearInCatalog(gear) {
  return !(gear.equipLevel < 50 && gear.level < 90);
}
