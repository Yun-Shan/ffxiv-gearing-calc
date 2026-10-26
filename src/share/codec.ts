import { gameData } from "../domain/data.ts";
import { slotsForJob } from "../domain/gear-options.ts";
import type { GearSlot } from "../domain/types.ts";
import {
  bit,
  check,
  elapsedTicks,
  equal,
  mixedRead,
  mixedWrite,
  q7,
  q7Units,
  readQ7,
  Reader,
  writeQ7,
  Writer,
  uint,
} from "./binary.ts";
import { configsRead, configsWrite, prepareConfigs } from "./config-codec.ts";
import { PatternPool, patternRead, patternWrite } from "./patterns.ts";
import { versionFromId, versionId } from "./tables.ts";
import {
  MAX_LINK_CHARS,
  MAX_RAW_BYTES,
  SHARED_SLOTS,
  type ShareConfig,
  type ShareDocument,
  type ShareIdentity,
  type ShareRow,
} from "./types.ts";
import { buildShareUrl } from "./url.ts";
import { validateConfigs } from "./validation.ts";

function itemBase(d: ShareDocument): number {
  const ids = d.identities.map((g) => g.itemId);
  d.configs.forEach((c) => {
    if (c.foodId) ids.push(c.foodId);
    ids.push(...(c.excludedGearIds ?? []));
    for (const f of Object.values(c.forcedGear ?? {}))
      if (f !== undefined) ids.push(typeof f === "number" ? f : f.id);
  });
  d.rows.forEach((row) => ids.push(row.foodId));
  check(ids.length > 0);
  let base = Infinity;
  for (const id of ids) {
    uint(id);
    check(id > 0);
    base = Math.min(base, id);
  }
  return base;
}
function canonical(input: ShareDocument): ShareDocument {
  const d = structuredClone(input),
    order: number[] = [],
    seen = new Set<number>();
  for (const row of d.rows)
    for (const choice of row.gear) {
      check(d.identities[choice.identity] !== undefined, "装备引用越界");
      if (!seen.has(choice.identity)) {
        seen.add(choice.identity);
        order.push(choice.identity);
      }
    }
  order.sort((a, b) => d.identities[a].itemId - d.identities[b].itemId);
  const identities: ShareIdentity[] = [],
    remap = new Map<number, number>();
  for (const old of order) {
    const value = d.identities[old];
    let index = identities.findIndex((v) => equal(value, v));
    if (index < 0) {
      index = identities.length;
      identities.push(value);
    }
    remap.set(old, index);
  }
  for (const row of d.rows)
    for (const choice of row.gear)
      choice.identity = remap.get(choice.identity)!;
  d.identities = identities;
  d.commonSlots = SHARED_SLOTS.filter((slot) => d.commonSlots.includes(slot));
  return d;
}
function validateDocument(d: ShareDocument): void {
  validateConfigs(d);
  check(d.rows.length === d.configs.length);
  check(
    d.identities.length > 0 &&
      d.identities.length <=
        d.configs.reduce((n, c) => n + slotsForJob(c.jobId).length, 0),
  );
  d.identities.forEach((identity) =>
    check(gameData.getGearById(identity.itemId), `未知装备 ${identity.itemId}`),
  );
  d.rows.forEach((row, i) => {
    const slots = slotsForJob(d.configs[i].jobId);
    check(
      row.gear.length === slots.length &&
        new Set(row.gear.map((c) => c.slot)).size === slots.length &&
        slots.every((slot) => row.gear.some((c) => c.slot === slot)),
      "装备槽位不完整",
    );
    check(
      gameData.foods.some((f) => f.id === row.foodId),
      `未知食物 ${row.foodId}`,
    );
    for (const cell of row.gear)
      check(d.identities[cell.identity] !== undefined, "装备引用越界");
  });
  if (d.mode === "joint")
    check(
      d.baselines.length === d.configs.length &&
        d.baselines.every((v) => q7Units(v) > 0) &&
        d.jointValue !== undefined,
      "联合概览不完整",
    );
}
function assignmentsWrite(w: Writer, refs: number[], range: number): void {
  const candidates: Writer[] = [],
    dense = new Writer();
  dense.byte(0);
  refs.forEach((ref) => dense.u(ref));
  candidates.push(dense);
  for (const defaultRef of new Set([0, ...refs])) {
    const x = new Writer();
    x.byte(1);
    x.u(defaultRef);
    const diffs = refs.flatMap((ref, index) =>
      ref === defaultRef ? [] : [{ ref, index }],
    );
    x.u(diffs.length);
    let last = -1;
    for (const { ref, index } of diffs) {
      x.u(index - last - 1);
      x.u(ref);
      last = index;
    }
    candidates.push(x);
  }
  const packed = new Writer();
  packed.byte(2);
  mixedWrite(
    packed,
    refs,
    refs.map(() => range),
  );
  candidates.push(packed);
  candidates.sort((a, b) => a.bytes.length - b.bytes.length);
  w.merge(candidates[0]);
}
function assignmentsRead(r: Reader, count: number, range: number): number[] {
  const kind = r.byte();
  let refs: number[];
  if (kind === 0) refs = Array.from({ length: count }, () => r.u());
  else if (kind === 2) refs = mixedRead(r, Array(count).fill(range));
  else {
    check(kind === 1, "引用列模式无效");
    const defaultRef = r.u();
    check(defaultRef < range);
    refs = Array(count).fill(defaultRef);
    let position = -1;
    for (let n = r.count(count); n; n--) {
      position += r.u() + 1;
      check(position < count, "稀疏引用越界");
      refs[position] = r.u();
    }
  }
  check(
    refs.every((ref) => ref < range),
    "参数引用越界",
  );
  return refs;
}
function selectionPlan(
  configs: readonly ShareConfig[],
  commonSlots: readonly GearSlot[],
  identities: readonly ShareIdentity[],
) {
  const groups = new Map<GearSlot, number[]>();
  identities.forEach((v, i) => {
    const raw = gameData.getGearById(v.itemId);
    check(raw, `未知装备 ${v.itemId}`);
    const group = groups.get(raw.slot) ?? [];
    group.push(i);
    groups.set(raw.slot, group);
  });
  const cells: { job: number; slot: GearSlot; refs: number[] }[] = [];
  configs.forEach((config, job) => {
    for (const slot of slotsForJob(config.jobId)) {
      if (job && commonSlots.includes(slot)) continue;
      const refs = groups.get(slot === "ring2" ? "ring" : slot);
      check(refs?.length, `缺少部位 ${slot}`);
      cells.push({ job, slot, refs });
    }
  });
  return cells;
}
function foodPlan(d: Pick<ShareDocument, "configs" | "foodStrategy" | "mode">) {
  const fixed = d.configs.map((c) => c.foodId),
    shared = d.mode === "joint" && d.foodStrategy === "shared";
  const known = shared ? fixed.find((id) => id > 0) : undefined;
  return {
    fixed,
    shared,
    known,
    count: shared
      ? known === undefined
        ? 1
        : 0
      : fixed.filter((id) => id === 0).length,
  };
}
function selectionsWrite(w: Writer, d: ShareDocument, base: number): void {
  const cells = selectionPlan(d.configs, d.commonSlots, d.identities);
  const maps = d.rows.map(
    (row) => new Map(row.gear.map((c) => [c.slot, c.identity])),
  );
  for (let i = 1; i < maps.length; i++)
    for (const slot of d.commonSlots)
      check(maps[i].get(slot) === maps[0].get(slot), "共享完整身份不一致");
  mixedWrite(
    w,
    cells.map((c) => {
      const index = c.refs.indexOf(maps[c.job].get(c.slot)!);
      check(index >= 0);
      return index;
    }),
    cells.map((c) => c.refs.length),
  );
  const plan = foodPlan(d),
    ids = d.rows.map((row) => row.foodId);
  plan.fixed.forEach((id, i) => check(!id || id === ids[i], "固定食物不匹配"));
  if (plan.shared)
    check(
      ids.every((id) => id === ids[0]),
      "共享食物不一致",
    );
  const saved = plan.shared
    ? plan.count
      ? [ids[0]]
      : []
    : ids.filter((_, i) => plan.fixed[i] === 0);
  saved.forEach((id) => w.u(id - base));
}
function selectionsRead(
  r: Reader,
  d: Pick<
    ShareDocument,
    "configs" | "commonSlots" | "identities" | "foodStrategy" | "mode"
  >,
  base: number,
): ShareRow[] {
  const cells = selectionPlan(d.configs, d.commonSlots, d.identities),
    values = mixedRead(
      r,
      cells.map((c) => c.refs.length),
    );
  const maps = d.configs.map(() => new Map<GearSlot, number>());
  cells.forEach((cell, i) =>
    maps[cell.job].set(cell.slot, cell.refs[values[i]]),
  );
  for (let i = 1; i < maps.length; i++)
    for (const slot of d.commonSlots) maps[i].set(slot, maps[0].get(slot)!);
  const plan = foodPlan(d),
    saved = Array.from({ length: plan.count }, () => {
      const id = base + r.u();
      uint(id);
      return id;
    });
  let cursor = 0;
  const foods = plan.shared
    ? d.configs.map(() => plan.known ?? saved[0])
    : plan.fixed.map((id) => id || saved[cursor++]);
  return d.configs.map((config, i) => ({
    gear: slotsForJob(config.jobId).map((slot) => ({
      slot,
      identity: maps[i].get(slot)!,
    })),
    foodId: foods[i],
  }));
}
export function encodeShareBinary(input: ShareDocument): Uint8Array {
  validateConfigs(input);
  const d = canonical(input);
  validateDocument(d);
  const base = itemBase(d),
    w = new Writer(),
    pool = new PatternPool();
  const refs = d.identities.map((identity) => pool.add(identity.pattern)),
    configs = prepareConfigs(d.configs, pool),
    ctx = { pool, itemBase: base };
  w.byte(d.mode === "joint" ? 0x41 : 0x01);
  w.u(versionId(d.dataVersion));
  w.u(elapsedTicks(d.elapsedMs));
  w.u(base);
  w.u(pool.values.length - 1);
  pool.values.slice(1).forEach((pattern) => patternWrite(w, pattern));
  w.u(d.identities.length);
  let previous = base;
  d.identities.forEach((identity) => {
    w.u(identity.itemId - previous);
    previous = identity.itemId;
  });
  assignmentsWrite(w, refs, pool.values.length);
  configsWrite(w, configs, ctx);
  if (d.mode === "joint")
    w.u(
      Number(d.foodStrategy === "independent") +
        d.commonSlots.reduce(
          (mask, slot) => mask + 2 ** (SHARED_SLOTS.indexOf(slot) + 1),
          0,
        ),
    );
  selectionsWrite(w, d, base);
  if (d.mode === "joint") {
    d.baselines.forEach((value) => writeQ7(w, value));
    const equalCount = q7(d.jointValue!) === d.configs.length;
    w.flag(equalCount);
    if (!equalCount) writeQ7(w, d.jointValue!);
  }
  return w.finish();
}
export function decodeShareBinary(bytes: Uint8Array): ShareDocument {
  const r = new Reader(bytes),
    control = r.byte();
  check(control === 1 || control === 65, "不支持的分享格式");
  const mode: ShareDocument["mode"] = control === 65 ? "joint" : "single";
  const dataVersion = versionFromId(r.u()),
    ticks = r.u();
  uint(ticks * 100);
  const base = r.u();
  check(base > 0);
  const pool = new PatternPool(),
    patternCount = r.count(4095);
  check(patternCount <= r.remaining);
  for (let i = 0; i < patternCount; i++) pool.values.push(patternRead(r));
  const identityCount = r.count(Object.keys(gameData.jobs).length * 12);
  check(identityCount > 0 && identityCount <= r.remaining);
  const ids: number[] = [];
  let id = base;
  for (let i = 0; i < identityCount; i++) {
    id += r.u();
    uint(id);
    check(gameData.getGearById(id), `未知装备 ${id}`);
    ids.push(id);
  }
  const refs = assignmentsRead(r, identityCount, pool.values.length),
    identities = ids.map((itemId, i) => ({
      itemId,
      pattern: structuredClone(pool.get(refs[i])),
    }));
  const configs = configsRead(r, { itemBase: base, pool });
  let commonSlots: GearSlot[] = [],
    foodStrategy: ShareDocument["foodStrategy"] = "independent";
  if (mode === "joint") {
    const mask = r.u();
    check(mask < 2048, "共享位图越界");
    foodStrategy = mask % 2 ? "independent" : "shared";
    commonSlots = SHARED_SLOTS.filter((_, i) => bit(mask, i + 1));
  }
  const partial = { mode, configs, commonSlots, foodStrategy, identities };
  validateConfigs(partial);
  const rows = selectionsRead(r, partial, base);
  const baselines: number[] = [];
  let jointValue: number | undefined;
  if (mode === "joint") {
    configs.forEach(() => {
      const score = readQ7(r);
      check(score > 0, "基线必须大于零");
      baselines.push(score);
    });
    jointValue = r.flag() ? configs.length : readQ7(r);
  }
  r.finish();
  const d: ShareDocument = {
    ...partial,
    rows,
    dataVersion,
    elapsedMs: ticks * 100,
    baselines,
    ...(jointValue === undefined ? {} : { jointValue }),
  };
  validateDocument(d);
  return d;
}

export function toBase64url(bytes: Uint8Array): string {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}
export function fromBase64url(value: string): Uint8Array {
  check(value.length > 0 && value.length <= MAX_LINK_CHARS, "超出分享容量限制");
  check(
    /^[A-Za-z0-9_-]+$/.test(value) && value.length % 4 !== 1,
    "Base64url 无效",
  );
  const text = atob(value.replaceAll("-", "+").replaceAll("_", "/"));
  check(text.length <= MAX_RAW_BYTES, "超出分享容量限制");
  const bytes = Uint8Array.from(text, (char) => char.charCodeAt(0));
  check(toBase64url(bytes) === value, "Base64url 尾位非规范");
  return bytes;
}
export function shareUrl(document: ShareDocument, href: string): string {
  return buildShareUrl(toBase64url(encodeShareBinary(document)), href);
}
export function documentFromToken(token: string): ShareDocument {
  try {
    return decodeShareBinary(fromBase64url(token));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("无效的分享链接"))
      throw error;
    throw new Error("无效的分享链接", { cause: error });
  }
}
