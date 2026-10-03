import {
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  rmSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";

const RECORD_BYTES = 8;
const INTERVAL_RECORD_BYTES = 12;
const DEFAULT_BUFFER_RECORDS = 1 << 17;
const INTERVAL_BUFFER_RECORDS = 1 << 12;

export type AttributeVector = readonly [
  first: number,
  second: number,
  third: number,
  fourth: number,
];

export type ThresholdKeyEvaluator = (
  first: number,
  second: number,
  third: number,
  fourth: number,
  output: Uint32Array,
) => void;

export type AttributeCombinationSlot = {
  name: string;
  candidates: readonly AttributeVector[];
};

export type AttributeCombinationLayerResult = {
  name: string;
  candidateCount: number;
  traversalCount: bigint;
  exactCount: number;
  thresholdCount: number;
  minimumTotal: number;
  maximumTotal: number;
  thresholdUpperBound: bigint;
};

export type AttributeCombinationLayerProgress = {
  name: string;
  percent: number;
  elapsedMs: number;
  layerElapsedMs: number;
  traversalCount: bigint;
};

export type AttributeCombinationCounterOptions = {
  slots: readonly AttributeCombinationSlot[];
  workRoot: string;
  blockSize?: number;
  keepTemporaryFiles?: boolean;
  onLayerComplete?: (result: AttributeCombinationLayerResult) => void;
  onLayerProgress?: (progress: AttributeCombinationLayerProgress) => void;
  thresholdKeysSorted?: boolean;
  thresholdKey: ThresholdKeyEvaluator;
  thresholdUpperBound: (
    minimumTotal: number,
    maximumTotal: number,
  ) => bigint;
};

function writeFully(fd: number, buffer: Buffer): void {
  let offset = 0;
  while (offset < buffer.byteLength) {
    const written = writeSync(fd, buffer, offset, buffer.byteLength - offset);
    if (written <= 0) throw new Error("无法写入属性组合临时文件");
    offset += written;
  }
}

function readFully(
  fd: number,
  buffer: Buffer,
  position: number,
): void {
  let offset = 0;
  while (offset < buffer.byteLength) {
    const read = readSync(
      fd,
      buffer,
      offset,
      buffer.byteLength - offset,
      position + offset,
    );
    if (read <= 0) throw new Error("属性组合临时文件提前结束");
    offset += read;
  }
}

function packVector(vector: AttributeVector): [number, number] {
  const first = vector[0];
  const second = vector[1];
  const third = vector[2];
  const fourth = vector[3];
  for (const value of [first, second, third, fourth]) {
    if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
      throw new RangeError(`属性向量分量超出 16 位范围：${value}`);
    }
  }
  return [
    (((first << 16) | second) >>> 0),
    (((third << 16) | fourth) >>> 0),
  ];
}

function addPackedHigh16(first: number, second: number): number {
  const high = (first >>> 16) + (second >>> 16);
  const low = (first & 0xffff) + (second & 0xffff);
  if (high > 0xffff || low > 0xffff) {
    throw new RangeError("属性组合相加超过 16 位范围");
  }
  return (((high << 16) | low) >>> 0);
}

function addPackedLow16(first: number, second: number): number {
  const high = (first >>> 16) + (second >>> 16);
  const low = (first & 0xffff) + (second & 0xffff);
  if (high > 0xffff || low > 0xffff) {
    throw new RangeError("属性组合相加超过 16 位范围");
  }
  return (((high << 16) | low) >>> 0);
}

class BinaryWriter {
  private readonly fd: number;
  private readonly buffer: Uint32Array;
  private bufferedRecords = 0;
  private writtenRecords = 0;

  constructor(path: string, bufferRecords = DEFAULT_BUFFER_RECORDS) {
    this.fd = openSync(path, "w");
    this.buffer = new Uint32Array(bufferRecords * 2);
  }

  push(key0: number, key1: number): void {
    const offset = this.bufferedRecords * 2;
    this.buffer[offset] = key0;
    this.buffer[offset + 1] = key1;
    this.bufferedRecords++;
    if (this.bufferedRecords === this.buffer.length / 2) this.flush();
  }

  private flush(): void {
    if (this.bufferedRecords === 0) return;
    const buffer = Buffer.from(
      this.buffer.buffer,
      this.buffer.byteOffset,
      this.bufferedRecords * RECORD_BYTES,
    );
    writeFully(this.fd, buffer);
    this.writtenRecords += this.bufferedRecords;
    this.bufferedRecords = 0;
  }

  close(): number {
    this.flush();
    closeSync(this.fd);
    return this.writtenRecords;
  }
}

class IntervalWriter {
  private readonly fd: number;
  private readonly buffer: Uint32Array;
  private bufferedRecords = 0;
  private writtenRecords = 0;

  constructor(path: string, bufferRecords = INTERVAL_BUFFER_RECORDS) {
    this.fd = openSync(path, "w");
    this.buffer = new Uint32Array(bufferRecords * 3);
  }

  push(prefix: number, thirdAndStart: number, end: number): void {
    const offset = this.bufferedRecords * 3;
    this.buffer[offset] = prefix;
    this.buffer[offset + 1] = thirdAndStart;
    this.buffer[offset + 2] = end;
    this.bufferedRecords++;
    if (this.bufferedRecords === this.buffer.length / 3) this.flush();
  }

  private flush(): void {
    if (this.bufferedRecords === 0) return;
    const buffer = Buffer.from(
      this.buffer.buffer,
      this.buffer.byteOffset,
      this.bufferedRecords * INTERVAL_RECORD_BYTES,
    );
    writeFully(this.fd, buffer);
    this.writtenRecords += this.bufferedRecords;
    this.bufferedRecords = 0;
  }

  close(): number {
    this.flush();
    closeSync(this.fd);
    return this.writtenRecords;
  }
}

class BinaryReader {
  private readonly fd: number;
  private readonly totalRecords: number;
  private readonly buffer: Uint32Array;
  private bufferedRecords = 0;
  private bufferIndex = 0;
  private readRecords = 0;
  current0 = 0;
  current1 = 0;

  constructor(
    path: string,
    totalRecords: number,
    bufferRecords = DEFAULT_BUFFER_RECORDS,
  ) {
    this.fd = openSync(path, "r");
    this.totalRecords = totalRecords;
    this.buffer = new Uint32Array(bufferRecords * 2);
  }

  next(): boolean {
    if (this.bufferIndex >= this.bufferedRecords) {
      if (this.readRecords >= this.totalRecords) return false;
      const recordCount = Math.min(
        this.buffer.length / 2,
        this.totalRecords - this.readRecords,
      );
      const byteCount = recordCount * RECORD_BYTES;
      const buffer = Buffer.from(
        this.buffer.buffer,
        this.buffer.byteOffset,
        byteCount,
      );
      readFully(this.fd, buffer, this.readRecords * RECORD_BYTES);
      this.bufferedRecords = recordCount;
      this.bufferIndex = 0;
      this.readRecords += recordCount;
    }
    const offset = this.bufferIndex * 2;
    this.current0 = this.buffer[offset]!;
    this.current1 = this.buffer[offset + 1]!;
    this.bufferIndex++;
    return true;
  }

  close(): void {
    closeSync(this.fd);
  }
}

class IntervalReader {
  private readonly fd: number;
  private readonly totalRecords: number;
  private readonly buffer: Uint32Array;
  private bufferedRecords = 0;
  private bufferIndex = 0;
  private readRecords = 0;
  currentPrefix = 0;
  currentThirdAndStart = 0;
  currentEnd = 0;

  constructor(
    path: string,
    totalRecords: number,
    bufferRecords = INTERVAL_BUFFER_RECORDS,
  ) {
    this.fd = openSync(path, "r");
    this.totalRecords = totalRecords;
    this.buffer = new Uint32Array(bufferRecords * 3);
  }

  next(): boolean {
    if (this.bufferIndex >= this.bufferedRecords) {
      if (this.readRecords >= this.totalRecords) return false;
      const recordCount = Math.min(
        this.buffer.length / 3,
        this.totalRecords - this.readRecords,
      );
      const byteCount = recordCount * INTERVAL_RECORD_BYTES;
      const buffer = Buffer.from(
        this.buffer.buffer,
        this.buffer.byteOffset,
        byteCount,
      );
      readFully(this.fd, buffer, this.readRecords * INTERVAL_RECORD_BYTES);
      this.bufferedRecords = recordCount;
      this.bufferIndex = 0;
      this.readRecords += recordCount;
    }
    const offset = this.bufferIndex * 3;
    this.currentPrefix = this.buffer[offset]!;
    this.currentThirdAndStart = this.buffer[offset + 1]!;
    this.currentEnd = this.buffer[offset + 2]!;
    this.bufferIndex++;
    return true;
  }

  close(): void {
    closeSync(this.fd);
  }
}

class RecordHeap {
  readonly stream: Int32Array;
  readonly position: Int32Array;
  readonly key0: Uint32Array;
  readonly key1: Uint32Array;
  size = 0;
  poppedStream = 0;
  poppedPosition = 0;
  poppedKey0 = 0;
  poppedKey1 = 0;

  constructor(capacity: number) {
    this.stream = new Int32Array(capacity);
    this.position = new Int32Array(capacity);
    this.key0 = new Uint32Array(capacity);
    this.key1 = new Uint32Array(capacity);
  }

  private less(left: number, right: number): boolean {
    return (
      this.key0[left]! < this.key0[right]! ||
      (this.key0[left] === this.key0[right] &&
        this.key1[left]! < this.key1[right]!)
    );
  }

  push(
    stream: number,
    position: number,
    key0: number,
    key1: number,
  ): void {
    let index = this.size++;
    this.stream[index] = stream;
    this.position[index] = position;
    this.key0[index] = key0;
    this.key1[index] = key1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (!this.less(index, parent)) break;
      this.swap(index, parent);
      index = parent;
    }
  }

  private swap(left: number, right: number): void {
    let value = this.stream[left]!;
    this.stream[left] = this.stream[right]!;
    this.stream[right] = value;
    value = this.position[left]!;
    this.position[left] = this.position[right]!;
    this.position[right] = value;
    value = this.key0[left]!;
    this.key0[left] = this.key0[right]!;
    this.key0[right] = value;
    value = this.key1[left]!;
    this.key1[left] = this.key1[right]!;
    this.key1[right] = value;
  }

  pop(): void {
    if (this.size === 0) throw new Error("不能从空属性组合堆取值");
    this.poppedStream = this.stream[0]!;
    this.poppedPosition = this.position[0]!;
    this.poppedKey0 = this.key0[0]!;
    this.poppedKey1 = this.key1[0]!;
    this.size--;
    if (this.size === 0) return;
    this.stream[0] = this.stream[this.size]!;
    this.position[0] = this.position[this.size]!;
    this.key0[0] = this.key0[this.size]!;
    this.key1[0] = this.key1[this.size]!;
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      if (left >= this.size) break;
      const right = left + 1;
      let child = left;
      if (right < this.size && this.less(right, left)) child = right;
      if (!this.less(child, index)) break;
      this.swap(index, child);
      index = child;
    }
  }
}

function radixSortPairs(
  data: Uint32Array,
  count: number,
  scratch: Uint32Array,
): void {
  const counters = new Uint32Array(65536);
  let source = data;
  let destination = scratch;
  const passes: readonly [word: 0 | 1, shift: 0 | 16][] = [
    [1, 0],
    [1, 16],
    [0, 0],
    [0, 16],
  ];
  for (const [word, shift] of passes) {
    counters.fill(0);
    for (let index = 0; index < count; index++) {
      counters[(source[index * 2 + word]! >>> shift) & 0xffff]++;
    }
    let offset = 0;
    for (let index = 0; index < counters.length; index++) {
      const size = counters[index]!;
      counters[index] = offset;
      offset += size;
    }
    for (let index = 0; index < count; index++) {
      const sourceOffset = index * 2;
      const digit = (source[sourceOffset + word]! >>> shift) & 0xffff;
      const destinationOffset = counters[digit]!++ * 2;
      destination[destinationOffset] = source[sourceOffset]!;
      destination[destinationOffset + 1] = source[sourceOffset + 1]!;
    }
    const previousSource = source;
    source = destination;
    destination = previousSource;
  }
  if (source !== data) data.set(source.subarray(0, count * 2));
}

function processBlock(
  source: Uint32Array,
  recordCount: number,
  nodes: readonly [number, number][],
  outputPath: string,
): number {
  const writer = new BinaryWriter(outputPath);
  const heap = new RecordHeap(nodes.length);
  const nodeCount = nodes.length;
  for (let node = 0; node < nodeCount; node++) {
    heap.push(
      node,
      0,
      addPackedHigh16(source[0]!, nodes[node]![0]),
      addPackedLow16(source[1]!, nodes[node]![1]),
    );
  }
  let hasLast = false;
  let last0 = 0;
  let last1 = 0;
  while (heap.size > 0) {
    heap.pop();
    if (
      !hasLast ||
      heap.poppedKey0 !== last0 ||
      heap.poppedKey1 !== last1
    ) {
      writer.push(heap.poppedKey0, heap.poppedKey1);
      hasLast = true;
      last0 = heap.poppedKey0;
      last1 = heap.poppedKey1;
    }
    const nextPosition = heap.poppedPosition + 1;
    if (nextPosition >= recordCount) continue;
    const sourceOffset = nextPosition * 2;
    const node = nodes[heap.poppedStream]!;
    heap.push(
      heap.poppedStream,
      nextPosition,
      addPackedHigh16(source[sourceOffset]!, node[0]),
      addPackedLow16(source[sourceOffset + 1]!, node[1]),
    );
  }
  return writer.close();
}

function mergeTranslatedFile(
  inputPath: string,
  inputCount: number,
  nodes: readonly [number, number][],
  outputPath: string,
): number {
  const readers = nodes.map(
    () => new BinaryReader(inputPath, inputCount),
  );
  const heap = new RecordHeap(readers.length);
  for (let node = 0; node < nodes.length; node++) {
    const reader = readers[node]!;
    if (reader.next()) {
      heap.push(
        node,
        0,
        addPackedHigh16(reader.current0, nodes[node]![0]),
        addPackedLow16(reader.current1, nodes[node]![1]),
      );
    }
  }
  const writer = new BinaryWriter(outputPath);
  let hasLast = false;
  let last0 = 0;
  let last1 = 0;
  while (heap.size > 0) {
    heap.pop();
    if (
      !hasLast ||
      heap.poppedKey0 !== last0 ||
      heap.poppedKey1 !== last1
    ) {
      writer.push(heap.poppedKey0, heap.poppedKey1);
      hasLast = true;
      last0 = heap.poppedKey0;
      last1 = heap.poppedKey1;
    }
    const node = heap.poppedStream;
    const reader = readers[node]!;
    if (reader.next()) {
      heap.push(
        node,
        0,
        addPackedHigh16(reader.current0, nodes[node]![0]),
        addPackedLow16(reader.current1, nodes[node]![1]),
      );
    }
  }
  for (const reader of readers) reader.close();
  return writer.close();
}

const PREFIX_BASE = 0x10000;
const PREFIX_SQUARE = PREFIX_BASE * PREFIX_BASE;

function packPrefix(first: number, second: number): number {
  return first * PREFIX_BASE + second;
}

function unpackPrefix(prefix: number): [number, number] {
  const first = Math.floor(prefix / PREFIX_BASE);
  return [first, prefix - first * PREFIX_BASE];
}

function encodeThirdInterval(
  third: number,
  start: number,
  end: number,
): number {
  return third * PREFIX_SQUARE + start * PREFIX_BASE + end;
}

function decodeThirdInterval(value: number): [number, number, number] {
  const third = Math.floor(value / PREFIX_SQUARE);
  const remainder = value - third * PREFIX_SQUARE;
  const start = Math.floor(remainder / PREFIX_BASE);
  return [third, start, remainder - start * PREFIX_BASE];
}

function mergeThirdIntervals(intervals: number[]): void {
  if (intervals.length === 0) return;
  intervals.sort((first, second) => first - second);
  let writeIndex = 0;
  let [currentThird, currentStart, currentEnd] = decodeThirdInterval(
    intervals[0]!,
  );
  for (let index = 1; index < intervals.length; index++) {
    const [third, start, end] = decodeThirdInterval(intervals[index]!);
    if (third === currentThird && start <= currentEnd + 1) {
      currentEnd = Math.max(currentEnd, end);
      continue;
    }
    intervals[writeIndex++] = encodeThirdInterval(
      currentThird,
      currentStart,
      currentEnd,
    );
    currentThird = third;
    currentStart = start;
    currentEnd = end;
  }
  intervals[writeIndex++] = encodeThirdInterval(
    currentThird,
    currentStart,
    currentEnd,
  );
  intervals.length = writeIndex;
}

class PrefixHeap {
  readonly node: Int32Array;
  readonly sourceIndex: Int32Array;
  readonly prefix: Uint32Array;
  size = 0;
  poppedNode = 0;
  poppedSourceIndex = 0;
  poppedPrefix = 0;

  constructor(capacity: number) {
    this.node = new Int32Array(capacity);
    this.sourceIndex = new Int32Array(capacity);
    this.prefix = new Uint32Array(capacity);
  }

  get peekPrefix(): number {
    if (this.size === 0) throw new Error("不能查看空的目标前缀堆");
    return this.prefix[0]!;
  }

  private less(left: number, right: number): boolean {
    return (
      this.prefix[left]! < this.prefix[right]! ||
      (this.prefix[left] === this.prefix[right] &&
        this.node[left]! < this.node[right]!)
    );
  }

  private swap(left: number, right: number): void {
    let value = this.node[left]!;
    this.node[left] = this.node[right]!;
    this.node[right] = value;
    value = this.sourceIndex[left]!;
    this.sourceIndex[left] = this.sourceIndex[right]!;
    this.sourceIndex[right] = value;
    const prefix = this.prefix[left]!;
    this.prefix[left] = this.prefix[right]!;
    this.prefix[right] = prefix;
  }

  push(node: number, sourceIndex: number, prefix: number): void {
    let index = this.size++;
    this.node[index] = node;
    this.sourceIndex[index] = sourceIndex;
    this.prefix[index] = prefix;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (!this.less(index, parent)) break;
      this.swap(index, parent);
      index = parent;
    }
  }

  pop(): void {
    if (this.size === 0) throw new Error("不能从空的目标前缀堆取值");
    this.poppedNode = this.node[0]!;
    this.poppedSourceIndex = this.sourceIndex[0]!;
    this.poppedPrefix = this.prefix[0]!;
    this.size--;
    if (this.size === 0) return;
    this.node[0] = this.node[this.size]!;
    this.sourceIndex[0] = this.sourceIndex[this.size]!;
    this.prefix[0] = this.prefix[this.size]!;
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      if (left >= this.size) break;
      const right = left + 1;
      let child = left;
      if (right < this.size && this.less(right, left)) child = right;
      if (!this.less(child, index)) break;
      this.swap(index, child);
      index = child;
    }
  }
}

function appendTranslatedGroupIntervals(
  fd: number,
  startRecord: number,
  recordCount: number,
  node: readonly [number, number],
  buffer: Uint32Array,
  output: number[],
): void {
  const thirdOffset = node[1] >>> 16;
  const speedOffset = node[1] & 0xffff;
  let processed = 0;
  let sourceThird = -1;
  let sourceStart = 0;
  let sourceEnd = 0;

  const flushSourceInterval = (): void => {
    if (sourceThird < 0) return;
    const targetThird = sourceThird + thirdOffset;
    const targetStart = sourceStart + speedOffset;
    const targetEnd = sourceEnd + speedOffset;
    if (
      targetThird > 0xffff ||
      targetStart > 0xffff ||
      targetEnd > 0xffff
    ) {
      throw new RangeError("属性组合后两项相加超过 16 位范围");
    }
    output.push(encodeThirdInterval(targetThird, targetStart, targetEnd));
  };

  while (processed < recordCount) {
    const blockCount = Math.min(
      buffer.length / 2,
      recordCount - processed,
    );
    const block = Buffer.from(
      buffer.buffer,
      buffer.byteOffset,
      blockCount * RECORD_BYTES,
    );
    readFully(
      fd,
      block,
      (startRecord + processed) * RECORD_BYTES,
    );
    for (let index = 0; index < blockCount; index++) {
      const offset = index * 2;
      const third = buffer[offset + 1]! >>> 16;
      const fourth = buffer[offset + 1]! & 0xffff;
      if (sourceThird !== third) {
        flushSourceInterval();
        sourceThird = third;
        sourceStart = fourth;
        sourceEnd = fourth;
      } else if (fourth > sourceEnd + 1) {
        flushSourceInterval();
        sourceStart = fourth;
        sourceEnd = fourth;
      } else {
        sourceEnd = fourth;
      }
    }
    processed += blockCount;
  }
  flushSourceInterval();
}

function appendTranslatedGroupIntervalsFromArray(
  source: Uint32Array,
  startRecord: number,
  recordCount: number,
  node: readonly [number, number],
  output: number[],
): void {
  const thirdOffset = node[1] >>> 16;
  const speedOffset = node[1] & 0xffff;
  let sourceThird = -1;
  let sourceStart = 0;
  let sourceEnd = 0;

  const flushSourceInterval = (): void => {
    if (sourceThird < 0) return;
    const targetThird = sourceThird + thirdOffset;
    const targetStart = sourceStart + speedOffset;
    const targetEnd = sourceEnd + speedOffset;
    if (
      targetThird > 0xffff ||
      targetStart > 0xffff ||
      targetEnd > 0xffff
    ) {
      throw new RangeError("属性组合后两项相加超过 16 位范围");
    }
    output.push(encodeThirdInterval(targetThird, targetStart, targetEnd));
  };

  for (let index = 0; index < recordCount; index++) {
    const key1 = source[(startRecord + index) * 2 + 1]!;
    const third = key1 >>> 16;
    const fourth = key1 & 0xffff;
    if (sourceThird !== third) {
      flushSourceInterval();
      sourceThird = third;
      sourceStart = fourth;
      sourceEnd = fourth;
    } else if (fourth > sourceEnd + 1) {
      flushSourceInterval();
      sourceStart = fourth;
      sourceEnd = fourth;
    } else {
      sourceEnd = fourth;
    }
  }
  flushSourceInterval();
}

type MergedIntervalLayer = {
  intervalCount: number;
  exactCount: number;
  minimumTotal: number;
  maximumTotal: number;
};

function appendTranslatedIntervalGroup(
  fd: number,
  startRecord: number,
  recordCount: number,
  node: readonly [number, number],
  buffer: Uint32Array,
  output: number[],
): void {
  const thirdOffset = node[1] >>> 16;
  const speedOffset = node[1] & 0xffff;
  let processed = 0;
  while (processed < recordCount) {
    const blockCount = Math.min(
      buffer.length / 3,
      recordCount - processed,
    );
    const block = Buffer.from(
      buffer.buffer,
      buffer.byteOffset,
      blockCount * INTERVAL_RECORD_BYTES,
    );
    readFully(
      fd,
      block,
      (startRecord + processed) * INTERVAL_RECORD_BYTES,
    );
    for (let index = 0; index < blockCount; index++) {
      const offset = index * 3;
      const sourceThirdAndStart = buffer[offset + 1]!;
      const targetThird = (sourceThirdAndStart >>> 16) + thirdOffset;
      const targetStart = (sourceThirdAndStart & 0xffff) + speedOffset;
      const targetEnd = buffer[offset + 2]! + speedOffset;
      if (
        targetThird > 0xffff ||
        targetStart > 0xffff ||
        targetEnd > 0xffff
      ) {
        throw new RangeError("属性组合后两项相加超过 16 位范围");
      }
      output.push(encodeThirdInterval(targetThird, targetStart, targetEnd));
    }
    processed += blockCount;
  }
}

function appendTranslatedIntervalGroupFromArray(
  source: Uint32Array,
  startRecord: number,
  recordCount: number,
  node: readonly [number, number],
  output: number[],
): void {
  const thirdOffset = node[1] >>> 16;
  const speedOffset = node[1] & 0xffff;
  for (let index = 0; index < recordCount; index++) {
    const offset = (startRecord + index) * 3;
    const sourceThirdAndStart = source[offset + 1]!;
    const targetThird = (sourceThirdAndStart >>> 16) + thirdOffset;
    const targetStart = (sourceThirdAndStart & 0xffff) + speedOffset;
    const targetEnd = source[offset + 2]! + speedOffset;
    if (
      targetThird > 0xffff ||
      targetStart > 0xffff ||
      targetEnd > 0xffff
    ) {
      throw new RangeError("属性组合后两项相加超过 16 位范围");
    }
    output.push(encodeThirdInterval(targetThird, targetStart, targetEnd));
  }
}

/**
 * Union translated interval records by target prefix.  The layer files stay
 * compressed as disjoint speed intervals, so later layers never need to
 * materialize every speed value just to translate it again.
 */
function mergeTranslatedFileByIntervals(
  inputPath: string,
  inputCount: number,
  nodes: readonly [number, number][],
  outputPath: string,
  onProgress?: (percent: number) => void,
): MergedIntervalLayer {
  const sourcePrefixes: number[] = [];
  const sourceStarts: number[] = [];
  const sourceCounts: number[] = [];
  const reader = new IntervalReader(inputPath, inputCount);
  let currentPrefix: number | undefined;
  let currentStart = 0;
  let processed = 0;
  let lastProgressAt = Date.now() - 1000;
  const maybeReportProgress = (percent: number): void => {
    const now = Date.now();
    if (percent >= 100 || now - lastProgressAt >= 1000) {
      onProgress?.(Math.max(0, Math.min(100, percent)));
      lastProgressAt = now;
    }
  };
  maybeReportProgress(0);
  while (reader.next()) {
    const prefix = reader.currentPrefix;
    if (prefix !== currentPrefix) {
      if (currentPrefix !== undefined) {
        sourcePrefixes.push(currentPrefix);
        sourceStarts.push(currentStart);
        sourceCounts.push(processed - currentStart);
      }
      currentPrefix = prefix;
      currentStart = processed;
    }
    processed++;
    if ((processed & 0xffff) === 0) {
      maybeReportProgress((processed * 5) / inputCount);
    }
  }
  if (currentPrefix !== undefined) {
    sourcePrefixes.push(currentPrefix);
    sourceStarts.push(currentStart);
    sourceCounts.push(processed - currentStart);
  }
  reader.close();
  maybeReportProgress(5);

  if (sourcePrefixes.length === 0) {
    return {
      intervalCount: 0,
      exactCount: 0,
      minimumTotal: Number.POSITIVE_INFINITY,
      maximumTotal: Number.NEGATIVE_INFINITY,
    };
  }
  const sourceBufferBytes = inputCount * INTERVAL_RECORD_BYTES;
  const sourceFileBuffer = sourceBufferBytes <= 768 * 1024 * 1024
    ? readFileSync(inputPath)
    : undefined;
  const sourceData = sourceFileBuffer === undefined
    ? undefined
    : new Uint32Array(
      sourceFileBuffer.buffer,
      sourceFileBuffer.byteOffset,
      sourceFileBuffer.byteLength / Uint32Array.BYTES_PER_ELEMENT,
    );
  const sourceFd = sourceData === undefined
    ? openSync(inputPath, "r")
    : undefined;
  const sourceBuffer = new Uint32Array(INTERVAL_BUFFER_RECORDS * 3);
  const heap = new PrefixHeap(nodes.length);
  const totalStreamGroups = sourcePrefixes.length * nodes.length;
  let completedStreamGroups = 0;
  for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex++) {
    heap.push(
      nodeIndex,
      0,
      addPackedHigh16(sourcePrefixes[0]!, nodes[nodeIndex]![0]),
    );
  }
  const writer = new IntervalWriter(outputPath);
  let exactCount = 0;
  let minimumTotal = Number.POSITIVE_INFINITY;
  let maximumTotal = Number.NEGATIVE_INFINITY;
  try {
    while (heap.size > 0) {
      heap.pop();
      const targetPrefix = heap.poppedPrefix;
      const intervals: number[] = [];

      const consume = (): void => {
        const node = nodes[heap.poppedNode]!;
        if (sourceData !== undefined) {
          appendTranslatedIntervalGroupFromArray(
            sourceData,
            sourceStarts[heap.poppedSourceIndex]!,
            sourceCounts[heap.poppedSourceIndex]!,
            node,
            intervals,
          );
        } else {
          appendTranslatedIntervalGroup(
            sourceFd!,
            sourceStarts[heap.poppedSourceIndex]!,
            sourceCounts[heap.poppedSourceIndex]!,
            node,
            sourceBuffer,
            intervals,
          );
        }
        completedStreamGroups++;
        const nextSourceIndex = heap.poppedSourceIndex + 1;
        if (nextSourceIndex < sourcePrefixes.length) {
          heap.push(
            heap.poppedNode,
            nextSourceIndex,
            addPackedHigh16(
              sourcePrefixes[nextSourceIndex]!,
              node[0],
            ),
          );
        }
      };

      consume();
      while (heap.size > 0 && heap.peekPrefix === targetPrefix) {
        heap.pop();
        consume();
      }
      maybeReportProgress(
        5 + (completedStreamGroups * 95) / totalStreamGroups,
      );

      mergeThirdIntervals(intervals);
      const [first, second] = unpackPrefix(targetPrefix);
      for (const encodedInterval of intervals) {
        const [third, start, end] = decodeThirdInterval(encodedInterval);
        exactCount += end - start + 1;
        minimumTotal = Math.min(minimumTotal, first + second + third + start);
        maximumTotal = Math.max(maximumTotal, first + second + third + end);
        writer.push(
          targetPrefix,
          ((third << 16) | start) >>> 0,
          end,
        );
      }
    }
    const writtenCount = writer.close();
    maybeReportProgress(100);
    return {
      intervalCount: writtenCount,
      exactCount,
      minimumTotal,
      maximumTotal,
    };
  } finally {
    if (sourceFd !== undefined) closeSync(sourceFd);
  }
}

function mergeSortedFiles(
  inputPaths: readonly string[],
  inputCounts: readonly number[],
  outputPath: string,
): number {
  const readers = inputPaths.map(
    (path, index) => new BinaryReader(path, inputCounts[index]!),
  );
  const heap = new RecordHeap(readers.length);
  for (let index = 0; index < readers.length; index++) {
    const reader = readers[index]!;
    if (reader.next()) {
      heap.push(index, 0, reader.current0, reader.current1);
    }
  }
  const writer = new BinaryWriter(outputPath);
  let hasLast = false;
  let last0 = 0;
  let last1 = 0;
  while (heap.size > 0) {
    heap.pop();
    if (
      !hasLast ||
      heap.poppedKey0 !== last0 ||
      heap.poppedKey1 !== last1
    ) {
      writer.push(heap.poppedKey0, heap.poppedKey1);
      hasLast = true;
      last0 = heap.poppedKey0;
      last1 = heap.poppedKey1;
    }
    const reader = readers[heap.poppedStream]!;
    if (reader.next()) {
      heap.push(
        heap.poppedStream,
        0,
        reader.current0,
        reader.current1,
      );
    }
  }
  for (const reader of readers) reader.close();
  return writer.close();
}

function countSortedUniqueFiles(
  inputPaths: readonly string[],
  inputCounts: readonly number[],
): number {
  const readers = inputPaths.map(
    (path, index) =>
      new BinaryReader(path, inputCounts[index]!),
  );
  const heap = new RecordHeap(readers.length);
  for (let index = 0; index < readers.length; index++) {
    const reader = readers[index]!;
    if (reader.next()) heap.push(index, 0, reader.current0, reader.current1);
  }
  let count = 0;
  let hasLast = false;
  let last0 = 0;
  let last1 = 0;
  while (heap.size > 0) {
    heap.pop();
    if (
      !hasLast ||
      heap.poppedKey0 !== last0 ||
      heap.poppedKey1 !== last1
    ) {
      count++;
      hasLast = true;
      last0 = heap.poppedKey0;
      last1 = heap.poppedKey1;
    }
    const reader = readers[heap.poppedStream]!;
    if (reader.next()) {
      heap.push(
        heap.poppedStream,
        0,
        reader.current0,
        reader.current1,
      );
    }
  }
  for (const reader of readers) reader.close();
  return count;
}

function scanIntervalLayer(
  path: string,
  count: number,
  thresholdKey: ThresholdKeyEvaluator,
  temporaryRoot: string,
  layerIndex: number,
  blockSize: number,
  thresholdKeysSorted: boolean,
): Omit<AttributeCombinationLayerResult, "name" | "candidateCount" | "traversalCount" | "thresholdUpperBound"> {
  const reader = new IntervalReader(path, count);
  const thresholdChunkPaths: string[] = [];
  const thresholdChunkCounts: number[] = [];
  const thresholdData = thresholdKeysSorted
    ? undefined
    : new Uint32Array(blockSize * 2);
  const thresholdScratch = new Uint32Array(2);
  let thresholdRecords = 0;
  let thresholdChunkIndex = 0;
  let thresholdCount = 0;
  let hasLastThreshold = false;
  let lastThreshold0 = 0;
  let lastThreshold1 = 0;
  let hasLastRaw = false;
  let lastPrefix = 0;
  let lastThirdAndStart = 0;
  let lastEnd = 0;
  let minimumTotal = Number.POSITIVE_INFINITY;
  let maximumTotal = Number.NEGATIVE_INFINITY;

  const flushThresholdChunk = (): void => {
    if (thresholdRecords === 0) return;
    radixSortPairs(
      thresholdData!,
      thresholdRecords,
      new Uint32Array(thresholdRecords * 2),
    );
    const thresholdChunkPath = join(
      temporaryRoot,
      `slot-${layerIndex}-threshold-${thresholdChunkIndex}.bin`,
    );
    const writer = new BinaryWriter(thresholdChunkPath);
    for (let index = 0; index < thresholdRecords; index++) {
      writer.push(
        thresholdData![index * 2]!,
        thresholdData![index * 2 + 1]!,
      );
    }
    thresholdChunkPaths.push(thresholdChunkPath);
    thresholdChunkCounts.push(writer.close());
    thresholdChunkIndex++;
    thresholdRecords = 0;
  };

  while (reader.next()) {
    const prefix = reader.currentPrefix;
    const thirdAndStart = reader.currentThirdAndStart;
    const end = reader.currentEnd;
    if (
      hasLastRaw &&
      (prefix < lastPrefix ||
        (prefix === lastPrefix &&
          (thirdAndStart < lastThirdAndStart ||
            (thirdAndStart === lastThirdAndStart && end < lastEnd))))
    ) {
      throw new Error("属性组合区间结果未按顺序递增");
    }
    hasLastRaw = true;
    lastPrefix = prefix;
    lastThirdAndStart = thirdAndStart;
    lastEnd = end;

    const [first, second] = unpackPrefix(prefix);
    const third = thirdAndStart >>> 16;
    const start = thirdAndStart & 0xffff;
    minimumTotal = Math.min(minimumTotal, first + second + third + start);
    maximumTotal = Math.max(maximumTotal, first + second + third + end);
    for (let speed = start; speed <= end; speed++) {
      thresholdKey(first, second, third, speed, thresholdScratch);
      if (thresholdKeysSorted) {
        if (
          hasLastThreshold &&
          (thresholdScratch[0]! < lastThreshold0 ||
            (thresholdScratch[0] === lastThreshold0 &&
              thresholdScratch[1]! < lastThreshold1))
        ) {
          throw new Error("阈值键未按属性组合顺序递增");
        }
        if (
          !hasLastThreshold ||
          thresholdScratch[0] !== lastThreshold0 ||
          thresholdScratch[1] !== lastThreshold1
        ) {
          thresholdCount++;
          hasLastThreshold = true;
          lastThreshold0 = thresholdScratch[0]!;
          lastThreshold1 = thresholdScratch[1]!;
        }
      } else {
        thresholdData![thresholdRecords * 2] = thresholdScratch[0]!;
        thresholdData![thresholdRecords * 2 + 1] = thresholdScratch[1]!;
        thresholdRecords++;
        if (thresholdRecords === blockSize) flushThresholdChunk();
      }
    }
  }
  reader.close();
  if (!thresholdKeysSorted) {
    flushThresholdChunk();
    thresholdCount = countSortedUniqueFiles(
      thresholdChunkPaths,
      thresholdChunkCounts,
    );
    for (const thresholdChunkPath of thresholdChunkPaths) {
      unlinkSync(thresholdChunkPath);
    }
  }
  return { thresholdCount, minimumTotal, maximumTotal };
}

function scanLayer(
  path: string,
  count: number,
  thresholdKey: ThresholdKeyEvaluator,
  temporaryRoot: string,
  layerIndex: number,
  blockSize: number,
  thresholdKeysSorted: boolean,
): Omit<AttributeCombinationLayerResult, "name" | "candidateCount" | "traversalCount" | "thresholdUpperBound"> {
  const reader = new BinaryReader(path, count);
  let hasLastRaw = false;
  let lastRaw0 = 0;
  let lastRaw1 = 0;
  let minimumTotal = Number.POSITIVE_INFINITY;
  let maximumTotal = Number.NEGATIVE_INFINITY;
  const thresholdChunkPaths: string[] = [];
  const thresholdChunkCounts: number[] = [];
  let thresholdCount = 0;
  let hasLastThreshold = false;
  let lastThreshold0 = 0;
  let lastThreshold1 = 0;
  let processed = 0;
  let thresholdChunkIndex = 0;
  while (processed < count) {
    const blockCount = Math.min(blockSize, count - processed);
    const thresholdData = thresholdKeysSorted
      ? undefined
      : new Uint32Array(blockCount * 2);
    const thresholdScratch = new Uint32Array(2);
    for (let index = 0; index < blockCount; index++) {
      if (!reader.next()) throw new Error("属性组合扫描数量与文件不一致");
      const first = reader.current0 >>> 16;
      const second = reader.current0 & 0xffff;
      const third = reader.current1 >>> 16;
      const fourth = reader.current1 & 0xffff;
      const absoluteIndex = processed + index;
      if (
        hasLastRaw &&
        (reader.current0 < lastRaw0 ||
          (reader.current0 === lastRaw0 && reader.current1 < lastRaw1))
      ) {
        throw new Error(`属性组合归并结果未排序：记录=${absoluteIndex}`);
      }
      hasLastRaw = true;
      lastRaw0 = reader.current0;
      lastRaw1 = reader.current1;
      const total = first + second + third + fourth;
      minimumTotal = Math.min(minimumTotal, total);
      maximumTotal = Math.max(maximumTotal, total);
      thresholdKey(first, second, third, fourth, thresholdScratch);
      if (thresholdKeysSorted) {
        if (
          hasLastThreshold &&
          (thresholdScratch[0]! < lastThreshold0 ||
            (thresholdScratch[0] === lastThreshold0 &&
              thresholdScratch[1]! < lastThreshold1))
        ) {
          throw new Error(
            `阈值键未按属性组合顺序递增：记录=${absoluteIndex}` +
              `；上一原始=${lastRaw0 >>> 16},${lastRaw0 & 0xffff},${lastRaw1 >>> 16},${lastRaw1 & 0xffff}` +
              `；当前原始=${first},${second},${third},${fourth}` +
              `；上一键=${lastThreshold0},${lastThreshold1}` +
              `；当前键=${thresholdScratch[0]},${thresholdScratch[1]}`,
          );
        }
        if (
          !hasLastThreshold ||
          thresholdScratch[0] !== lastThreshold0 ||
          thresholdScratch[1] !== lastThreshold1
        ) {
          thresholdCount++;
          hasLastThreshold = true;
          lastThreshold0 = thresholdScratch[0]!;
          lastThreshold1 = thresholdScratch[1]!;
        }
      } else {
        thresholdData![index * 2] = thresholdScratch[0]!;
        thresholdData![index * 2 + 1] = thresholdScratch[1]!;
      }
    }
    if (!thresholdKeysSorted) {
      radixSortPairs(
        thresholdData!,
        blockCount,
        new Uint32Array(blockCount * 2),
      );
      const thresholdChunkPath = join(
        temporaryRoot,
        `slot-${layerIndex}-threshold-${thresholdChunkIndex}.bin`,
      );
      const writer = new BinaryWriter(thresholdChunkPath);
      for (let index = 0; index < blockCount; index++) {
        writer.push(thresholdData![index * 2]!, thresholdData![index * 2 + 1]!);
      }
      thresholdChunkPaths.push(thresholdChunkPath);
      thresholdChunkCounts.push(writer.close());
      thresholdChunkIndex++;
    }
    processed += blockCount;
  }
  reader.close();
  if (!thresholdKeysSorted) {
    thresholdCount = countSortedUniqueFiles(
      thresholdChunkPaths,
      thresholdChunkCounts,
    );
    for (const thresholdChunkPath of thresholdChunkPaths) {
      unlinkSync(thresholdChunkPath);
    }
  }
  return { thresholdCount, minimumTotal, maximumTotal };
}

export function countAttributeCombinationLayers(
  options: AttributeCombinationCounterOptions,
): AttributeCombinationLayerResult[] {
  if (options.slots.length === 0) return [];
  const blockSize = options.blockSize ?? 2_000_000;
  if (!Number.isInteger(blockSize) || blockSize < 1) {
    throw new RangeError("属性组合分块大小必须是正整数");
  }
  mkdirSync(options.workRoot, { recursive: true });
  const runRoot = mkdtempSync(join(options.workRoot, "run-"));
  const results: AttributeCombinationLayerResult[] = [];
  const startedAt = Date.now();
  let inputPath = join(runRoot, "initial.bin");
  let inputIntervalCount = 1;
  let inputExactCount = 1;
  const initialWriter = new IntervalWriter(inputPath, 1);
  initialWriter.push(0, 0, 0);
  initialWriter.close();
  try {
    for (let slotIndex = 0; slotIndex < options.slots.length; slotIndex++) {
      const slot = options.slots[slotIndex]!;
      if (slot.candidates.length === 0) {
        throw new Error(`槽位 ${slot.name} 没有候选属性`);
      }
      const nodes: [number, number][] = [];
      for (const candidate of slot.candidates) {
        const node = packVector(candidate);
        if (
          nodes.every(
            (existing) => existing[0] !== node[0] || existing[1] !== node[1],
          )
        ) {
          nodes.push(node);
        }
      }
      const outputPath = join(runRoot, `slot-${slotIndex}-merged.bin`);
      const layerStartedAt = Date.now();
      const traversalCount =
        BigInt(inputExactCount) * BigInt(slot.candidates.length);
      const merged = mergeTranslatedFileByIntervals(
        inputPath,
        inputIntervalCount,
        nodes,
        outputPath,
        (percent) =>
          options.onLayerProgress?.({
            name: slot.name,
            percent,
            elapsedMs: Date.now() - startedAt,
            layerElapsedMs: Date.now() - layerStartedAt,
            traversalCount,
          }),
      );
      if (inputPath !== join(runRoot, "initial.bin")) unlinkSync(inputPath);
      const scanned = scanIntervalLayer(
        outputPath,
        merged.intervalCount,
        options.thresholdKey,
        runRoot,
        slotIndex,
        blockSize,
        options.thresholdKeysSorted ?? false,
      );
      const thresholdUpperBound = options.thresholdUpperBound(
        scanned.minimumTotal,
        scanned.maximumTotal,
      );
      if (BigInt(scanned.thresholdCount) > thresholdUpperBound) {
        throw new Error(
          `槽位=${slot.name} 的阈值组合数超过理论范围上限：` +
            `实际=${scanned.thresholdCount}；理论=${thresholdUpperBound}`,
        );
      }
      const result = {
        name: slot.name,
        candidateCount: slot.candidates.length,
        traversalCount,
        exactCount: merged.exactCount,
        thresholdCount: scanned.thresholdCount,
        minimumTotal: scanned.minimumTotal,
        maximumTotal: scanned.maximumTotal,
        thresholdUpperBound,
      } satisfies AttributeCombinationLayerResult;
      results.push(result);
      options.onLayerComplete?.(result);
      inputPath = outputPath;
      inputIntervalCount = merged.intervalCount;
      inputExactCount = merged.exactCount;
    }
    return results;
  } finally {
    if (!options.keepTemporaryFiles) {
      rmSync(runRoot, { recursive: true, force: true });
    }
  }
}
