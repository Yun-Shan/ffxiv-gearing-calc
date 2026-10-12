// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import * as testSupport from "../../../../../test-utils/workbench.helper.test";
import { jobSchemas } from "../../../../../domain/index";

describe("JointProfessionResult damage metrics", () => {
  it("联合结果继续使用 GCD 折算指标名称", async () => {
    const config = testSupport.testJointConfig(["RDM", "WHM"]);
    testSupport.seedCompletedJointHistory(config);
    testSupport.navigateToJoint();
    await testSupport.settleApp();
    testSupport.openSearchHistory();
    await testSupport.settleApp();
    const record = testSupport.historyCardContaining(`${jobSchemas.RDM.name} ${jobSchemas.RDM.maxJobLevel} 级、${jobSchemas.WHM.name}`);
    testSupport.click(testSupport.historyActionButton(record, "载入结果"));

    const title = testSupport.host.querySelector(`#joint-result-RDM`);
    const resultSection = title?.closest("section");
    expect(resultSection).not.toBeNull();
    expect(testSupport.normalizedText(resultSection!)).toContain("按 GCD 折算");
    expect(testSupport.normalizedText(resultSection!)).not.toContain("每秒每威力伤害期望");
  });
});
