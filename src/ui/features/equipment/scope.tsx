import { createContext, useContext, type ReactNode } from "react";
import type { ForcedGearValue, Gear, GearSlot, JobId } from "@/domain";
import type {
  EquipmentAction,
  EquipmentGearCatalog,
  EquipmentScope,
  EquipmentScopeDraft,
  JointJobEquipmentDraft,
  JointSharedEquipmentDraft,
  SingleEquipmentDraft,
} from "./types";

export interface EquipmentScopeValue {
  scope: EquipmentScope;
  draft: EquipmentScopeDraft;
  catalog: EquipmentGearCatalog;
  readOnly: boolean;
  dispatch(action: EquipmentAction): boolean | void;
}

const EquipmentScopeContext = createContext<EquipmentScopeValue | undefined>(
  undefined,
);

export function EquipmentScopeProvider({
  scope,
  draft,
  catalog,
  onAction,
  readOnly = false,
  children,
}: {
  scope: EquipmentScope;
  draft: EquipmentScopeDraft;
  catalog: EquipmentGearCatalog;
  onAction: (action: EquipmentAction) => boolean | void;
  readOnly?: boolean;
  children: ReactNode;
}) {
  return (
    <EquipmentScopeContext.Provider
      value={{ scope, draft, catalog, readOnly, dispatch: onAction }}
    >
      {children}
    </EquipmentScopeContext.Provider>
  );
}

export function SingleEquipmentScope(props: {
  draft: SingleEquipmentDraft;
  catalog: EquipmentGearCatalog;
  onAction: (action: EquipmentAction) => void;
  readOnly?: boolean;
  children: ReactNode;
}) {
  return <EquipmentScopeProvider scope={{ kind: "single" }} {...props} />;
}

export function JointSharedEquipmentScope(props: {
  draft: JointSharedEquipmentDraft;
  catalog: EquipmentGearCatalog;
  onAction: (action: EquipmentAction) => void;
  readOnly?: boolean;
  children: ReactNode;
}) {
  return <EquipmentScopeProvider scope={{ kind: "joint-shared" }} {...props} />;
}

export function JointJobEquipmentScope(props: {
  jobId: JobId;
  draft: JointJobEquipmentDraft;
  catalog: EquipmentGearCatalog;
  onAction: (action: EquipmentAction) => void;
  readOnly?: boolean;
  children: ReactNode;
}) {
  const { jobId, ...scopeProps } = props;
  return (
    <EquipmentScopeProvider
      scope={{ kind: "joint-job", jobId }}
      {...scopeProps}
    />
  );
}

export function useEquipmentScope(): EquipmentScopeValue {
  const scope = useContext(EquipmentScopeContext);
  if (!scope)
    throw new Error(
      "Equipment editors must be rendered inside an EquipmentScope.",
    );
  return scope;
}

export function useExcludedSources() {
  const value = useEquipmentScope();
  if (value.scope.kind === "joint-job") {
    throw new Error(
      "Joint job equipment scope does not support source exclusions.",
    );
  }
  const draft = value.draft as SingleEquipmentDraft | JointSharedEquipmentDraft;
  return {
    excludedSources: draft.excludedSources,
    sourceOptions: value.catalog.sourceOptions ?? [],
    setSources: (sources: string[]) =>
      value.dispatch({ type: "set-source-exclusions", sources }),
    remove: (source: string) =>
      value.dispatch({ type: "remove-source-exclusion", source }),
  };
}

export function useExcludedGear() {
  const value = useEquipmentScope();
  return {
    excludedGearIds: value.draft.excludedGearIds,
    gearOptions: value.catalog.gearOptions,
    add: (gearId: number) =>
      value.dispatch({ type: "add-gear-exclusion", gearId }),
    remove: (gearId: number) =>
      value.dispatch({ type: "remove-gear-exclusion", gearId }),
  };
}

export function useForcedGear() {
  const value = useEquipmentScope();
  return {
    forcedGear: value.draft.forcedGear,
    set: (slot: GearSlot, gearId: number, forcedValue?: ForcedGearValue) =>
      value.dispatch({ type: "set-force", slot, gearId, forcedValue }),
    clear: (slot: GearSlot) => value.dispatch({ type: "clear-force", slot }),
    gearOptionsForSlot: (slot: GearSlot): readonly Gear[] => {
      const supplied = value.catalog.forceGearOptions?.[slot];
      return (
        supplied ??
        value.catalog.gearOptions.filter(
          (gear) => gear.slot === (slot === "ring2" ? "ring" : slot),
        )
      );
    },
  };
}

export function useAllowedForcedGearSlots(): readonly GearSlot[] {
  return useEquipmentScope().catalog.allowedForcedGearSlots;
}
