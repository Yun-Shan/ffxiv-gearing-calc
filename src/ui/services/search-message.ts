import { jobIds, jobSchemas } from "@/domain";
import { statNames } from "./labels";

export function searchMessageText(message: string): string {
  let text = message;
  const statuses = [
    ["Primal infeasible or unbounded", "无可行方案或有效边界"],
    ["Bound on objective reached", "达到目标边界"],
    ["Target for objective reached", "达到目标值"],
    ["Iteration limit reached", "达到迭代上限"],
    ["Time limit reached", "达到搜索时限"],
    ["Postsolve error", "结果还原失败"],
    ["Presolve error", "搜索预处理失败"],
    ["Model error", "搜索模型无效"],
    ["Solve error", "搜索失败"],
    ["Load error", "加载失败"],
    ["Not Set", "未初始化"],
    ["Infeasible", "无可行方案"],
    ["Unbounded", "无有效边界"],
    ["Optimal", "最优"],
    ["Unknown", "未知状态"],
    ["Empty", "没有候选"],
  ] as const;
  for (const [status, label] of statuses) text = text.replaceAll(status, label);
  for (const jobId of jobIds) {
    text = text.replace(new RegExp(`\\b${jobId}\\b`, "g"), jobSchemas[jobId].name);
  }
  for (const [stat, name] of Object.entries(statNames)) {
    text = text.replace(new RegExp(`\\b${stat}\\b`, "g"), name);
  }
  return text
    .replace(/V3/g, "联合搜索")
    .replace(/MIP|HiGHS/g, "求解器")
    .replace(/incumbent/g, "当前最优方案")
    .replace(/surrogate/g, "内部评分")
    .replace(/DPS|dps/g, "每秒每威力伤害期望")
    .replace(/damage/g, "每威力伤害期望")
    .replace(/RSS/g, "内存")
    .replace(/maxSearchMs/g, "搜索时限")
    .replace(/cacheLimit/g, "缓存数量")
    .replace(/NaN/g, "无效数值")
    .replace(/Infinity/g, "无穷值");
}

export function searchProgressText(message: string): string {
  if (message.includes("基线")) {
    const jobId = jobIds.find((id) => new RegExp(`\\b${id}\\b`).test(message));
    return `正在计算${jobId ? jobSchemas[jobId].name : "各职业"}的单独最优配装…`;
  }
  if (message.includes("候选准备完成")) return "候选准备完成，正在求解配装…";
  if (message.includes("还原并复核")) return "正在还原并复核结果…";
  if (message.includes("最高坚韧")) return "正在优化最高坚韧方案…";
  if (message.includes("GCD") || message.includes("档位")) return searchMessageText(message);
  if (message.includes("incumbent")) return "已找到候选配装，正在确认最优结果…";
  return "正在核验候选配装与约束…";
}
