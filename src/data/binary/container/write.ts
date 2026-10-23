import {
  MAGIC,
  FORMAT_VERSION,
  SECTION_IDS,
  HEADER_BYTES,
  containerHeaderSchema,
  containerEntrySchema,
} from "../schema.ts";
import { ByteWriter, assertUInt, fail } from "../shared/bytes.ts";
import { writeValue } from "../shared/schema-write.ts";
import { crc32 } from "../shared/crc.ts";

export function writeContainer(
  sections: ReadonlyMap<number, Uint8Array>,
): Uint8Array {
  if (sections.size !== SECTION_IDS.length) fail("生成段数量异常");
  let size = HEADER_BYTES + 4;
  for (const id of SECTION_IDS) {
    const bytes = sections.get(id);
    if (!bytes) fail(`生成段 ${id} 缺失`);
    size += bytes.length;
  }
  assertUInt(size, 32, "文件长度");
  const bytes = new Uint8Array(size),
    view = new DataView(bytes.buffer);
  const header = new ByteWriter();
  const noStrings = (): never => fail("容器不能引用字符串");
  header.append(MAGIC);
  writeValue(
    header,
    containerHeaderSchema,
    {
      version: FORMAT_VERSION,
      flags: 0,
      sectionCount: SECTION_IDS.length,
      headerBytes: HEADER_BYTES,
    },
    noStrings,
    "容器头",
  );
  let offset = HEADER_BYTES;
  for (const id of SECTION_IDS) {
    const payload = sections.get(id)!;
    writeValue(
      header,
      containerEntrySchema,
      { id, codec: 0, reserved: 0, offset, length: payload.length },
      noStrings,
      "段目录",
    );
    bytes.set(payload, offset);
    offset += payload.length;
  }
  bytes.set(header.finish());
  view.setUint32(size - 4, crc32(bytes.subarray(0, -4)), true);
  return bytes;
}
