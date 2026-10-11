/** Caps memory-heavy joint baselines (100k+ input candidates) at three workers. */
export function baselineWorkerLimit(jobCount: number, candidateCount: number): number {
  const normalizedJobCount = Math.max(1, Math.floor(jobCount));
  const availableWorkers = Math.min(4, normalizedJobCount);
  if (candidateCount >= 100_000) return Math.min(3, availableWorkers);
  // A fifth baseline avoids leaving one profession queued in ordinary five-job
  // searches. Keep the broader four-worker cap for larger candidate pools.
  if (normalizedJobCount >= 5 && candidateCount <= 13_500) return 5;
  return availableWorkers;
}
