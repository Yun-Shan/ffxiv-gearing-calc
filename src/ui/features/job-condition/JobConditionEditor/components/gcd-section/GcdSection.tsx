import { speedAttributeLabel } from "@/ui/services/labels";
import { NumberInput } from "@/ui/components/form-controls/number-input/NumberInput";
import { useJobConditionScope } from "../../../scope";
import type { GcdDraft } from "../../../types";
import { LabeledSelect } from "@/ui/components/form-controls/labeled-select/LabeledSelect";
import { deriveJobObjective } from "../../../compiler";
import styles from "./GcdSection.module.scss";

export function GcdSection() {
  const { jobId, draft, updateDraft, runtime, validation, readOnly } =
    useJobConditionScope();
  const speedLabel = speedAttributeLabel(jobId);
  const gcd = draft.gcd;
  const analysis = runtime.gcdAnalysis;
  const awaitingSelection = gcd.mode === "tiers" && gcd.tiers.length === 0;
  const objective =
    analysis.status === "ready" && !awaitingSelection
      ? deriveJobObjective(gcd, analysis.feasibleTiers)
      : undefined;
  const issues = validation?.sections.gcd.issues ?? [];

  function setMode(mode: GcdDraft["mode"]) {
    updateDraft((current) => ({
      ...current,
      gcd:
        mode === "any"
          ? { mode }
          : mode === "tiers"
            ? { mode, tiers: [] }
            : { mode },
    }));
  }

  return (
    <section className={styles.section} aria-label="GCD">
      <h2 className={styles.title}>GCD</h2>
      <div className={styles.controls}>
        <LabeledSelect
          controlSize="strategy"
          layout="inline"
          label="GCD 条件"
          value={gcd.mode}
          disabled={readOnly}
          options={[
            { value: "any", label: "不限" },
            { value: "tiers", label: "选择可行档位" },
            { value: "speed", label: `${speedLabel}范围` },
          ]}
          onChange={(value) => setMode(value as GcdDraft["mode"])}
        />
        {gcd.mode === "tiers" && (
          <div className={styles.tierSelection}>
            <LabeledSelect
              controlSize="wide"
              multiple
              label="可行 GCD 档位"
              layout="inline"
              value={gcd.tiers.map(String)}
              disabled={readOnly || runtime.gcdAnalysis.status !== "ready"}
              placeholder={
                runtime.gcdAnalysis.status === "ready"
                  ? "选择可行档位"
                  : "正在计算…"
              }
              options={(runtime.gcdAnalysis.status === "ready"
                ? runtime.gcdAnalysis.feasibleTiers
                : []
              ).map((tier) => ({
                value: String(tier),
                label: `${tier.toFixed(2)} 秒`,
              }))}
              onChange={(values) =>
                updateDraft((current) => ({
                  ...current,
                  gcd: {
                    mode: "tiers",
                    tiers: values.map(Number).sort((a, b) => b - a),
                  },
                }))
              }
            />
            {runtime.gcdAnalysis.status === "ready" &&
              runtime.gcdAnalysis.feasibleTiers.length === 0 && (
                <p className={styles.note}>当前条件下没有可行 GCD 档位。</p>
              )}
            {runtime.gcdAnalysis.status === "error" && (
              <p className={styles.issue}>{runtime.gcdAnalysis.message}</p>
            )}
          </div>
        )}
        {gcd.mode === "speed" && (
          <div className={styles.bounds}>
            <NumberInput
              minDigits={8}
              label={`最低${speedLabel}`}
              min={0}
              value={gcd.min}
              disabled={readOnly}
              onChange={(value) =>
                updateDraft((current) =>
                  current.gcd.mode === "speed"
                    ? {
                        ...current,
                        gcd: {
                          ...current.gcd,
                          min: value === null ? undefined : (value ?? 0),
                        },
                      }
                    : current,
                )
              }
            />
            <NumberInput
              minDigits={8}
              label={`最高${speedLabel}`}
              min={0}
              value={gcd.max}
              disabled={readOnly}
              onChange={(value) =>
                updateDraft((current) =>
                  current.gcd.mode === "speed"
                    ? {
                        ...current,
                        gcd: {
                          ...current.gcd,
                          max: value === null ? undefined : (value ?? 0),
                        },
                      }
                    : current,
                )
              }
            />
          </div>
        )}
        <div className={styles.objectiveInfo}>
          <span className={styles.objective} aria-live="polite">
            目标模式：
            {objective === "damage"
              ? "每威力期望伤害"
              : objective === "dps"
                ? "每秒每威力期望伤害"
                : analysis.status === "error"
                  ? "暂无法识别"
                  : analysis.status === "ready" && awaitingSelection
                    ? "待选择"
                    : "识别中…"}
          </span>
          {objective === "dps" && (
            <p className={styles.objectiveNote}>
              仅供参考：副本时间轴与职业技能轴可能使实际 GCD 收益偏离估算。
            </p>
          )}
        </div>
      </div>
      {issues.map((entry, index) => (
        <p className={styles.issue} key={`${entry.code}-${index}`}>
          {entry.message}
        </p>
      ))}
    </section>
  );
}
