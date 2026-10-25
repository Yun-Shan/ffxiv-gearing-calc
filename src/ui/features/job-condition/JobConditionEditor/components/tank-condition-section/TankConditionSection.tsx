import { jobSchemas } from "@/domain";
import { useJobConditionScope } from "../../../scope";
import type { TankConditionDraft, TankStrategy } from "../../../types";
import { LabeledSelect } from "@/ui/components/form-controls/labeled-select/LabeledSelect";
import { NumberInput } from "@/ui/components/form-controls/number-input/NumberInput";
import styles from "./TankConditionSection.module.scss";
function selectStrategy(
  strategy: TankStrategy,
  current: TankConditionDraft,
): TankConditionDraft {
  switch (strategy) {
    case "tenacity":
      return {
        strategy,
        minimumTenacity:
          current.strategy === strategy ? current.minimumTenacity : 0,
      };
    case "reduction":
      return {
        strategy,
        minimumDamageReductionPercent:
          current.strategy === strategy
            ? current.minimumDamageReductionPercent
            : 0,
      };
    default:
      return { strategy };
  }
}
export function TankConditionSection() {
  const { jobId, draft, updateDraft, validation, readOnly } =
    useJobConditionScope();
  if (jobSchemas[jobId].role !== "tank") return null;
  const tank = draft.tank;
  function update(tank: TankConditionDraft) {
    updateDraft((current) => ({ ...current, tank }));
  }
  return (
    <section className={styles.section} aria-label="坚韧条件">
      <h2 className={styles.title}>坚韧条件</h2>
      <div className={styles.controls}>
        <LabeledSelect
          controlSize="strategy"
          label="坚韧策略"
          layout="inline"
          value={tank.strategy}
          disabled={readOnly}
          options={[
            { value: "any", label: "不限" },
            { value: "maximize", label: "最大化减伤百分比" },
            { value: "reduction", label: "最低减伤百分比" },
            { value: "tenacity", label: "最低坚韧数值" },
          ]}
          onChange={(value) => {
            updateDraft((current) => ({
              ...current,
              tank: selectStrategy(value as TankStrategy, current.tank),
            }));
          }}
        />
        {tank.strategy === "tenacity" && (
          <NumberInput
            minDigits={8}
            label="最低坚韧值"
            min={0}
            value={tank.minimumTenacity}
            disabled={readOnly}
            onChange={(value) =>
              update({
                strategy: "tenacity",
                minimumTenacity: value ?? undefined,
              })
            }
          />
        )}
        {tank.strategy === "reduction" && (
          <NumberInput
            minDigits={8}
            label="最低减伤比例"
            min={0}
            max={100}
            step={0.1}
            suffix="%"
            value={tank.minimumDamageReductionPercent}
            disabled={readOnly}
            onChange={(value) =>
              update({
                strategy: "reduction",
                minimumDamageReductionPercent: value ?? undefined,
              })
            }
          />
        )}
      </div>
      {(validation?.sections.tank.issues ?? []).map((entry, index) => (
        <p className={styles.issue} key={`${entry.code}-${index}`}>
          {entry.message}
        </p>
      ))}
    </section>
  );
}
