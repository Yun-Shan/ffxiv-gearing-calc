import { readFile, writeFile, rename, unlink } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { encodeGearCatalog } from "../../src/data/binary/sections/gear-catalog/write.ts";
import { dutyIdentityKey as dutyKey } from "../sync-level-duties.mjs";

export const defaultShareIdentityPath = resolve(
  import.meta.dirname,
  "share-identities.json",
);

const projectRoot = resolve(import.meta.dirname, "../..");
const emptyLedger = () => ({ sources: [], duties: [], dataVersions: [] });
const compareText = (left, right) => (left < right ? -1 : left > right ? 1 : 0);
const sourcePrefix = (source) => source.split("/", 1)[0];

/** Only committed IDs are permanent; repeated generation rebuilds the pending batch. */
export function committedShareLedger(identityPath = defaultShareIdentityPath) {
  const path = relative(projectRoot, identityPath).replaceAll("\\", "/");
  const git = (args) =>
    execFileSync("git", ["--no-optional-locks", "-C", projectRoot, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  try {
    return JSON.parse(git(["show", `HEAD:${path}`]));
  } catch (error) {
    if (git(["ls-tree", "--name-only", "HEAD", "--", path]).trim()) throw error;
    return emptyLedger();
  }
}

/** Committed identity arrays are append-only; original-table indexes are rebuilt. */
export function buildShareTables(previous, sources, duties, version, { sourceMaxItemIds, dutyMaxIds } = {}) {
  const validateUnique = (values, key) => {
    if (
      !Array.isArray(values) ||
      new Set(values.map(key)).size !== values.length
    )
      throw new Error("分享身份账本包含重复项或结构无效");
  };
  validateUnique(previous.sources, (value) => value);
  validateUnique(previous.duties, dutyKey);
  validateUnique(previous.dataVersions, (value) => value);
  validateUnique(sources, (value) => value);
  validateUnique(duties, dutyKey);
  if (
    previous.sources.some((value) => typeof value !== "string" || !value) ||
    previous.dataVersions.some(
      (value) => typeof value !== "string" || !value,
    ) ||
    previous.duties.some(
      (duty) =>
        !duty.name ||
        !["itemLevel", "jobLevel"].includes(duty.target.kind) ||
        !Number.isSafeInteger(duty.target.value),
    )
  )
    throw new Error("分享身份账本内容无效");
  const append = (old, current, key, maximumIds, group = () => "") => {
    const seen = new Set(old.map(key)),
      next = structuredClone(old);
    const added = current.filter((value) => !seen.has(key(value)));
    for (const value of added) {
      const id = maximumIds?.get(key(value));
      if (!Number.isSafeInteger(id) || id < 0)
        throw new Error(`新增分享身份缺少最高原始 ID：${key(value)}`);
    }
    added.sort(
      (left, right) =>
        compareText(group(left), group(right)) ||
        maximumIds.get(key(right)) - maximumIds.get(key(left)) ||
        compareText(key(left), key(right)),
    );
    for (const value of added) next.push(structuredClone(value));
    return next;
  };
  const ledger = {
    sources: append(previous.sources, sources, (value) => value, sourceMaxItemIds, sourcePrefix),
    duties: append(previous.duties, duties, dutyKey, dutyMaxIds),
    dataVersions: previous.dataVersions.includes(version) ? [...previous.dataVersions] : [...previous.dataVersions, version],
  };
  const indexes = (identities, current, key) => {
    const map = new Map(current.map((value, i) => [key(value), i]));
    return identities.map((value) => map.get(key(value)) ?? current.length);
  };
  return {
    ledger,
    tables: {
      sourceRefs: indexes(ledger.sources, sources, (value) => value),
      dutyRefs: indexes(ledger.duties, duties, dutyKey),
      dataVersions: ledger.dataVersions,
    },
  };
}

export async function prepareShareTables(
  payload,
  identityPath = defaultShareIdentityPath,
  dutyMaxIds,
) {
  const readLedgerText = () => readFile(identityPath, "utf8").catch((error) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  const previousText = await readLedgerText();
  const previous = committedShareLedger(identityPath);
  const catalog = encodeGearCatalog(payload.gears, payload.jobSchemas);
  const sources = catalog.sources;
  const sourceMaxItemIds = new Map();
  for (const gear of catalog.gears) if (gear.source !== undefined) {
    sourceMaxItemIds.set(gear.source, Math.max(sourceMaxItemIds.get(gear.source) ?? 0, gear.id));
  }
  const duties = payload.sync.groups.flatMap((group) => group.options);
  const { ledger, tables } = buildShareTables(
    previous,
    sources,
    duties,
    payload.version,
    { sourceMaxItemIds, dutyMaxIds },
  );
  return {
    payload: { ...payload, shareTables: tables },
    async persist() {
      const current = await readLedgerText();
      if (current !== previousText)
        throw new Error("分享身份账本在生成期间被修改");
      const temporaryPath = `${identityPath}.tmp-${randomUUID()}`;
      try {
        await writeFile(temporaryPath, JSON.stringify(ledger, null, 2) + "\n");
        await rename(temporaryPath, identityPath);
      } catch (error) {
        await unlink(temporaryPath).catch(() => {});
        throw error;
      }
    },
  };
}
