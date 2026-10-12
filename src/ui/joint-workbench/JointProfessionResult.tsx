import type { ReactNode } from "react";
import { jobSchemas, type JobId, type OptimizationResult } from "../../domain";

export interface JointProfessionResultProps {
  jobId: JobId;
  result?: OptimizationResult;
  baseline?: OptimizationResult;
  equipment?: ReactNode;
  configSnapshot?: ReactNode;
  statName: (stat: string) => string;
  statValue: (stat: string, value: number) => string;
}

export function JointProfessionResult({
  jobId,
  result,
  baseline,
  equipment,
  configSnapshot,
  statName,
  statValue,
}: JointProfessionResultProps) {
  const retention = baseline && result && baseline.score > 0 && Number.isFinite(baseline.score)
    ? `${((result.score / baseline.score) * 100).toFixed(4)}%`
    : "—";

  return (
    <section className="joint-job-result" aria-labelledby={`joint-result-${jobId}`}>
      <div className="joint-job-heading">
        <div>
          <div className="section-kicker">职业完整结果</div>
          <h2 id={`joint-result-${jobId}`}>{jobSchemas[jobId].name}</h2>
        </div>
        <div className="baseline-summary">
          <strong>基线保留率 {retention}</strong>
        </div>
      </div>

      {result ? (
        <>
          <dl className="joint-result-metrics">
            <div><dt>单职业最优基线</dt><dd>{baseline ? baseline.score.toFixed(7) : "—"}</dd></div>
            <div><dt>联合目标值</dt><dd>{result.score.toFixed(7)}</dd></div>
            <div><dt>每威力伤害期望</dt><dd>{result.effects.damage.toFixed(7)}</dd></div>
            <div><dt>按 GCD 折算</dt><dd>{result.damagePerSecond.toFixed(7)}</dd></div>
          </dl>

          <div className="joint-result-equipment">{equipment}</div>

          <section className="joint-result-attributes" aria-label={`${jobSchemas[jobId].name}配装总属性和战斗效果`}>
            <div className="joint-result-detail-heading">
              <h3>配装总属性</h3>
              <span>已计入食物比例加成与装备魔晶石</span>
            </div>
            {result.maximumTenacity !== undefined && (
              <p className="joint-result-tenacity">最高坚韧 {result.maximumTenacity.toLocaleString("zh-CN")}</p>
            )}
            <div className="joint-result-stat-grid">
              {Object.entries(result.stats)
                .filter(([, value]) => value !== undefined && value > 0)
                .map(([stat, value]) => (
                  <div className="joint-result-stat" key={stat}>
                    <span>{statName(stat)}</span>
                    <strong>{statValue(stat, value!)}</strong>
                  </div>
                ))}
            </div>
            <dl className="joint-result-effects">
              <div><dt>坚韧伤害加成</dt><dd>{(result.effects.tenDamage * 100).toFixed(2)}%</dd></div>
              <div><dt>坚韧减伤</dt><dd>{(result.effects.tenMitigation * 100).toFixed(2)}%</dd></div>
              <div><dt>生命值</dt><dd>{result.effects.hp.toLocaleString("zh-CN")}</dd></div>
              <div><dt>每 3 秒魔力恢复</dt><dd>{result.effects.mp.toLocaleString("zh-CN")}</dd></div>
            </dl>
          </section>

          <details className="joint-result-extra-metrics">
            <summary>其他输出指标</summary>
            <dl>
              <div><dt>GCD</dt><dd>{result.effects.gcd.toFixed(2)} 秒</dd></div>
              <div><dt>暴击率</dt><dd>{(result.effects.crtChance * 100).toFixed(1)}%</dd></div>
              <div><dt>直击率</dt><dd>{(result.effects.dhtChance * 100).toFixed(1)}%</dd></div>
              <div><dt>已搜索候选</dt><dd>{result.searchedCandidates.toLocaleString("zh-CN")}</dd></div>
              <div><dt>耗时</dt><dd>{result.durationMs.toLocaleString("zh-CN")} 毫秒</dd></div>
            </dl>
          </details>

          {configSnapshot && (
            <details className="joint-job-config-details">
              <summary>本次职业条件快照</summary>
              {configSnapshot}
            </details>
          )}
        </>
      ) : (
        <p className="joint-result-missing">本次结果未返回该职业的配装明细。</p>
      )}
    </section>
  );
}
