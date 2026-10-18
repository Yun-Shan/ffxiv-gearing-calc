import { Popover } from "@base-ui/react/popover";
import { ChevronDown } from "lucide-react";
import { useId, useState } from "react";
import { FormField } from "@/ui/components/form-controls/form-field/FormField";
import { clanLabel, raceClans } from "@/ui/services/clans";
import styles from "./ClanSelect.module.scss";

export function ClanSelect({
  clanIndex,
  onChange,
  disabled = false,
}: {
  clanIndex: number;
  onChange(clanIndex: number): void;
  disabled?: boolean;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <FormField id={id} label="种族" layout="inline">
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger
          id={id}
          className={styles.trigger}
          disabled={disabled}
        >
          <span>{clanLabel(clanIndex)}</span>
          <ChevronDown size={14} aria-hidden="true" />
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner
            className={styles.positioner}
            side="bottom"
            sideOffset={4}
            align="start"
            collisionAvoidance={{
              side: "flip",
              align: "shift",
              fallbackAxisSide: "none",
            }}
          >
            <Popover.Popup className={styles.popup} aria-label="选择种族">
              <div className={styles.table} role="group" aria-label="种族与族群">
                {raceClans.map((race, raceIndex) => (
                  <div className={styles.row} key={race.name}>
                    <span className={styles.race}>{race.name}</span>
                    {race.clans.map((clan, offset) => {
                      const index = raceIndex * 2 + offset;
                      return (
                        <button
                          key={clan}
                          type="button"
                          className={styles.clan}
                          aria-pressed={index === clanIndex}
                          onClick={() => {
                            onChange(index);
                            setOpen(false);
                          }}
                        >
                          {clan}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </FormField>
  );
}
