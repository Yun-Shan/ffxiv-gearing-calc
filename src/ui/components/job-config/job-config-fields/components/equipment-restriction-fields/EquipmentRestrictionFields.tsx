import { useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { X } from "lucide-react";
import { getGearById, gearOptionsFor, slotsForJob, type Gear, type GearSlot, type OptimizationConfig } from "../../../../../../domain/index";
import { gearSlotLabels } from "../../../../../services/labels";
import { SingleEquipmentRestrictionsSection } from "./components/single-equipment-restrictions-section/SingleEquipmentRestrictionsSection";
import { SearchableGearDropdown as SearchableDropdown, VirtualGearOptions } from "./components/searchable-gear-dropdown/SearchableGearDropdown";
import { GearMark } from "./components/gear-mark/GearMark";
import { CheckControl } from "../../../fields/fields";
import styles from "./EquipmentRestrictionFields.module.css";

export interface EquipmentRestrictionFieldsProps {
  config: OptimizationConfig;
  setConfig: Dispatch<SetStateAction<OptimizationConfig>>;
  singleWorkbench: boolean;
  onEdited?: () => void;
}

export function EquipmentRestrictionFields({
  config,
  setConfig,
  singleWorkbench,
  onEdited,
}: EquipmentRestrictionFieldsProps) {
  const slotLabels = gearSlotLabels;
  const [sourceQuery, setSourceQuery] = useState("");
  const [equipmentQuery, setEquipmentQuery] = useState("");
  const [forcedSearch, setForcedSearch] = useState("");
  const [sourceDropdownOpen, setSourceDropdownOpen] = useState(false);
  const [equipmentDropdownOpen, setEquipmentDropdownOpen] = useState(false);
  const [forcedDropdownOpen, setForcedDropdownOpen] = useState(false);
  const [forcedGearSelection, setForcedGearSelection] = useState<number>();
  const [forcedSlot, setForcedSlot] = useState<GearSlot>(
    slotsForJob(config.jobId)[0] ?? "weapon",
  );
  const jobGears = useMemo(
    () => [...new Map(slotsForJob(config.jobId).flatMap(slot =>
      gearOptionsFor({ ...config, excludedSources: [], excludedGearIds: [], forcedGear: {} }, slot),
    ).map(gear => [gear.id, gear])).values()],
    [config.jobId, config.jobLevel, config.minItemLevel, config.maxItemLevel],
  );
  const sourceOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const gear of jobGears) {
      if (gear.source) counts.set(gear.source, (counts.get(gear.source) ?? 0) + 1);
    }
    return [...counts.entries()]
      .filter(([source]) => source.toLowerCase().includes(sourceQuery.toLowerCase()))
      .sort((first, second) => second[1] - first[1]);
  }, [jobGears, sourceQuery]);

  const activeGears = useMemo(
    () =>
      jobGears.filter(
        (gear) =>
          !config.excludedSources.some((source) => gear.source?.startsWith(source)),
      ),
    [jobGears, config.excludedSources],
  );
  const forceSuggestions = activeGears
    .filter((gear) => gear.slot === (forcedSlot === "ring2" ? "ring" : forcedSlot))
    .filter((gear) => {
      const query = forcedSearch.trim().toLowerCase();
      return (
        !query ||
        gear.name.toLowerCase().includes(query) ||
        String(gear.id).includes(query)
      );
    });
  const excludeSuggestions = activeGears
    .filter((gear) => {
      const query = equipmentQuery.trim().toLowerCase();
      return (
        !query ||
        gear.name.toLowerCase().includes(query) ||
        String(gear.id).includes(query)
      );
    })
    .filter((gear) => !(config.excludedGearIds ?? []).includes(gear.id));
  const forcedGearEntries = Object.entries(config.forcedGear)
    .filter(([, id]) => id !== undefined)
    .map(([slot, id]) => ({
      slot: slot as GearSlot,
      id: id as number,
      gear: getGearById(id),
    }));
  const selectedForcedGear = forcedGearSelection === undefined
    ? undefined
    : jobGears.find((gear) => gear.id === forcedGearSelection);
  const excludedGears = (config.excludedGearIds ?? [])
    .map((id) => getGearById(id))
    .filter((gear): gear is Gear => gear !== undefined);
  const availableSlots = slotsForJob(config.jobId);
  function update<K extends keyof OptimizationConfig>(
    key: K,
    value: OptimizationConfig[K],
  ) {
    onEdited?.();
    setConfig((current) => ({ ...current, [key]: value }));
  }

  function forceGear(gear: Gear) {
    onEdited?.();
    setConfig((current) => ({
      ...current,
      forcedGear: { ...current.forcedGear, [forcedSlot]: gear.id },
      excludedGearIds: (current.excludedGearIds ?? []).filter((id) => id !== gear.id),
    }));
    setForcedSearch("");
  }

  function excludeGear(gear: Gear) {
    onEdited?.();
    setConfig((current) => {
      const forcedGear = { ...current.forcedGear };
      for (const [slot, id] of Object.entries(forcedGear)) {
        if (id === gear.id) delete forcedGear[slot as GearSlot];
      }
      return {
        ...current,
        forcedGear,
        excludedGearIds: [...(current.excludedGearIds ?? []), gear.id],
      };
    });
    setEquipmentQuery("");
  }

  return (
    <>
      {singleWorkbench ? <SingleEquipmentRestrictionsSection
      left={<section className="single-restriction-column single-restriction-left" aria-label="来源与排除装备">
          <div className="single-restriction-editor">
            <div className="single-restriction-editor-heading">
              <h3>来源限制</h3>
              <span>{config.excludedSources.length ? `${config.excludedSources.length} 项` : "可选"}</span>
            </div>
            <SearchableDropdown
              label="选择来源限制"
              placeholder="搜索装备来源"
              query={sourceQuery}
              onQueryChange={setSourceQuery}
              open={sourceDropdownOpen}
              onOpenChange={setSourceDropdownOpen}
            >
              {sourceOptions
                .filter(([source]) => !config.excludedSources.includes(source))
                .map(([source, count]) => (
                  <button
                    type="button"
                    role="option"
                    aria-selected="false"
                    data-option-kind="source"
                    key={source}
                    onClick={() => update("excludedSources", [...config.excludedSources, source])}
                  >
                    <span>{source}</span>
                    <small>{count} 件装备</small>
                  </button>
                ))}
              {!sourceOptions.some(([source]) => !config.excludedSources.includes(source)) && <p>没有匹配的来源。</p>}
            </SearchableDropdown>
            <div className="single-restriction-selected-list" aria-label="已排除来源">
              {config.excludedSources.map((source) => (
                <div className="single-restriction-row single-restriction-row--source" key={source}>
                  <span className="single-restriction-row-main">
                    <span className="single-restriction-row-name">{source}</span>
                    <span className="single-restriction-count">{jobGears.filter((gear) => gear.source?.startsWith(source)).length} 件</span>
                  </span>
                  <button type="button" aria-label={`恢复来源 ${source}`} onClick={() => update("excludedSources", config.excludedSources.filter((item) => item !== source))}><X size={14} /></button>
                </div>
              ))}
            </div>
          </div>

          <div className="single-restriction-editor">
            <div className="single-restriction-editor-heading">
              <h3>排除指定装备</h3>
              <span>{excludedGears.length ? `${excludedGears.length} 件` : "可选"}</span>
            </div>
            <SearchableDropdown
              label="选择排除装备"
              placeholder="按名称或编号搜索装备"
              query={equipmentQuery}
              onQueryChange={setEquipmentQuery}
              open={equipmentDropdownOpen}
              onOpenChange={setEquipmentDropdownOpen}
            >
              {excludeSuggestions.length > 0 ? <VirtualGearOptions
                items={excludeSuggestions}
                query={equipmentQuery}
                slotLabels={slotLabels}
                onSelect={(gear) => {
                  excludeGear(gear);
                  setEquipmentDropdownOpen(false);
                }}
              /> : <p>没有匹配装备。</p>}
            </SearchableDropdown>
            <div className="single-restriction-selected-list" aria-label="已排除装备">
              {excludedGears.map((gear) => (
                <div className="single-restriction-row single-restriction-row--excluded" key={gear.id}>
                  <span className="single-restriction-row-slot">{slotLabels[gear.slot]}</span>
                  <GearMark />
                  <span className="single-restriction-row-name">{gear.name}</span>
                  <span className="single-restriction-row-source">{gear.source ?? "上游未标注"}</span>
                  <button type="button" aria-label={`恢复装备 ${gear.name}`} onClick={() => update("excludedGearIds", (config.excludedGearIds ?? []).filter((id) => id !== gear.id))}><X size={14} /></button>
                </div>
              ))}
            </div>
          </div>
        </section>}
      right={<section className="single-restriction-column single-forced-gear" aria-label="强制使用装备">
          <div className="single-restriction-editor-heading">
            <h3>强制使用装备</h3>
            <span>{forcedGearEntries.length ? `${forcedGearEntries.length} 件` : "可选"}</span>
          </div>
          <div className={`picker-row ${styles.pickerRow}`}>
            <select
              aria-label="选择装备部位"
              value={forcedSlot}
              onChange={(event) => {
                setForcedSlot(event.target.value as GearSlot);
                setForcedSearch("");
                setForcedGearSelection(undefined);
                setForcedDropdownOpen(false);
              }}
            >
              {availableSlots.map((slot) => <option key={slot} value={slot}>{slotLabels[slot]}</option>)}
            </select>
            <SearchableDropdown
              className="single-forced-gear-search"
              label="选择强制装备"
              placeholder={`搜索${slotLabels[forcedSlot]}装备`}
              query={forcedSearch}
              onQueryChange={setForcedSearch}
              open={forcedDropdownOpen}
              onOpenChange={setForcedDropdownOpen}
              selectedLabel={selectedForcedGear?.name}
            >
              {forceSuggestions.length > 0 ? <VirtualGearOptions
                items={forceSuggestions}
                query={forcedSearch}
                selectedId={forcedGearSelection}
                slotLabels={slotLabels}
                onSelect={(gear) => {
                  setForcedGearSelection(gear.id);
                  setForcedDropdownOpen(false);
                }}
              /> : <p>没有匹配装备。</p>}
            </SearchableDropdown>
            <button
              type="button"
              className="single-restriction-add"
              disabled={!selectedForcedGear}
              onClick={() => {
                if (selectedForcedGear) forceGear(selectedForcedGear);
                setForcedGearSelection(undefined);
              }}
            >添加</button>
          </div>
          <div className="single-restriction-selected-list" aria-label="已强制使用装备">
            {forcedGearEntries.map(({ slot, id, gear }) => (
              <div className="single-restriction-row single-restriction-row--forced" key={slot}>
                <span className="single-restriction-row-slot">{slotLabels[slot]}</span>
                <GearMark />
                <span className="single-restriction-row-name">{gear?.name ?? `装备 ${id}`}</span>
                <button type="button" aria-label={`移除强制装备 ${gear?.name ?? id}`} onClick={() => {
                  onEdited?.();
                  setConfig((current) => {
                    const forcedGear = { ...current.forcedGear };
                    delete forcedGear[slot];
                    return { ...current, forcedGear };
                  });
                }}><X size={14} /></button>
              </div>
            ))}
          </div>
        </section>}
      /> : <details className="advanced-section">
        <summary>
          <span>来源与装备限制</span>
          <span className="advanced-summary">
            来源排除 {config.excludedSources.length} 项 · 强制 {forcedGearEntries.length} 件 · 排除 {excludedGears.length} 件
          </span>
        </summary>
      <details className={`restriction-details ${styles.restrictionDetails}`}>
        <summary>
          来源限制
          <span>{config.excludedSources.length} 项已排除</span>
        </summary>
        <input
          type="search"
          value={sourceQuery}
          placeholder="搜索装备来源"
          onChange={(event) => setSourceQuery(event.target.value)}
        />
        <div className={`source-options ${styles.sourceOptions}`}>
          {sourceOptions.map(([source, count]) => (
            <CheckControl
              key={source}
              checked={config.excludedSources.includes(source)}
              onChange={(checked) =>
                update(
                  "excludedSources",
                  checked
                    ? [...config.excludedSources, source]
                    : config.excludedSources.filter((item) => item !== source),
                )
              }
            >
              <span>{source}</span>
              <em>{count}</em>
            </CheckControl>
          ))}
          {!sourceOptions.length && <p className="muted">没有匹配的来源。</p>}
        </div>
      </details>

      <details className={`restriction-details ${styles.restrictionDetails}`}>
        <summary>
          装备限制
          <span>
            {forcedGearEntries.length} 件强制 · {excludedGears.length} 件排除
          </span>
        </summary>
        <div className={`restriction-block ${styles.restrictionBlock}`}>
          <strong>强制使用装备</strong>
          <div className={`picker-row ${styles.pickerRow}`}>
            <select
              aria-label="选择装备部位"
              value={forcedSlot}
              onChange={(event) => {
                setForcedSlot(event.target.value as GearSlot);
                setForcedSearch("");
              }}
            >
              {availableSlots.map((slot) => (
                <option key={slot} value={slot}>
                  {slotLabels[slot]}
                </option>
              ))}
            </select>
            <input
              type="search"
              value={forcedSearch}
              placeholder="按名称或编号搜索"
              onChange={(event) => setForcedSearch(event.target.value)}
            />
          </div>
          {forcedSearch && (
            <div className={`suggestions ${styles.suggestions}`}>
              {forceSuggestions.map((gear) => (
                <button type="button" key={gear.id} onClick={() => forceGear(gear)}>
                  <span>{gear.name}</span>
                  <small>品级 {gear.level} · 编号 {gear.id}</small>
                </button>
              ))}
              {!forceSuggestions.length && <p>没有匹配装备。</p>}
            </div>
          )}
          <div className={`restriction-tags ${styles.restrictionTags}`}>
            {forcedGearEntries.map(({ slot, id, gear }) => (
              <span className={`restriction-tag ${styles.restrictionTag}`} key={slot}>
                {slotLabels[slot]} · {gear?.name ?? "装备 " + id}
                <button
                  type="button"
                  aria-label={"移除强制装备 " + (gear?.name ?? id)}
                  onClick={() => {
                    onEdited?.();
                    setConfig((current) => {
                      const forcedGear = { ...current.forcedGear };
                      delete forcedGear[slot];
                      return { ...current, forcedGear };
                    });
                  }}
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        </div>
        <div className={`restriction-block ${styles.restrictionBlock}`}>
          <strong>排除具体装备</strong>
          <input
            type="search"
            value={equipmentQuery}
            placeholder="按名称或编号搜索"
            onChange={(event) => setEquipmentQuery(event.target.value)}
          />
          {equipmentQuery && (
            <div className={`suggestions ${styles.suggestions}`}>
              {excludeSuggestions.map((gear) => (
                <button type="button" key={gear.id} onClick={() => excludeGear(gear)}>
                  <span>{gear.name}</span>
                  <small>{slotLabels[gear.slot]} · 品级 {gear.level}</small>
                </button>
              ))}
              {!excludeSuggestions.length && <p>没有匹配装备。</p>}
            </div>
          )}
          <div className={`restriction-tags ${styles.restrictionTags}`}>
            {excludedGears.map((gear) => (
              <span className={`restriction-tag ${styles.restrictionTag}`} key={gear.id}>
                {gear.name}
                <button
                  type="button"
                  aria-label={"恢复装备 " + gear.name}
                  onClick={() =>
                    update(
                      "excludedGearIds",
                      (config.excludedGearIds ?? []).filter((id) => id !== gear.id),
                    )
                  }
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        </div>
      </details>
      </details>}
    </>
  );
}
