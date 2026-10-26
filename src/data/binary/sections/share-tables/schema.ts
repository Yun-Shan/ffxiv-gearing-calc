/** Counts refer to the original tables in this same container, including index N for missing identities. */
export const shareTablesLayout = [
  ["sourceRefCount", "U，已分配来源分享 ID 数量"],
  ["sourceRefs", "sourceRefCount 个 W(原来源池项数) 字节序号"],
  ["dutyRefCount", "U，已分配副本分享 ID 数量"],
  ["dutyRefs", "dutyRefCount 个 W(原副本选项数) 字节序号"],
  ["dataVersionCount", "U，永久版本数量，至少1"],
  ["dataVersions", "逐项 U(UTF-8 字节数)＋UTF-8；不套用普通段字符串池"],
] as const;
export function referenceWidth(count: number): 1 | 2 | 4 {
  if (!Number.isSafeInteger(count) || count < 0 || count > 0xffffffff)
    throw new Error("分享原表数量无效");
  return count <= 255 ? 1 : count <= 65535 ? 2 : 4;
}
