import { NumberInput } from "@/ui/components/form-controls/number-input/NumberInput";
import { gameData, type SyncTarget } from "@/domain";
import { bounds } from "@/ui/services/app-config";
import { syncTargetKey } from "@/ui/services/sync-selection";
import { useJobConditionScope } from "../../../scope";
import type { SearchRangeDraft, ValidationIssue } from "../../../types";
import { SyncLevelSelect } from "./sync-level-select/SyncLevelSelect";
import { ClanSelect } from "./clan-select/ClanSelect";
import styles from "./SearchRangeSection.module.scss";

function assistedMinItemLevel(target: SyncTarget): number | undefined {
  const baseline =
    target.kind === "itemLevel"
      ? target.value
      : gameData.sync.levels.find(({ jobLevel }) => jobLevel === target.value)
          ?.defaultItemLevel;
  return baseline === undefined
    ? undefined
    : Math.floor((baseline - 10) / 10) * 10;
}

export function SearchRangeSectionFields({
  range,
  onChange,
  readOnly = false,
  issues = [],
}: {
  range: SearchRangeDraft;
  onChange(range: SearchRangeDraft): void;
  readOnly?: boolean;
  issues?: readonly ValidationIssue[];
}) {
  return (
    <section className={styles.section} aria-label="搜索范围">
      <h2 className={styles.title}>搜索范围</h2>
      <div className={styles.grid}>
        <ClanSelect
          clanIndex={range.clanIndex}
          disabled={readOnly}
          onChange={(clanIndex) => onChange({ ...range, clanIndex })}
        />
        <div
          className={styles.itemLevelRange}
          role="group"
          aria-label="装备品级范围"
        >
          <span>装备品级范围</span>
          <NumberInput
            minDigits={8}
            hideLabel
            label="最低装备品级"
            debounceMs={1500}
            min={bounds[0]}
            max={bounds[1]}
            value={range.minItemLevel}
            disabled={readOnly}
            invalid={issues.length > 0}
            onChange={(value) =>
              onChange({ ...range, minItemLevel: value ?? 0 })
            }
          />
          <span aria-hidden="true">–</span>
          <NumberInput
            minDigits={8}
            hideLabel
            label="最高装备品级"
            debounceMs={1500}
            min={bounds[0]}
            max={bounds[1]}
            value={range.maxItemLevel}
            disabled={readOnly}
            invalid={issues.length > 0}
            onChange={(value) =>
              onChange({ ...range, maxItemLevel: value ?? 0 })
            }
          />
        </div>
        <SyncLevelSelect
          value={range.sync}
          duty={range.syncDuty}
          disabled={readOnly}
          onChange={(target, syncDuty) => {
            const sameTarget = syncTargetKey(range.sync) === syncTargetKey(target);
            if (sameTarget && range.syncDuty === syncDuty) return;
            const assisted = !sameTarget && target ? assistedMinItemLevel(target) : undefined;
            onChange({
              ...range,
              minItemLevel:
                assisted === undefined
                  ? range.minItemLevel
                  : Math.min(range.minItemLevel, assisted),
              sync: target,
              syncDuty,
            });
          }}
        />
      </div>
      {issues.map((entry, index) => (
        <p className={styles.issue} key={`${entry.code}-${index}`}>
          {entry.message}
        </p>
      ))}
    </section>
  );
}

export function SearchRangeSection() {
  const { draft, updateDraft, readOnly, validation } = useJobConditionScope();
  return (
    <SearchRangeSectionFields
      range={draft.range}
      readOnly={readOnly}
      issues={validation?.sections.range.issues ?? []}
      onChange={(range) => updateDraft((current) => ({ ...current, range }))}
    />
  );
}
