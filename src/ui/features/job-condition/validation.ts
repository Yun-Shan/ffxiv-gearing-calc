import { speedAttributeLabel } from "@/ui/services/labels";
import { clanCount, type JobId } from "@/domain";
import type {
  GcdAnalysisState,
  JobConditionDraft,
  JobConditionRuntime,
  JobValidation,
  SearchRangeDraft,
  SectionValidation,
  ValidationIssue,
  ValidationStatus,
  WorkbenchValidation,
} from "./types";

function validationStatus(
  sections: readonly SectionValidation[],
): ValidationStatus {
  if (sections.some((section) => section.status === "invalid"))
    return "invalid";
  if (sections.some((section) => section.status === "pending"))
    return "pending";
  return "valid";
}

function section(
  issues: ValidationIssue[],
  pending = false,
): SectionValidation {
  return {
    status: issues.length > 0 ? "invalid" : pending ? "pending" : "valid",
    issues,
  };
}

function issue(
  code: string,
  message: string,
  ...path: (string | number)[]
): ValidationIssue {
  return { code, message, path };
}

function gcdValidation(
  gcd: JobConditionDraft["gcd"],
  analysis: GcdAnalysisState,
  expectedGcdKey?: string,
  speedLabel = "战斗速度",
): SectionValidation {
  const issues: ValidationIssue[] = [];
  if (gcd.mode === "tiers") {
    if (gcd.tiers.length === 0) {
      issues.push(
        issue(
          "gcd.tiers.required",
          "请至少选择一个可行 GCD 档位。",
          "gcd",
          "tiers",
        ),
      );
    }
    if (
      analysis.status === "ready" &&
      (!expectedGcdKey || analysis.key === expectedGcdKey)
    ) {
      for (const [index, tier] of gcd.tiers.entries()) {
        if (!analysis.feasibleTiers.includes(tier)) {
          issues.push(
            issue(
              "gcd.tier.unavailable",
              `GCD ${tier.toFixed(2)} 秒当前不可行。`,
              "gcd",
              "tiers",
              index,
            ),
          );
        }
      }
    }
  }
  if (gcd.mode === "speed") {
    if (gcd.min === undefined && gcd.max === undefined) {
      issues.push(
        issue("gcd.speed.required", `请至少填写一个${speedLabel}边界。`, "gcd"),
      );
    }
    if (gcd.min !== undefined && !Number.isFinite(gcd.min)) {
      issues.push(
        issue(
          "gcd.speed.min.finite",
          `最低${speedLabel}必须是有限数值。`,
          "gcd",
          "min",
        ),
      );
    }
    if (gcd.max !== undefined && !Number.isFinite(gcd.max)) {
      issues.push(
        issue(
          "gcd.speed.max.finite",
          `最高${speedLabel}必须是有限数值。`,
          "gcd",
          "max",
        ),
      );
    }
    if (gcd.min !== undefined && gcd.max !== undefined && gcd.min > gcd.max) {
      issues.push(
        issue(
          "gcd.speed.order",
          `最低${speedLabel}不能高于最高${speedLabel}。`,
          "gcd",
        ),
      );
    }
  }

  if (issues.length > 0) return section(issues);
  if (
    expectedGcdKey !== undefined &&
    (analysis.status === "idle" || analysis.key !== expectedGcdKey)
  )
    return section([], true);
  if (analysis.status === "error") {
    return section([
      issue(
        "gcd.analysis.error",
        `GCD 可行档位分析失败：${analysis.message}`,
        "gcd",
      ),
    ]);
  }
  if (analysis.status === "idle" || analysis.status === "loading")
    return section([], true);
  return section(issues);
}

export function validateSearchRangeDraft(
  range: SearchRangeDraft,
  pathPrefix: readonly (string | number)[] = ["range"],
): SectionValidation {
  const rangeIssues: ValidationIssue[] = [];
  if (!Number.isFinite(range.minItemLevel) || !Number.isFinite(range.maxItemLevel)) {
    rangeIssues.push(
      issue("range.finite", "装备品级范围必须是有限数值。", ...pathPrefix),
    );
  }
  if (range.minItemLevel > range.maxItemLevel) {
    rangeIssues.push(
      issue("range.order", "最低装备品级不能高于最高装备品级。", ...pathPrefix),
    );
  }
  if (
    range.sync.mode === "enabled" &&
    (!Number.isFinite(range.sync.itemLevel) || range.sync.itemLevel <= 0)
  ) {
    rangeIssues.push(
      issue(
        "range.sync.invalid",
        "同步品级必须是大于零的有限数值。",
        ...pathPrefix,
        "sync",
      ),
    );
  }
  if (
    !Number.isSafeInteger(range.clanIndex) ||
    range.clanIndex < 0 ||
    range.clanIndex >= clanCount
  ) {
    rangeIssues.push(
      issue(
        "range.clan.invalid",
        "种族选择无效。",
        ...pathPrefix,
        "clanIndex",
      ),
    );
  }
  return section(rangeIssues);
}

export function validateJobConditionDraft(
  draft: JobConditionDraft,
  runtime: JobConditionRuntime,
  options: {
    jobId?: JobId;
    expectedGcdKey?: string;
    /** 联合模式的搜索范围属于共享条件，由调用方单独校验。 */
    skipRange?: boolean;
  } = {},
): JobValidation {
  const rangeSection = options.skipRange
    ? section([])
    : validateSearchRangeDraft(draft.range);

  const gcd = gcdValidation(
    draft.gcd,
    runtime.gcdAnalysis,
    options.expectedGcdKey,
    options.jobId ? speedAttributeLabel(options.jobId) : undefined,
  );
  const tankIssues: ValidationIssue[] = [];
  if (
    Number(draft.tank.minimumTenacity !== undefined) +
      Number(draft.tank.minimumDamageReductionPercent !== undefined) +
      Number(draft.tank.maximizeTenacity) >
    1
  ) {
    tankIssues.push(
      issue(
        "tank.strategy.single",
        "历史条件包含多个坚韧约束，请选择单一策略。",
        "tank",
      ),
    );
  }
  if (
    draft.tank.strategy === "tenacity" &&
    draft.tank.minimumTenacity === undefined
  ) {
    tankIssues.push(
      issue(
        "tank.minimum.required",
        "请输入最低坚韧值。",
        "tank",
        "minimumTenacity",
      ),
    );
  }
  if (
    draft.tank.strategy === "reduction" &&
    draft.tank.minimumDamageReductionPercent === undefined
  ) {
    tankIssues.push(
      issue(
        "tank.reduction.required",
        "请输入最低减伤比例。",
        "tank",
        "minimumDamageReductionPercent",
      ),
    );
  }
  const minimum = draft.tank.minimumTenacity;
  const reduction = draft.tank.minimumDamageReductionPercent;
  if (minimum !== undefined && (!Number.isFinite(minimum) || minimum < 0)) {
    tankIssues.push(
      issue(
        "tank.minimum.invalid",
        "最低坚韧值必须是大于等于零的有限数值。",
        "tank",
        "minimumTenacity",
      ),
    );
  }
  if (
    reduction !== undefined &&
    (!Number.isFinite(reduction) || reduction < 0 || reduction > 100)
  ) {
    tankIssues.push(
      issue(
        "tank.reduction.invalid",
        "最低减伤比例必须在 0 到 100 之间。",
        "tank",
        "minimumDamageReductionPercent",
      ),
    );
  }

  const baseSections = {
    range: rangeSection,
    gcd,
    tank: section(tankIssues),
  } as const;
  const withJobId = (current: SectionValidation): SectionValidation => ({
    ...current,
    issues: current.issues.map((entry) =>
      options.jobId === undefined ? entry : { ...entry, jobId: options.jobId },
    ),
  });
  const sections = {
    range: withJobId(baseSections.range),
    gcd: withJobId(baseSections.gcd),
    tank: withJobId(baseSections.tank),
  };
  const issues = Object.values(sections).flatMap((value) => value.issues);
  const status = validationStatus(Object.values(sections));
  return { status, valid: status === "valid", issues, sections };
}

export function deriveWorkbenchValidation({
  jobs,
  sharedIssues = [],
  sharedPending = false,
}: {
  jobs: readonly {
    jobId: JobId;
    draft: JobConditionDraft;
    runtime: JobConditionRuntime;
    expectedGcdKey?: string;
    skipRange?: boolean;
  }[];
  sharedIssues?: readonly ValidationIssue[];
  sharedPending?: boolean;
}): WorkbenchValidation {
  const jobValidations: Partial<Record<JobId, JobValidation>> = {};
  const jobValues: JobValidation[] = [];
  for (const { jobId, draft, runtime, expectedGcdKey, skipRange } of jobs) {
    const validation = validateJobConditionDraft(draft, runtime, {
      jobId,
      expectedGcdKey,
      skipRange,
    });
    jobValidations[jobId] = validation;
    jobValues.push(validation);
  }
  const shared =
    sharedIssues.length > 0 || sharedPending
      ? {
          status:
            sharedIssues.length > 0
              ? ("invalid" as const)
              : ("pending" as const),
          issues: sharedIssues,
        }
      : undefined;
  const statuses = [
    ...jobValues.map((value) => value.status),
    ...(shared ? [shared.status] : []),
  ];
  const status = statuses.includes("invalid")
    ? "invalid"
    : statuses.includes("pending")
      ? "pending"
      : "valid";
  const issues = [
    ...(shared?.issues ?? []),
    ...jobValues.flatMap((value) => value.issues),
  ];
  return {
    status,
    valid: status === "valid",
    issues,
    shared,
    jobs: jobValidations,
  };
}
