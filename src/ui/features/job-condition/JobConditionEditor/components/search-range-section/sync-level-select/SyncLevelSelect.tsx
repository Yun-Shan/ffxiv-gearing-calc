import { ChevronDown, TriangleAlert } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { ScrollArea } from "@base-ui/react/scroll-area";
import {
  gameData,
  syncTargetCalculationError,
  type SyncTarget,
} from "@/domain";
import { FormField } from "@/ui/components/form-controls/form-field/FormField";
import { syncTargetKey, syncTargetLabel } from "@/ui/services/sync-selection";
import {
  categoryFor,
  dutyOptionCategories,
  levelOptionCategories,
  type SyncSelectionMode,
  syncOptionLabel,
} from "./sync-level-options";
import styles from "./SyncLevelSelect.module.scss";

function SyncTargetChoice({
  target,
  selected,
  onChoose,
  onHover,
}: {
  target: SyncTarget;
  selected?: SyncTarget;
  onChoose(target: SyncTarget): void;
  onHover(target: SyncTarget): void;
}) {
  const isSelected = syncTargetKey(selected) === syncTargetKey(target);
  return (
    <button
      type="button"
      className={styles.choice}
      aria-pressed={isSelected}
      onMouseEnter={() => onHover(target)}
      onFocus={() => onHover(target)}
      onClick={() => onChoose(target)}
    >
      <span>{syncOptionLabel(target)}</span>
      {isSelected && <span className={styles.selectedMark}>当前</span>}
    </button>
  );
}

export function SyncLevelSelect({
  value,
  duty,
  disabled,
  onChange,
}: {
  value?: SyncTarget;
  duty?: string;
  disabled: boolean;
  onChange(value?: SyncTarget, duty?: string): void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<SyncSelectionMode>(duty ? "duty" : "level");
  const [levelCategory, setLevelCategory] = useState(() =>
    String(gameData.sync.levels.at(-1)?.jobLevel ?? ""),
  );
  const [dutyCategory, setDutyCategory] = useState(() =>
    dutyOptionCategories.find(({ options }) => options.some((option) =>
      option.name === duty && syncTargetKey(option.target) === syncTargetKey(value),
    ))?.id ?? "0",
  );
  const [customInput, setCustomInput] = useState("");
  const [customError, setCustomError] = useState("");
  const [hovered, setHovered] = useState<SyncTarget>();
  const popupRef = useRef<HTMLDivElement>(null);
  const categories =
    mode === "level" ? levelOptionCategories : dutyOptionCategories;
  const selectedCategoryId =
    mode === "level"
      ? (categoryFor(levelOptionCategories, levelCategory)?.id ?? "")
      : (categoryFor(dutyOptionCategories, dutyCategory)?.id ?? "");
  const selectedLabel = syncTargetLabel(value, duty);
  const optionsByTarget = gameData.sync.groups.flatMap(
    ({ options }) => options,
  );

  useEffect(() => {
    if (!open)
      setCustomInput(value?.kind === "itemLevel" ? String(value.value) : "");
  }, [open, value]);

  const levelOptions =
    categoryFor(levelOptionCategories, levelCategory)?.options ?? [];
  const dutyCategoryValue = categoryFor(dutyOptionCategories, dutyCategory);
  const dutyOptions = dutyCategoryValue?.options ?? [];
  const showExplorationWarning =
    mode === "duty" &&
    dutyCategoryValue?.label === "特殊场景探索";

  const chooseLevel = (next?: SyncTarget, nextDuty?: string) => {
    setHovered(undefined);
    setCustomError("");
    setCustomInput(next?.kind === "itemLevel" ? String(next.value) : "");
    if (syncTargetKey(next) !== syncTargetKey(value) || nextDuty !== duty)
      onChange(next, nextDuty);
    setOpen(false);
  };

  const applyCustomInput = () => {
    const normalized = customInput.trim();
    if (!/^\d+$/.test(normalized)) {
      setCustomError("请输入不低于 90 的安全整数。");
      return;
    }
    const itemLevel = Number(normalized);
    if (!Number.isSafeInteger(itemLevel) || itemLevel < 90) {
      setCustomError("同步品级必须是不低于 90 的安全整数。");
      return;
    }
    const target: SyncTarget = { kind: "itemLevel", value: itemLevel };
    const error = syncTargetCalculationError(target);
    if (error) {
      setCustomError(error);
      return;
    }
    chooseLevel(target);
  };

  const activateMode = (next: SyncSelectionMode) => {
    setMode(next);
    setHovered(undefined);
  };

  const selectCategory = (next: string) => {
    if (mode === "level") setLevelCategory(next);
    else setDutyCategory(next);
    setHovered(undefined);
  };

  const renderCategoryButtons = (
    items: readonly { id: string; label: string }[],
  ) => (
    <nav className={styles.categories} aria-label="同步品级分类">
      {items.map((category) => (
        <button
          type="button"
          key={category.id}
          className={styles.category}
          aria-current={category.id === selectedCategoryId ? "true" : undefined}
          onClick={() => selectCategory(category.id)}
        >
          {category.label}
        </button>
      ))}
    </nav>
  );

  return (
    <>
      <FormField id={id} label="同步方式" layout="inline">
        <Popover.Root
          open={open}
          onOpenChange={(nextOpen) => {
            setOpen(nextOpen);
            setHovered(undefined);
            setCustomError("");
            setCustomInput(
              value?.kind === "itemLevel" ? String(value.value) : "",
            );
          }}
        >
          <Popover.Trigger
            id={id}
            className={styles.trigger}
            disabled={disabled}
          >
            <span className={styles.triggerValue}>{selectedLabel}</span>
            <ChevronDown size={14} aria-hidden="true" />
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Positioner
              className={styles.panelPositioner}
              side="bottom"
              sideOffset={4}
              align="start"
              collisionAvoidance={{
                side: "flip",
                align: "shift",
                fallbackAxisSide: "none",
              }}
            >
              <Popover.Popup className={styles.panel} aria-label="同步设置">
                <Popover.Title className={styles.visuallyHidden}>
                  同步设置
                </Popover.Title>
                <div
                  className={styles.modeSwitch}
                  role="group"
                  aria-label="选择方式"
                >
                  <button
                    type="button"
                    className={styles.modeButton}
                    aria-pressed={mode === "level"}
                    onClick={() => activateMode("level")}
                  >
                    按品级
                  </button>
                  <button
                    type="button"
                    className={styles.modeButton}
                    aria-pressed={mode === "duty"}
                    onClick={() => activateMode("duty")}
                  >
                    按副本
                  </button>
                </div>
                <div className={styles.browser}>
                  {renderCategoryButtons(categories)}
                  <ScrollArea.Root
                    ref={popupRef}
                    className={styles.choicesScrollArea}
                    onMouseLeave={() => setHovered(undefined)}
                    onBlurCapture={(event) => {
                      if (
                        !event.currentTarget.contains(
                          event.relatedTarget as Node | null,
                        )
                      )
                        setHovered(undefined);
                    }}
                  >
                    <ScrollArea.Viewport
                      className={styles.choicesViewport}
                      aria-label={mode === "level" ? "同步品级" : "副本"}
                    >
                      <ScrollArea.Content
                        className={styles.choices}
                        style={{ minWidth: 0 }}
                      >
                        <button
                          type="button"
                          className={styles.choice}
                          aria-pressed={!value}
                          onClick={() => chooseLevel(undefined)}
                        >
                          <span>未启用</span>
                          {!value && (
                            <span className={styles.selectedMark}>当前</span>
                          )}
                        </button>
                        {mode === "level" ? (
                          <section className={styles.optionGroup}>
                            {selectedCategoryId && (
                              <SyncTargetChoice
                                target={{
                                  kind: "jobLevel",
                                  value: Number(selectedCategoryId),
                                }}
                                selected={value}
                                onChoose={chooseLevel}
                                onHover={setHovered}
                              />
                            )}
                            {levelOptions.map((option) => (
                              <SyncTargetChoice
                                key={syncTargetKey(option.target)}
                                target={option.target}
                                selected={value}
                                onChoose={chooseLevel}
                                onHover={setHovered}
                              />
                            ))}
                          </section>
                        ) : (
                          <section className={styles.optionGroup}>
                            {dutyOptions.map((option, index) => (
                              <button
                                type="button"
                                key={`${option.name}-${index}`}
                                className={styles.choice}
                                aria-pressed={
                                  duty === option.name && syncTargetKey(value) ===
                                  syncTargetKey(option.target)
                                }
                                onClick={() => chooseLevel(option.target, option.name)}
                              >
                                <span className={styles.dutyName}>
                                  {option.name}
                                </span>
                                <span className={styles.dutyLevel}>
                                  {option.target.kind === "jobLevel"
                                    ? `仅同步等级 ${option.target.value}`
                                    : option.target.value}
                                </span>
                              </button>
                            ))}
                          </section>
                        )}
                        {showExplorationWarning && (
                          <p className={styles.explorationWarning} role="note">
                            <TriangleAlert size={14} aria-hidden="true" />
                            <span>暂未计入特殊场景专属的属性修正效果。</span>
                          </p>
                        )}
                      </ScrollArea.Content>
                    </ScrollArea.Viewport>
                    <ScrollArea.Scrollbar
                      className={styles.scrollbar}
                      keepMounted
                    >
                      <ScrollArea.Thumb className={styles.scrollThumb} />
                    </ScrollArea.Scrollbar>
                  </ScrollArea.Root>
                </div>
                <div className={styles.manualSection}>
                  <div className={styles.manualHeader}>
                    <label
                      className={styles.manualLabel}
                      htmlFor={`${id}-manual`}
                    >
                      自定义同步品级
                    </label>
                    <p
                      id={`${id}-message`}
                      className={styles.error}
                      role={customError ? "alert" : "status"}
                      aria-live="polite"
                    >
                      {customError}
                    </p>
                  </div>
                  <form
                    className={styles.manualRow}
                    onSubmit={(event) => {
                      event.preventDefault();
                      applyCustomInput();
                    }}
                  >
                    <input
                      id={`${id}-manual`}
                      className={styles.manualInput}
                      type="text"
                      inputMode="numeric"
                      autoComplete="off"
                      value={customInput}
                      aria-invalid={Boolean(customError)}
                      aria-describedby={`${id}-message`}
                      onChange={(event) => {
                        setCustomInput(event.currentTarget.value);
                        setCustomError("");
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          event.preventDefault();
                          event.stopPropagation();
                          setCustomInput(
                            value?.kind === "itemLevel"
                              ? String(value.value)
                              : "",
                          );
                          setCustomError("");
                        }
                      }}
                    />
                    <button
                      type="submit"
                      className={styles.apply}
                      disabled={disabled}
                    >
                      应用
                    </button>
                  </form>
                </div>
              </Popover.Popup>
            </Popover.Positioner>
          </Popover.Portal>
        </Popover.Root>
      </FormField>
      <Popover.Root open={hovered !== undefined}>
        <Popover.Portal>
          <Popover.Positioner
            anchor={popupRef.current}
            className={styles.tooltipPositioner}
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
              <strong className={styles.tooltipTitle}>
                {syncOptionLabel(hovered)}
              </strong>
              <ul className={styles.list}>
                {optionsByTarget
                  .filter(
                    ({ target }) =>
                      syncTargetKey(target) === syncTargetKey(hovered),
                  )
                  .map(({ name }, index) => (
                    <li key={`${name}-${index}`}>{name}</li>
                  ))}
              </ul>
              {!optionsByTarget.some(
                ({ target }) =>
                  syncTargetKey(target) === syncTargetKey(hovered),
              ) && <p className={styles.empty}>没有匹配的条目。</p>}
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </>
  );
}
