import { NumberInput } from "@/ui/components/form-controls/number-input/NumberInput";
import { bounds, selectableSyncLevels } from "@/ui/services/app-config";
import { useJobConditionScope } from "../../../scope";
import type { SearchRangeDraft, ValidationIssue } from "../../../types";
import { LabeledSelect } from "@/ui/components/form-controls/labeled-select/LabeledSelect";
import { ClanSelect } from "./clan-select/ClanSelect";
import styles from "./SearchRangeSection.module.scss";

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
        <LabeledSelect
          controlSize="regular"
          layout="inline"
          label="同步品级"
          value={
            range.sync.mode === "enabled"
              ? String(range.sync.itemLevel)
              : "disabled"
          }
          disabled={readOnly}
          options={[
            { value: "disabled", label: "未启用" },
            ...selectableSyncLevels.map((level) => ({
              value: String(level),
              label: String(level),
            })),
          ]}
          onChange={(value) =>
            onChange({
              ...range,
              sync:
                value === "disabled"
                  ? { mode: "disabled" }
                  : { mode: "enabled", itemLevel: Number(value) },
            })
          }
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
