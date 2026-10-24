import {
  gameData,
  syncTargetJobLevel,
  type SyncDutyOption,
  type SyncTarget,
} from "@/domain";
import { syncTargetLabel } from "@/ui/services/sync-selection";

export type SyncSelectionMode = "level" | "duty";

export interface SyncLevelOption {
  target: SyncTarget;
}

export interface SyncOptionCategory<T> {
  id: string;
  label: string;
  options: T[];
}

export function syncOptionLabel(target?: SyncTarget): string {
  return target?.kind === "jobLevel"
    ? `仅同步等级 ${target.value}`
    : syncTargetLabel(target);
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

export function categoryFor<T>(
  categories: readonly SyncOptionCategory<T>[],
  selectedId: string,
) {
  return categories.find(({ id }) => id === selectedId) ?? categories[0];
}
