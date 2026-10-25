import type {
  ForcedGearMap,
  EquipmentRestrictions,
  ForcedGearValue,
  Gear,
  GearSlot,
  JobId,
} from "@/domain";

export type EquipmentScope =
  | { kind: "single" }
  | { kind: "joint-shared" }
  | { kind: "joint-job"; jobId: JobId };

export type EquipmentType = Exclude<GearSlot, "ring2"> | "ring";
export type JointCommonSlot = GearSlot;

/** Editors materialize the optional request fields as empty collections. */
export type SingleEquipmentDraft = Required<EquipmentRestrictions>;
export type JointSharedEquipmentDraft = SingleEquipmentDraft;
export type JointJobEquipmentDraft = Pick<
  SingleEquipmentDraft,
  "excludedGearIds" | "forcedGear"
>;

export interface JointEquipmentDraft {
  commonSlots: JointCommonSlot[];
  shared: JointSharedEquipmentDraft;
  jobs: Partial<Record<JobId, JointJobEquipmentDraft>>;
}

export type EquipmentScopeDraft =
  SingleEquipmentDraft | JointSharedEquipmentDraft | JointJobEquipmentDraft;

export type EquipmentAction =
  | { type: "set-source-exclusions"; sources: string[] }
  | { type: "add-source-exclusion"; source: string }
  | { type: "remove-source-exclusion"; source: string }
  | { type: "add-gear-exclusion"; gearId: number }
  | { type: "remove-gear-exclusion"; gearId: number }
  | {
      type: "set-force";
      slot: GearSlot;
      gearId: number;
      forcedValue?: ForcedGearValue;
    }
  | { type: "import-forces"; forces: ForcedGearMap }
  | { type: "clear-force"; slot: GearSlot };

export interface EquipmentGearCatalog {
  /** Domain-generated gear choices for the current job/range. */
  gearOptions: readonly Gear[];
  /** Domain-generated candidates still legal under every effective scope restriction. */
  forceGearOptions?: Partial<Record<GearSlot, readonly Gear[]>>;
  sourceOptions?: readonly string[];
  allowedForcedGearSlots: readonly GearSlot[];
}

export interface EquipmentActionResult<T> {
  state: T;
  accepted: boolean;
  reason?:
    | "unique-ring"
    | "invalid-slot"
    | "shared-restriction"
    | "job-restriction"
    | "not-private"
    | "not-shared";
}

export type GearLookup = (gearId: number) => Gear | undefined;
