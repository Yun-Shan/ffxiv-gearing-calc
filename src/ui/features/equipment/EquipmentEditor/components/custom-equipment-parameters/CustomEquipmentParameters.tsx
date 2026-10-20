import { useMemo, useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { Slider } from "@base-ui/react/slider";
import {
  prepareCustomEquipmentParameters,
  calculationJobLevelFor,
  effectiveGearSyncLevel,
  getGearStatCap,
  initialCustomEquipmentParameters,
  customEquipmentParametersFromStats,
  evaluateCustomEquipmentParameters,
  type CustomEquipmentParameterDraft,
  type EquipmentMateriaConfig,
  type ForcedGearValue,
  type Gear,
  type Stats,
} from "@/domain";
import { LabeledSelect } from "@/ui/components/form-controls/labeled-select/LabeledSelect";
import { NumberInput } from "@/ui/components/form-controls/number-input/NumberInput";
import { statNames } from "@/ui/services/labels";
import { SyncIcon } from "@/ui/components/sync-icon/SyncIcon";
import styles from "./CustomEquipmentParameters.module.scss";

const parameterStatOrder: readonly string[] = ["CRT", "DET", "DHT", "SKS", "SPS", "TEN"];

function orderAttributes<T extends { stat: string }>(attributes: readonly T[]): T[] {
  const rank = (stat: string) => {
    const index = parameterStatOrder.indexOf(stat);
    return index < 0 ? parameterStatOrder.length : index;
  };
  return attributes.toSorted((left, right) => rank(left.stat) - rank(right.stat));
}

type ParameterSetting = {
  mode: "auto" | "custom";
  draft: CustomEquipmentParameterDraft;
  stats?: Stats;
};

function settingFromValue(
  model: ReturnType<typeof prepareCustomEquipmentParameters>,
  gearId: number,
  value: ForcedGearValue,
): ParameterSetting {
  if (
    typeof value === "number" ||
    value.id !== gearId ||
    !("customStats" in value)
  )
    return { mode: "auto", draft: initialCustomEquipmentParameters(model) };
  return {
    mode: "custom",
    draft: customEquipmentParametersFromStats(model, value.customStats),
    stats: value.customStats,
  };
}

export function CustomEquipmentParameters({
  gear,
  config,
  readOnly,
  value,
  onChange,
}: {
  gear: Gear;
  config: EquipmentMateriaConfig;
  readOnly: boolean;
  value: ForcedGearValue;
  onChange(value: ForcedGearValue): void;
}) {
  const model = useMemo(
    () => {
      const prepared = prepareCustomEquipmentParameters(gear, config.jobId);
      return prepared.kind === "manderville"
        ? { ...prepared, attributes: orderAttributes(prepared.attributes) }
        : { ...prepared, attributes: orderAttributes(prepared.attributes) };
    },
    [gear.id, config.jobId],
  );
  const syncLevel = effectiveGearSyncLevel(gear, calculationJobLevelFor(config), config.syncLevel);
  const syncCaps = useMemo(
    () => syncLevel === undefined ? undefined : Object.fromEntries(
      model.attributes.map(({ stat }) => [stat, getGearStatCap(gear, stat, syncLevel)]),
    ) as Stats,
    [gear.id, model, syncLevel],
  );
  const committed = useMemo(
    () => settingFromValue(model, gear.id, value),
    [gear.id, model, value],
  );
  const [mode, setMode] = useState<ParameterSetting["mode"]>("auto");
  const [draft, setDraft] = useState(() =>
    initialCustomEquipmentParameters(model),
  );
  const [open, setOpen] = useState(false);
  const evaluation = useMemo(
    () => evaluateCustomEquipmentParameters(model, draft),
    [model, draft],
  );
  const disabled = mode === "auto";
  const resistanceOverLimit =
    mode === "custom" &&
    model.kind === "resistance" &&
    draft.kind === "resistance" &&
    ((evaluation.total !== undefined &&
      evaluation.total > model.maxTotalStats) ||
      model.attributes.some(({ stat, base, max }) => {
        const value = draft.values[stat];
        return (
          value !== null && value !== undefined && (value < base || value > max)
        );
      }));
  const summary = committed.mode === "auto"
    ? <>{syncCaps && <SyncIcon />}自动</>
    : model.attributes.filter(({ stat }) => Math.min(committed.stats![stat] ?? 0, syncCaps?.[stat] ?? Infinity) > 0).map(({ stat }, index) => {
        const value = committed.stats![stat] ?? 0;
        const cap = syncCaps?.[stat];
        const synchronized = cap !== undefined && value > cap;
        return <span key={stat}>
          {index > 0 && " / "}
          {synchronized && <SyncIcon />}
          {statNames[stat]} {synchronized ? cap : value}
        </span>;
      });
  const resistanceHint =
    mode !== "custom" || model.kind !== "resistance"
      ? ""
      : resistanceOverLimit
        ? "超限"
        : evaluation.total === undefined
          ? "未填完整"
          : evaluation.error
            ? "数值无效"
            : evaluation.total < model.maxTotalStats
              ? "未分配满"
              : "";
  const canConfirm =
    mode === "auto" ||
    Boolean(
      evaluation.stats &&
      (model.kind !== "resistance" || evaluation.total === model.maxTotalStats),
    );
  function confirm() {
    if (!canConfirm) return;
    onChange(
      mode === "auto"
        ? gear.id
        : { id: gear.id, customStats: evaluation.stats! },
    );
    setOpen(false);
  }
  return (
    <span className={styles.root}>
      <Popover.Root
        open={open}
        onOpenChange={(next) => {
          if (next) {
            setMode(committed.mode);
            setDraft(committed.draft);
          }
          setOpen(next);
        }}
      >
        <Popover.Trigger
          className={styles.trigger}
          disabled={readOnly}
          aria-label={`${gear.name}参数设置`}
        >
          {summary}
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner
            className={styles.positioner}
            sideOffset={4}
            align="start"
          >
            <Popover.Popup className={styles.popup}>
              <Popover.Title className={styles.title}>
                {gear.name} · 参数设置
              </Popover.Title>
              <LabeledSelect
                label="参数模式"
                value={mode}
                options={[
                  { value: "auto", label: "自动" },
                  { value: "custom", label: "自定义" },
                ]}
                onChange={(value) => setMode(value as ParameterSetting["mode"])}
              />
              <fieldset
                className={styles.attributes}
                disabled={disabled}
                aria-label="自定义属性"
              >
                <div className={styles.fields}>
                  {model.kind === "manderville" && draft.kind === "manderville"
                    ? draft.choices.map((choice, index) => (
                        <LabeledSelect
                          key={index}
                          label={["大属性一", "大属性二", "小属性"][index]!}
                          value={choice || null}
                          disabled={disabled}
                          invalid={
                            !disabled &&
                            choice !== "" &&
                            draft.choices.some(
                              (selected, other) =>
                                other !== index && selected === choice,
                            )
                          }
                          placeholder="请选择属性"
                          options={model.attributes.filter((attribute) => (index < 2 ? attribute.bigValue : attribute.smallValue) > 0).map((attribute) => ({
                            value: attribute.stat,
                            label: `${statNames[attribute.stat]} ${index < 2 ? attribute.bigValue : attribute.smallValue}`,
                            suffix: syncCaps && syncCaps[attribute.stat]! < attribute.base + (index < 2 ? attribute.bigValue : attribute.smallValue)
                              ? <span className={styles.syncedValue}><SyncIcon />{syncCaps[attribute.stat]}</span>
                              : undefined,
                          }))}
                          onChange={(value) =>
                            setDraft((current) => {
                              if (current.kind !== "manderville")
                                return current;
                              const choices = current.choices.slice();
                              choices[index] = value as typeof choice;
                              return { ...current, choices };
                            })
                          }
                        />
                      ))
                    : model.kind === "resistance" && draft.kind === "resistance"
                      ? model.attributes.filter((attribute) => attribute.max > 0).map((attribute) => {
                          const value = draft.values[attribute.stat] ?? null;
                          const cap = syncCaps?.[attribute.stat];
                          const syncMark = cap !== undefined && cap >= attribute.base && cap <= attribute.max && attribute.max > attribute.base
                            ? cap : undefined;
                          const update = (value: number | null) =>
                            setDraft((current) =>
                              current.kind === "resistance"
                                ? {
                                    ...current,
                                    values: {
                                      ...current.values,
                                      [attribute.stat]: value,
                                    },
                                  }
                                : current,
                            );
                          const invalid =
                            value === null ||
                            !Number.isSafeInteger(value) ||
                            value < attribute.base ||
                            value > attribute.max;
                          return (
                            <div
                              key={attribute.stat}
                              className={styles.statRow}
                            >
                              <div className={styles.statHeader}>
                                <span>{statNames[attribute.stat]}</span>
                                <span>{attribute.max}</span>
                              </div>
                              <div className={styles.adjustment}>
                                <Slider.Root
                                  className={styles.slider}
                                  min={attribute.base}
                                  max={attribute.max}
                                  step={1}
                                  value={Math.max(
                                    attribute.base,
                                    Math.min(
                                      attribute.max,
                                      value ?? attribute.base,
                                    ),
                                  )}
                                  disabled={disabled}
                                  onValueChange={update}
                                >
                                  <Slider.Control
                                    className={styles.sliderControl}
                                  >
                                    <Slider.Track className={styles.track}>
                                      {syncMark !== undefined && (
                                        <span className={styles.syncMark}
                                          style={{ left: `${Number(((syncMark - attribute.base) / (attribute.max - attribute.base) * 100).toFixed(3))}%` }}
                                          aria-label={`${statNames[attribute.stat]}同步上限 ${syncMark}`}>
                                          <span className={styles.syncMarkLabel}><SyncIcon />{syncMark}</span>
                                        </span>
                                      )}
                                      <Slider.Indicator
                                        className={styles.indicator}
                                      />
                                      <Slider.Thumb
                                        className={styles.thumb}
                                        aria-label={`${statNames[attribute.stat]}滑块`}
                                      />
                                    </Slider.Track>
                                  </Slider.Control>
                                </Slider.Root>
                                <NumberInput
                                  label={`${statNames[attribute.stat]}数值`}
                                  hideLabel
                                  value={value}
                                  onChange={update}
                                  min={attribute.base}
                                  max={attribute.max}
                                  step={1}
                                  disabled={disabled}
                                  invalid={mode === "custom" && invalid}
                                  minDigits={3}
                                />
                              </div>
                            </div>
                          );
                        })
                      : null}
                </div>
                {disabled && <div className={styles.mask} aria-hidden="true" />}
              </fieldset>
              {model.kind === "resistance" && (
                <p className={styles.budget}>
                  <span>
                    总分配：
                    <span
                      className={
                        resistanceOverLimit ? styles.overLimit : undefined
                      }
                      aria-label="总分配当前值"
                    >
                      {evaluation.total ?? "—"}
                    </span>{" "}
                    / {model.maxTotalStats}
                  </span>
                  <span
                    className={styles.error}
                    role="status"
                  >
                    {resistanceHint}
                  </span>
                </p>
              )}
              {mode === "custom" &&
                model.kind === "manderville" &&
                evaluation.error && (
                  <p className={styles.error} role="status">
                    {evaluation.error}
                  </p>
                )}
              <div className={styles.actions}>
                <Popover.Close className={styles.cancel}>取消</Popover.Close>
                <button
                  type="button"
                  className={styles.confirm}
                  disabled={!canConfirm}
                  onClick={confirm}
                >
                  确认
                </button>
              </div>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </span>
  );
}
