import { LabeledSelect } from "@/ui/components/form-controls/labeled-select/LabeledSelect";
import { TextInput } from "@/ui/components/form-controls/text-input/TextInput";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  defaultDataVersion,
  foods,
  gears,
  jobIds,
  jobSchemas,
  type JobId,
  type MeldedGear,
} from "@/domain";
import { CoreMetricBar } from "@/ui/components/results/core-metric-bar/CoreMetricBar";
import { Breadcrumbs } from "@/ui/components/breadcrumbs/Breadcrumbs";
import { GearTable } from "@/ui/components/results/gear-table/GearTable";
import { useFeedback } from "@/ui/components/feedback/FeedbackProvider";
import {
  listSearchHistory,
  type SearchHistoryRecord,
} from "@/ui/services/search-history";
import { parseReferenceGearset } from "@/ui/services/reference-gearset-share";
import { Link } from "@tanstack/react-router";
import { resolveImportedGearset } from "@/ui/services/fixed-gearset-import";
import {
  historyComparisonEntry,
  historyComparisonOptions,
} from "@/ui/features/gear-comparison/history-entry";
import {
  appendComparisonEntry,
  approveComparisonJobChange,
  buildComparisonGearTableRows,
  buildComparisonMetricEntries,
  comparisonEntryValidationError,
  comparisonPlanLabel,
  MAX_COMPARISON_ENTRIES,
  removeComparisonEntry,
} from "@/ui/features/gear-comparison/comparison-model";
import type {
  ComparisonEntry,
  ResolveImportedGearset,
} from "@/ui/features/gear-comparison/types";
import { createComparisonEntryId } from "@/ui/features/gear-comparison/types";
import styles from "./GearComparisonPage.module.scss";

const previewSlots = [
  "weapon",
  "offhand",
  "head",
  "body",
  "hands",
  "legs",
  "feet",
  "earrings",
  "necklace",
  "bracelet",
  "ring",
  "ring2",
] as const;

function createCapacityPreviewEntries(): ComparisonEntry[] {
  const plans = Array.from({ length: 4 }, (_, index) => index);
  const choices = new Map<string, MeldedGear[]>();
  for (const slot of previewSlots) {
    const sourceSlot = slot === "ring2" ? "ring" : slot;
    const candidates = gears
      .filter((gear) => gear.jobs.includes("PLD") && gear.slot === sourceSlot)
      .toSorted((left, right) => left.id - right.id)
      .filter(
        (gear, index, all) =>
          all.findIndex((candidate) => candidate.id === gear.id) === index,
      )
      .slice(0, 4);
    if (candidates.length !== 4) continue;
    choices.set(
      slot,
      candidates.map((gear) => ({
        ...gear,
        slot,
        melds: [],
        finalStats: gear.stats,
      })),
    );
  }
  return plans.map((index) => ({
    entryId: `capacity-preview-${index}`,
    snapshot: {
      jobId: "PLD",
      calculationLevel: 100,
      gear: [...choices.values()].map((slotChoices) => slotChoices[index]!),
      food: { ...foods[index]!, actualStats: {}, utilization: 0 },
      // Preview totals and metrics are deliberately synthetic. This is only a
      // layout stress fixture and is never produced outside the DEV query gate.
      stats: {},
      effects: {
        crtChance: 0.15,
        crtDamage: 1.4,
        detDamage: 1.1,
        dhtChance: 0.05,
        tenDamage: 1.0,
        tenMitigation: 0.01,
        damage: 100 + index * 10,
        gcd: 2.5 - index * 0.01,
        hp: 1000,
        mp: 1000,
      },
      damagePerPotency: 100 + index * 10,
      damagePerSecond: 800 + index * 100,
    },
    dataVersion: defaultDataVersion,
    source: { kind: "import", url: "dev-preview:comparison-capacity" },
  }));
}

export function GearComparisonPage({
  resolveImport = resolveImportedGearset,
}: {
  resolveImport?: ResolveImportedGearset;
}) {
  const { confirm, notify } = useFeedback();
  const capacityPreview =
    import.meta.env.DEV &&
    new URLSearchParams(window.location.search).get("ui-preview") ===
      "comparison-capacity";
  const [selectedJob, setSelectedJob] = useState<JobId | undefined>(() =>
    capacityPreview ? "PLD" : undefined,
  );
  const [entries, setEntries] = useState<ComparisonEntry[]>(() =>
    capacityPreview ? createCapacityPreviewEntries() : [],
  );
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const notifyRef = useRef(notify);
  notifyRef.current = notify;
  const [history, setHistory] = useState<SearchHistoryRecord[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [selectedHistoryId, setSelectedHistoryId] = useState("");
  const [source, setSource] = useState<"history" | "import">("history");
  const [importUrl, setImportUrl] = useState("");
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    let active = true;
    listSearchHistory()
      .then((records) => {
        if (active) setHistory(records);
      })
      .catch((error: unknown) => {
        if (active)
          notifyRef.current(
            error instanceof Error ? error.message : "无法读取历史记录。",
            "warning",
          );
      })
      .finally(() => {
        if (active) setHistoryLoaded(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const options = useMemo(
    () => (selectedJob ? historyComparisonOptions(history, selectedJob) : []),
    [history, selectedJob],
  );
  const selectedHistory = options.find(
    (option) => option.historyId === selectedHistoryId,
  );
  const metricEntries = useMemo(
    () => buildComparisonMetricEntries(entries),
    [entries],
  );
  const gearRows = useMemo(
    () => buildComparisonGearTableRows(entries),
    [entries],
  );
  const showTenacity = selectedJob
    ? jobSchemas[selectedJob].role === "tank"
    : false;

  function commitEntries(
    update: (current: readonly ComparisonEntry[]) => ComparisonEntry[],
  ) {
    const next = update(entriesRef.current);
    entriesRef.current = next;
    setEntries(next);
  }

  async function changeJob(nextJob: JobId | undefined) {
    if (nextJob === selectedJob) return;
    const approved = await approveComparisonJobChange(entriesRef.current, () =>
      confirm({
        title: "切换比较职业？",
        description: "切换职业会清空当前已添加的全部方案。",
      }),
    );
    if (!approved) return;
    commitEntries(() => []);
    setSelectedHistoryId("");
    setSelectedJob(nextJob);
  }

  function addEntry(entry: ComparisonEntry) {
    if (!selectedJob) return;
    try {
      commitEntries((current) =>
        appendComparisonEntry(current, entry, selectedJob),
      );
      notify("方案已加入对比。", "success");
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "无法加入该方案。",
        "warning",
      );
    }
  }

  function addHistoryEntry() {
    if (!selectedJob || !selectedHistory) {
      notify("请选择一条当前职业的已完成历史结果。", "warning");
      return;
    }
    try {
      addEntry(historyComparisonEntry(selectedHistory.record, selectedJob));
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "无法读取该历史结果。",
        "warning",
      );
    }
  }

  async function importGearset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedJob) return;
    const url = importUrl.trim();
    if (!url) {
      notify("请粘贴配装器分享链接。", "warning");
      return;
    }
    setImporting(true);
    try {
      const parsed = parseReferenceGearset(url);
      if (parsed.job !== selectedJob) {
        notify(
          `职业不匹配：当前比较 ${jobSchemas[selectedJob].name}，链接内容为 ${jobSchemas[parsed.job].name}。`,
          "warning",
        );
        return;
      }
      if (parsed.foodId === undefined) {
        notify(
          "链接没有包含当前数据目录可识别的食物；请使用包含 Food 的完整配装分享链接。",
          "warning",
        );
        return;
      }
      const resolved = await resolveImport(url);
      const entry: ComparisonEntry = {
        entryId: createComparisonEntryId(),
        snapshot: resolved.snapshot,
        dataVersion: resolved.dataVersion,
        source: { kind: "import", url },
      };
      const validationError = comparisonEntryValidationError(
        entry,
        selectedJob,
      );
      if (validationError) {
        notify(validationError, "warning");
        return;
      }
      addEntry(entry);
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "无法解析该配装链接。",
        "error",
      );
    } finally {
      setImporting(false);
    }
  }

  function removeEntry(index: number) {
    commitEntries((current) => removeComparisonEntry(current, index));
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <Breadcrumbs items={["实验室", "装备对比"]} />
          <h1>同职业配装对比</h1>
        </div>
        <Link to="/lab" search={{}}>返回实验室</Link>
      </header>

      {capacityPreview && (
        <p className={styles.previewWarning} role="status">
          开发版容量布局预览：装备来自当前游戏数据目录；属性与伤害指标为专用
          mock，不是有效计算结果，也不会用于正式产品数据。
        </p>
      )}

      <section className={styles.controls} aria-label="选择比较职业与方案来源">
        <LabeledSelect
          label="比较职业"
          value={selectedJob ?? ""}
          disabled={importing}
          options={[
            { value: "", label: "选择职业" },
            ...jobIds.map((jobId) => ({
              value: jobId,
              label: jobSchemas[jobId].name,
            })),
          ]}
          onChange={(value) => {
            void changeJob(value ? (value as JobId) : undefined);
          }}
        />
        <div
          className={styles.sourceTabs}
          role="group"
          aria-label="添加方案来源"
        >
          <button
            type="button"
            aria-pressed={source === "history"}
            disabled={importing}
            onClick={() => setSource("history")}
          >
            历史记录
          </button>
          <button
            type="button"
            aria-pressed={source === "import"}
            disabled={importing}
            onClick={() => setSource("import")}
          >
            导入分享链接
          </button>
        </div>
        {source === "history" ? (
          <div className={styles.sourceForm}>
            <LabeledSelect
              label="已完成的同职业结果"
              value={selectedHistoryId}
              disabled={!selectedJob || !historyLoaded || options.length === 0}
              options={[
                {
                  value: "",
                  label: !selectedJob
                    ? "请先选择职业"
                    : !historyLoaded
                      ? "正在读取历史记录"
                      : options.length
                        ? "选择历史结果"
                        : "没有可用的已完成结果",
                },
                ...options.map((option) => ({
                  value: option.historyId,
                  label: option.label,
                })),
              ]}
              onChange={setSelectedHistoryId}
            />
            <button
              className={styles.addButton}
              type="button"
              disabled={
                !selectedJob || entries.length >= MAX_COMPARISON_ENTRIES
              }
              onClick={addHistoryEntry}
            >
              添加方案
            </button>
          </div>
        ) : (
          <form
            className={styles.sourceForm}
            onSubmit={(event) => {
              void importGearset(event);
            }}
          >
            <TextInput
              label="配装器分享链接"
              type="url"
              value={importUrl}
              onValueChange={setImportUrl}
              placeholder="https://asvel.github.io/ffxiv-gearing/?…"
              disabled={!selectedJob || importing}
            />
            <button
              className={styles.addButton}
              type="submit"
              disabled={
                !selectedJob ||
                importing ||
                entries.length >= MAX_COMPARISON_ENTRIES
              }
            >
              {importing ? "正在导入" : "导入并添加"}
            </button>
          </form>
        )}
        {entries.length >= MAX_COMPARISON_ENTRIES && (
          <p className={styles.limitMessage}>
            最多同时比较 {MAX_COMPARISON_ENTRIES} 套方案。
          </p>
        )}
      </section>

      {entries.length > 0 ? (
        <>
          <section className={styles.plans} aria-label="当前比较方案">
            {entries.map((entry, index) => (
              <article className={styles.plan} key={entry.entryId}>
                <div>
                  <span className={styles.planLabel}>
                    {comparisonPlanLabel(index)}
                  </span>
                  <strong>
                    {entry.source.kind === "history" ? "历史结果" : "导入配装"}
                  </strong>
                  <small>
                    {jobSchemas[entry.snapshot.jobId].name} · Lv.
                    {entry.snapshot.calculationLevel} · 数据 {entry.dataVersion}
                  </small>
                </div>
                <button
                  type="button"
                  aria-label={`删除方案 ${comparisonPlanLabel(index)}`}
                  onClick={() => removeEntry(index)}
                >
                  删除
                </button>
              </article>
            ))}
          </section>
          <CoreMetricBar
            entries={metricEntries}
            showTenacity={showTenacity}
            compact
          />
          <GearTable rows={gearRows} jobId={selectedJob!} />
        </>
      ) : (
        <section className={styles.empty} aria-live="polite">
          <strong>{selectedJob ? "尚未添加比较方案" : "先选择一个职业"}</strong>
          <span>
            {selectedJob
              ? "从该职业的已完成历史记录添加方案，第一套方案将成为比较基准。"
              : "Comparison 只比较同一职业的配装结果。"}
          </span>
        </section>
      )}
    </main>
  );
}
