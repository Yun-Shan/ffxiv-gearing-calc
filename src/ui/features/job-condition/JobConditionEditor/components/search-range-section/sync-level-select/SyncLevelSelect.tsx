import { ChevronDown, Search, TriangleAlert } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Popover } from "@base-ui/react/popover";
import {
  gameData,
  syncTargetCalculationError,
  type SyncTarget,
} from "@/domain";
import { FormField } from "@/ui/components/form-controls/form-field/FormField";
import {
  categoryFor,
  dutyOptionCategories,
  levelOptionCategories,
  searchMatches,
  type SyncSelectionMode,
  syncTargetKey,
  syncTargetLabel,
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
      <span>{syncTargetLabel(target)}</span>
      {isSelected && <span className={styles.selectedMark}>当前</span>}
    </button>
  );
}

export function SyncLevelSelect({
  value,
  disabled,
  onChange,
}: {
  value?: SyncTarget;
  disabled: boolean;
  onChange(value?: SyncTarget): void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<SyncSelectionMode>("level");
  const [levelCategory, setLevelCategory] = useState(() =>
    String(gameData.sync.levels.at(-1)?.jobLevel ?? ""),
  );
  const [dutyCategory, setDutyCategory] = useState("0");
  const [query, setQuery] = useState("");
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
  const selectedLabel = syncTargetLabel(value);
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
  const dutyCandidates = query.trim()
    ? dutyOptionCategories.flatMap(({ options }) => options)
    : (dutyCategoryValue?.options ?? []);
  const dutyOptions = dutyCandidates.filter((option) =>
    searchMatches(query, option.name, syncTargetLabel(option.target)),
  );
  const showExplorationWarning =
    mode === "duty" &&
    dutyOptionCategories.some(
      ({ label, options }) =>
        label === "特殊场景探索" &&
        options.some((option) => dutyOptions.includes(option)),
    );

  const chooseLevel = (next?: SyncTarget) => {
    setHovered(undefined);
    setCustomError("");
    setCustomInput(next?.kind === "itemLevel" ? String(next.value) : "");
    if (syncTargetKey(next) !== syncTargetKey(value)) onChange(next);
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
    setQuery("");
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
            setQuery("");
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
                {mode === "duty" && (
                  <>
                    <label
                      className={styles.visuallyHidden}
                      htmlFor={`${id}-search`}
                    >
                      搜索副本名称或品级
                    </label>
                    <div className={styles.searchBox}>
                      <Search size={15} aria-hidden="true" />
                      <input
                        id={`${id}-search`}
                        className={styles.search}
                        type="search"
                        value={query}
                        autoComplete="off"
                        placeholder="搜索副本名称或品级…"
                        onChange={(event) => {
                          setQuery(event.currentTarget.value);
                          setHovered(undefined);
                        }}
                      />
                    </div>
                  </>
                )}
                <div className={styles.browser}>
                  {renderCategoryButtons(categories)}
                  <div
                    ref={popupRef}
                    className={styles.choices}
                    aria-label={mode === "level" ? "同步品级" : "副本"}
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
                    {(!query.trim() || searchMatches(query, "未启用")) && (
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
                    )}
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
                    ) : dutyOptions.length ? (
                      <section className={styles.optionGroup}>
                        {dutyOptions.map((option, index) => (
                          <button
                            type="button"
                            key={`${option.name}-${index}`}
                            className={styles.choice}
                            aria-pressed={
                              syncTargetKey(value) ===
                              syncTargetKey(option.target)
                            }
                            onClick={() => chooseLevel(option.target)}
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
                    ) : (
                      <p className={styles.empty}>没有匹配的副本。</p>
                    )}
                    {showExplorationWarning && (
                      <p className={styles.explorationWarning} role="note">
                        <TriangleAlert size={14} aria-hidden="true" />
                        <span>暂未计入特殊场景专属的属性修正效果。</span>
                      </p>
                    )}
                  </div>
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
                {syncTargetLabel(hovered)}
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
