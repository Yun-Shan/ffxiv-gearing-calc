import type { SyncTarget } from "@/domain";

export function syncTargetKey(target?: SyncTarget): string {
  return target ? `${target.kind}:${target.value}` : "disabled";
}

export function syncTargetLabel(target?: SyncTarget, duty?: string): string {
  if (!target) return "未启用";
  if (duty)
    return `${duty}(${target.kind === "itemLevel" ? `品级${target.value}` : `${target.value}级`})`;
  return target.kind === "jobLevel"
    ? `${target.value}级`
    : `品级 ${target.value}`;
}

export function syncSummaryLabel(target?: SyncTarget, duty?: string): string {
  return target?.kind === "itemLevel" && !duty
    ? String(target.value)
    : syncTargetLabel(target, duty);
}
