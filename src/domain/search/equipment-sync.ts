export function applySyncLimit(
  originalValue: number,
  syncLimit: number | undefined,
): number {
  return syncLimit === undefined
    ? originalValue
    : Math.min(originalValue, syncLimit);
}
