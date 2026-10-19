import type { GearSlot, JobId } from "@/domain";
import { gearGroups } from "@/ui/components/job-selection/JobSelection";

const armorSlots: GearSlot[] = ["head", "body", "hands", "legs", "feet"];
const accessorySlots: GearSlot[] = [
  "earrings",
  "necklace",
  "bracelet",
  "ring",
  "ring2",
];

export function shareableSlotsForJobs(jobs: readonly JobId[]): GearSlot[] {
  if (!jobs.length) return [];
  const group = gearGroups.find((group) => {
    const members =
      group.jobs ?? group.subGroups?.flatMap((sub) => sub.jobs ?? []) ?? [];
    return jobs.every((job) => members.includes(job));
  });
  if (!group) return [];
  const sameArmorGroup =
    !group.subGroups ||
    group.subGroups.some((sub) => jobs.every((job) => sub.jobs?.includes(job)));
  return [...(sameArmorGroup ? armorSlots : []), ...accessorySlots];
}
