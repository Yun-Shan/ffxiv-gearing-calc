import { type CommonGearSlot, type JointOptimizationResult } from "../../domain";

export const commonSlotLabels: Record<CommonGearSlot, string> = {
  weapon: "武器",
  offhand: "盾牌",
  head: "头部",
  body: "身体",
  hands: "手部",
  legs: "腿部",
  feet: "脚部",
  earrings: "耳饰",
  necklace: "项链",
  bracelet: "手镯",
  ring: "戒指 1",
  ring2: "戒指 2",
  rings: "两个戒指",
};

export function JointCommonGearSection({ result }: { result: JointOptimizationResult }) {
  const commonGear = result.commonGear ?? {};
  const slots = Object.entries(commonGear).filter(([, items]) => (items?.length ?? 0) > 0);
  if (slots.length === 0) return null;

  const itemCount = slots.reduce((count, [, items]) => count + (items?.length ?? 0), 0);

  return (
    <details className="common-gear-section">
      <summary className="result-toolbar common-gear-summary">
        <div>
          <h2>公共共享装备</h2>
          <span className="muted">所有参与职业使用相同装备和属性方案</span>
        </div>
        <span className="common-gear-summary-meta">
          {itemCount} 个部位{result.commonFood ? ` · 食物 ${result.commonFood.name}` : ""}
        </span>
      </summary>
      <div className="common-gear-content">
        <div className="common-gear-list">
          {slots.flatMap(([slot, items]) => {
            if (slot === "rings") {
              return (items ?? []).map((item, index) => (
                <div className="common-gear-row" key={`ring-${index}-${item.id}`}>
                  <span>{`戒指${index + 1}`}</span>
                  <div><strong>{item.name}</strong></div>
                </div>
              ));
            }
            const slotLabel = commonSlotLabels[slot as CommonGearSlot];
            return [(
              <div className="common-gear-row" key={slot}>
                <span>{slotLabel}</span>
                <div>{items?.map((item) => <strong key={item.id}>{item.name}</strong>)}</div>
              </div>
            )];
          })}
        </div>
        {result.commonFood && <p className="common-food-note">共用食物：{result.commonFood.name}</p>}
      </div>
    </details>
  );
}
