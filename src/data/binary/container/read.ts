import {
  MAGIC,
  FORMAT_VERSION,
  SECTION_IDS,
  HEADER_BYTES,
  containerHeaderSchema,
  containerEntrySchema,
  type ContainerHeader,
  type ContainerEntry,
} from "../schema.ts";
import { ByteReader, fail } from "../shared/bytes.ts";
import { readValue } from "../shared/schema-read.ts";
import { crc32 } from "../shared/crc.ts";
import {
  timingStart,
  reportTiming,
  type TimingCallback,
} from "../shared/timing.ts";

export function readContainer(
  input: Uint8Array | ArrayBuffer,
  onTiming?: TimingCallback,
): Map<number, Uint8Array> {
  const start = timingStart(onTiming);
  if (!(input instanceof Uint8Array) && !(input instanceof ArrayBuffer))
    fail("输入不是二进制缓冲区");
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length < HEADER_BYTES + 4) fail("文件头、目录或校验码被截断");
  if (MAGIC.some((byte, index) => byte !== bytes[index])) fail("magic 不匹配");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const reader = new ByteReader(bytes, "文件容器");
  reader.slice(MAGIC.length);
  const noStrings = { length: 0, get: (): never => fail("容器不能引用字符串") };
  const header = readValue(
    reader,
    containerHeaderSchema,
    noStrings,
  ) as ContainerHeader;
  if (header.version !== FORMAT_VERSION)
    fail(`不支持的格式版本 ${header.version}`);
  if (header.flags !== 0) fail("文件头 flags 非零");
  if (header.sectionCount !== SECTION_IDS.length) fail("section 数量异常");
  if (header.headerBytes !== HEADER_BYTES) fail("header 长度无效");
  if (view.getUint32(bytes.length - 4, true) !== crc32(bytes.subarray(0, -4)))
    fail("文件 CRC-32 不匹配");
  const sections = new Map<number, Uint8Array>();
  let offset = HEADER_BYTES;
  for (const id of SECTION_IDS) {
    const entry = readValue(
      reader,
      containerEntrySchema,
      noStrings,
    ) as ContainerEntry;
    if (entry.id !== id) fail("section ID 顺序或内容无效");
    if (entry.codec !== 0 || entry.reserved !== 0)
      fail("section codec 或保留位非零");
    const start = entry.offset,
      length = entry.length;
    if (start !== offset || length > bytes.length - 4 - start)
      fail("section 偏移不连续或长度越界");
    sections.set(id, bytes.subarray(start, start + length));
    offset += length;
  }
  if (offset !== bytes.length - 4) fail("文件长度包含尾随数据或与目录不一致");
  reportTiming(onTiming, "containerIntegrityAndCrcMs", start);
  return sections;
}
