import { Popover } from "@base-ui/react/popover";
import { Input } from "@base-ui/react/input";
import { ChevronDown, ChevronRight } from "lucide-react";
import { CheckboxInput } from "@/ui/components/form-controls/checkbox-input/CheckboxInput";
import { FormField } from "@/ui/components/form-controls/form-field/FormField";
import { useId, useMemo, useRef, useState, type RefObject } from "react";
import { gearSlotLabels, gearSlotOrder } from "@/ui/services/labels";
import {
  useAllowedForcedGearSlots,
  useEquipmentScope,
  useExcludedGear,
  useExcludedSources,
  useForcedGear,
} from "../scope";
import {
  forcedGearId,
  type EquipmentMateriaConfig,
  type ForcedGearValue,
  type Gear,
  type GearSlot,
  type JobId,
} from "@/domain";
import { LabeledSelect } from "@/ui/components/form-controls/labeled-select/LabeledSelect";
import { EquipmentSelect } from "@/ui/components/equipment-select/EquipmentSelect";
import { EquipmentOptionRow } from "@/ui/components/equipment-option-row/EquipmentOptionRow";
import styles from "./EquipmentEditor.module.scss";
import { ForcedEquipmentRow } from "./components/forced-equipment-row/ForcedEquipmentRow";
import { ForcedGearImport } from "./components/forced-gear-import/ForcedGearImport";

const sourceOrder = (a: string, b: string) => a.localeCompare(b, "zh-CN");
const equipmentOrder = (
  a: Pick<Gear, "level" | "id">,
  b: Pick<Gear, "level" | "id">,
) => b.level - a.level || b.id - a.id;

function EquipmentCountBadge({ count }: { count: number }) {
  return (
    <span className={styles.sourceCount} aria-label={`${count} 件装备`}>
      {count}
    </span>
  );
}

interface SourceSummary {
  count: number;
  level: number;
  id: number;
}

interface SourceNode extends SourceSummary {
  path: string;
  label: string;
  sources: string[];
  children: SourceNode[];
}

function buildSourceTree(
  sources: readonly string[],
  summaries: ReadonlyMap<string, SourceSummary>,
): SourceNode[] {
  const roots: SourceNode[] = [];
  for (const source of [...new Set(sources)].sort(sourceOrder)) {
    const summary = summaries.get(source);
    let children = roots;
    let path = "";
    for (const label of source.split("/").filter(Boolean)) {
      path = path ? `${path}/${label}` : label;
      let node = children.find((entry) => entry.path === path);
      if (!node) {
        node = {
          path,
          label,
          sources: [],
          count: 0,
          level: 0,
          id: 0,
          children: [],
        };
        children.push(node);
      }
      node.sources.push(source);
      node.count += summary?.count ?? 0;
      if (summary && equipmentOrder(summary, node) < 0) {
        node.level = summary.level;
        node.id = summary.id;
      }
      children = node.children;
    }
  }
  function sort(nodes: SourceNode[]) {
    nodes.sort((a, b) => equipmentOrder(a, b) || sourceOrder(a.label, b.label));
    nodes.forEach((node) => sort(node.children));
  }
  sort(roots);
  return roots;
}

function SourceTreeBranch({
  node,
  selected,
  disabled,
  onToggle,
}: {
  node: SourceNode;
  selected: ReadonlySet<string>;
  disabled: boolean;
  onToggle(node: SourceNode, checked: boolean): void;
}) {
  const [expanded, setExpanded] = useState(true);
  const selectedCount = node.sources.filter((source) =>
    selected.has(source),
  ).length;
  const checked = selectedCount === node.sources.length;
  const partial = selectedCount > 0 && !checked;
  return (
    <li>
      <div className={styles.sourceTreeRow}>
        {node.children.length > 0 ? (
          <button
            type="button"
            className={styles.sourceExpand}
            aria-label={`${expanded ? "收起" : "展开"}${node.label}`}
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        ) : (
          <span className={styles.sourceExpandSpacer} />
        )}
        <CheckboxInput
          checked={checked}
          indeterminate={partial}
          disabled={disabled}
          onChange={() => onToggle(node, !checked)}
          label={
            <span title={node.path}>
              {node.label}
              <EquipmentCountBadge count={node.count} />
            </span>
          }
        />
      </div>
      {node.children.length > 0 && expanded && (
        <ul className={styles.sourceChildren}>
          {node.children.map((child) => (
            <SourceTreeBranch
              key={child.path}
              node={child}
              selected={selected}
              disabled={disabled}
              onToggle={onToggle}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function SourceTreeSelect({
  popupAnchor,
  sources,
  excludedSources,
  summaries,
  disabled,
  onChange,
}: {
  popupAnchor: RefObject<HTMLDivElement | null>;
  sources: readonly string[];
  excludedSources: readonly string[];
  summaries: ReadonlyMap<string, SourceSummary>;
  disabled: boolean;
  onChange(sources: string[]): void;
}) {
  const id = useId();
  const popupId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const controlRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLocaleLowerCase();
  // Expand historical prefix exclusions to the current concrete source leaves.
  const choices = useMemo(
    () => [
      ...new Set([
        ...sources,
        ...excludedSources.filter(
          (excluded) => !sources.some((source) => source.startsWith(excluded)),
        ),
      ]),
    ],
    [sources, excludedSources],
  );
  const nodes = useMemo(
    () =>
      buildSourceTree(
        choices.filter((source) =>
          source.toLocaleLowerCase().includes(normalizedQuery),
        ),
        summaries,
      ),
    [choices, summaries, normalizedQuery],
  );
  const selected = new Set(
    choices.filter((source) =>
      excludedSources.some((excluded) => source.startsWith(excluded)),
    ),
  );
  function toggle(node: SourceNode, checked: boolean) {
    const next = new Set(selected);
    node.sources.forEach((source) =>
      checked ? next.add(source) : next.delete(source),
    );
    onChange([...next].sort(sourceOrder));
  }
  return (
    <FormField id={id} label="排除来源" layout="inline" hideLabel>
      <Popover.Root
        open={open}
        onOpenChange={(nextOpen, details) => {
          if (
            !nextOpen &&
            details.reason !== "trigger-press" &&
            details.event.target instanceof Node &&
            controlRef.current?.contains(details.event.target)
          ) {
            details.cancel();
            return;
          }
          setOpen(nextOpen);
          if (!nextOpen) setQuery("");
        }}
      >
        <div
          ref={controlRef}
          className={styles.sourceControl}
          data-disabled={disabled || choices.length === 0 ? "" : undefined}
        >
          <Input
            id={id}
            ref={inputRef}
            className={styles.sourceInput}
            role="combobox"
            aria-label="排除来源"
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-controls={open ? popupId : undefined}
            autoComplete="off"
            placeholder="搜索来源"
            value={query}
            disabled={disabled || choices.length === 0}
            onClick={() => setOpen(true)}
            onValueChange={(value) => {
              setQuery(value);
              setOpen(true);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setOpen(true);
                requestAnimationFrame(() =>
                  popupRef.current
                    ?.querySelector<HTMLElement>('[role="checkbox"]')
                    ?.focus(),
                );
              } else if (event.key === "Escape") {
                event.preventDefault();
                setOpen(false);
                setQuery("");
              }
            }}
          />
          <Popover.Trigger
            className={styles.sourceTrigger}
            aria-label="打开排除来源列表"
            disabled={disabled || choices.length === 0}
          >
            ▾
          </Popover.Trigger>
        </div>
        <Popover.Portal>
          <Popover.Positioner
            anchor={popupAnchor}
            className={styles.sourcePositioner}
            side="bottom"
            collisionAvoidance={{
              side: "flip",
              align: "shift",
              fallbackAxisSide: "none",
            }}
            sideOffset={4}
            align="start"
          >
            <Popover.Popup
              id={popupId}
              ref={popupRef}
              initialFocus={false}
              finalFocus={(type) =>
                type === "keyboard" ? inputRef.current : false
              }
              className={styles.sourcePopup}
              aria-label="选择排除来源"
            >
              <ul className={styles.sourceTree} aria-label="来源分类">
                {nodes.map((node) => (
                  <SourceTreeBranch
                    key={`${normalizedQuery}:${node.path}`}
                    node={node}
                    selected={selected}
                    disabled={disabled}
                    onToggle={toggle}
                  />
                ))}
              </ul>
              {nodes.length === 0 && (
                <p className={styles.sourceEmpty} role="status">
                  没有匹配的来源。
                </p>
              )}
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </FormField>
  );
}

function ExcludedSourcesEditor() {
  const popupAnchor = useRef<HTMLDivElement>(null);
  const { excludedSources, sourceOptions, remove, setSources } =
    useExcludedSources();
  const { readOnly, catalog } = useEquipmentScope();
  const summaries = useMemo(() => {
    const result = new Map<string, SourceSummary>();
    const seen = new Set<number>();
    for (const gear of catalog.gearOptions) {
      if (!gear.source || seen.has(gear.id)) continue;
      seen.add(gear.id);
      const summary = result.get(gear.source) ?? { count: 0, level: 0, id: 0 };
      summary.count += 1;
      if (equipmentOrder(gear, summary) < 0) {
        summary.level = gear.level;
        summary.id = gear.id;
      }
      result.set(gear.source, summary);
    }
    return result;
  }, [catalog.gearOptions]);
  return (
    <section className={styles.section} aria-label="排除来源">
      <div ref={popupAnchor} className={styles.titleRow}>
        <h3 className={styles.sectionLabel}>排除来源</h3>
        <div className={styles.pickerRow}>
          <SourceTreeSelect
            popupAnchor={popupAnchor}
            sources={sourceOptions}
            excludedSources={excludedSources}
            summaries={summaries}
            disabled={readOnly}
            onChange={setSources}
          />
        </div>
      </div>
      <ul className={styles.list} tabIndex={0} aria-label="已排除来源">
        {[...excludedSources].sort(sourceOrder).map((source) => (
          <li key={source}>
            <span className={styles.sourceListLabel}>
              <span data-source-name>{source}</span>
              <EquipmentCountBadge
                count={[...summaries].reduce(
                  (sum, [name, summary]) =>
                    name.startsWith(source) ? sum + summary.count : sum,
                  0,
                )}
              />
            </span>
            <button
              type="button"
              disabled={readOnly}
              onClick={() => remove(source)}
            >
              移除
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ExcludedGearEditor() {
  const popupAnchor = useRef<HTMLDivElement>(null);
  const { excludedGearIds, gearOptions, add, remove } = useExcludedGear();
  const [part, setPart] = useState("all");
  const parts: GearSlot[] = [
    ...new Set(
      gearOptions.map((gear) => (gear.slot === "ring2" ? "ring" : gear.slot)),
    ),
  ];
  const activePart = parts.includes(part as GearSlot) ? part : "all";
  const { readOnly } = useEquipmentScope();
  const available = gearOptions
    .filter(
      (gear) =>
        !excludedGearIds.includes(gear.id) &&
        (activePart === "all" ||
          (gear.slot === "ring2" ? "ring" : gear.slot) === activePart),
    )
    .sort(equipmentOrder);
  return (
    <section className={styles.section} aria-label="排除指定装备">
      <div ref={popupAnchor} className={styles.titleRow}>
        <h3 className={styles.sectionLabel}>排除装备</h3>
        <div className={styles.pickerRow}>
          <div className={styles.slotFilter}>
            <LabeledSelect
              label="排除装备部位"
              hideLabel
              controlSize="slot"
              value={activePart}
              disabled={readOnly}
              options={[
                { value: "all", label: "全部部位" },
                ...parts.map((slot) => ({
                  value: slot,
                  label:
                    slot === "ring" || slot === "ring2"
                      ? "戒指"
                      : gearSlotLabels[slot],
                })),
              ]}
              onChange={setPart}
            />
          </div>
          <EquipmentSelect
            hideLabel
            label="排除装备"
            popupAnchor={popupAnchor}
            placeholder="搜索装备名称、品级或来源"
            items={available}
            disabled={readOnly || available.length === 0}
            onSelect={(gear) => add(gear.id)}
          />
        </div>
      </div>
      <ul className={styles.list} tabIndex={0} aria-label="已排除装备">
        {excludedGearIds.map((id) => {
          const gear = gearOptions.find((entry) => entry.id === id);
          return (
            <li key={id}>
              {gear ? (
                <EquipmentOptionRow
                  slot={gear.slot}
                  itemId={gear.id}
                  name={gear.name}
                  level={gear.level}
                  source={gear.source}
                />
              ) : (
                <span>装备 {id}</span>
              )}
              <button
                type="button"
                disabled={readOnly}
                onClick={() => remove(id)}
              >
                移除
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function ForcedGearEditor({
  materiaConfig,
  importJobs,
}: {
  materiaConfig?: EquipmentMateriaConfig;
  importJobs?: readonly JobId[];
}) {
  const popupAnchor = useRef<HTMLDivElement>(null);
  const slots = useAllowedForcedGearSlots();
  const { forcedGear, gearOptionsForSlot, set, clear } = useForcedGear();
  const { catalog, readOnly } = useEquipmentScope();
  const [selectedSlot, setSelectedSlot] = useState<GearSlot | "all">("all");
  const activeSlot =
    selectedSlot !== "all" && slots.includes(selectedSlot)
      ? selectedSlot
      : "all";
  if (slots.length === 0)
    return (
      <section className={styles.section} aria-label="强制装备">
        <h3 className={styles.sectionLabel}>强制装备</h3>
        <p>当前没有可强制的装备部位。</p>
        <ul className={styles.list} tabIndex={0} aria-label="已强制装备" />
      </section>
    );
  const choices = (
    activeSlot === "all"
      ? [
          ...new Map(
            slots
              .flatMap((slot) => gearOptionsForSlot(slot))
              .map((gear) => [gear.id, gear]),
          ).values(),
        ]
      : gearOptionsForSlot(activeSlot)
  ).toSorted(equipmentOrder);
  const selectedId =
    activeSlot === "all" ? undefined : forcedGearId(forcedGear[activeSlot]);
  const selectedGear =
    selectedId === undefined
      ? undefined
      : (choices.find((gear) => gear.id === selectedId) ??
        catalog.gearOptions.find((gear) => gear.id === selectedId));
  return (
    <section className={styles.section} aria-label="强制装备">
      <div ref={popupAnchor} className={styles.titleRow}>
        <h3 className={styles.sectionLabel}>
          强制装备{" "}
          <span className={styles.count}>
            {
              Object.values(forcedGear).filter((value) => value !== undefined)
                .length
            }{" "}
            个部位
          </span>
        </h3>
        <div className={styles.pickerRow}>
          <div className={styles.slotFilter}>
            <LabeledSelect
              hideLabel
              controlSize="slot"
              label="强制装备部位"
              value={activeSlot}
              disabled={readOnly}
              options={[
                { value: "all", label: "全部部位" },
                ...slots.map((slot) => ({
                  value: slot,
                  label: gearSlotLabels[slot],
                })),
              ]}
              onChange={(slot) => setSelectedSlot(slot as GearSlot | "all")}
            />
          </div>
          <EquipmentSelect
            hideLabel
            label="指定装备"
            popupAnchor={popupAnchor}
            placeholder="搜索装备名称、品级或来源"
            items={choices}
            value={selectedGear}
            disabled={readOnly || choices.length === 0}
            onSelect={(gear) => {
              const target =
                activeSlot === "all"
                  ? slots.find((slot) =>
                      gearOptionsForSlot(slot).some(
                        (option) => option.id === gear.id,
                      ),
                    )
                  : activeSlot;
              if (target) {
                const current = forcedGear[target];
                set(
                  target,
                  gear.id,
                  forcedGearId(current) === gear.id ? current : gear.id,
                );
              }
            }}
            onClear={activeSlot === "all" ? undefined : () => clear(activeSlot)}
          />
          {materiaConfig && <ForcedGearImport config={materiaConfig} allowedJobs={importJobs ?? [materiaConfig.jobId]} />}
        </div>
      </div>
      <ul
        className={`${styles.list} ${styles.forcedList}`}
        tabIndex={0}
        aria-label="已强制装备"
      >
        {Object.entries(forcedGear)
          .filter(([, value]) => value !== undefined)
          .sort(([left], [right]) => gearSlotOrder.indexOf(left as GearSlot) - gearSlotOrder.indexOf(right as GearSlot))
          .map(([slot, value]) => {
            const forcedValue = value as ForcedGearValue;
            const id = forcedGearId(forcedValue)!;
            const gear =
              catalog.gearOptions.find((item) => item.id === id) ??
              gearOptionsForSlot(slot as GearSlot).find(
                (item) => item.id === id,
              );
            return gear ? (
              <ForcedEquipmentRow key={slot} gear={gear} slot={slot as GearSlot}
                value={forcedValue} config={materiaConfig} readOnly={readOnly}
                onChange={(next) => set(slot as GearSlot, gear.id, next)}
                onRemove={() => clear(slot as GearSlot)} />
            ) : (
              <li key={slot}>
                  <span className={styles.missingForcedEquipment}>
                    {gearSlotLabels[slot as GearSlot]} · 装备 {id}
                  </span>
                <button
                  type="button"
                  disabled={readOnly}
                  onClick={() => clear(slot as GearSlot)}
                >
                  移除
                </button>
              </li>
            );
          })}
      </ul>
    </section>
  );
}

export function EquipmentEditor({
  title = "装备限制",
  materiaConfig,
  importJobs,
}: {
  title?: string;
  materiaConfig?: EquipmentMateriaConfig;
  importJobs?: readonly JobId[];
}) {
  const { scope } = useEquipmentScope();
  return (
    <section className={styles.root} aria-label={title}>
      <header className={styles.header}>
        <h2>{title}</h2>
      </header>
      <div className={styles.editor}>
        <div className={styles.exclusions}>
          {scope.kind !== "joint-job" && <ExcludedSourcesEditor />}
          <ExcludedGearEditor />
        </div>
        <ForcedGearEditor materiaConfig={materiaConfig} importJobs={importJobs} />
      </div>
    </section>
  );
}
