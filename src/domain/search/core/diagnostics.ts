import type { LinearMipRequest } from "../linear-mip.ts";
import type { LinearMipProgress } from "../linear-mip.ts";

export function isProfileTimingEnabled(): boolean {
  const runtimeProcess = (globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> };
  }).process;
  return runtimeProcess?.env?.FFXIV_PROFILE_TIMING === "1";
}

export function emitSolverProfile(
  request: LinearMipRequest,
  phase: string,
  fields: Readonly<Record<string, string | number>>,
): void {
  emitProfileEvent(request.onProgress, "HiGHS", request.name, phase, fields);
}

export function emitProfileEvent(
  onProgress: ((event: LinearMipProgress) => void) | undefined,
  backend: LinearMipProgress["backend"],
  model: string,
  phase: string,
  fields: Readonly<Record<string, string | number>>,
): void {
  if (!onProgress || !isProfileTimingEnabled()) return;
  onProgress({
    backend,
    model,
    kind: "log",
    message: `PROFILE ${JSON.stringify({ phase, ...fields })}`,
  });
}
