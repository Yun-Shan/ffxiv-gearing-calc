import type { LinearMipRequest, LinearMipRow } from "../linear-mip.ts";

type Guide = NonNullable<LinearMipRequest["jointObjective"]>["kind"];

export type JointGuideFeedback = {
  guide: Guide;
  improved: boolean;
  saturated: boolean;
  restrictions: readonly LinearMipRow[];
};

function sameExpression(a: LinearMipRow, b: LinearMipRow): boolean {
  if (a.sense !== b.sense || a.terms.size !== b.terms.size) return false;
  for (const [name, coefficient] of a.terms) {
    if (b.terms.get(name) !== coefficient) return false;
  }
  return true;
}

/** 每次反馈都来自一个已按原模型和物理属性核验、随即被排除的完整签名。 */
export function chooseJointGuide(
  ratioAvailable: boolean,
  restrictions: readonly LinearMipRow[],
  previous?: JointGuideFeedback,
): Guide {
  if (!previous) return ratioAvailable ? "ratio-bound" : "feasibility";
  const { guide, improved, saturated } = previous;
  if (guide === "ratio-bound" && !saturated) return guide;

  const before = new Map(previous.restrictions.map(row => [row.name, row]));
  let onlySignatureChanged = before.size === restrictions.length;
  let lowerBoundTightened = false;
  for (const row of restrictions) {
    const old = before.get(row.name);
    const same = old !== undefined && sameExpression(row, old);
    if (!same || old.rhs !== row.rhs) onlySignatureChanged = false;
    if (row.sense === ">=" && (!old || (same && row.rhs > old.rhs)) &&
        /^joint_necessary_(?:product|job_\d+|ratio_sum_\d+(?:_\d+)*)$/.test(row.name)) {
      lowerBoundTightened = true;
    }
  }

  if (guide === "ratio-bound") return onlySignatureChanged ? "signature" : guide;
  if (guide === "signature") {
    return (improved ? lowerBoundTightened : onlySignatureChanged) ? "feasibility" : guide;
  }
  return !improved && onlySignatureChanged ? "signature" : "feasibility";
}
