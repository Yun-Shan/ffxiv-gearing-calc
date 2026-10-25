import { useMemo } from "react";
import {
  domainGearOptionsForConfig,
  equipmentGearCatalog,
  intersectGearOptionsById,
  JointSharedEquipmentScope,
  EquipmentEditor,
} from "@/ui/features/equipment";
import {
  slotsForJob,
  type GearSlot,
  type JobId,
  type OptimizationConfig,
} from "@/domain";
import type {
  EquipmentAction,
  JointEquipmentDraft,
} from "@/ui/features/equipment";
import { sharedSlotsForJobs } from "../shared-slots-section/SharedSlotsSection";
import styles from "./JointSharedEquipmentRestrictions.module.scss";

export function JointSharedEquipmentRestrictions({
  jobs,
  configs,
  equipment,
  onAction,
}: {
  jobs: readonly JobId[];
  configs: Readonly<Record<JobId, OptimizationConfig>>;
  equipment: JointEquipmentDraft;
  onAction(action: EquipmentAction): void;
}) {
  const catalog = useMemo(() => {
    const commonSlots = equipment.commonSlots;
    const availableSlots = sharedSlotsForJobs(jobs);
    const forceSlots = commonSlots.filter((slot) =>
      availableSlots.includes(slot),
    );
    const gearOptions = [
      ...new Map(
        jobs
          .flatMap((jobId) =>
            domainGearOptionsForConfig(configs[jobId]!, slotsForJob(jobId)),
          )
          .map((gear) => [gear.id, gear]),
      ).values(),
    ];
    const forceGearOptions = Object.fromEntries(
      forceSlots.map((slot) => {
        const optionsByJob = jobs.map((jobId) =>
          domainGearOptionsForConfig(configs[jobId]!, [slot]).filter(
            (gear) => !equipment.jobs[jobId]?.excludedGearIds.includes(gear.id),
          ),
        );
        return [slot, intersectGearOptionsById(optionsByJob)];
      }),
    ) as Partial<
      Record<GearSlot, ReturnType<typeof domainGearOptionsForConfig>>
    >;
    return equipmentGearCatalog(gearOptions, forceSlots, forceGearOptions);
  }, [configs, equipment.commonSlots, equipment.jobs, jobs]);

  return (
    <section className={styles.section} aria-label="共享装备限制">
      <JointSharedEquipmentScope
        draft={equipment.shared}
        catalog={catalog}
        onAction={onAction}
      >
        <EquipmentEditor title="共享装备限制" importJobs={jobs} materiaConfig={jobs[0] ? configs[jobs[0]] : undefined} />
      </JointSharedEquipmentScope>
    </section>
  );
}
