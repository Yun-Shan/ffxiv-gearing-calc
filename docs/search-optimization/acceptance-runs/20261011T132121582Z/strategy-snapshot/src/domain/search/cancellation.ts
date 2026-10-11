export function throwIfCancelled(isCancelled?: () => boolean): void {
  if (isCancelled?.() !== true) return;
  const error = new Error("搜索已取消");
  error.name = "AbortError";
  throw error;
}
