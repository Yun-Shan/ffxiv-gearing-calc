import { domainGearOptionsForConfig, equipmentGearCatalog } from "@/ui/features/equipment/catalog";
import { useMemo } from "react";
import {
  slotsForJob,
  getGearById,
} from "@/domain";
import { SingleEquipmentScope } from "@/ui/features/equipment/scope";
import { EquipmentEditor } from "@/ui/features/equipment/EquipmentEditor/EquipmentEditor";
import { useFeedback } from "@/ui/components/feedback/FeedbackProvider";
import { applySingleEquipmentAction } from "@/ui/features/equipment/transactions";
import type { SingleEquipmentDraft } from "@/ui/features/equipment/types";
import type { SingleDraft } from "../../state/useSingleController";
import { compileSingleDraft } from "../../state/useSingleController";
export function SingleEquipmentRestrictions({
  draft,
  onChange,
}: {
  draft: SingleDraft;
  onChange(draft: SingleDraft): void;
}) {
  const { notify } = useFeedback();
  const catalog = useMemo(() => {
    const config = compileSingleDraft(draft);
    const slots = slotsForJob(draft.jobId);
    return equipmentGearCatalog(
      domainGearOptionsForConfig(config, slots),
      slots,
      Object.fromEntries(slots.map((slot) => [slot, domainGearOptionsForConfig(config, [slot])])),
    );
  }, [draft]);
  return (
    <SingleEquipmentScope
      draft={draft.equipment as SingleEquipmentDraft}
      catalog={catalog}
      onAction={(action) => {
        const result = applySingleEquipmentAction(
          draft.equipment as SingleEquipmentDraft,
          action,
          getGearById,
        );
        if (result.accepted) onChange({ ...draft, equipment: result.state });
        else if (result.reason === "unique-ring") notify("不能同时强制装备两枚相同的唯一戒指。", "warning");
      }}
    >
      <EquipmentEditor materiaConfig={compileSingleDraft(draft)} />
    </SingleEquipmentScope>
  );
}
