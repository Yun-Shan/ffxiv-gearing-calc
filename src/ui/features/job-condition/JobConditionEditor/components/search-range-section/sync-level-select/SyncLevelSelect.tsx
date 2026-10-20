import { useRef, useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { gameData } from "@/domain";
import { LabeledSelect } from "@/ui/components/form-controls/labeled-select/LabeledSelect";
import { selectableSyncLevels } from "@/ui/services/app-config";
import styles from "./SyncLevelSelect.module.scss";

const duties: Readonly<
  Record<string, readonly { id: number; name: string }[]>
> = gameData.syncLevelDuties;

export function SyncLevelSelect({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled: boolean;
  onChange(value: string): void;
}) {
  const [hovered, setHovered] = useState<string>();
  const popupRef = useRef<HTMLDivElement>(null);
  return (
    <>
      <LabeledSelect
        controlSize="regular"
        layout="inline"
        label="同步品级"
        value={value}
        disabled={disabled}
        onChange={(next) => {
          setHovered(undefined);
          onChange(next);
        }}
        options={[
          { value: "disabled", label: "未启用" },
          ...selectableSyncLevels.map((level) => ({
            value: String(level),
            label: String(level),
          })),
        ]}
        popupRef={popupRef}
        onOptionHighlighted={(option) =>
          setHovered(
            option && option.value !== "disabled" ? option.value : undefined,
          )
        }
      />
      <Popover.Root open={hovered !== undefined}>
        <Popover.Portal>
          <Popover.Positioner
            anchor={popupRef.current}
            className={styles.positioner}
            side="left"
            align="center"
            sideOffset={8}
            collisionAvoidance={{
              side: "flip",
              align: "shift",
              fallbackAxisSide: "none",
            }}
          >
            <Popover.Popup
              className={styles.popup}
              aria-label="同步品级对应条目"
              initialFocus={false}
              finalFocus={false}
            >
              <strong className={styles.title}>同步品级 {hovered}</strong>
              <ul className={styles.list}>
                {(duties[hovered ?? ""] ?? []).map((duty) => (
                  <li key={duty.id}>{duty.name || "（Name 为空）"}</li>
                ))}
              </ul>
              {hovered && !duties[hovered]?.length && (
                <p className={styles.empty}>没有匹配的条目。</p>
              )}
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </>
  );
}
