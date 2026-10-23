export function fail(message: string): never {
  throw new Error(`生成数据二进制格式错误：${message}`);
}

export function assertUInt(value: number, bits: number, label: string): void {
  const max = bits === 32 ? 0xffffffff : 2 ** bits - 1;
  if (!Number.isSafeInteger(value) || value < 0 || value > max)
    fail(`${label} 超出 u${bits} 范围：${value}`);
}

export class ByteWriter {
  #bytes = new Uint8Array(1024);
  #length = 0;
  #reserve(length: number): void {
    const needed = this.#length + length;
    if (needed > 0xffffffff) fail("编码长度超出 u32");
    if (needed <= this.#bytes.length) return;
    const grown = new Uint8Array(Math.max(needed, this.#bytes.length * 2));
    grown.set(this.#bytes);
    this.#bytes = grown;
  }
  u8(value: number, label = "u8"): void {
    assertUInt(value, 8, label);
    this.#reserve(1);
    this.#bytes[this.#length++] = value;
  }
  u16(value: number, label = "u16"): void {
    assertUInt(value, 16, label);
    this.#reserve(2);
    new DataView(this.#bytes.buffer).setUint16(this.#length, value, true);
    this.#length += 2;
  }
  u32(value: number, label = "u32"): void {
    assertUInt(value, 32, label);
    this.#reserve(4);
    new DataView(this.#bytes.buffer).setUint32(this.#length, value, true);
    this.#length += 4;
  }
  i16(value: number, label = "i16"): void {
    if (!Number.isSafeInteger(value) || value < -32768 || value > 32767)
      fail(`${label} 超出 i16`);
    this.#reserve(2);
    new DataView(this.#bytes.buffer).setInt16(this.#length, value, true);
    this.#length += 2;
  }
  i32(value: number, label = "i32"): void {
    if (
      !Number.isSafeInteger(value) ||
      value < -0x80000000 ||
      value > 0x7fffffff
    )
      fail(`${label} 超出 i32`);
    this.#reserve(4);
    new DataView(this.#bytes.buffer).setInt32(this.#length, value, true);
    this.#length += 4;
  }
  f64(value: number, label = "f64"): void {
    if (!Number.isFinite(value)) fail(`${label} 不是有限数值`);
    this.#reserve(8);
    new DataView(this.#bytes.buffer).setFloat64(this.#length, value, true);
    this.#length += 8;
  }
  varUint(value: number, label = "varuint"): void {
    if (!Number.isSafeInteger(value) || value < 0)
      fail(`${label} 不是非负安全整数`);
    do {
      const low = value % 128;
      value = Math.floor(value / 128);
      this.u8(low | (value ? 128 : 0));
    } while (value);
  }
  append(bytes: Uint8Array): void {
    this.#reserve(bytes.length);
    this.#bytes.set(bytes, this.#length);
    this.#length += bytes.length;
  }
  finish(): Uint8Array {
    return this.#bytes.slice(0, this.#length);
  }
}

export class ByteReader {
  offset = 0;
  readonly view: DataView;
  readonly bytes: Uint8Array;
  readonly label: string;
  constructor(bytes: Uint8Array, label: string) {
    this.bytes = bytes;
    this.label = label;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  require(length: number): void {
    if (
      !Number.isSafeInteger(length) ||
      length < 0 ||
      length > this.bytes.length - this.offset
    )
      fail(`${this.label} 在偏移 ${this.offset} 处被截断`);
  }
  u8(): number {
    this.require(1);
    return this.bytes[this.offset++];
  }
  u16(): number {
    this.require(2);
    const value = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return value;
  }
  i16(): number {
    this.require(2);
    const value = this.view.getInt16(this.offset, true);
    this.offset += 2;
    return value;
  }
  u32(): number {
    this.require(4);
    const value = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return value;
  }
  i32(): number {
    this.require(4);
    const value = this.view.getInt32(this.offset, true);
    this.offset += 4;
    return value;
  }
  f64(): number {
    this.require(8);
    const value = this.view.getFloat64(this.offset, true);
    this.offset += 8;
    if (!Number.isFinite(value)) fail(`${this.label} 含非有限数值`);
    return value;
  }
  varUint(): number {
    let value = 0,
      multiplier = 1;
    for (let index = 0; index < 8; index++) {
      const byte = this.u8();
      value += (byte & 127) * multiplier;
      if (!Number.isSafeInteger(value))
        fail(`${this.label} varuint 超出安全整数`);
      if (!(byte & 128)) {
        if (index && byte === 0) fail(`${this.label} varuint 编码不规范`);
        return value;
      }
      multiplier *= 128;
    }
    return fail(`${this.label} varuint 编码过长`);
  }
  slice(length: number): Uint8Array {
    this.require(length);
    const result = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return result;
  }
  finish(): void {
    if (this.offset !== this.bytes.length) fail(`${this.label} 含尾随数据`);
  }
}
