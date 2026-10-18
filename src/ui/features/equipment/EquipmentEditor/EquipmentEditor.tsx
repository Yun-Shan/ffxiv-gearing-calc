import { Popover } from "@base-ui/react/popover";
import { ChevronDown, ChevronRight } from "lucide-react";
import { CheckboxInput } from "@/ui/components/form-controls/checkbox-input/CheckboxInput";
import { FormField } from "@/ui/components/form-controls/form-field/FormField";
import { useId, useMemo, useState } from "react";
import { gearSlotLabels } from "@/ui/services/labels";
import {
  useAllowedForcedGearSlots,
  useEquipmentScope,
  useExcludedGear,
  useExcludedSources,
  useForcedGear,
} from "../scope";
import type { GearSlot } from "@/domain";
import { LabeledSelect } from "@/ui/components/form-controls/labeled-select/LabeledSelect";
import { EquipmentSelect } from "@/ui/components/equipment-select/EquipmentSelect";
import { EquipmentOptionRow } from "@/ui/components/equipment-option-row/EquipmentOptionRow";
import { itemIconId } from "@/ui/services/item-icons";
import styles from "./EquipmentEditor.module.scss";

const sourceOrder = (a: string, b: string) => a.localeCompare(b, "zh-CN");

function EquipmentCountBadge({ count }: { count: number }) {
  return (
    <span className={styles.sourceCount} aria-label={`${count} 件装备`}>
      {count}
    </span>
  );
}

interface SourceNode {
  path: string;
  label: string;
  sources: string[];
  count: number;
  children: SourceNode[];
}

function buildSourceTree(
  sources: readonly string[],
  counts: ReadonlyMap<string, number>,
): SourceNode[] {
  const roots: SourceNode[] = [];
  for (const source of [...new Set(sources)].sort(sourceOrder)) {
    let children = roots;
    let path = "";
    for (const label of source.split("/").filter(Boolean)) {
      path = path ? `${path}/${label}` : label;
      let node = children.find((entry) => entry.path === path);
      if (!node) {
        node = { path, label, sources: [], count: 0, children: [] };
        children.push(node);
      }
      node.sources.push(source);
      node.count += counts.get(source) ?? 0;
      children = node.children;
    }
  }
  function sort(nodes: SourceNode[]) {
    nodes.sort((a, b) => sourceOrder(a.label, b.label));
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
  sources,
  excludedSources,
  counts,
  disabled,
  onChange,
}: {
  sources: readonly string[];
  excludedSources: readonly string[];
  counts: ReadonlyMap<string, number>;
  disabled: boolean;
  onChange(sources: string[]): void;
}) {
  const id = useId();
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
    () => buildSourceTree(choices, counts),
    [choices, counts],
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
    <FormField id={id} label="排除来源" layout="inline">
      <Popover.Root>
        <Popover.Trigger
          id={id}
          className={styles.sourceTrigger}
          disabled={disabled || nodes.length === 0}
        >
          <span>选择来源</span>
          <ChevronDown size={14} aria-hidden="true" />
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner
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
              className={styles.sourcePopup}
              aria-label="选择排除来源"
            >
              <ul className={styles.sourceTree} aria-label="来源分类">
                {nodes.map((node) => (
                  <SourceTreeBranch
                    key={node.path}
                    node={node}
                    selected={selected}
                    disabled={disabled}
                    onToggle={toggle}
                  />
                ))}
              </ul>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </FormField>
  );
}

function ExcludedSourcesEditor() {
  const { excludedSources, sourceOptions, remove, setSources } =
    useExcludedSources();
  const { readOnly, catalog } = useEquipmentScope();
  const counts = useMemo(() => {
    const result = new Map<string, number>();
    const seen = new Set<number>();
    for (const gear of catalog.gearOptions) {
      if (!gear.source || seen.has(gear.id)) continue;
      seen.add(gear.id);
      result.set(gear.source, (result.get(gear.source) ?? 0) + 1);
    }
    return result;
  }, [catalog.gearOptions]);
  return (
    <section className={styles.section} aria-label="排除来源">
      <SourceTreeSelect
        sources={sourceOptions}
        excludedSources={excludedSources}
        counts={counts}
        disabled={readOnly}
        onChange={setSources}
      />
      <ul className={styles.list} tabIndex={0} aria-label="已排除来源">
        {[...excludedSources].sort(sourceOrder).map((source) => (
          <li key={source}>
            <span className={styles.sourceListLabel}>
              <span data-source-name>{source}</span>
              <EquipmentCountBadge
                count={[...counts].reduce(
                  (sum, [name, count]) =>
                    name.startsWith(source) ? sum + count : sum,
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
  const { excludedGearIds, gearOptions, add, remove } = useExcludedGear();
  const [part, setPart] = useState("all");
  const parts: GearSlot[] = [
    ...new Set(
      gearOptions.map((gear) => (gear.slot === "ring2" ? "ring" : gear.slot)),
    ),
  ];
  const activePart = parts.includes(part as GearSlot) ? part : "all";
  const { readOnly } = useEquipmentScope();
  const available = gearOptions.filter(
    (gear) =>
      !excludedGearIds.includes(gear.id) &&
      (activePart === "all" ||
        (gear.slot === "ring2" ? "ring" : gear.slot) === activePart),
  );
  return (
    <section className={styles.section} aria-label="排除指定装备">
      <div className={styles.titleRow}>
        <h3>排除装备</h3>
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
            placeholder="搜索装备名称或品级"
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
                  iconId={itemIconId(gear.id)}
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

function ForcedGearEditor() {
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
        <h3>强制装备</h3>
        <p>当前没有可强制的装备部位。</p>
        <ul className={styles.list} tabIndex={0} aria-label="已强制装备" />
      </section>
    );
  const choices =
    activeSlot === "all"
      ? [
          ...new Map(
            slots
              .flatMap((slot) => gearOptionsForSlot(slot))
              .map((gear) => [gear.id, gear]),
          ).values(),
        ]
      : gearOptionsForSlot(activeSlot);
  const selectedId = activeSlot === "all" ? undefined : forcedGear[activeSlot];
  const selectedGear =
    selectedId === undefined
      ? undefined
      : (choices.find((gear) => gear.id === selectedId) ??
        catalog.gearOptions.find((gear) => gear.id === selectedId));
  return (
    <section className={styles.section} aria-label="强制装备">
      <div className={styles.titleRow}>
        <h3>
          强制装备{" "}
          <span className={styles.count}>
            {Object.values(forcedGear).filter((id) => id !== undefined).length}{" "}
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
            placeholder="搜索装备名称或品级"
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
              if (target) set(target, gear.id);
            }}
            onClear={activeSlot === "all" ? undefined : () => clear(activeSlot)}
          />
        </div>
      </div>
      <ul className={styles.list} tabIndex={0} aria-label="已强制装备">
        {Object.entries(forcedGear)
          .filter(([, id]) => id !== undefined)
          .map(([slot, id]) => {
            const gear =
              catalog.gearOptions.find((item) => item.id === id) ??
              gearOptionsForSlot(slot as GearSlot).find(
                (item) => item.id === id,
              );
            return (
              <li key={slot}>
                {gear ? (
                  <EquipmentOptionRow
                    slot={slot as GearSlot}
                    iconId={itemIconId(gear.id)}
                    name={gear.name}
                    level={gear.level}
                    source={gear.source}
                  />
                ) : (
                  <span>
                    {gearSlotLabels[slot as GearSlot]} · 装备 {id}
                  </span>
                )}
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

export function EquipmentEditor({ title = "装备限制" }: { title?: string }) {
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
        <ForcedGearEditor />
      </div>
    </section>
  );
}
