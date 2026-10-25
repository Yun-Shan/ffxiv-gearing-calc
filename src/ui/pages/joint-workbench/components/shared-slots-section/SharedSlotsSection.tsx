import { shareableSlotsForJobs } from "../../shared-slot-options";
import type { ValidationIssue } from "@/ui/features/job-condition/types";
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
  issues = [],
  onChange,
}: {
  jobs: readonly JobId[];
  equipment: JointEquipmentDraft;
  issues?: readonly ValidationIssue[];
  onChange(next: JointEquipmentDraft): void;
}) {
  const available = sharedSlotsForJobs(jobs).filter(slot => slot !== "weapon" && slot !== "offhand");
  const shareable = new Set(shareableSlotsForJobs(jobs));
  return (
    <section className={styles.section} aria-label="共享部位">
      <h2>共享部位</h2>
      <CheckboxGroup
        className={styles.grid}
        aria-label="共享部位选择"
        value={available.filter(
          (slot) =>
            shareable.has(slot) &&
            equipment.commonSlots.includes(slot),
        )}
        onValueChange={(values) =>
          onChange({
            ...equipment,
            commonSlots: values.filter((slot) =>
              shareable.has(slot as GearSlot),
            ) as JointCommonSlot[],
          })
        }
      >
        {available.map((slot) => (
          <CheckboxInput
            key={slot}
            label={gearSlotLabels[slot]}
            value={slot}
            disabled={!shareable.has(slot)}
          />
        ))}
      </CheckboxGroup>
      {issues.map((issue, index) => (
        <p key={`${issue.code}-${index}`} className={styles.issue} role="alert">
          {issue.message}
        </p>
      ))}
    </section>
  );
}
