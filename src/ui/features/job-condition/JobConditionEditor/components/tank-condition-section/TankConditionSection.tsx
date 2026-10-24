import { jobSchemas } from "@/domain";
import { useJobConditionScope } from "../../../scope";
import type { TankConditionDraft, TankStrategy } from "../../../types";
import { LabeledSelect } from "@/ui/components/form-controls/labeled-select/LabeledSelect";
import { NumberInput } from "@/ui/components/form-controls/number-input/NumberInput";
import styles from "./TankConditionSection.module.scss";
type Strategy = TankStrategy;
function strategyFor(tank: TankConditionDraft): Strategy | "" {
  const count =
    Number(tank.minimumTenacity !== undefined) +
    Number(tank.minimumDamageReductionPercent !== undefined) +
    Number(tank.maximizeTenacity);
  if (count > 1) return "";
  if (tank.minimumTenacity !== undefined) return "tenacity";
  if (tank.minimumDamageReductionPercent !== undefined) return "reduction";
  return tank.maximizeTenacity ? "maximize" : "any";
}
export function TankConditionSection() {
  const { jobId, draft, updateDraft, validation, readOnly } =
    useJobConditionScope();
  const strategy = draft.tank.strategy ?? strategyFor(draft.tank);
  if (jobSchemas[jobId].role !== "tank") return null;
  const tank = draft.tank;
  function update(patch: Partial<TankConditionDraft>) {
    updateDraft((current) => ({
      ...current,
      tank: {
        ...current.tank,
        strategy:
          current.tank.strategy ?? (strategyFor(current.tank) || undefined),
        ...patch,
      },
    }));
  }
  return (
    <section className={styles.section} aria-label="坚韧条件">
      <h2 className={styles.title}>坚韧条件</h2>
      <div className={styles.controls}>
        <LabeledSelect
          controlSize="strategy"
          label="坚韧策略"
          layout="inline"
          value={strategy || null}
          placeholder="请选择单一策略"
          disabled={readOnly}
          options={[
            { value: "any", label: "不限" },
            { value: "maximize", label: "最大化减伤百分比" },
            { value: "reduction", label: "最低减伤百分比" },
            { value: "tenacity", label: "最低坚韧数值" },
          ]}
          onChange={(value) => {
            const next = value as Strategy;
            updateDraft((current) => ({
              ...current,
              tank: {
                strategy: next,
                minimumTenacity:
                  next === "tenacity"
                    ? (current.tank.minimumTenacity ?? 0)
                    : undefined,
                minimumDamageReductionPercent:
                  next === "reduction"
                    ? (current.tank.minimumDamageReductionPercent ?? 0)
                    : undefined,
                maximizeTenacity: next === "maximize",
              },
            }));
          }}
        />
        {strategy === "tenacity" && (
          <NumberInput
            minDigits={8}
            label="最低坚韧值"
            min={0}
            value={tank.minimumTenacity}
            disabled={readOnly}
            onChange={(value) =>
              update({ minimumTenacity: value ?? undefined })
            }
          />
        )}
        {strategy === "reduction" && (
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
              update({ minimumDamageReductionPercent: value ?? undefined })
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
