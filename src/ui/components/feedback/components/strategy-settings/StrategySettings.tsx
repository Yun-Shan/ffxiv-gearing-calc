import { SEARCH_STRATEGY_IDS, type SearchStrategyId } from "@/domain/search/strategies";
import { LabeledSelect } from "@/ui/components/form-controls/labeled-select/LabeledSelect";
import { resetSearchStrategies, setSearchStrategy, useSearchStrategySettings } from "@/ui/services/search-strategy-settings";
import styles from "./StrategySettings.module.scss";

const strategyGroups = [
  { id: "common", title: "单职业与联合共用", description: "" },
  { id: "single", title: "单职业精确求解阶段专用", description: "也用于联合搜索中的独立基线和受限子搜索。" },
  { id: "joint", title: "联合搜索专用", description: "" },
] as const;

type StrategyGroupId = typeof strategyGroups[number]["id"];

const strategyCopy: Record<SearchStrategyId, { group: StrategyGroupId; title: string; description: string }> = {
  candidateDominance: { group: "common", title: "候选支配与等价剪枝", description: "跳过已有证明支配关系的装备、食物与候选。" },
  factorReachability: { group: "common", title: "可达因子压缩", description: "根据可达属性缩小因子档位范围。" },
  speedFoodProjection: { group: "common", title: "GCD 与食物投影", description: "用必要约束提前去除不匹配的组合。" },
  foodProductBound: { group: "single", title: "食物乘积上界", description: "排除上界无法改善当前结果的食物。" },
  candidateUpperBound: { group: "common", title: "候选上界剪枝", description: "按可行配装的精确上界收紧候选。" },
  resourceSupports: { group: "common", title: "资源支撑约束", description: "添加保守的属性资源加强约束。" },
  conditionalResourceSupports: { group: "common", title: "条件资源支撑", description: "按品级范围构造保守加强约束。" },
  resourceBudgetCandidateBounds: { group: "common", title: "预算候选上界", description: "按资源预算上界移除无法改善结果的候选。" },
  sharedStateSearch: { group: "joint", title: "共享状态搜索", description: "枚举完整共享状态并优化私有配装。" },
  utilityEquivalence: { group: "joint", title: "职业效用等价合并", description: "等价证书成立时复用联合搜索计算。" },
  materiaFamilyProjection: { group: "single", title: "魔晶石家族投影", description: "按完整家族约束压缩整数模型。" },
  equalityQuotient: { group: "common", title: "相等变量商模型", description: "通过等价证书压缩模型变量。" },
  jointRatioPairBounds: { group: "joint", title: "联合比例配对上界", description: "添加保守的职业比值配对上界。" },
  jointSharedBounds: { group: "joint", title: "联合共享上界", description: "加强共享装备与组合上界。" },
  jointFactorCuts: { group: "joint", title: "联合因子加强约束", description: "添加有效的职业因子加强约束。" },
  ringSymmetry: { group: "joint", title: "共享戒指对称性", description: "简化可证明对称的共享戒指表示。" },
  feasibleSeeds: { group: "common", title: "可行解种子与热启动", description: "将合法候选作为求解提示。" },
  restrictedResultReuse: { group: "joint", title: "受限结果复用", description: "复用当前联合搜索内已验证的受限结果。" },
};

const groupedStrategies = strategyGroups.map((group) => ({
  ...group,
  ids: SEARCH_STRATEGY_IDS.filter((id) => strategyCopy[id].group === group.id),
}));

const strategyOptions = [
  { value: "auto", label: "自动" },
  { value: "on", label: "开启" },
  { value: "off", label: "关闭" },
] as const;

export function StrategySettings() {
  const settings = useSearchStrategySettings();
  return (
    <div className={styles.root}>
      <p className={styles.description}>
        这些策略全局用于单职业和联合搜索，修改后对下一次搜索生效。「自动」沿用推荐条件；「开启」仍须满足数学适用条件。
      </p>
      <div className={styles.groups}>
        {groupedStrategies.map((group) => (
          <section className={styles.group} key={group.id} aria-label={group.title}>
            <h3 className={styles.groupTitle}>
              {group.title}
              <span>{group.ids.length} 项</span>
            </h3>
            {group.description && <p className={styles.groupDescription}>{group.description}</p>}
            <div className={styles.rows}>
              {group.ids.map((id) => {
                const item = strategyCopy[id];
                return (
                  <div className={styles.row} key={id}>
                    <div className={styles.copy}>
                      <strong>{item.title}</strong>
                      <span>{item.description}</span>
                    </div>
                    <LabeledSelect
                      label={`${item.title}策略`}
                      hideLabel
                      triggerClassName={styles.select}
                      value={settings[id]}
                      options={strategyOptions}
                      onChange={(mode) => {
                        if (mode === "auto" || mode === "on" || mode === "off") setSearchStrategy(id, mode);
                      }}
                    />
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
      <button className={styles.reset} type="button" onClick={resetSearchStrategies}>
        全部恢复自动
      </button>
    </div>
  );
}
