/** 当候选输入达到十万以上时，将内存占用较高的联合基线任务限制为三个工作线程。 */
export function baselineWorkerLimit(jobCount: number, candidateCount: number): number {
  const normalizedJobCount = Math.max(1, Math.floor(jobCount));
  const availableWorkers = Math.min(4, normalizedJobCount);
  if (candidateCount >= 100_000) return Math.min(3, availableWorkers);
  // 普通的五职业搜索使用五个线程，可避免总有一个职业的基线任务排队。
  // 候选池较大时仍沿用较宽的四线程上限。
  if (normalizedJobCount >= 5 && candidateCount <= 13_500) return 5;
  return availableWorkers;
}
