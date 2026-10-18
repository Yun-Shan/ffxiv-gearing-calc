import { describe, expect, it } from "vitest";
import { createJobConditionRuntime } from "../draft";
import {
  deriveWorkbenchValidation,
  validateJobConditionDraft,
  validateSearchRangeDraft,
} from "../validation";
import type { JobConditionDraft } from "../types";

const validDraft: JobConditionDraft = {
  range: {
    minItemLevel: 700,
    maxItemLevel: 795,
    sync: { mode: "disabled" },
    clanIndex: 0,
  },
  gcd: { mode: "any" },
  food: { mode: "auto" },
  tank: { maximizeTenacity: false },
};

describe("job condition validation snapshot", () => {
  it("validates a shared range once and skips the job-level range section", () => {
    const invalidRange = {
      minItemLevel: 800,
      maxItemLevel: 700,
      sync: { mode: "disabled" as const },
      clanIndex: 0,
    };
    const shared = validateSearchRangeDraft(invalidRange, ["shared", "range"]);
    expect(shared.status).toBe("invalid");
    expect(shared.issues[0]?.path).toEqual(["shared", "range"]);
    expect(shared.issues[0]?.code).toBe("range.order");

    const job = validateJobConditionDraft(
      { ...validDraft, range: invalidRange },
      createJobConditionRuntime(),
      { skipRange: true },
    );
    expect(job.sections.range).toEqual({ status: "valid", issues: [] });

    const invalidClan = validateSearchRangeDraft(
      { ...invalidRange, clanIndex: 99 },
      ["shared", "range"],
    );
    expect(invalidClan.status).toBe("invalid");
    expect(
      invalidClan.issues.some((issue) => issue.code === "range.clan.invalid"),
    ).toBe(true);
  });
  it("ignores errors from an old analysis key and reports errors only for the current input", () => {
    const runtime = {
      gcdAnalysis: { status: "error" as const, key: "old", message: "offline" },
    };
    const stale = validateJobConditionDraft(validDraft, runtime, {
      expectedGcdKey: "new",
    });
    expect(stale.sections.gcd).toEqual({ status: "pending", issues: [] });
    const current = validateJobConditionDraft(validDraft, runtime, {
      expectedGcdKey: "old",
    });
    expect(current.sections.gcd.status).toBe("invalid");
    expect(current.sections.gcd.issues[0]?.code).toBe("gcd.analysis.error");
  });
  it("treats GCD analysis idle and loading as pending for analysis-backed modes", () => {
    const idle = validateJobConditionDraft(
      { ...validDraft, gcd: { mode: "tiers", tiers: [2.5] } },
      createJobConditionRuntime(),
    );
    const loading = validateJobConditionDraft(
      { ...validDraft, gcd: { mode: "speed", min: 400 } },
      { gcdAnalysis: { status: "loading", key: "gcd" } },
    );
    expect(idle.status).toBe("pending");
    expect(idle.sections.gcd.status).toBe("pending");
    expect(loading.status).toBe("pending");
  });

  it("waits for feasible-GCD analysis in any mode because the compiler derives objective from it", () => {
    const idle = validateJobConditionDraft(
      validDraft,
      createJobConditionRuntime(),
    );
    const loading = validateJobConditionDraft(validDraft, {
      gcdAnalysis: { status: "loading", key: "current" },
    });
    const failed = validateJobConditionDraft(validDraft, {
      gcdAnalysis: { status: "error", key: "current", message: "offline" },
    });

    expect(idle.sections.gcd.status).toBe("pending");
    expect(loading.sections.gcd.status).toBe("pending");
    expect(
      failed.issues.some((entry) => entry.code === "gcd.analysis.error"),
    ).toBe(true);
  });

  it("rejects empty or inverted speed bounds and keeps no-feasible-tier as a valid search condition", () => {
    const empty = validateJobConditionDraft(
      { ...validDraft, gcd: { mode: "speed" } },
      createJobConditionRuntime(),
    );
    const inverted = validateJobConditionDraft(
      { ...validDraft, gcd: { mode: "speed", min: 500, max: 400 } },
      createJobConditionRuntime(),
    );
    const noTiers = validateJobConditionDraft(
      { ...validDraft, gcd: { mode: "speed", min: 400 } },
      { gcdAnalysis: { status: "ready", key: "latest", feasibleTiers: [] } },
    );

    expect(
      empty.issues.some((entry) => entry.code === "gcd.speed.required"),
    ).toBe(true);
    expect(
      inverted.issues.some((entry) => entry.code === "gcd.speed.order"),
    ).toBe(true);
    expect(noTiers.status).toBe("valid");
  });

  it("reuses the exact issue objects across section, job, and root branches", () => {
    const draft = {
      ...validDraft,
      range: { ...validDraft.range, minItemLevel: 800 },
    };
    const entry = {
      jobId: "RDM" as const,
      draft,
      runtime: createJobConditionRuntime(),
    };
    const snapshot = deriveWorkbenchValidation({ jobs: [entry] });
    const rangeIssue = snapshot.jobs.RDM!.sections.range.issues[0]!;

    expect(snapshot.status).toBe("invalid");
    expect(snapshot.jobs.RDM!.issues).toContain(rangeIssue);
    expect(snapshot.issues).toContain(rangeIssue);
    expect(
      snapshot.issues.find((issue) => issue.code === rangeIssue.code),
    ).toBe(rangeIssue);
  });

  it("gives invalid priority over pending and includes shared validation without copying its issues", () => {
    const sharedIssue = {
      code: "shared.force.conflict",
      path: ["shared", "forcedGear"],
      message: "冲突",
    } as const;
    const snapshot = deriveWorkbenchValidation({
      jobs: [
        {
          jobId: "RDM",
          draft: { ...validDraft, gcd: { mode: "tiers", tiers: [2.5] } },
          runtime: createJobConditionRuntime(),
        },
      ],
      sharedIssues: [sharedIssue],
    });
    expect(snapshot.status).toBe("invalid");
    expect(snapshot.shared?.status).toBe("invalid");
    expect(snapshot.issues[0]).toBe(sharedIssue);
  });
});
