import { NumberInput } from "@/ui/components/form-controls/number-input/NumberInput";
import { bounds, selectableSyncLevels } from "@/ui/services/app-config";
import { useJobConditionScope } from "../../../scope";
import { LabeledSelect } from "@/ui/components/form-controls/labeled-select/LabeledSelect";
import styles from "./SearchRangeSection.module.scss";

export function SearchRangeSection() {
  const { draft, updateDraft, readOnly, validation } = useJobConditionScope();
  const issues = validation?.sections.range.issues ?? [];
  const range = draft.range;

  return (
    <section className={styles.section} aria-label="搜索范围">
      <div className={styles.heading}>
        <h2 className={styles.title}>搜索范围</h2>
        <span className={styles.note} title="未同步时按职业上限计算；同步时取映射等级与职业上限的较小值">
          等级规则：职业上限 / 同步
        </span>
      </div>
      <div className={styles.grid}>
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
              updateDraft((current) => ({
                ...current,
                range: {
                  ...current.range,
                  minItemLevel: value ?? 0,
                },
              }))
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
              updateDraft((current) => ({
                ...current,
                range: {
                  ...current.range,
                  maxItemLevel: value ?? 0,
                },
              }))
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
            updateDraft((current) => ({
              ...current,
              range: {
                ...current.range,
                sync:
                  value === "disabled"
                    ? { mode: "disabled" }
                    : { mode: "enabled", itemLevel: Number(value) },
              },
            }))
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
