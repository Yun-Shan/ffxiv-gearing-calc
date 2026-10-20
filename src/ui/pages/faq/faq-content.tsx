import { Button } from "@base-ui/react/button";
import type { ReactNode } from "react";

export interface FaqEntry {
  question: string;
  answer: ReactNode;
}

/** 常见问题内容；每条只保存问答，由同一 FaqItem 组件渲染。 */
export const faqEntries: readonly FaqEntry[] = [
  {
    question: "是否所有可能的装备都会参与搜索？",
    answer: (
      <>
        <p>目前以下装备不会参与搜索：</p>
        <ul>
          <li>穿戴等级不满 50 级且品级不满 90 的装备：低等级副本装、商店装、纯幻化装。</li>
          <li>部分品级 90 的 4.0 特职任务校服。</li>
          <li>所有军票兑换的装备。</li>
        </ul>
        <p>50–70 级肝武（上古武器、元灵武器、禁地兵装）的自定义属性不参与计算。</p>
        <p>其他未列出的所有装备和自定义属性肝武都参与搜索。</p>
      </>
    ),
  },
  {
    question: "种族是否对最佳配装有影响？",
    answer: (
      <p>
        绝大多数情况下没有影响，但在少数情况下，种族差异会带来细微的最佳配装差距。例如在以下特定条件中：召唤师、亚历山大绝境战
        475 同步配装、品级范围 470–795、GCD 固定为 2.5 秒，且无其他约束，人族·中原之民（
        <a href="https://asvel.github.io/ffxiv-gearing/?6wVlX4ZgXDZQ9IrIgjzVxaexhR8NlsU3BgR9x6wvZy5plpuQCt7hI" target="_blank">
          配装链接
        </a>
        ）与敖龙族·晨曦之民（
        <a href="https://asvel.github.io/ffxiv-gearing/?ibofDI2xqPEWrq5PomiET3OJjbilUTNbdJqK7pUxtRjcGwZG8Noa" target="_blank">
          配装链接
        </a>
        ）的最佳配装并不相同：人族·中原之民的 BIS 期望伤害比敖龙族·晨曦之民的 BIS 高约 0.17%。
      </p>
    ),
  },
  {
    question: "同时选择多个 GCD 搜索，得到的是这些 GCD 中最好的配装吗？",
    answer: (
      <p>
        严格来说，多选 GCD 得到的是“<mark>无关循环的纸面最优</mark>”：工具会把目标切换为每秒每威力期望伤害（Expected DPP/S），并在所选 GCD 内取该目标最大的配装。
        但这个目标没有针对具体副本时间轴和职业技能轴做修正，只是按 GCD 折算，
        所以纸面上的最优在实战中不一定最优。建议只在 GCD 相近、实际手感差异不大时才选择多个搜索；
        要比较差距较大的 GCD，请分别按单个 GCD 搜索，再根据目标副本对应 GCD 能打出的总威力折算伤害。
      </p>
    ),
  },
  {
    question: "只选择一个 GCD 时，得到的一定是这个 GCD 下的最佳配装吗？",
    answer: (
      <p>
        尽管已经为尽可能保证最优解做了很多的努力，但是由于目前并未在数学上进行形式化验证，因此不能从数学上绝对保证是最优解。
        目前搜索会先覆盖当前条件约束下的装备与镶嵌选择， 求解后再按同一套公式逐项复算属性、限制和期望伤害，并做完整的最优性复核，尽量确认没有更优的可行方案。
        如果您发现了伤害更高的配装，欢迎通过<Button type="button">反馈入口</Button>提交搜索条件、本项目结果和更高伤害配装的配装器分享链接。
      </p>
    ),
  },
];
