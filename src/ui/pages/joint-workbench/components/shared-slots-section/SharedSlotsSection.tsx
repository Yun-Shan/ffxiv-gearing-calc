import { CheckboxGroup } from "@base-ui/react/checkbox-group";
import { CheckboxInput } from "@/ui/components/form-controls/checkbox-input/CheckboxInput";
import { slotsForJob, type GearSlot, type JobId } from "@/domain";
import type {
  JointEquipmentDraft,
  JointCommonSlot,
} from "@/ui/features/equipment";
import { gearSlotLabels } from "@/ui/services/labels";
import styles from "./SharedSlotsSection.module.scss";

const slotOrder: readonly GearSlot[] = [
  "weapon",
  "offhand",
  "head",
  "body",
  "hands",
  "legs",
  "feet",
  "earrings",
  "necklace",
  "bracelet",
  "ring",
  "ring2",
];

export function sharedSlotsForJobs(jobs: readonly JobId[]): GearSlot[] {
  if (jobs.length === 0) return [];
  const intersection = new Set(slotsForJob(jobs[0]!));
  for (const jobId of jobs.slice(1)) {
    const available = new Set(slotsForJob(jobId));
    for (const slot of intersection)
      if (!available.has(slot)) intersection.delete(slot);
  }
  return slotOrder.filter((slot) => intersection.has(slot));
}

export function SharedSlotsSection({
  jobs,
  equipment,
  onChange,
}: {
  jobs: readonly JobId[];
  equipment: JointEquipmentDraft;
  onChange(next: JointEquipmentDraft): void;
}) {
  const available = sharedSlotsForJobs(jobs);
  return (
    <section className={styles.section} aria-label="共享部位">
      <h2>共享部位</h2>
      <CheckboxGroup
        className={styles.grid}
        aria-label="共享部位选择"
        value={available.filter(
          (slot) =>
            equipment.commonSlots.includes(slot) ||
            (equipment.commonSlots.includes("rings") &&
              (slot === "ring" || slot === "ring2")),
        )}
        onValueChange={(values) =>
          onChange({ ...equipment, commonSlots: values as JointCommonSlot[] })
        }
      >
        {available.map((slot) => (
          <CheckboxInput key={slot} label={gearSlotLabels[slot]} value={slot} />
        ))}
      </CheckboxGroup>
    </section>
  );
}
