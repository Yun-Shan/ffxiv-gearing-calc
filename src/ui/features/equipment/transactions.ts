import type { GearSlot, JobId } from "@/domain";
import type {
  EquipmentAction,
  EquipmentActionResult,
  GearLookup,
  JointCommonSlot,
  JointEquipmentDraft,
  JointJobEquipmentDraft,
  SingleEquipmentDraft,
} from "./types";

export function equipmentTypeForSlot(slot: GearSlot): GearSlot | "ring" {
  return slot === "ring2" ? "ring" : slot;
}

export function isSlotShared(
  slot: GearSlot,
  commonSlots: readonly JointCommonSlot[],
): boolean {
  return (
    commonSlots.includes(slot) ||
    ((slot === "ring" || slot === "ring2") && commonSlots.includes("rings"))
  );
}

export function hasPrivatePositionForType(
  jobId: JobId,
  gearType: GearSlot | "ring",
  commonSlots: readonly JointCommonSlot[],
  jobSlots: Readonly<Partial<Record<JobId, readonly GearSlot[]>>>,
): boolean {
  return (jobSlots[jobId] ?? []).some(
    (slot) =>
      equipmentTypeForSlot(slot) === gearType &&
      !isSlotShared(slot, commonSlots),
  );
}

export function allowedForcedGearSlots(
  scope: { kind: "single" | "joint-shared" | "joint-job"; jobId?: JobId },
  allSlots: readonly GearSlot[],
  commonSlots: readonly JointCommonSlot[] = [],
): GearSlot[] {
  if (scope.kind === "single") return [...allSlots];
  return allSlots.filter(
    (slot) =>
      isSlotShared(slot, commonSlots) === (scope.kind === "joint-shared"),
  );
}

function setMembership(
  values: readonly number[],
  value: number,
  add: boolean,
): number[] {
  if (add) return values.includes(value) ? [...values] : [...values, value];
  return values.filter((item) => item !== value);
}

function copyForce(
  force: Partial<Record<GearSlot, number>>,
): Partial<Record<GearSlot, number>> {
  return { ...force };
}

function applyLocalAction<
  T extends SingleEquipmentDraft | JointJobEquipmentDraft,
>(draft: T, action: EquipmentAction, lookup: GearLookup): T {
  const next = { ...draft, forcedGear: copyForce(draft.forcedGear) };
  if (action.type === "add-source-exclusion" && "excludedSources" in next) {
    next.excludedSources = next.excludedSources.includes(action.source)
      ? [...next.excludedSources]
      : [...next.excludedSources, action.source];
    for (const [slot, id] of Object.entries(next.forcedGear)) {
      if (id !== undefined && lookup(id)?.source?.startsWith(action.source))
        delete next.forcedGear[slot as GearSlot];
    }
  } else if (
    action.type === "remove-source-exclusion" &&
    "excludedSources" in next
  ) {
    next.excludedSources = next.excludedSources.filter(
      (source) => source !== action.source,
    );
  } else if (action.type === "add-gear-exclusion") {
    next.excludedGearIds = setMembership(
      next.excludedGearIds,
      action.gearId,
      true,
    );
    for (const [slot, id] of Object.entries(next.forcedGear)) {
      if (id === action.gearId) delete next.forcedGear[slot as GearSlot];
    }
  } else if (action.type === "remove-gear-exclusion") {
    next.excludedGearIds = setMembership(
      next.excludedGearIds,
      action.gearId,
      false,
    );
  } else if (action.type === "set-force") {
    const source = lookup(action.gearId)?.source;
    if (source && "excludedSources" in next) {
      next.excludedSources = next.excludedSources.filter(
        (excluded) => !source.startsWith(excluded),
      );
    }
    next.excludedGearIds = setMembership(
      next.excludedGearIds,
      action.gearId,
      false,
    );
    next.forcedGear[action.slot] = action.gearId;
  } else if (action.type === "clear-force") {
    delete next.forcedGear[action.slot];
  }
  return next;
}

export function applySingleEquipmentAction(
  draft: SingleEquipmentDraft,
  action: EquipmentAction,
  lookup: GearLookup,
): EquipmentActionResult<SingleEquipmentDraft> {
  if (action.type === "set-source-exclusions") {
    let state = draft;
    for (const source of draft.excludedSources.filter(
      (source) => !action.sources.includes(source),
    ))
      state = applyLocalAction(
        state,
        { type: "remove-source-exclusion", source },
        lookup,
      );
    for (const source of [...new Set(action.sources)].filter(
      (source) => !draft.excludedSources.includes(source),
    ))
      state = applyLocalAction(
        state,
        { type: "add-source-exclusion", source },
        lookup,
      );
    return { state, accepted: true };
  }
  return { state: applyLocalAction(draft, action, lookup), accepted: true };
}

function getJobDraft(
  state: JointEquipmentDraft,
  jobId: JobId,
): JointJobEquipmentDraft {
  return state.jobs[jobId] ?? { excludedGearIds: [], forcedGear: {} };
}

function isExcludedByShared(
  state: JointEquipmentDraft,
  gearId: number,
  lookup: GearLookup,
): boolean {
  const gear = lookup(gearId);
  return (
    state.shared.excludedGearIds.includes(gearId) ||
    Boolean(
      gear?.source &&
      state.shared.excludedSources.some((source) =>
        gear.source!.startsWith(source),
      ),
    )
  );
}

function pruneJobForceByGearIds(
  state: JointEquipmentDraft,
  gearId: number,
): JointEquipmentDraft {
  const jobs = { ...state.jobs };
  for (const [jobId, existing] of Object.entries(jobs) as [
    JobId,
    JointJobEquipmentDraft,
  ][]) {
    const forcedGear = copyForce(existing.forcedGear);
    for (const [slot, id] of Object.entries(forcedGear)) {
      if (id === gearId) delete forcedGear[slot as GearSlot];
    }
    jobs[jobId] = { ...existing, forcedGear };
  }
  return { ...state, jobs };
}

export function applyJointEquipmentAction(
  state: JointEquipmentDraft,
  scope: { kind: "joint-shared" } | { kind: "joint-job"; jobId: JobId },
  action: EquipmentAction,
  options: {
    lookup: GearLookup;
    jobSlots: Readonly<Partial<Record<JobId, readonly GearSlot[]>>>;
    sharedSlots?: readonly GearSlot[];
  },
): EquipmentActionResult<JointEquipmentDraft> {
  if (action.type === "set-source-exclusions") {
    if (scope.kind === "joint-job")
      return { state, accepted: false, reason: "invalid-slot" };
    let next = state;
    for (const source of state.shared.excludedSources.filter(
      (source) => !action.sources.includes(source),
    ))
      next = applyJointEquipmentAction(
        next,
        scope,
        { type: "remove-source-exclusion", source },
        options,
      ).state;
    for (const source of [...new Set(action.sources)].filter(
      (source) => !state.shared.excludedSources.includes(source),
    ))
      next = applyJointEquipmentAction(
        next,
        scope,
        { type: "add-source-exclusion", source },
        options,
      ).state;
    return { state: next, accepted: true };
  }
  if (scope.kind === "joint-job") {
    const jobId = scope.jobId;
    const job = getJobDraft(state, jobId);
    const jobs = { ...state.jobs };
    if (
      action.type === "add-source-exclusion" ||
      action.type === "remove-source-exclusion"
    ) {
      return { state, accepted: false, reason: "invalid-slot" };
    }
    if (action.type === "add-gear-exclusion") {
      const gearType = options.lookup(action.gearId)?.slot;
      if (
        !gearType ||
        !hasPrivatePositionForType(
          jobId,
          equipmentTypeForSlot(gearType),
          state.commonSlots,
          options.jobSlots,
        )
      ) {
        return { state, accepted: false, reason: "not-private" };
      }
      const sharedForceConflict = Object.values(state.shared.forcedGear).some(
        (id) => id === action.gearId,
      );
      if (sharedForceConflict)
        return { state, accepted: false, reason: "shared-restriction" };
      jobs[jobId] = applyLocalAction(job, action, options.lookup);
      return { state: { ...state, jobs }, accepted: true };
    }
    if (action.type === "set-force") {
      if (
        !options.jobSlots[jobId]?.includes(action.slot) ||
        isSlotShared(action.slot, state.commonSlots)
      ) {
        return { state, accepted: false, reason: "not-private" };
      }
      if (isExcludedByShared(state, action.gearId, options.lookup)) {
        return { state, accepted: false, reason: "shared-restriction" };
      }
      jobs[jobId] = applyLocalAction(job, action, options.lookup);
      return { state: { ...state, jobs }, accepted: true };
    }
    jobs[jobId] = applyLocalAction(job, action, options.lookup);
    return { state: { ...state, jobs }, accepted: true };
  }

  if (action.type === "add-source-exclusion") {
    let next = state;
    const sources = state.shared.excludedSources.includes(action.source)
      ? [...state.shared.excludedSources]
      : [...state.shared.excludedSources, action.source];
    const sharedForce = copyForce(state.shared.forcedGear);
    for (const [slot, id] of Object.entries(sharedForce)) {
      if (
        id !== undefined &&
        options.lookup(id)?.source?.startsWith(action.source)
      )
        delete sharedForce[slot as GearSlot];
    }
    next = {
      ...state,
      shared: {
        ...state.shared,
        excludedSources: sources,
        forcedGear: sharedForce,
      },
    };
    for (const [jobId, job] of Object.entries(next.jobs) as [
      JobId,
      JointJobEquipmentDraft,
    ][]) {
      const forcedGear = copyForce(job.forcedGear);
      for (const [slot, id] of Object.entries(forcedGear)) {
        if (
          id !== undefined &&
          options.lookup(id)?.source?.startsWith(action.source)
        )
          delete forcedGear[slot as GearSlot];
      }
      next = {
        ...next,
        jobs: { ...next.jobs, [jobId]: { ...job, forcedGear } },
      };
    }
    return { state: next, accepted: true };
  }
  if (action.type === "remove-source-exclusion") {
    return {
      state: {
        ...state,
        shared: {
          ...state.shared,
          excludedSources: state.shared.excludedSources.filter(
            (source) => source !== action.source,
          ),
        },
      },
      accepted: true,
    };
  }
  if (action.type === "add-gear-exclusion") {
    const excludedGearIds = setMembership(
      state.shared.excludedGearIds,
      action.gearId,
      true,
    );
    const sharedForce = copyForce(state.shared.forcedGear);
    for (const [slot, id] of Object.entries(sharedForce))
      if (id === action.gearId) delete sharedForce[slot as GearSlot];
    const next = pruneJobForceByGearIds(
      {
        ...state,
        shared: { ...state.shared, excludedGearIds, forcedGear: sharedForce },
      },
      action.gearId,
    );
    return { state: next, accepted: true };
  }
  if (action.type === "remove-gear-exclusion") {
    return {
      state: {
        ...state,
        shared: {
          ...state.shared,
          excludedGearIds: setMembership(
            state.shared.excludedGearIds,
            action.gearId,
            false,
          ),
        },
      },
      accepted: true,
    };
  }
  if (action.type === "set-force") {
    if (!isSlotShared(action.slot, state.commonSlots)) {
      return { state, accepted: false, reason: "not-shared" };
    }
    if (
      Object.values(state.jobs).some((job) =>
        job.excludedGearIds.includes(action.gearId),
      )
    ) {
      return { state, accepted: false, reason: "job-restriction" };
    }
    const source = options.lookup(action.gearId)?.source;
    const shared = {
      ...state.shared,
      excludedSources: source
        ? state.shared.excludedSources.filter(
            (excluded) => !source.startsWith(excluded),
          )
        : state.shared.excludedSources,
      excludedGearIds: setMembership(
        state.shared.excludedGearIds,
        action.gearId,
        false,
      ),
      forcedGear: { ...state.shared.forcedGear, [action.slot]: action.gearId },
    };
    return { state: { ...state, shared }, accepted: true };
  }
  return {
    state: {
      ...state,
      shared: {
        ...state.shared,
        forcedGear: Object.fromEntries(
          Object.entries(state.shared.forcedGear).filter(
            ([slot]) => slot !== action.slot,
          ),
        ),
      },
    },
    accepted: true,
  };
}

export function updateJointSharedSlots(
  state: JointEquipmentDraft,
  nextSlots: readonly JointCommonSlot[],
  options: {
    jobSlots: Readonly<Partial<Record<JobId, readonly GearSlot[]>>>;
    lookup: GearLookup;
  },
): JointEquipmentDraft {
  const next: JointEquipmentDraft = { ...state, commonSlots: [...nextSlots] };
  const sharedForce = copyForce(state.shared.forcedGear);
  for (const slot of Object.keys(sharedForce) as GearSlot[]) {
    if (isSlotShared(slot, state.commonSlots) && !isSlotShared(slot, nextSlots))
      delete sharedForce[slot];
  }
  let jobs = { ...state.jobs };
  for (const [jobId, job] of Object.entries(jobs) as [
    JobId,
    JointJobEquipmentDraft,
  ][]) {
    const forcedGear = copyForce(job.forcedGear);
    for (const slot of Object.keys(forcedGear) as GearSlot[]) {
      if (
        !isSlotShared(slot, state.commonSlots) &&
        isSlotShared(slot, nextSlots)
      )
        delete forcedGear[slot];
    }
    const excludedGearIds = job.excludedGearIds.filter((id) => {
      const type = options.lookup(id)?.slot;
      return (
        type === undefined ||
        hasPrivatePositionForType(
          jobId,
          equipmentTypeForSlot(type),
          nextSlots,
          options.jobSlots,
        )
      );
    });
    jobs[jobId] = { ...job, forcedGear, excludedGearIds };
  }
  return {
    ...next,
    shared: { ...state.shared, forcedGear: sharedForce },
    jobs,
  };
}
