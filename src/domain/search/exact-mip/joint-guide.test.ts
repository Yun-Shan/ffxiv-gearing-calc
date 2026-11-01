import { expect, test } from "vitest";
import type { LinearMipRow } from "../linear-mip.ts";
import { chooseJointGuide, type JointGuideFeedback } from "./joint-guide.ts";

const lower: LinearMipRow = { name: "joint_necessary_product", sense: ">=", rhs: 1, terms: new Map([["x", 2], ["y", 1]]) };
const equalExpression = { ...lower, terms: new Map([["y", 1], ["x", 2]]) };
const feedback: JointGuideFeedback = { guide: "ratio-bound", improved: false, saturated: true, restrictions: [lower] };

test("start with the available proof objective and leave an informative ratio bound in place", () => {
  expect(chooseJointGuide(true, [])).toBe("ratio-bound");
  expect(chooseJointGuide(false, [])).toBe("feasibility");
  expect(chooseJointGuide(true, [lower], { ...feedback, saturated: false })).toBe("ratio-bound");
});

test("a saturated envelope switches only if the previous signature is the only progress", () => {
  expect(chooseJointGuide(true, [equalExpression], feedback)).toBe("signature");
  for (const changed of [
    [], [{ ...lower, rhs: 2 }], [{ ...lower, sense: "<=" as const }],
    [{ ...lower, terms: new Map([["x", 1], ["y", 1]]) }], [{ ...lower, terms: new Map([["x", 2]]) }],
  ]) expect(chooseJointGuide(true, changed, feedback)).toBe("ratio-bound");
});

test("a physically better signature can hand the tightened residual to feasibility", () => {
  const log = { ...feedback, guide: "signature", improved: true } as const;
  expect(chooseJointGuide(true, [lower, { ...lower, name: "newLower" }], log)).toBe("signature");
  expect(chooseJointGuide(true, [lower, { ...lower, name: "joint_necessary_ratio_sum_0_1" }], log)).toBe("feasibility");
  expect(chooseJointGuide(true, [{ ...equalExpression, rhs: 2 }], log)).toBe("feasibility");
  expect(chooseJointGuide(true, [lower], log)).toBe("signature");
  expect(chooseJointGuide(true, [{ ...lower, rhs: 0 }], log)).toBe("signature");
});

test("unchanged constraints allow both visiting objectives to switch after a non-improvement", () => {
  const log = { ...feedback, guide: "signature" } as const;
  const feasibility = { ...feedback, guide: "feasibility" } as const;
  expect(chooseJointGuide(true, [lower], log)).toBe("feasibility");
  expect(chooseJointGuide(true, [], log)).toBe("signature");
  expect(chooseJointGuide(true, [lower], feasibility)).toBe("signature");
  expect(chooseJointGuide(true, [], feasibility)).toBe("feasibility");
  expect(chooseJointGuide(true, [lower], { ...feasibility, improved: true })).toBe("feasibility");
});
