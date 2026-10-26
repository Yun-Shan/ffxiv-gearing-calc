import { gameData } from "../domain/data.ts";
import type { JobId, SyncTarget } from "../domain/types.ts";
import { check, equal, uint, Reader, Writer } from "./binary.ts";
import { isUnknownSource, type ShareSource } from "./types.ts";

const duties = gameData.sync.groups.flatMap((group) => group.options);
export const sourceIds = new Map<string, number>();
gameData.shareTables.sourceRefs.forEach((ref, id) => {
  const source = gameData.gearSources[ref];
  if (source !== undefined) sourceIds.set(source, id);
});
export function sourceById(id: number): ShareSource {
  return (
    gameData.gearSources[gameData.shareTables.sourceRefs[id]] ?? {
      unknownSourceId: id,
    }
  );
}
export function dutyById(id: number) {
  const duty = duties[gameData.shareTables.dutyRefs[id]];
  check(duty, `未知同步副本 ${id}`);
  return duty;
}
export function dutyId(name: string, sync: SyncTarget | undefined): number {
  const id = gameData.shareTables.dutyRefs.findIndex(
    (ref) => duties[ref]?.name === name && equal(duties[ref]?.target, sync),
  );
  check(id >= 0, "同步副本无法解析");
  return id;
}
export function jobNumber(jobId: JobId): number {
  check(Object.hasOwn(gameData.jobs, jobId), "未知职业");
  return gameData.jobs[jobId].id;
}
export function jobFromNumber(id: number): JobId {
  const job = Object.values(gameData.jobs).find((job) => job.id === id);
  check(job, `未知职业 ${id}`);
  return job.abbreviation;
}
export function versionId(version: string): number {
  const id = gameData.shareTables.dataVersions.indexOf(version);
  check(id >= 0, "未知数据版本");
  return id;
}
export function versionFromId(id: number): string {
  const version = gameData.shareTables.dataVersions[id];
  check(version !== undefined, "未知数据版本");
  return version;
}

export function writeSource(w: Writer, source: ShareSource): void {
  if (typeof source !== "string") {
    check(isUnknownSource(source));
    uint(source.unknownSourceId);
    check(source.unknownSourceId < Number.MAX_SAFE_INTEGER);
    w.u(source.unknownSourceId + 1);
    return;
  }
  const id = sourceIds.get(source);
  if (id !== undefined) {
    w.u(id + 1);
    return;
  }
  const bytes = new TextEncoder().encode(source);
  w.u(0);
  w.u(bytes.length);
  w.append(bytes);
}
export function readSource(r: Reader): ShareSource {
  const tag = r.u();
  if (tag === 0) {
    const count = r.count(r.remaining);
    return new TextDecoder("utf-8", { fatal: true }).decode(r.take(count));
  }
  return sourceById(tag - 1);
}
