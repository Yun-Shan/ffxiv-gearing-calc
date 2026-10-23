export type TimingCallback = (phase: string, milliseconds: number) => void;
export function timingStart(onTiming?: TimingCallback): number {
  return onTiming ? performance.now() : 0;
}
export function reportTiming(
  onTiming: TimingCallback | undefined,
  phase: string,
  startedAt: number,
): void {
  onTiming?.(phase, performance.now() - startedAt);
}
