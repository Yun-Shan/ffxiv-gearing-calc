import { gameData } from "../domain/data.ts";
import { materiaForGrade } from "../domain/optimizer/candidates/materia-rules.ts";
import type {
  ForcedGearMap,
  ForcedGearValue,
  GearSlot,
  Stats,
} from "../domain/types.ts";
import { bit, check, equal, gcdCode, Reader, Writer, uint } from "./binary.ts";
import {
  allocationRead,
  allocationWrite,
  forcedSelection,
  normalizeMelds,
  PatternPool,
  patternForItem,
  resolveForcedSelection,
  resolvePattern,
} from "./patterns.ts";
import {
  dutyById,
  dutyId,
  jobFromNumber,
  jobNumber,
  readSource,
  writeSource,
} from "./tables.ts";
import { SLOT_CODES, type ShareConfig, type ShareSource } from "./types.ts";

const MODE_KEYS = [
  "objective",
  "gcdChoices",
  "speedMin",
  "speedMax",
  "sync",
  "syncDuty",
  "minTenacity",
  "toughnessMinPercent",
  "maximizeTenacity",
] as const;
type ModeBlock = Pick<ShareConfig, (typeof MODE_KEYS)[number]>;
interface WireForce {
  id: number;
  pattern?: number;
  customSelection?: number;
  customStats?: Stats;
}
type WireForces = Partial<Record<GearSlot, WireForce>>;
interface WireConfig {
  jobId: ShareConfig["jobId"];
  clanIndex: number;
  minItemLevel: number;
  maxItemLevel: number;
  modeBlock: ModeBlock;
  foodId: number;
  excludedSources?: ShareSource[];
  excludedGearIds?: number[];
  forcedGear?: WireForces;
}
const FIELDS = [
  "jobId",
  "clanIndex",
  "minItemLevel",
  "maxItemLevel",
  "modeBlock",
  "foodId",
  "excludedSources",
  "excludedGearIds",
  "forcedGear",
] as const;
export interface ConfigContext {
  itemBase: number;
  pool: PatternPool;
}

export function percentTenths(value: number): number {
  const ticks = Math.round(value * 10);
  check(
    Number.isFinite(value) &&
      value >= 0 &&
      value <= 100 &&
      !Object.is(value, -0) &&
      Object.is(ticks / 10, value),
    "减伤只允许十分位百分比",
  );
  return ticks;
}
function modeOf(config: ShareConfig): ModeBlock {
  return Object.fromEntries(
    MODE_KEYS.filter((key) => config[key] !== undefined).map((key) => [
      key,
      structuredClone(config[key]),
    ]),
  ) as ModeBlock;
}
export function modeWrite(w: Writer, value: ModeBlock, minLevel: number): void {
  const gcd =
    value.speedMin !== undefined || value.speedMax !== undefined
      ? 3
      : value.gcdChoices !== undefined
        ? value.gcdChoices.length === 1
          ? 1
          : 2
        : 0;
  const sync =
    value.syncDuty !== undefined
      ? 3
      : value.sync === undefined
        ? 0
        : value.sync.kind === "jobLevel"
          ? 1
          : 2;
  const ten = value.maximizeTenacity
    ? 3
    : value.minTenacity !== undefined
      ? 1
      : value.toughnessMinPercent !== undefined
        ? 2
        : 0;
  w.byte(Number(value.objective === "dps") + 2 * gcd + 8 * sync + 32 * ten);
  if (gcd === 1) w.byte(gcdCode(value.gcdChoices![0]));
  if (gcd === 2) {
    w.u(value.gcdChoices!.length);
    value.gcdChoices!.forEach((gcd) => w.byte(gcdCode(gcd)));
  }
  if (gcd === 3) {
    w.byte(
      Number(value.speedMin !== undefined) +
        2 * Number(value.speedMax !== undefined),
    );
    if (value.speedMin !== undefined) w.u(value.speedMin);
    if (value.speedMax !== undefined) w.u(value.speedMax);
  }
  if (sync === 1) w.u(value.sync!.value);
  if (sync === 2) w.z(value.sync!.value - minLevel);
  if (sync === 3) w.u(dutyId(value.syncDuty!, value.sync));
  if (ten === 1) w.u(value.minTenacity!);
  if (ten === 2) w.u(percentTenths(value.toughnessMinPercent!));
}
function readGcd(r: Reader): number {
  const x = r.byte();
  check(x < 250, "GCD 编码无效");
  return (250 - x) / 100;
}
export function modeRead(r: Reader, minLevel: number): ModeBlock {
  const code = r.byte();
  check(code < 128, "条件保留位");
  const gcd = Math.floor(code / 2) % 4,
    sync = Math.floor(code / 8) % 4,
    ten = Math.floor(code / 32) % 4;
  const value: ModeBlock = {
    objective: code % 2 ? "dps" : "damage",
    maximizeTenacity: ten === 3,
  };
  if (gcd === 1) value.gcdChoices = [readGcd(r)];
  if (gcd === 2) {
    const count = r.count(250);
    check(count >= 2);
    value.gcdChoices = Array.from({ length: count }, () => readGcd(r));
  }
  if (gcd === 3) {
    const mask = r.byte();
    check(mask >= 1 && mask <= 3, "速度存在图无效");
    if (bit(mask, 0)) value.speedMin = r.u();
    if (bit(mask, 1)) value.speedMax = r.u();
  }
  if (sync === 1) value.sync = { kind: "jobLevel", value: r.u() };
  if (sync === 2) {
    const level = minLevel + r.z();
    uint(level);
    value.sync = { kind: "itemLevel", value: level };
  }
  if (sync === 3) {
    const duty = dutyById(r.u());
    value.sync = structuredClone(duty.target);
    value.syncDuty = duty.name;
  }
  if (ten === 1) value.minTenacity = r.u();
  if (ten === 2) {
    const ticks = r.u();
    check(ticks <= 1000);
    value.toughnessMinPercent = ticks / 10;
  }
  return value;
}

function customFamily(id: number): "choice" | "allocation" {
  const raw = gameData.getGearById(id);
  check(raw, `未知装备 ${id}`);
  check(
    (raw.customParameters !== undefined) !==
      (raw.resistanceWeaponAdjust !== undefined),
    "自定义参数族无效",
  );
  return raw.customParameters ? "choice" : "allocation";
}
function forceMode(force: WireForce | undefined): number {
  return force === undefined
    ? 0
    : force.pattern !== undefined
      ? 2
      : force.customSelection !== undefined || force.customStats !== undefined
        ? 3
        : 1;
}
function itemWrite(w: Writer, id: number, ctx: ConfigContext): void {
  w.u(id - ctx.itemBase);
}
function itemRead(r: Reader, ctx: ConfigContext): number {
  const id = ctx.itemBase + r.u();
  uint(id);
  return id;
}
function forceWrite(w: Writer, force: WireForce, ctx: ConfigContext): void {
  itemWrite(w, force.id, ctx);
  if (force.pattern !== undefined) w.u(force.pattern);
  else if (
    force.customSelection !== undefined ||
    force.customStats !== undefined
  ) {
    if (customFamily(force.id) === "choice") {
      check(force.customSelection !== undefined && force.customSelection < 192);
      w.byte(force.customSelection);
    } else {
      check(force.customStats !== undefined);
      allocationWrite(w, force.customStats);
    }
  }
}
function forceRead(r: Reader, mode: number, ctx: ConfigContext): WireForce {
  const force: WireForce = { id: itemRead(r, ctx) };
  if (mode === 2) {
    force.pattern = r.u();
    ctx.pool.get(force.pattern);
  }
  if (mode === 3) {
    if (customFamily(force.id) === "choice") {
      force.customSelection = r.byte();
      check(force.customSelection < 192);
    } else force.customStats = allocationRead(r);
  }
  return force;
}
function forcesWrite(
  w: Writer,
  value: WireForces,
  previous: WireForces | undefined,
  ctx: ConfigContext,
): void {
  const states = SLOT_CODES.map((slot) =>
    previous === undefined
      ? forceMode(value[slot])
      : equal(value[slot], previous[slot])
        ? 0
        : value[slot] === undefined
          ? 1
          : forceMode(value[slot]) + 1,
  );
  const bits = previous === undefined ? 2 : 3;
  const mask = states.reduce(
    (mask, state, i) => mask + state * 2 ** (bits * i),
    0,
  );
  check(previous !== undefined || mask > 0);
  w.u(mask);
  SLOT_CODES.forEach((slot, i) => {
    if (states[i] >= (previous === undefined ? 1 : 2))
      forceWrite(w, value[slot]!, ctx);
  });
}
function forcesRead(
  r: Reader,
  previous: WireForces | undefined,
  ctx: ConfigContext,
): WireForces {
  const mask = r.u(),
    bits = previous === undefined ? 2 : 3,
    radix = 2 ** bits;
  check(
    mask < 2 ** (bits * SLOT_CODES.length) &&
      (previous !== undefined || mask > 0),
    "强制装备模式图无效",
  );
  const value = structuredClone(previous ?? {});
  SLOT_CODES.forEach((slot, i) => {
    const state = Math.floor(mask / radix ** i) % radix;
    check(state <= (previous === undefined ? 3 : 4), "强制装备保留码");
    if (previous === undefined) {
      if (state) value[slot] = forceRead(r, state, ctx);
    } else if (state === 1) delete value[slot];
    else if (state >= 2) value[slot] = forceRead(r, state - 1, ctx);
  });
  return value;
}

export function listWrite<T>(
  w: Writer,
  values: readonly T[],
  previous: readonly T[] | undefined,
  write: (w: Writer, v: T) => void,
): void {
  w.u(values.length);
  if (previous === undefined) {
    values.forEach((v) => write(w, v));
    return;
  }
  const overlap = Math.min(previous.length, values.length),
    map = new Uint8Array(Math.ceil(overlap / 8));
  for (let i = 0; i < overlap; i++)
    if (!equal(values[i], previous[i])) map[Math.floor(i / 8)] |= 1 << (i % 8);
  w.append(map);
  values.forEach((v, i) => {
    if (i >= overlap || map[Math.floor(i / 8)] & (1 << (i % 8))) write(w, v);
  });
}
export function listRead<T>(
  r: Reader,
  previous: readonly T[] | undefined,
  read: (r: Reader) => T,
): T[] {
  const count = r.count();
  if (previous === undefined) {
    check(count <= r.remaining, "列表被截断");
    return Array.from({ length: count }, () => read(r));
  }
  const overlap = Math.min(count, previous.length),
    map = r.take(Math.ceil(overlap / 8));
  if (overlap % 8)
    check(map[map.length - 1] >> (overlap % 8) === 0, "位置图非零补齐");
  return Array.from({ length: count }, (_, i) =>
    i >= overlap || map[Math.floor(i / 8)] & (1 << (i % 8))
      ? read(r)
      : structuredClone(previous[i]),
  );
}

function wireConfig(config: ShareConfig, pool: PatternPool): WireConfig {
  const force: WireForces = {};
  for (const slot of SLOT_CODES) {
    const value = config.forcedGear?.[slot];
    if (value === undefined) continue;
    if (typeof value === "number") force[slot] = { id: value };
    else if ("melds" in value)
      force[slot] = {
        id: value.id,
        pattern: pool.add(
          patternForItem(value.id, normalizeMelds(value.melds, true)),
        ),
      };
    else {
      const selection = forcedSelection(value.id, value.customStats, config);
      force[slot] =
        selection === undefined
          ? { id: value.id, customStats: structuredClone(value.customStats) }
          : { id: value.id, customSelection: selection };
    }
  }
  return {
    jobId: config.jobId,
    clanIndex: config.clanIndex,
    minItemLevel: config.minItemLevel,
    maxItemLevel: config.maxItemLevel,
    modeBlock: modeOf(config),
    foodId: config.foodId,
    ...(config.excludedSources?.length
      ? { excludedSources: structuredClone(config.excludedSources) }
      : {}),
    ...(config.excludedGearIds?.length
      ? { excludedGearIds: [...config.excludedGearIds] }
      : {}),
    ...(Object.keys(force).length ? { forcedGear: force } : {}),
  };
}
function unpack(config: WireConfig, pool: PatternPool): ShareConfig {
  const { modeBlock, forcedGear, ...rest } = config;
  const forces: ForcedGearMap = {};
  for (const slot of SLOT_CODES) {
    const force = forcedGear?.[slot];
    if (!force) continue;
    let value: ForcedGearValue;
    if (force.pattern !== undefined) {
      const melds = resolvePattern(force.id, pool.get(force.pattern));
      value = {
        id: force.id,
        melds: melds.map((m, i) => {
          if (m === null) return null;
          check(m.grade > 0);
          return { ...materiaForGrade(m.stat, m.grade), slotIndex: i };
        }),
      };
    } else if (force.customSelection !== undefined)
      value = {
        id: force.id,
        customStats: resolveForcedSelection(
          force.id,
          force.customSelection,
          config,
        ),
      };
    else if (force.customStats !== undefined)
      value = { id: force.id, customStats: force.customStats };
    else value = force.id;
    forces[slot] = value;
  }
  return {
    excludedSources: [],
    excludedGearIds: [],
    ...rest,
    ...modeBlock,
    forcedGear: forces,
  };
}

function fieldWrite(
  w: Writer,
  index: number,
  value: WireConfig,
  previous: WireConfig | undefined,
  ctx: ConfigContext,
): void {
  switch (index) {
    case 0:
      w.u(jobNumber(value.jobId));
      break;
    case 1:
      w.u(value.clanIndex);
      break;
    case 2:
      w.u(value.minItemLevel);
      break;
    case 3:
      w.u(value.maxItemLevel - value.minItemLevel);
      break;
    case 4:
      modeWrite(w, value.modeBlock, value.minItemLevel);
      break;
    case 5:
      w.u(value.foodId === 0 ? 0 : value.foodId - ctx.itemBase + 1);
      break;
    case 6:
      listWrite(
        w,
        value.excludedSources!,
        previous?.excludedSources,
        writeSource,
      );
      break;
    case 7:
      listWrite(w, value.excludedGearIds!, previous?.excludedGearIds, (w, id) =>
        itemWrite(w, id, ctx),
      );
      break;
    case 8:
      forcesWrite(w, value.forcedGear!, previous?.forcedGear, ctx);
      break;
  }
}
function fieldRead(
  r: Reader,
  index: number,
  value: WireConfig,
  previous: WireConfig | undefined,
  ctx: ConfigContext,
): void {
  switch (index) {
    case 0:
      value.jobId = jobFromNumber(r.u());
      break;
    case 1:
      value.clanIndex = r.u();
      break;
    case 2:
      value.minItemLevel = r.u();
      break;
    case 3:
      value.maxItemLevel = value.minItemLevel + r.u();
      uint(value.maxItemLevel);
      break;
    case 4:
      value.modeBlock = modeRead(r, value.minItemLevel);
      break;
    case 5: {
      const code = r.u();
      value.foodId = code === 0 ? 0 : ctx.itemBase + code - 1;
      uint(value.foodId);
      break;
    }
    case 6:
      value.excludedSources = listRead(
        r,
        previous?.excludedSources,
        readSource,
      );
      break;
    case 7:
      value.excludedGearIds = listRead(r, previous?.excludedGearIds, (r) =>
        itemRead(r, ctx),
      );
      break;
    case 8:
      value.forcedGear = forcesRead(r, previous?.forcedGear, ctx);
      break;
  }
}
function changesWrite(w: Writer, changed: number, present: number): void {
  check(changed % 64 === present % 64);
  const candidates: Writer[] = [];
  if (changed === present) {
    const x = new Writer();
    x.u(4 * changed);
    candidates.push(x);
  }
  const pair = new Writer();
  pair.u(4 * changed + 1);
  pair.u(Math.floor(present / 64));
  candidates.push(pair);
  let ternary = 0;
  for (let i = 0; i < 3; i++)
    ternary +=
      (bit(changed, i + 6) ? (bit(present, i + 6) ? 2 : 1) : 0) * 3 ** i;
  const mixed = new Writer();
  mixed.u(4 * ((changed % 64) + 64 * ternary) + 2);
  candidates.push(mixed);
  candidates.sort((a, b) => w.cost(a) - w.cost(b));
  w.merge(candidates[0]);
}
function changesRead(r: Reader): { changed: number; present: number } {
  const code = r.u(),
    mode = code % 4,
    body = Math.floor(code / 4);
  let changed = 0,
    present = 0;
  if (mode === 0) changed = present = body;
  else if (mode === 1) {
    changed = body;
    const assigned = r.u();
    check(assigned < 8);
    present = (body % 64) + 64 * assigned;
  } else {
    check(mode === 2, "配置差分保留码");
    changed = present = body % 64;
    let states = Math.floor(body / 64);
    for (let i = 0; i < 3; i++) {
      const state = states % 3;
      states = Math.floor(states / 3);
      if (state) changed += 2 ** (6 + i);
      if (state === 2) present += 2 ** (6 + i);
    }
    check(states === 0);
  }
  check(changed < 512 && present < 512 && changed % 64 === present % 64);
  for (let i = 0; i < 9; i++) check(!bit(present, i) || bit(changed, i));
  return { changed, present };
}
function configWrite(
  w: Writer,
  value: WireConfig,
  previous: WireConfig | undefined,
  ctx: ConfigContext,
): void {
  if (!previous) {
    for (let i = 0; i < 6; i++) fieldWrite(w, i, value, undefined, ctx);
    for (let i = 6; i < 9; i++) w.flag(value[FIELDS[i]] !== undefined);
    for (let i = 6; i < 9; i++)
      if (value[FIELDS[i]] !== undefined)
        fieldWrite(w, i, value, undefined, ctx);
    return;
  }
  let changed = 0,
    present = 0;
  FIELDS.forEach((field, i) => {
    if (!equal(value[field], previous[field])) {
      changed += 2 ** i;
      if (value[field] !== undefined) present += 2 ** i;
    }
  });
  changesWrite(w, changed, present);
  FIELDS.forEach((_, i) => {
    if (bit(present, i)) fieldWrite(w, i, value, previous, ctx);
  });
}
function configRead(
  r: Reader,
  previous: WireConfig | undefined,
  ctx: ConfigContext,
): WireConfig {
  // Required fields are filled in order before the object is exposed.
  const value = structuredClone(previous ?? {}) as WireConfig;
  if (!previous) {
    for (let i = 0; i < 6; i++) fieldRead(r, i, value, undefined, ctx);
    const flags = [r.flag(), r.flag(), r.flag()];
    for (let i = 6; i < 9; i++)
      if (flags[i - 6]) fieldRead(r, i, value, undefined, ctx);
  } else {
    const { changed, present } = changesRead(r);
    FIELDS.forEach((field, i) => {
      if (bit(changed, i)) {
        if (bit(present, i)) fieldRead(r, i, value, previous, ctx);
        else delete (value as unknown as Record<string, unknown>)[field];
      }
    });
  }
  check(
    value.minItemLevel >= 90 && value.maxItemLevel >= value.minItemLevel,
    "装备品级范围无效",
  );
  return value;
}
export function prepareConfigs(
  configs: readonly ShareConfig[],
  pool: PatternPool,
): WireConfig[] {
  return configs.map((config) => wireConfig(config, pool));
}
export function configsWrite(
  w: Writer,
  rows: readonly WireConfig[],
  ctx: ConfigContext,
): void {
  w.u(rows.length);
  rows.forEach((row, index) => {
    const candidates = [undefined, ...rows.slice(0, index)].map((base, ref) => {
      const x = new Writer();
      x.u(ref);
      configWrite(x, row, base, ctx);
      return x;
    });
    candidates.sort((a, b) => w.cost(a) - w.cost(b));
    w.merge(candidates[0]);
  });
}
export function configsRead(r: Reader, ctx: ConfigContext): ShareConfig[] {
  const count = r.count(Object.keys(gameData.jobs).length);
  check(count > 0);
  const rows: WireConfig[] = [];
  for (let i = 0; i < count; i++) {
    const ref = r.u();
    check(ref <= i, "配置前向引用");
    rows.push(configRead(r, ref ? rows[ref - 1] : undefined, ctx));
  }
  return rows.map((row) => unpack(row, ctx.pool));
}
