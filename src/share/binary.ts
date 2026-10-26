import { MAX_RAW_BYTES } from "./types.ts";

export function check(value: unknown, detail = "字段无效"): asserts value {
  if (!value) throw new Error(`无效的分享链接：${detail}`);
}
export function uint(value: number): void {
  check(
    Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0),
    "整数超出范围",
  );
}
export function equal(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (
    typeof a !== "object" ||
    a === null ||
    typeof b !== "object" ||
    b === null ||
    Array.isArray(a) !== Array.isArray(b)
  )
    return false;
  const keys = Object.keys(a).filter(
    (k) => (a as Record<string, unknown>)[k] !== undefined,
  );
  const other = Object.keys(b).filter(
    (k) => (b as Record<string, unknown>)[k] !== undefined,
  );
  return (
    keys.length === other.length &&
    keys.every(
      (k) =>
        Object.hasOwn(b, k) &&
        equal(
          (a as Record<string, unknown>)[k],
          (b as Record<string, unknown>)[k],
        ),
    )
  );
}
export const bit = (mask: number, index: number): boolean =>
  Math.floor(mask / 2 ** index) % 2 === 1;

export class Writer {
  bytes: number[] = [];
  flags: number[] = [];
  byte(value: number): void {
    uint(value);
    check(value <= 255);
    check(this.bytes.length < MAX_RAW_BYTES, "超出分享容量限制");
    this.bytes.push(value);
  }
  u(value: number): void {
    uint(value);
    do {
      const low = value % 128;
      value = Math.floor(value / 128);
      this.byte(low + (value ? 128 : 0));
    } while (value);
  }
  z(value: number): void {
    check(
      Number.isSafeInteger(value) && value >= -(2 ** 52) && value < 2 ** 52,
    );
    this.u(value < 0 ? -2 * value - 1 : 2 * value);
  }
  flag(value: boolean): void {
    this.flags.push(value ? 1 : 0);
  }
  append(bytes: Uint8Array): void {
    for (const byte of bytes) this.byte(byte);
  }
  merge(other: Writer): void {
    this.append(Uint8Array.from(other.bytes));
    this.flags.push(...other.flags);
  }
  cost(other: Writer): number {
    return (
      other.bytes.length +
      Math.ceil((this.flags.length + other.flags.length) / 8) -
      Math.ceil(this.flags.length / 8)
    );
  }
  finish(): Uint8Array {
    const tail = new Uint8Array(Math.ceil(this.flags.length / 8));
    this.flags.forEach((value, i) => {
      tail[tail.length - 1 - Math.floor(i / 8)] |= value << (i % 8);
    });
    check(this.bytes.length + tail.length <= MAX_RAW_BYTES, "超出分享容量限制");
    const result = new Uint8Array(this.bytes.length + tail.length);
    result.set(this.bytes);
    result.set(tail, this.bytes.length);
    return result;
  }
}

export class Reader {
  offset = 0;
  flagIndex = 0;
  // A raw byte can describe an unchanged/implicit element; charge those too.
  #work = MAX_RAW_BYTES * 16;
  readonly bytes: Uint8Array;
  constructor(bytes: Uint8Array) {
    check(
      bytes.length > 0 && bytes.length <= MAX_RAW_BYTES,
      "超出分享容量限制",
    );
    this.bytes = bytes;
  }
  get remaining(): number {
    return this.bytes.length - Math.ceil(this.flagIndex / 8) - this.offset;
  }
  spend(count = 1): void {
    uint(count);
    this.#work -= count;
    check(this.#work >= 0, "读取资源超出限制");
  }
  count(limit = MAX_RAW_BYTES): number {
    const n = this.u();
    check(n <= limit, "列表数量超出限制");
    this.spend(n);
    return n;
  }
  byte(): number {
    check(this.remaining > 0, "内容被截断");
    return this.bytes[this.offset++];
  }
  u(): number {
    let value = 0n;
    for (let i = 0; i < 8; i++) {
      const byte = this.byte();
      value |= BigInt(byte & 127) << BigInt(7 * i);
      check(value <= BigInt(Number.MAX_SAFE_INTEGER), "整数溢出");
      if (byte < 128) {
        check(i === 0 || byte !== 0, "非最短整数");
        return Number(value);
      }
    }
    check(false, "整数过长");
  }
  z(): number {
    const v = this.u();
    return v % 2 ? -(v + 1) / 2 : v / 2;
  }
  flag(): boolean {
    const at = this.bytes.length - 1 - Math.floor(this.flagIndex / 8);
    check(at >= this.offset, "标记与载荷重叠");
    return ((this.bytes[at] >> (this.flagIndex++ % 8)) & 1) === 1;
  }
  take(count: number): Uint8Array {
    uint(count);
    check(count <= this.remaining, "内容被截断");
    const out = this.bytes.subarray(this.offset, this.offset + count);
    this.offset += count;
    return out;
  }
  finish(): void {
    check(this.remaining === 0, "含尾随内容");
    const used = this.flagIndex % 8;
    if (used) check(this.bytes[this.offset] >> used === 0, "尾部非零补齐");
  }
}

export function q7Units(value: number): number {
  check(
    Number.isFinite(value) &&
      value >= 0 &&
      !Object.is(value, -0) &&
      value <= 429.4967295,
    "七位定点数超出范围",
  );
  const units = Number(value.toFixed(7).replace(".", ""));
  check(Number.isInteger(units) && units <= 0xffffffff);
  return units;
}
export const q7 = (value: number): number => q7Units(value) / 1e7;
export function writeQ7(w: Writer, value: number): void {
  let n = q7Units(value);
  for (let i = 0; i < 4; i++) {
    w.byte(n % 256);
    n = Math.floor(n / 256);
  }
}
export function readQ7(r: Reader): number {
  let n = 0;
  for (let i = 0; i < 4; i++) n += r.byte() * 256 ** i;
  return n / 1e7;
}
export function gcdCode(value: number): number {
  const x = 250 - Math.round(value * 100);
  check(
    Number.isFinite(value) &&
      value > 0 &&
      value <= 2.5 &&
      x >= 0 &&
      x < 250 &&
      Object.is((250 - x) / 100, value),
    "GCD 精度无效",
  );
  return x;
}
export function elapsedTicks(ms: number): number {
  check(Number.isFinite(ms) && ms >= 0);
  const s = (ms / 1000).toFixed(1),
    n = Number(s.replace(".", ""));
  uint(n);
  check(Number.isSafeInteger(n * 100) && (n / 10).toFixed(1) === s);
  return n;
}

function rangeSpace(ranges: readonly number[]): bigint {
  check(ranges.length <= 1024, "范围数量超出限制");
  let space = 1n;
  for (const range of ranges) {
    uint(range);
    check(range > 0);
    space *= BigInt(range);
    check(space.toString(2).length <= MAX_RAW_BYTES * 8, "范围块超出限制");
  }
  return space;
}
export function mixedWrite(
  w: Writer,
  digits: readonly number[],
  ranges: readonly number[],
): void {
  check(digits.length === ranges.length);
  const space = rangeSpace(ranges);
  let value = 0n;
  digits.forEach((digit, i) => {
    uint(digit);
    check(digit < ranges[i]);
    value = value * BigInt(ranges[i]) + BigInt(digit);
  });
  const bytes = new Uint8Array(
    space === 1n ? 0 : Math.ceil((space - 1n).toString(2).length / 8),
  );
  for (let i = bytes.length - 1; i >= 0; i--) {
    bytes[i] = Number(value & 255n);
    value >>= 8n;
  }
  w.append(bytes);
}
export function mixedRead(r: Reader, ranges: readonly number[]): number[] {
  r.spend(ranges.length);
  const space = rangeSpace(ranges),
    count = space === 1n ? 0 : Math.ceil((space - 1n).toString(2).length / 8);
  let value = 0n;
  for (const byte of r.take(count)) value = value * 256n + BigInt(byte);
  check(value < space, "范围块溢出");
  const out = Array<number>(ranges.length);
  for (let i = ranges.length - 1; i >= 0; i--) {
    out[i] = Number(value % BigInt(ranges[i]));
    value /= BigInt(ranges[i]);
  }
  return out;
}
