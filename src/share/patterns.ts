import { gameData } from "../domain/data.ts";
import { fixedCustomParameterMelds } from "../domain/custom-gear-parameters.ts";
import { concretizeGearStats } from "../domain/rules.ts";
import type { Materia, Stats } from "../domain/types.ts";
import { bit, check, equal, Reader, Writer, uint } from "./binary.ts";
import {
  STAT_CODES,
  type ShareConfig,
  type ShareMeld,
  type SharePattern,
} from "./types.ts";

export function allocationWrite(w: Writer, stats: Stats): void {
  let mask = 0;
  for (const key of Object.keys(stats)) {
    const at = STAT_CODES.indexOf(key as (typeof STAT_CODES)[number]);
    check(at >= 0);
    mask += 2 ** at;
  }
  w.u(mask);
  STAT_CODES.forEach((stat, i) => {
    if (bit(mask, i)) w.u(stats[stat]!);
  });
}
export function allocationRead(r: Reader): Stats {
  const mask = r.u();
  check(mask < 2 ** 15, "属性图越界");
  return Object.fromEntries(
    STAT_CODES.flatMap((stat, i) => (bit(mask, i) ? [[stat, r.u()]] : [])),
  );
}
export function normalizeMelds(
  melds: readonly ((ShareMeld & { slotIndex?: number }) | null)[],
  forced = false,
): (ShareMeld | null)[] {
  check(Array.isArray(melds));
  if (melds.length && melds.every((m) => m !== null && m.grade === 0)) {
    check(!forced, "固定孔不能包含自定义参数");
    return melds
      .map((m) => ({ stat: m!.stat, grade: 0, value: m!.value }))
      .sort((a, b) => STAT_CODES.indexOf(a.stat) - STAT_CODES.indexOf(b.stat));
  }
  let length = melds.length;
  for (const [i, m] of melds.entries())
    if (m !== null) {
      const at = m.slotIndex ?? i;
      uint(at);
      check(at < 5 && (!forced || at === i), "魔晶石孔位无效");
      length = Math.max(length, at + 1);
    }
  check(length <= 5);
  const out: (ShareMeld | null)[] = Array(length).fill(null);
  melds.forEach((m, i) => {
    if (m !== null) {
      const at = m.slotIndex ?? i;
      check(out[at] === null, "重复孔位");
      out[at] = { stat: m.stat, grade: m.grade };
    }
  });
  return out;
}
export function parameterSlots(id: number) {
  const raw = gameData.getGearById(id);
  check(raw, `未知装备 ${id}`);
  if (!raw.customParameters) return undefined;
  const ps = raw.customParameters.toSorted(
    (a, b) => STAT_CODES.indexOf(a.stat) - STAT_CODES.indexOf(b.stat),
  );
  check(ps.length === 4 && new Set(ps.map((p) => p.stat)).size === 4);
  return ps;
}
export function choiceMelds(id: number, choice: number): ShareMeld[] {
  const ps = parameterSlots(id);
  uint(choice);
  check(ps && choice < 12);
  const small = Math.floor(choice / 3),
    empty = [0, 1, 2, 3].filter((i) => i !== small)[choice % 3];
  return ps.flatMap((p, i) =>
    i === empty
      ? []
      : [
          {
            stat: p.stat,
            grade: 0,
            value: i === small ? p.smallValue : p.bigValue,
          },
        ],
  );
}
export function patternForItem(
  id: number,
  melds: readonly ((ShareMeld & { slotIndex?: number }) | null)[],
): SharePattern {
  const p = normalizeMelds(melds);
  if (!parameterSlots(id)) return p;
  for (let choice = 0; choice < 12; choice++)
    if (equal(p, choiceMelds(id, choice))) return { choice };
  check(false, `自定义选择不合法 ${id}`);
}
export function resolvePattern(
  id: number,
  pattern: SharePattern,
): (ShareMeld | null)[] {
  return Array.isArray(pattern)
    ? structuredClone(pattern)
    : choiceMelds(id, pattern.choice);
}
export function patternWrite(w: Writer, pattern: SharePattern): void {
  if (!Array.isArray(pattern)) {
    uint(pattern.choice);
    check(pattern.choice < 12);
    w.byte(144 + pattern.choice);
    return;
  }
  if (pattern.length && pattern.every((m) => m !== null && m.grade === 0)) {
    check(new Set(pattern.map((m) => m!.stat)).size === pattern.length);
    w.byte(240);
    allocationWrite(
      w,
      Object.fromEntries(pattern.map((m) => [m!.stat, m!.value])),
    );
    return;
  }
  check(pattern.length <= 5);
  let mask = 0;
  pattern.forEach((m, i) => {
    if (m !== null) mask += 2 ** i;
  });
  w.byte(2 ** pattern.length - 1 + mask);
  for (const m of pattern)
    if (m !== null) {
      const stat = STAT_CODES.indexOf(m.stat);
      check(stat >= 0 && stat < 7);
      uint(m.grade);
      check(m.grade > 0 && m.grade <= 31);
      w.byte(stat * 32 + m.grade);
    }
}
export function patternRead(r: Reader): SharePattern {
  const code = r.byte();
  if (code >= 144 && code <= 155) return { choice: code - 144 };
  if (code === 240)
    return Object.entries(allocationRead(r)).map(([stat, value]) => ({
      stat: stat as Materia["stat"],
      value,
      grade: 0,
    }));
  check(code <= 62, "参数模式保留码");
  let length = 0;
  while (2 ** (length + 1) <= code + 1) length++;
  const mask = code - (2 ** length - 1);
  return Array.from({ length }, (_, i) => {
    if (!bit(mask, i)) return null;
    const token = r.byte(),
      stat = Math.floor(token / 32),
      grade = token % 32;
    check(stat < 7 && grade > 0);
    return { stat: STAT_CODES[stat] as Materia["stat"], grade };
  });
}
export class PatternPool {
  values: SharePattern[] = [[]];
  add(p: SharePattern): number {
    const id = this.values.findIndex((value) => equal(value, p));
    if (id >= 0) return id;
    check(this.values.length < 4096);
    this.values.push(p);
    return this.values.length - 1;
  }
  get(id: number): SharePattern {
    const p = this.values[id];
    check(p !== undefined, "参数引用越界");
    return p;
  }
}
export function forcedSelection(
  id: number,
  stats: Stats,
  config: ShareConfig,
): number | undefined {
  const ps = parameterSlots(id);
  if (!ps) return undefined;
  const melds = fixedCustomParameterMelds(
    gameData.getGearById(id)!,
    stats,
    gameData.jobSchemas[config.jobId],
  );
  const pattern = patternForItem(id, melds);
  check(!Array.isArray(pattern));
  const mask = ps.reduce(
    (mask, p, i) => mask + (Object.hasOwn(stats, p.stat) ? 2 ** i : 0),
    0,
  );
  const code = pattern.choice + 12 * mask;
  check(
    equal(resolveForcedSelection(id, code, config), stats),
    "绝对分配不匹配",
  );
  return code;
}
export function resolveForcedSelection(
  id: number,
  code: number,
  config: Pick<ShareConfig, "jobId">,
): Stats {
  uint(code);
  check(code < 192);
  const ps = parameterSlots(id);
  check(ps);
  const values = {
    ...concretizeGearStats(
      gameData.getGearById(id)!.stats,
      gameData.jobSchemas[config.jobId],
    ),
  };
  for (const m of choiceMelds(id, code % 12))
    values[m.stat] = (values[m.stat] ?? 0) + m.value!;
  return Object.fromEntries(
    ps.flatMap((p, i) =>
      bit(Math.floor(code / 12), i) ? [[p.stat, values[p.stat] ?? 0]] : [],
    ),
  );
}
