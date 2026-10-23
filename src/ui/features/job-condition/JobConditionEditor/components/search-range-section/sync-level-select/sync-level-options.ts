import {
  gameData,
  syncTargetJobLevel,
  type SyncDutyOption,
  type SyncTarget,
} from "@/domain";

export type SyncSelectionMode = "level" | "duty";

export interface SyncLevelOption {
  target: SyncTarget;
}

export interface SyncOptionCategory<T> {
  id: string;
  label: string;
  options: T[];
}

export function syncTargetKey(target?: SyncTarget): string {
  return target ? `${target.kind}:${target.value}` : "disabled";
}

export function syncTargetLabel(target?: SyncTarget): string {
  if (!target) return "未启用";
  return target.kind === "jobLevel"
    ? `仅同步等级 ${target.value}`
    : `品级 ${target.value}`;
}

const dutyOptions: SyncDutyOption[] = gameData.sync.groups.flatMap(
  ({ options }) => options,
);

export const levelOptionCategories: SyncOptionCategory<SyncLevelOption>[] = gameData.sync.levels
  .toSorted((left, right) => right.jobLevel - left.jobLevel)
  .map(({ jobLevel }) => ({
    id: String(jobLevel),
    label: `${jobLevel} 级`,
    options: [
      ...new Map(
        dutyOptions
          .filter(
            ({ target }) =>
              target.kind === "itemLevel" &&
              syncTargetJobLevel(target) === jobLevel,
          )
          .map(({ target }) => [target.value, { target }] as const),
      ).values(),
    ].toSorted((left, right) => right.target.value - left.target.value),
  }));

export const dutyOptionCategories: SyncOptionCategory<SyncDutyOption>[] =
  gameData.sync.groups.map(({ name, options }, index) => ({
    id: String(index),
    label: name,
    options,
  }));

export function searchMatches(query: string, ...values: (string | number)[]) {
  const normalized = query.trim().toLocaleLowerCase();
  return (
    !normalized ||
    values.some((value) =>
      String(value).toLocaleLowerCase().includes(normalized),
    )
  );
}

export function categoryFor<T>(
  categories: readonly SyncOptionCategory<T>[],
  selectedId: string,
) {
  return categories.find(({ id }) => id === selectedId) ?? categories[0];
}
