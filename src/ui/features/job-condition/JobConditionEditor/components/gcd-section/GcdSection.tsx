import { speedAttributeLabel } from '@/ui/services/labels';
import { NumberInput } from '@/ui/components/form-controls/number-input/NumberInput';
import { useJobConditionScope } from '../../../scope';
import type { GcdAnalysisState, GcdDraft, ValidationIssue } from '../../../types';
import { LabeledSelect } from '@/ui/components/form-controls/labeled-select/LabeledSelect';
import { deriveJobObjective } from '../../../compiler';
import styles from './GcdSection.module.scss';
import { useEffect } from 'react';

type GcdUiMode = Exclude<GcdDraft['mode'], 'tiers'> | 'single' | 'multiple';

function Issue({objective, gcdAnalysisState, issues}: {
  objective: 'damage' | 'dps' | undefined,
  gcdAnalysisState: GcdAnalysisState,
  issues: readonly ValidationIssue[]
}) {
  // 有意在部分情况下不显示issue的内容，避免出现矛盾的提示
  const [className, msg] = (() => {
    let className: string | undefined;
    let msg: string | undefined;
    if (gcdAnalysisState.status === 'ready' && gcdAnalysisState.feasibleTiers.length === 0) {
      className = styles.objectiveTipError;
      msg = '当前条件下没有可行 GCD 档位。';
    } else if (gcdAnalysisState.status === 'error') {
      className = styles.objectiveTipError;
      msg = gcdAnalysisState.message;
    } else if (objective === 'dps') {
      className = styles.objectiveTipNote;
      msg = '多GCD搜索仅供参考：副本时间轴与职业技能轴可能使实际 GCD 收益与期望不符。';
    } else if (gcdAnalysisState.status !== 'loading' && issues.length > 0) {
      className = styles.objectiveTipError;
      msg = issues.map(it => it.message).join(',');
    }
    return [className, msg];
  })();
  return (<>
    {className && (
      <p className={className}>{msg}</p>
    )}
  </>);
}

export function GcdSection() {
  const { jobId, draft, updateDraft, runtime, validation, readOnly } = useJobConditionScope();
  const speedLabel = speedAttributeLabel(jobId);
  const gcd = draft.gcd;
  // 重建的条件按数量识别；编辑后显式保留模式，允许多选只剩一个档位。
  const multiple = gcd.mode === 'tiers' && (gcd.multiple ?? (gcd.tiers.length > 1));
  const mode = gcd.mode === 'tiers'
    ? multiple ? 'multiple' : 'single'
    : gcd.mode;
  const analysis = runtime.gcdAnalysis;
  const awaitingSelection = gcd.mode === 'tiers' && gcd.tiers.length === 0;
  const objective =
    analysis.status === 'ready' && !awaitingSelection
      ? deriveJobObjective(gcd, analysis.feasibleTiers)
      : undefined;
  const issues = validation?.sections.gcd.issues ?? [];

  useEffect(() => {
    if (readOnly || analysis.status !== 'ready' || gcd.mode !== 'tiers') return;
    if (gcd.tiers.every((tier) => analysis.feasibleTiers.includes(tier))) return;
    updateDraft((current) => {
      if (current.gcd.mode !== 'tiers') return current;
      return {
        ...current,
        gcd: {
          ...current.gcd,
          multiple: current.gcd.multiple ?? (current.gcd.tiers.length > 1),
          tiers: current.gcd.tiers.filter((tier) => analysis.feasibleTiers.includes(tier)),
        },
      };
    });
  }, [analysis, gcd, readOnly, updateDraft]);

  function setMode(mode: GcdUiMode) {
    updateDraft((current) => ({
      ...current,
      gcd:
        mode === 'single' || mode === 'multiple'
          ? {mode: 'tiers', tiers: [], multiple: mode === 'multiple'}
          : {mode},
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
          value={mode}
          disabled={readOnly}
          options={[
            {value: 'any', label: '不限'},
            {value: 'single', label: '选择单个档位'},
            {value: 'multiple', label: '选择多个档位'},
            {value: 'speed', label: `${speedLabel}范围`},
          ]}
          onChange={(value) => setMode(value as GcdUiMode)}
        />
        {gcd.mode === 'tiers' && (
          <div className={styles.tierSelection}>
            <LabeledSelect
              key={mode}
              controlSize="wide"
              multiple={multiple}
              label="可行 GCD 档位"
              layout="inline"
              value={multiple
                ? gcd.tiers.map(String)
                : gcd.tiers[0] === undefined ? null : String(gcd.tiers[0])}
              disabled={readOnly || runtime.gcdAnalysis.status !== 'ready'}
              placeholder={
                runtime.gcdAnalysis.status === 'ready'
                  ? multiple ? '选择多个档位' : '选择单个档位'
                  : '正在计算…'
              }
              options={(runtime.gcdAnalysis.status === 'ready'
                  ? runtime.gcdAnalysis.feasibleTiers
                  : gcd.tiers
              ).map((tier) => ({
                value: String(tier),
                label: `${tier.toFixed(2)} 秒`,
              }))}
              onChange={(values) =>
                updateDraft((current) => ({
                  ...current,
                  gcd: {
                    mode: 'tiers',
                    multiple,
                    tiers: (Array.isArray(values) ? values : [values])
                      .map(Number).sort((a, b) => b - a),
                  },
                }))
              }
            />
          </div>
        )}
        {gcd.mode === 'speed' && (
          <div className={styles.bounds} role="group" aria-label={`${speedLabel}范围`}>
            <span>{speedLabel}范围</span>
            <NumberInput
              key={`${jobId}-min`}
              minDigits={8}
              hideLabel
              debounceMs={1500}
              label={`最低${speedLabel}`}
              min={0}
              value={gcd.min}
              disabled={readOnly}
              onChange={(value) =>
                updateDraft((current) =>
                  current.gcd.mode === 'speed'
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
            <span aria-hidden="true">–</span>
            <NumberInput
              key={`${jobId}-max`}
              minDigits={8}
              hideLabel
              debounceMs={1500}
              label={`最高${speedLabel}`}
              min={0}
              value={gcd.max}
              disabled={readOnly}
              onChange={(value) =>
                updateDraft((current) =>
                  current.gcd.mode === 'speed'
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
            {objective === 'damage'
              ? '每威力期望伤害'
              : objective === 'dps'
                ? '每秒每威力期望伤害'
                : analysis.status === 'error'
                  ? '暂无法识别'
                  : analysis.status === 'ready' && awaitingSelection
                    ? '待选择'
                    : '识别中…'}
          </span>
          <Issue objective={objective} gcdAnalysisState={runtime.gcdAnalysis} issues={issues}/>
        </div>
      </div>
    </section>
  );
}
