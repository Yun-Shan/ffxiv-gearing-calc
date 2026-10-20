import { useMemo } from "react";
import {
  domainGearOptionsForConfig,
  equipmentGearCatalog,
  JointJobEquipmentScope,
  EquipmentEditor,
} from "@/ui/features/equipment";
import type { GearSlot, JobId, OptimizationConfig } from "@/domain";
import type {
  EquipmentAction,
  JointEquipmentDraft,
} from "@/ui/features/equipment";
import { sharedSlotsForJobs } from "../shared-slots-section/SharedSlotsSection";
import styles from "./JointJobEquipmentRestrictions.module.scss";

export function JointJobEquipmentRestrictions({
  jobId,
  config,
  equipment,
  onAction,
}: {
  jobId: JobId;
  config: OptimizationConfig;
  equipment: JointEquipmentDraft;
  onAction(action: EquipmentAction): void;
}) {
  const catalog = useMemo(() => {
    const allSlots = sharedSlotsForJobs([jobId]);
    const privateSlots = allSlots.filter(
      (slot) =>
        !equipment.commonSlots.includes(slot) &&
        !(
          equipment.commonSlots.includes("rings") &&
          (slot === "ring" || slot === "ring2")
        ),
    );
    const allOptions = domainGearOptionsForConfig(config, privateSlots);
    const forceGearOptions = Object.fromEntries(
      privateSlots.map((slot) => {
        const candidates = domainGearOptionsForConfig(config, [slot]);
        return [
          slot,
          candidates.filter(
            (gear) =>
              !equipment.shared.excludedGearIds.includes(gear.id) &&
              !(
                gear.source &&
                equipment.shared.excludedSources.some((source) =>
                  gear.source!.startsWith(source),
                )
              ),
          ),
        ];
      }),
    ) as Partial<
      Record<GearSlot, ReturnType<typeof domainGearOptionsForConfig>>
    >;
    return equipmentGearCatalog(allOptions, privateSlots, forceGearOptions);
  }, [
    config,
    equipment.commonSlots,
    equipment.shared.excludedGearIds,
    equipment.shared.excludedSources,
    jobId,
  ]);
  const jobDraft = equipment.jobs[jobId] ?? {
    excludedGearIds: [],
    forcedGear: {},
  };
  return (
    <section className={styles.section} aria-label={jobId + " 职业装备限制"}>
      <JointJobEquipmentScope
        jobId={jobId}
        draft={jobDraft}
        catalog={catalog}
        onAction={onAction}
      >
        <EquipmentEditor title="职业专属装备限制" materiaConfig={config} />
      </JointJobEquipmentScope>
    </section>
  );
}
