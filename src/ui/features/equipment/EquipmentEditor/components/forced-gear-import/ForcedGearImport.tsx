import { useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import type { EquipmentMateriaConfig, JobId } from "@/domain";
import { jobSchemas } from "@/domain";
import { gearSlotOrder } from "@/ui/services/labels";
import { TextInput } from "@/ui/components/form-controls/text-input/TextInput";
import { ForcedEquipmentRow } from "../forced-equipment-row/ForcedEquipmentRow";
import editorStyles from "../../EquipmentEditor.module.scss";
import { prepareForcedGearImport } from "../../../forced-gear-import";
import { useEquipmentScope } from "../../../scope";
import styles from "./ForcedGearImport.module.scss";

export function ForcedGearImport({
  config,
  allowedJobs,
}: {
  config: EquipmentMateriaConfig;
  allowedJobs: readonly JobId[];
}) {
  const { catalog, readOnly, dispatch } = useEquipmentScope();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [preview, setPreview] =
    useState<ReturnType<typeof prepareForcedGearImport>>();
  const [error, setError] = useState("");
  const prepare = () =>
    prepareForcedGearImport(input, {
      allowedJobs,
      allowedSlots: catalog.allowedForcedGearSlots,
      catalog,
      config,
    });
  function identify() {
    setPreview(undefined);
    setError("");
    try {
      setPreview(prepare());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "链接识别失败。");
    }
  }
  function confirm() {
    if (!preview?.entries.length || readOnly) return;
    try {
      // Revalidate against the latest scope before the atomic equipment transaction.
      const current = prepare();
      const accepted = dispatch({
        type: "import-forces",
        forces: current.forces,
      });
      if (accepted === false) {
        setError("导入装备与当前强制或排除条件冲突，请调整后重试。");
        return;
      }
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "导入失败。");
      setPreview(undefined);
    }
  }
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setInput("");
          setPreview(undefined);
          setError("");
        }
      }}
    >
      <Dialog.Trigger className={styles.button} disabled={readOnly}>
        导入
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop className={styles.backdrop} />
        <Dialog.Popup className={styles.dialog}>
          <Dialog.Title className={styles.title}>导入强制装备</Dialog.Title>
          <Dialog.Description className={styles.description}>
            粘贴配装器分享链接，识别后确认要设置的装备。
          </Dialog.Description>
          <form
            className={styles.inputRow}
            onSubmit={(event) => {
              event.preventDefault();
              identify();
            }}
          >
            <TextInput
              label="配装器链接"
              value={input}
              placeholder="https://asvel.github.io/ffxiv-gearing/?…"
              onValueChange={(value) => {
                setInput(value);
                setPreview(undefined);
                setError("");
              }}
              aria-invalid={error ? true : undefined}
            />
            <button
              type="submit"
              className={styles.button}
              disabled={!input.trim() || readOnly}
            >
              识别
            </button>
          </form>
          {error && (
            <p role="alert" className={styles.error}>
              {error}
            </p>
          )}
          {preview && (
            <>
              {(preview.unknownGearIds?.length > 0 ||
                preview.restrictedGear?.length > 0) && (
                <p className={styles.warning} role="status">
                  {[
                    preview.unknownGearIds?.length
                      ? `当前数据中找不到装备 ID：${preview.unknownGearIds.join("、")}`
                      : "",
                    ...(preview.restrictedGear ?? []).map(
                      (item) =>
                        `${item.name}（${item.id}）：${item.reason.replace(/[。；，]+$/u, "")}`,
                    ),
                  ]
                    .filter(Boolean)
                    .join("；")}
                  ，已忽略。
                </p>
              )}
              <p className={styles.description}>
                {jobSchemas[preview.jobId].name} · {preview.entries.length}{" "}
                件装备
              </p>
              <div className={styles.previewScroll}>
                <ul
                  className={`${editorStyles.list} ${editorStyles.forcedList} ${styles.preview}`}
                  aria-label="导入装备预览"
                  data-preview
                >
                  {preview.entries
                    .toSorted(
                      (left, right) =>
                        gearSlotOrder.indexOf(left.slot) -
                        gearSlotOrder.indexOf(right.slot),
                    )
                    .map(({ slot, gear, value }) => (
                      <ForcedEquipmentRow
                        key={slot}
                        slot={slot}
                        gear={gear}
                        value={value}
                        config={config}
                        readOnly
                        onChange={() => {}}
                      />
                    ))}
                </ul>
              </div>
            </>
          )}
          <div className={styles.actions}>
            <Dialog.Close className={styles.button}>取消</Dialog.Close>
            <button
              type="button"
              className={styles.button}
              disabled={!preview?.entries.length || readOnly}
              onClick={confirm}
            >
              确认导入
            </button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
