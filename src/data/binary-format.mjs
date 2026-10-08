const MAGIC = new TextEncoder().encode("FFXIVGDB");
const FORMAT_VERSION = 2;
const SECTION_IDS = [1, 2];
const DIRECTORY_ENTRY_BYTES = 12;
const HEADER_BYTES = 16 + SECTION_IDS.length * DIRECTORY_ENTRY_BYTES;
const SECTION_NAMES = new Map([
  [1, "GAME_DATA_BINARY"],
  [2, "GEAR_CATALOG_BINARY"],
]);
const VALUE_TAG = { NULL: 0, FALSE: 1, TRUE: 2, I32: 3, U32: 4, F64: 5, STRING: 6, ARRAY: 7, OBJECT: 8 };
const SLOT_NAMES = [
  "weapon", "offhand", "head", "body", "hands", "legs", "feet",
  "earrings", "necklace", "bracelet", "ring",
];
const SLOT_CODES = new Map(SLOT_NAMES.map((slot, index) => [slot, index]));
const STAT_NAMES = [
  "STR", "DEX", "INT", "MND", "VIT", "CRT", "DET", "DHT", "SKS",
  "SPS", "TEN", "PIE", "PDMG", "MDMG", "DLY",
];
const STAT_CODES = new Map(STAT_NAMES.map((stat, index) => [stat, index]));
const CUSTOM_STAT_NAMES = ["CRT", "DET", "DHT", "SKS", "SPS", "TEN", "PIE"];
const CUSTOM_STAT_CODES = new Map(CUSTOM_STAT_NAMES.map((stat, index) => [stat, index]));
const MAIN_STATS = ["VIT", "STR", "DEX", "MND", "INT"];
const MAIN_STAT_CODES = new Map(MAIN_STATS.map((stat, index) => [stat, index]));

function fail(message) {
  throw new Error(`生成数据二进制格式错误：${message}`);
}

function timingStart(onTiming) {
  return onTiming ? globalThis.performance.now() : 0;
}

function reportTiming(onTiming, phase, startedAt) {
  if (onTiming) onTiming(phase, globalThis.performance.now() - startedAt);
}

function assertUInt(value, bits, label) {
  const max = bits === 32 ? 0xffffffff : 2 ** bits - 1;
  if (!Number.isSafeInteger(value) || value < 0 || value > max)
    fail(`${label} 超出 u${bits} 范围：${value}`);
}

class ByteWriter {
  #bytes = new Uint8Array(1024);
  #length = 0;

  #reserve(length) {
    const required = this.#length + length;
    if (required > this.#bytes.length) {
      let capacity = this.#bytes.length;
      while (capacity < required) capacity = Math.max(capacity * 2, required);
      const next = new Uint8Array(capacity);
      next.set(this.#bytes.subarray(0, this.#length));
      this.#bytes = next;
    }
    const offset = this.#length;
    this.#length = required;
    return offset;
  }

  u8(value, label) {
    assertUInt(value, 8, label);
    const offset = this.#reserve(1);
    this.#bytes[offset] = value;
  }

  u16(value, label) {
    assertUInt(value, 16, label);
    const offset = this.#reserve(2);
    new DataView(this.#bytes.buffer).setUint16(offset, value, true);
  }

  i16(value, label) {
    if (!Number.isSafeInteger(value) || value < -32768 || value > 32767)
      fail(`${label} 超出 i16 范围：${value}`);
    const offset = this.#reserve(2);
    new DataView(this.#bytes.buffer).setInt16(offset, value, true);
  }

  u32(value, label) {
    assertUInt(value, 32, label);
    const offset = this.#reserve(4);
    new DataView(this.#bytes.buffer).setUint32(offset, value, true);
  }

  i32(value, label) {
    if (!Number.isSafeInteger(value) || value < -0x80000000 || value > 0x7fffffff)
      fail(`${label} 超出 i32 范围：${value}`);
    const offset = this.#reserve(4);
    new DataView(this.#bytes.buffer).setInt32(offset, value, true);
  }

  f64(value) {
    const offset = this.#reserve(8);
    new DataView(this.#bytes.buffer).setFloat64(offset, value, true);
  }

  varUint(value, label) {
    if (!Number.isSafeInteger(value) || value < 0) fail(`${label} 不是有效的安全无符号整数`);
    while (value >= 128) {
      this.u8((value % 128) | 0x80, label);
      value = Math.floor(value / 128);
    }
    this.u8(value, label);
  }

  append(bytes) {
    const offset = this.#reserve(bytes.byteLength);
    this.#bytes.set(bytes, offset);
  }

  finish() {
    return this.#bytes.slice(0, this.#length);
  }
}

function collectBinaryStrings(value, strings, stringIndexes, ancestors = new WeakSet()) {
  if (typeof value === "string") {
    if (!stringIndexes.has(value)) {
      stringIndexes.set(value, strings.length);
      strings.push(value);
    }
    return;
  }
  if (!value || typeof value !== "object") return;
  if (ancestors.has(value)) fail("数据值包含循环引用");
  ancestors.add(value);
  if (Array.isArray(value)) {
    for (const item of value) collectBinaryStrings(item, strings, stringIndexes, ancestors);
  } else {
    for (const [key, item] of Object.entries(value)) {
      if (item === undefined) continue;
      collectBinaryStrings(key, strings, stringIndexes, ancestors);
      collectBinaryStrings(item, strings, stringIndexes, ancestors);
    }
  }
  ancestors.delete(value);
}

function encodeBinaryValueInto(writer, value, stringIndexes, label) {
  if (value === null || value === undefined) {
    writer.u8(VALUE_TAG.NULL, label);
  } else if (value === false) {
    writer.u8(VALUE_TAG.FALSE, label);
  } else if (value === true) {
    writer.u8(VALUE_TAG.TRUE, label);
  } else if (typeof value === "number") {
    if (!Number.isFinite(value)) fail(`${label} 含非有限数值`);
    if (Number.isInteger(value) && value >= -0x80000000 && value <= 0x7fffffff) {
      writer.u8(VALUE_TAG.I32, label);
      writer.i32(value, label);
    } else if (Number.isSafeInteger(value) && value >= 0 && value <= 0xffffffff) {
      writer.u8(VALUE_TAG.U32, label);
      writer.u32(value, label);
    } else {
      writer.u8(VALUE_TAG.F64, label);
      writer.f64(value);
    }
  } else if (typeof value === "string") {
    writer.u8(VALUE_TAG.STRING, label);
    writer.varUint(stringIndexes.get(value), `${label} 字符串序号`);
  } else if (Array.isArray(value)) {
    writer.u8(VALUE_TAG.ARRAY, label);
    writer.varUint(value.length, `${label} 数组长度`);
    for (const item of value) encodeBinaryValueInto(writer, item, stringIndexes, label);
  } else if (typeof value === "object") {
    const entries = Object.entries(value).filter(([, item]) => item !== undefined);
    writer.u8(VALUE_TAG.OBJECT, label);
    writer.varUint(entries.length, `${label} 对象字段数`);
    for (const [key, item] of entries) {
      writer.varUint(stringIndexes.get(key), `${label} 字段名字串序号`);
      encodeBinaryValueInto(writer, item, stringIndexes, label);
    }
  } else {
    fail(`${label} 含不支持的值类型 ${typeof value}`);
  }
}

function encodeBinaryValue(value, label) {
  const strings = [];
  const stringIndexes = new Map();
  collectBinaryStrings(value, strings, stringIndexes);
  const writer = new ByteWriter();
  writer.varUint(strings.length, `${label} 字符串表数量`);
  const encoder = new TextEncoder();
  for (const string of strings) {
    const encoded = encoder.encode(string);
    writer.varUint(encoded.byteLength, `${label} UTF-8 字符串长度`);
    writer.append(encoded);
  }
  encodeBinaryValueInto(writer, value, stringIndexes, label);
  return writer.finish();
}

class BinaryValueReader {
  constructor(bytes, label) {
    this.bytes = bytes;
    this.label = label;
    this.offset = 0;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  require(length) {
    if (length < 0 || this.offset + length > this.bytes.byteLength)
      fail(`${this.label} 在偏移 ${this.offset} 处被截断`);
  }

  u8() {
    this.require(1);
    return this.bytes[this.offset++];
  }

  u16() {
    this.require(2);
    const value = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return value;
  }

  i16() {
    this.require(2);
    const value = this.view.getInt16(this.offset, true);
    this.offset += 2;
    return value;
  }

  u32() {
    this.require(4);
    const value = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return value;
  }

  i32() {
    this.require(4);
    const value = this.view.getInt32(this.offset, true);
    this.offset += 4;
    return value;
  }

  f64() {
    this.require(8);
    const value = this.view.getFloat64(this.offset, true);
    this.offset += 8;
    return value;
  }

  varUint() {
    let value = 0;
    let multiplier = 1;
    for (let index = 0; index < 8; index++) {
      const byte = this.u8();
      value += (byte & 0x7f) * multiplier;
      if (!Number.isSafeInteger(value)) fail(`${this.label} 无符号整数超出安全范围`);
      if (!(byte & 0x80)) return value;
      multiplier *= 128;
    }
    fail(`${this.label} 无符号整数编码过长`);
  }

  slice(length) {
    this.require(length);
    const result = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return result;
  }

  finish() {
    if (this.offset !== this.bytes.byteLength)
      fail(`${this.label} 含 ${this.bytes.byteLength - this.offset} 字节尾随数据`);
  }
}

function decodeBinaryValueFrom(reader, strings, depth = 0) {
  if (depth > 512) fail(`${reader.label} 嵌套层数过深`);
  const tag = reader.u8();
  if (tag === VALUE_TAG.NULL) return null;
  if (tag === VALUE_TAG.FALSE) return false;
  if (tag === VALUE_TAG.TRUE) return true;
  if (tag === VALUE_TAG.I32) return reader.i32();
  if (tag === VALUE_TAG.U32) return reader.u32();
  if (tag === VALUE_TAG.F64) {
    const value = reader.f64();
    if (!Number.isFinite(value)) fail(`${reader.label} 含非有限数值`);
    return value;
  }
  if (tag === VALUE_TAG.STRING) {
    const index = reader.varUint();
    if (index >= strings.length) fail(`${reader.label} 引用了不存在的字符串 ${index}`);
    return readBinaryValueString(strings, index, reader.label);
  }
  if (tag === VALUE_TAG.ARRAY) {
    const count = reader.varUint();
    if (count > reader.bytes.byteLength - reader.offset)
      fail(`${reader.label} 数组长度超出剩余数据`);
    const values = new Array(count);
    for (let index = 0; index < count; index++)
      values[index] = decodeBinaryValueFrom(reader, strings, depth + 1);
    return values;
  }
  if (tag === VALUE_TAG.OBJECT) {
    const count = reader.varUint();
    if (count > Math.floor((reader.bytes.byteLength - reader.offset) / 2))
      fail(`${reader.label} 对象字段数超出剩余数据`);
    const entries = new Array(count);
    for (let index = 0; index < count; index++) {
      const keyIndex = reader.varUint();
      if (keyIndex >= strings.length) fail(`${reader.label} 引用了不存在的字段名 ${keyIndex}`);
      entries[index] = [readBinaryValueString(strings, keyIndex, reader.label), decodeBinaryValueFrom(reader, strings, depth + 1)];
    }
    return Object.fromEntries(entries);
  }
  fail(`${reader.label} 包含未知值类型 ${tag}`);
}

function validateGearForWrite(gear, jobIndexes, seenIds) {
  if (!gear || typeof gear !== 'object' || !Number.isSafeInteger(gear.id) || gear.id <= 0)
    fail('装备包含无效 ID');
  if (seenIds.has(gear.id)) fail('装备 ID 重复：' + gear.id);
  seenIds.add(gear.id);
  if (typeof gear.name !== 'string' || !gear.name.trim()) fail('装备 ' + gear.id + ' 名称无效');
  if (typeof gear.sourceFile !== 'string' || !gear.sourceFile ||
      !Array.isArray(gear.dataSources) || !gear.dataSources.length)
    fail('装备 ' + gear.id + ' 缺少逐件来源记录');
  for (const source of gear.dataSources) {
    if (!source || typeof source !== 'object' || Array.isArray(source))
      fail('装备 ' + gear.id + ' 含无效逐件来源记录');
    if (Object.hasOwn(source, 'rowIds') && !Array.isArray(source.rowIds))
      fail('装备 ' + gear.id + ' 的来源 rowIds 无效');
    if (Object.hasOwn(source, 'sourceFiles') && !Array.isArray(source.sourceFiles))
      fail('装备 ' + gear.id + ' 的来源 sourceFiles 无效');
  }
  if (!Array.isArray(gear.jobs) || !gear.jobs.length || new Set(gear.jobs).size !== gear.jobs.length)
    fail('装备 ' + gear.id + ' 的适用职业为空或重复');
  if (!gear.stats || typeof gear.stats !== 'object' || Array.isArray(gear.stats))
    fail('装备 ' + gear.id + ' 的属性表无效');
  if (!SLOT_CODES.has(gear.slot)) fail('装备 ' + gear.id + ' 的槽位无效');
  for (const [label, value, bits] of [
    ['id', gear.id, 32],
    ['level', gear.level, 16],
    ['equipLevel', gear.equipLevel, 8],
    ['rawSlot', gear.rawSlot, 8],
    ['roleId', gear.roleId, 8],
    ['jobCategory', gear.jobCategory, 16],
    ['materiaSlots', gear.materiaSlots, 8],
  ]) {
    try {
      assertUInt(value, bits, '装备 ' + gear.id + ' ' + label);
    } catch (error) {
      throw error;
    }
  }
  for (const [stat, value] of Object.entries(gear.stats)) {
    if (!STAT_CODES.has(stat) || !Number.isSafeInteger(value) || value < -32768 || value > 32767)
      fail('装备 ' + gear.id + ' 的属性 ' + stat + ' 超出二进制格式范围');
  }
  for (const jobId of gear.jobs)
    if (!jobIndexes.has(jobId)) fail('装备 ' + gear.id + ' 引用了未知职业 ' + jobId);
  if (Object.hasOwn(gear, 'unique') && typeof gear.unique !== 'boolean')
    fail('装备 ' + gear.id + ' 的 unique 不是布尔值');
  if (Object.hasOwn(gear, 'materiaAdvanced') && typeof gear.materiaAdvanced !== 'boolean')
    fail('装备 ' + gear.id + ' 的 materiaAdvanced 不是布尔值');
  if (Object.hasOwn(gear, 'customParameters') && !Array.isArray(gear.customParameters))
    fail('装备 ' + gear.id + ' 的 customParameters 不是数组');
  if (gear.customParameters?.length > 255)
    fail('装备 ' + gear.id + ' 的 customParameters 数量超出 u8');
  for (const parameter of gear.customParameters ?? []) {
    if (CUSTOM_STAT_CODES.get(parameter?.stat) === undefined)
      fail('装备 ' + gear.id + ' 含未知自定义参数属性');
  }
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
    );
  return value;
}

function prepareGearMetadata(gears) {
  const sourceTemplates = [];
  const templateIds = new Map();
  const rows = gears.map((gear) => {
    const dataSources = gear.dataSources.map((source) => {
      const template = {};
      for (const [key, value] of Object.entries(source))
        if (key !== 'rowIds' && key !== 'sourceFiles' && value !== undefined) template[key] = value;
      const templateKey = JSON.stringify(canonicalize(template));
      let templateId = templateIds.get(templateKey);
      if (templateId === undefined) {
        templateId = sourceTemplates.length;
        templateIds.set(templateKey, templateId);
        sourceTemplates.push(template);
      }
      return {
        templateId,
        hasRowIds: Object.hasOwn(source, 'rowIds'),
        rowIds: source.rowIds,
        hasSourceFiles: Object.hasOwn(source, 'sourceFiles'),
        sourceFiles: source.sourceFiles,
      };
    });
    return {
      name: gear.name,
      hasSource: Object.hasOwn(gear, 'source') && gear.source !== undefined,
      source: gear.source,
      sourceFile: gear.sourceFile,
      dataSources,
    };
  });
  return { sourceTemplates, rows };
}

function encodeBinaryValueData(value, stringIndexes, label) {
  const writer = new ByteWriter();
  encodeBinaryValueInto(writer, value, stringIndexes, label);
  return writer.finish();
}

function encodeGearStringTable(writer, strings, stringIndexes) {
  const encoder = new TextEncoder();
  const encoded = strings.map((value) => encoder.encode(value));
  let byteLength = 0;
  for (const value of encoded) {
    byteLength += value.byteLength;
    assertUInt(byteLength, 32, '装备 UTF-8 字符串表长度');
  }

  writer.u32(strings.length, '装备字符串数量');
  let offset = 0;
  writer.u32(offset, '装备字符串偏移');
  for (const value of encoded) {
    offset += value.byteLength;
    writer.u32(offset, '装备字符串偏移');
  }
  for (const value of encoded) writer.append(value);
  return stringIndexes;
}

function encodeGearRecordBody(gear, row, jobIndexes, stringIndexes) {
  const writer = new ByteWriter();
  let flags = 0;
  if (gear.materiaAdvanced === true) flags |= 1;
  if (gear.unique === true) flags |= 2;
  const customParameters = gear.customParameters ?? [];
  let statMask = 0;
  for (const stat of STAT_NAMES)
    if (Object.hasOwn(gear.stats, stat)) statMask |= 1 << STAT_CODES.get(stat);

  writer.u8(SLOT_CODES.get(gear.slot), '装备槽位代码');
  writer.u8(gear.equipLevel, '装备穿戴等级');
  writer.u8(gear.rawSlot, '装备原始槽位');
  writer.u8(gear.roleId, '装备角色分类 ID');
  writer.u16(gear.jobCategory, '装备职业分类 ID');
  writer.u8(gear.materiaSlots, '装备魔晶石孔数');
  writer.u8(flags, '装备标志');
  writer.u8(gear.jobs.length, '装备适用职业数');
  for (const jobId of gear.jobs) writer.u8(jobIndexes.get(jobId), '装备职业序号');
  writer.u16(statMask, '装备属性掩码');
  for (const stat of STAT_NAMES)
    if (statMask & (1 << STAT_CODES.get(stat))) writer.i16(gear.stats[stat], '装备属性 ' + stat);

  writer.u8(customParameters.length, '装备自定义参数数量');
  for (const parameter of customParameters) {
    const statCode = CUSTOM_STAT_CODES.get(parameter.stat);
    writer.u32(parameter.materiaId, '装备 materiaId');
    writer.u8(statCode, '装备自定义属性代码');
    writer.u8(parameter.bigValueIndex, '装备 bigValueIndex');
    writer.u8(parameter.smallValueIndex, '装备 smallValueIndex');
    writer.u16(parameter.bigValue, '装备 bigValue');
    writer.u16(parameter.smallValue, '装备 smallValue');
  }

  writer.varUint(stringIndexes.get(row.name), '装备名称字符串序号');
  writer.u8(row.hasSource ? 1 : 0, '装备来源存在标志');
  if (row.hasSource) writer.varUint(stringIndexes.get(row.source), '装备来源字符串序号');
  writer.varUint(stringIndexes.get(row.sourceFile), '装备来源文件字符串序号');
  writer.varUint(row.dataSources.length, '装备逐件来源记录数');
  for (const source of row.dataSources) {
    writer.varUint(source.templateId, '装备来源模板序号');
    let dynamicMask = 0;
    if (source.hasRowIds) dynamicMask |= 1;
    if (source.hasSourceFiles) dynamicMask |= 2;
    writer.u8(dynamicMask, '装备来源动态字段掩码');
    if (dynamicMask & 1)
      encodeBinaryValueInto(writer, source.rowIds, stringIndexes, '装备来源 rowIds');
    if (dynamicMask & 2)
      encodeBinaryValueInto(writer, source.sourceFiles, stringIndexes, '装备来源 sourceFiles');
  }
  return writer.finish();
}

const PHYSICAL_GROUPS = [...MAIN_STATS, 'SHARED'];

function encodeGearCatalog(gearsInput, jobSchemas) {
  const jobIds = Object.keys(jobSchemas ?? {});
  if (!jobIds.length || jobIds.length > 255) fail('职业数量无效：' + jobIds.length);
  const jobIndexes = new Map(jobIds.map((jobId, index) => [jobId, index]));
  for (const [jobId, schema] of Object.entries(jobSchemas))
    if (!MAIN_STAT_CODES.has(schema?.mainStat)) fail('职业 ' + jobId + ' 缺少有效主属性');

  const sortedInput = gearsInput.slice().sort((left, right) =>
    left.level - right.level || left.id - right.id);
  const seenIds = new Set();
  for (const gear of sortedInput) validateGearForWrite(gear, jobIndexes, seenIds);

  const physicalMembers = new Map(PHYSICAL_GROUPS.map((group) => [group, []]));
  for (const gear of sortedInput) {
    const applicableMainStats = new Set(gear.jobs.map((jobId) => jobSchemas[jobId].mainStat));
    const physicalGroup = applicableMainStats.size === 1
      ? applicableMainStats.values().next().value
      : 'SHARED';
    physicalMembers.get(physicalGroup).push(gear);
  }
  const gears = PHYSICAL_GROUPS.flatMap((group) => physicalMembers.get(group));
  const gearGroupByIndex = new Array(gears.length);
  const recordIndexById = new Map();
  const gearPhysicalGroupRanges = {};
  let globalIndex = 0;
  for (const physicalGroup of PHYSICAL_GROUPS) {
    const members = physicalMembers.get(physicalGroup);
    gearPhysicalGroupRanges[physicalGroup] = { start: globalIndex, count: members.length };
    for (const gear of members) {
      gearGroupByIndex[globalIndex] = physicalGroup;
      recordIndexById.set(gear.id, globalIndex++);
    }
  }

  const metadata = prepareGearMetadata(gears);
  const strings = [];
  const stringIndexes = new Map();
  const collect = (value) => collectBinaryStrings(value, strings, stringIndexes);
  for (let index = 0; index < gears.length; index++) {
    const row = metadata.rows[index];
    collect(row.name);
    if (row.hasSource) collect(row.source);
    collect(row.sourceFile);
    for (const source of row.dataSources) {
      if (source.hasRowIds) collect(source.rowIds);
      if (source.hasSourceFiles) collect(source.sourceFiles);
    }
  }
  collect(metadata.sourceTemplates);

  const recordBodiesByGroup = new Map(PHYSICAL_GROUPS.map((group) => [group, []]));
  const groupByteLengths = new Map(PHYSICAL_GROUPS.map((group) => [group, 0]));
  let statUnionMask = 0;
  for (let globalRecordIndex = 0; globalRecordIndex < gears.length; globalRecordIndex++) {
    const gear = gears[globalRecordIndex];
    for (const stat of Object.keys(gear.stats))
      statUnionMask |= 1 << STAT_CODES.get(stat);
    const body = encodeGearRecordBody(gear, metadata.rows[globalRecordIndex], jobIndexes, stringIndexes);
    const physicalGroup = gearGroupByIndex[globalRecordIndex];
    recordBodiesByGroup.get(physicalGroup).push(body);
    groupByteLengths.set(physicalGroup, groupByteLengths.get(physicalGroup) + body.byteLength);
    assertUInt(groupByteLengths.get(physicalGroup), 32, physicalGroup + ' 记录体长度');
  }

  const logicalGroups = new Map(MAIN_STATS.map((mainStat) => [mainStat, []]));
  for (const mainStat of MAIN_STATS) {
    const refs = logicalGroups.get(mainStat);
    for (const gear of physicalMembers.get(mainStat))
      refs.push(recordIndexById.get(gear.id));
    for (const gear of physicalMembers.get('SHARED'))
      if (gear.jobs.some((jobId) => jobSchemas[jobId].mainStat === mainStat))
        refs.push(recordIndexById.get(gear.id));
    refs.sort((left, right) => {
      const a = gears[left];
      const b = gears[right];
      return a.level - b.level || a.id - b.id;
    });
  }

  const writer = new ByteWriter();
  writer.u16(statUnionMask, '装备属性并集掩码');
  writer.u16(sortedInput[0]?.level ?? 0, '装备最低品级');
  writer.u16(sortedInput.at(-1)?.level ?? 0, '装备最高品级');
  encodeGearStringTable(writer, strings, stringIndexes);
  const templateBytes = encodeBinaryValueData(metadata.sourceTemplates, stringIndexes, '装备来源模板');
  writer.u32(templateBytes.byteLength, '装备来源模板编码长度');
  writer.append(templateBytes);

  writer.u8(PHYSICAL_GROUPS.length, '装备物理组数量');
  for (const physicalGroup of PHYSICAL_GROUPS) {
    writer.u8(MAIN_STAT_CODES.get(physicalGroup) ?? MAIN_STATS.length, physicalGroup + ' 物理组代码');
    writer.u32(physicalMembers.get(physicalGroup).length, physicalGroup + ' 装备数');
    writer.u32(groupByteLengths.get(physicalGroup), physicalGroup + ' 记录体字节数');
  }

  for (const physicalGroup of PHYSICAL_GROUPS) {
    const members = physicalMembers.get(physicalGroup);
    const bodies = recordBodiesByGroup.get(physicalGroup);
    let bodyOffset = 0;
    for (let index = 0; index < members.length; index++) {
      const gear = members[index];
      writer.u32(gear.id, '装备目录 ID');
      writer.u16(gear.level, '装备目录品级');
      writer.u32(bodyOffset, '装备目录组内记录偏移');
      bodyOffset += bodies[index].byteLength;
    }
  }

  writer.u8(MAIN_STATS.length, '逻辑主属性索引数量');
  const groupCounts = {};
  for (const [groupCode, mainStat] of MAIN_STATS.entries()) {
    const refs = logicalGroups.get(mainStat);
    groupCounts[mainStat] = refs.length;
    writer.u8(groupCode, mainStat + ' 主属性代码');
    writer.u32(refs.length, mainStat + ' 主属性引用数');
    for (const recordIndex of refs)
      writer.u32(recordIndex, mainStat + ' 全局装备记录序号');
  }

  for (const physicalGroup of PHYSICAL_GROUPS)
    for (const body of recordBodiesByGroup.get(physicalGroup)) writer.append(body);

  return { bytes: writer.finish(), gears, groupCounts, gearPhysicalGroupRanges };
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index++) {
    let crc = index;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc & 1) ? (0xEDB88320 ^ (crc >>> 1)) : (crc >>> 1);
    table[index] = crc >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xFFFFFFFF;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function assembleContainer(sections) {
  let totalBytes = HEADER_BYTES + 4;
  for (const id of SECTION_IDS) {
    const section = sections.get(id);
    if (!section) fail('缺少 section ' + id);
    assertUInt(section.byteLength, 32, 'section ' + id + ' 长度');
    totalBytes += section.byteLength;
  }
  assertUInt(totalBytes, 32, '二进制文件长度');

  const bytes = new Uint8Array(totalBytes);
  bytes.set(MAGIC, 0);
  const view = new DataView(bytes.buffer);
  view.setUint16(8, FORMAT_VERSION, true);
  view.setUint16(10, 0, true);
  view.setUint16(12, SECTION_IDS.length, true);
  view.setUint16(14, HEADER_BYTES, true);

  let directoryOffset = 16;
  let payloadOffset = HEADER_BYTES;
  for (const id of SECTION_IDS) {
    const section = sections.get(id);
    view.setUint16(directoryOffset, id, true);
    view.setUint8(directoryOffset + 2, 0);
    view.setUint8(directoryOffset + 3, 0);
    view.setUint32(directoryOffset + 4, payloadOffset, true);
    view.setUint32(directoryOffset + 8, section.byteLength, true);
    bytes.set(section, payloadOffset);
    directoryOffset += DIRECTORY_ENTRY_BYTES;
    payloadOffset += section.byteLength;
  }
  view.setUint32(bytes.byteLength - 4, crc32(bytes.subarray(0, bytes.byteLength - 4)), true);
  return bytes;
}

export async function encodeGeneratedData(payload) {
  if (!payload || typeof payload !== 'object' || !payload.jobSchemas ||
      !Array.isArray(payload.gears) || !payload.gears.length)
    fail('运行时快照结构无效');
  if (Object.hasOwn(payload, 'gearIndexesByMainStat'))
    fail('输入快照不能包含生成的主属性索引');
  const { gears: _gears, ...gameData } = payload;
  const gearCatalog = encodeGearCatalog(payload.gears, payload.jobSchemas);
  const sections = new Map([
    [1, encodeBinaryValue(gameData, 'GAME_DATA_BINARY')],
    [2, gearCatalog.bytes],
  ]);
  const bytes = assembleContainer(sections);
  const physicalGroupCounts = Object.fromEntries(
    Object.entries(gearCatalog.gearPhysicalGroupRanges)
      .map(([group, range]) => [group, range.count]),
  );
  return {
    bytes,
    gearCount: gearCatalog.gears.length,
    physicalGroupCounts,
    mainStatIndexCounts: gearCatalog.groupCounts,
    mainStatIndexBytes: Object.values(gearCatalog.groupCounts)
      .reduce((total, count) => total + count, 0) * 4,
    sectionSizes: Object.fromEntries([...sections].map(([id, section]) => [
      SECTION_NAMES.get(id), section.byteLength,
    ])),
  };
}

function toBytes(input) {
  if (input instanceof Uint8Array)
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  fail('输入不是 ArrayBuffer 或 Uint8Array');
}

function readSections(input, onTiming) {
  const startedAt = timingStart(onTiming);
  const bytes = toBytes(input);
  if (bytes.byteLength < HEADER_BYTES + 4) fail('文件头、目录或校验码被截断');
  for (let index = 0; index < MAGIC.length; index++)
    if (bytes[index] !== MAGIC[index]) fail('magic 不匹配');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint16(8, true);
  if (version !== FORMAT_VERSION) fail('不支持的格式版本 ' + version);
  if (view.getUint16(10, true) !== 0) fail('文件头 flags 非零');
  if (view.getUint16(12, true) !== SECTION_IDS.length) fail('section 数量异常');
  if (view.getUint16(14, true) !== HEADER_BYTES) fail('header 长度无效');
  const fileCrc = view.getUint32(bytes.byteLength - 4, true);
  if (fileCrc !== crc32(bytes.subarray(0, bytes.byteLength - 4))) fail('文件 CRC-32 不匹配');

  const descriptors = new Map();
  let directoryOffset = 16;
  for (const expectedId of SECTION_IDS) {
    const id = view.getUint16(directoryOffset, true);
    const codec = view.getUint8(directoryOffset + 2);
    const reserved = view.getUint8(directoryOffset + 3);
    const offset = view.getUint32(directoryOffset + 4, true);
    const length = view.getUint32(directoryOffset + 8, true);
    directoryOffset += DIRECTORY_ENTRY_BYTES;
    if (id !== expectedId) fail('section ID 顺序或内容无效：' + id);
    if (codec !== 0) fail('section ' + id + ' codec 无效：' + codec);
    if (reserved !== 0) fail('section ' + id + ' 保留位非零');
    descriptors.set(id, { offset, length });
  }

  const sections = new Map();
  let expectedOffset = HEADER_BYTES;
  for (const id of SECTION_IDS) {
    const descriptor = descriptors.get(id);
    if (descriptor.offset !== expectedOffset) fail('section ' + id + ' 偏移不连续或存在重叠');
    const end = descriptor.offset + descriptor.length;
    if (end > bytes.byteLength - 4) fail('section ' + id + ' 超出文件长度');
    const section = bytes.subarray(descriptor.offset, end);
    sections.set(id, section);
    expectedOffset = end;
  }
  if (expectedOffset !== bytes.byteLength - 4) fail('section 长度与文件尾部不一致');
  reportTiming(onTiming, 'containerIntegrityAndCrcMs', startedAt);
  return sections;
}

function decodeGenericValue(bytes, label, strings = undefined) {
  const reader = new BinaryValueReader(bytes, label);
  let valueStrings = strings;
  if (!valueStrings) {
    const stringCount = reader.varUint();
    if (stringCount > bytes.byteLength - reader.offset)
      fail(label + ' 字符串表数量超出剩余数据');
    valueStrings = new Array(stringCount);
    const decoder = new TextDecoder('utf-8', { fatal: true });
    try {
      for (let index = 0; index < stringCount; index++)
        valueStrings[index] = decoder.decode(reader.slice(reader.varUint()));
    } catch (error) {
      throw new Error('生成数据二进制格式错误：' + label + ' 字符串表解码失败', { cause: error });
    }
  }
  const value = decodeBinaryValueFrom(reader, valueStrings);
  reader.finish();
  return value;
}

function makeGearStringPool(reader) {
  const count = reader.u32();
  if (count > Math.floor((reader.bytes.byteLength - reader.offset - 4) / 4))
    fail('装备字符串偏移表被截断');
  const offsets = new Uint32Array(count + 1);
  for (let index = 0; index <= count; index++) offsets[index] = reader.u32();
  const byteLength = offsets[count];
  if (byteLength > reader.bytes.byteLength - reader.offset)
    fail('装备 UTF-8 字符串区长度无效');
  if (offsets[0] !== 0) fail('装备字符串首偏移必须为零');
  for (let index = 1; index <= count; index++)
    if (offsets[index] < offsets[index - 1]) fail('装备字符串偏移未排序');
  const stringBytes = reader.slice(byteLength);
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const cache = new Array(count);
  return {
    length: count,
    get(index) {
      if (!Number.isInteger(index) || index < 0 || index >= count)
        fail('装备记录引用不存在的字符串 ' + index);
      if (cache[index] !== undefined) return cache[index];
      try {
        cache[index] = decoder.decode(stringBytes.subarray(offsets[index], offsets[index + 1]));
        return cache[index];
      } catch (error) {
        throw new Error('生成数据二进制格式错误：装备字符串 UTF-8 解码失败', { cause: error });
      }
    },
  };
}

function readString(strings, index, label) {
  if (!Number.isInteger(index) || index < 0 || index >= strings.length)
    fail(label + ' 引用了不存在的字符串 ' + index);
  return typeof strings.get === 'function' ? strings.get(index) : strings[index];
}

function readBinaryValueString(strings, index, label) {
  if (!Number.isInteger(index) || index < 0 || index >= strings.length)
    fail(label + ' 引用了不存在的字符串 ' + index);
  return typeof strings.get === 'function' ? strings.get(index) : strings[index];
}

function decodeSourceTemplates(bytes, strings) {
  const reader = new BinaryValueReader(bytes, 'GEAR_CATALOG_BINARY 来源模板');
  const templates = decodeBinaryValueFrom(reader, strings);
  reader.finish();
  if (!Array.isArray(templates)) fail('装备来源模板不是数组');
  for (const template of templates)
    if (!template || typeof template !== 'object' || Array.isArray(template))
      fail('装备来源模板记录结构无效');
  return templates;
}

function decodeDataSources(reader, strings, templateCount) {
  const count = reader.varUint();
  if (count > Math.floor((reader.bytes.byteLength - reader.offset) / 2))
    fail('装备逐件来源记录数超出剩余数据');
  const values = new Array(count);
  for (let index = 0; index < count; index++) {
    const templateId = reader.varUint();
    if (templateId >= templateCount) fail('装备引用不存在的来源模板 ' + templateId);
    const mask = reader.u8();
    if (mask & ~3) fail('装备来源动态字段掩码含保留位');
    const dynamic = {};
    if (mask & 1) dynamic.rowIds = decodeBinaryValueFrom(reader, strings);
    if (mask & 2) dynamic.sourceFiles = decodeBinaryValueFrom(reader, strings);
    values[index] = { templateId, dynamic };
  }
  return values;
}

function decodeGearRecord(recordIndex, entry, endOffset, section, strings, templates, jobIds, onTiming) {
  const recordStartedAt = timingStart(onTiming);
  const bytes = section.subarray(entry.bodyOffset, endOffset);
  const reader = new BinaryValueReader(bytes, 'GEAR_CATALOG_BINARY 装备记录 ' + recordIndex);
  const slotCode = reader.u8();
  const equipLevel = reader.u8();
  const rawSlot = reader.u8();
  const roleId = reader.u8();
  const jobCategory = reader.u16();
  const materiaSlots = reader.u8();
  const flags = reader.u8();
  const jobCount = reader.u8();
  if (slotCode >= SLOT_NAMES.length) fail('装备槽位代码无效');
  if (flags & ~3) fail('装备标志含保留位');
  if (jobCount > reader.bytes.byteLength - reader.offset)
    fail('装备职业数量超出记录长度');
  const jobs = new Array(jobCount);
  for (let index = 0; index < jobCount; index++) {
    const jobIndex = reader.u8();
    if (jobIndex >= jobIds.length) fail('装备职业序号越界');
    jobs[index] = jobIds[jobIndex];
  }

  const statMask = reader.u16();
  if (statMask & ~((1 << STAT_NAMES.length) - 1)) fail('装备属性掩码含未知属性');
  const stats = {};
  for (let statCode = 0; statCode < STAT_NAMES.length; statCode++)
    if (statMask & (1 << statCode)) stats[STAT_NAMES[statCode]] = reader.i16();

  const customParameterCount = reader.u8();
  if (customParameterCount > Math.floor((reader.bytes.byteLength - reader.offset) / 11))
    fail('装备自定义参数数量超出记录长度');
  const customParameters = new Array(customParameterCount);
  for (let index = 0; index < customParameterCount; index++) {
    const materiaId = reader.u32();
    const statCode = reader.u8();
    const bigValueIndex = reader.u8();
    const smallValueIndex = reader.u8();
    const bigValue = reader.u16();
    const smallValue = reader.u16();
    if (statCode >= CUSTOM_STAT_NAMES.length) fail('装备自定义参数属性代码无效');
    customParameters[index] = {
      materiaId,
      stat: CUSTOM_STAT_NAMES[statCode],
      bigValueIndex,
      smallValueIndex,
      bigValue,
      smallValue,
    };
  }

  const nameIndex = reader.varUint();
  if (nameIndex >= strings.length) fail('装备名称字符串序号越界');
  const name = readString(strings, nameIndex, '装备 name');

  const sourceStartedAt = timingStart(onTiming);
  const sourcePresent = reader.u8();
  if (sourcePresent > 1) fail('装备 source 标志无效');
  let sourceIndex;
  if (sourcePresent) {
    sourceIndex = reader.varUint();
    if (sourceIndex >= strings.length) fail('装备 source 字符串序号越界');
  }
  const sourceFileIndex = reader.varUint();
  if (sourceFileIndex >= strings.length) fail('装备 sourceFile 字符串序号越界');
  const sourceFile = readString(strings, sourceFileIndex, '装备 sourceFile');
  const dataSourceEntries = decodeDataSources(reader, strings, templates.length);
  reader.finish();
  const dataSources = dataSourceEntries.map(({ templateId, dynamic }) => ({
    ...templates[templateId],
    ...dynamic,
  }));
  const source = sourcePresent
    ? readString(strings, sourceIndex, '装备 source')
    : undefined;
  const sourceMetadataMs = onTiming
    ? globalThis.performance.now() - sourceStartedAt
    : 0;

  const gear = {
    id: entry.id,
    slot: SLOT_NAMES[slotCode],
    rawSlot,
    level: entry.level,
    equipLevel,
    roleId,
    jobCategory,
    stats,
    materiaSlots,
    jobs,
    name,
    sourceFile,
    dataSources,
  };
  if (flags & 1) gear.materiaAdvanced = true;
  gear.unique = Boolean(flags & 2);
  if (customParameterCount) gear.customParameters = customParameters;
  if (sourcePresent) gear.source = source;
  const weaponDamage = stats.PDMG ?? stats.MDMG;
  if (weaponDamage !== undefined) gear.weaponDamage = weaponDamage;
  if (onTiming) {
    onTiming('gearSourceMetadataMs', sourceMetadataMs);
    onTiming(
      'gearOtherRecordFieldsMs',
      Math.max(0, globalThis.performance.now() - recordStartedAt - sourceMetadataMs),
    );
  }
  return gear;
}

function decodeGearCatalog(bytes, jobIds, onTiming) {
  const reader = new BinaryValueReader(bytes, 'GEAR_CATALOG_BINARY');
  let phaseStartedAt = timingStart(onTiming);
  const statUnionMask = reader.u16();
  if (statUnionMask & ~((1 << STAT_NAMES.length) - 1)) fail('装备属性并集掩码含未知属性');
  const gearMinLevel = reader.u16();
  const gearMaxLevel = reader.u16();
  if (gearMinLevel > gearMaxLevel) fail('装备最低品级大于最高品级');
  const strings = makeGearStringPool(reader);
  const templateByteLength = reader.u32();
  const templateBytes = reader.slice(templateByteLength);
  const templates = decodeSourceTemplates(templateBytes, strings);
  reportTiming(onTiming, 'equipmentStringsAndTemplatesMs', phaseStartedAt);

  phaseStartedAt = timingStart(onTiming);
  const physicalGroupCount = reader.u8();
  if (physicalGroupCount !== PHYSICAL_GROUPS.length) fail('装备物理组数量异常');
  const groupDescriptors = new Array(PHYSICAL_GROUPS.length);
  const gearPhysicalGroupRanges = {};
  let recordCount = 0;
  for (let groupIndex = 0; groupIndex < PHYSICAL_GROUPS.length; groupIndex++) {
    const groupName = PHYSICAL_GROUPS[groupIndex];
    const expectedCode = groupIndex < MAIN_STATS.length ? groupIndex : MAIN_STATS.length;
    if (reader.u8() !== expectedCode) fail(groupName + ' 物理组代码或顺序错误');
    const count = reader.u32();
    const byteLength = reader.u32();
    if (count > 1_000_000 - recordCount) fail('装备记录总数异常');
    gearPhysicalGroupRanges[groupName] = { start: recordCount, count };
    groupDescriptors[groupIndex] = { name: groupName, start: recordCount, count, byteLength };
    recordCount += count;
  }
  if (!recordCount) fail('装备记录数为空');

  const entries = new Array(recordCount);
  const gearLevelByRecordIndex = new Uint16Array(recordCount);
  const indexById = new Map();
  for (const group of groupDescriptors) {
    if (group.count > Math.floor((reader.bytes.byteLength - reader.offset) / 10))
      fail(group.name + ' 装备目录被截断');
    for (let offsetInGroup = 0; offsetInGroup < group.count; offsetInGroup++) {
      const globalIndex = group.start + offsetInGroup;
      const id = reader.u32();
      const level = reader.u16();
      const bodyOffset = reader.u32();
      indexById.set(id, globalIndex);
      entries[globalIndex] = { id, level, bodyOffset, groupIndex: PHYSICAL_GROUPS.indexOf(group.name) };
      gearLevelByRecordIndex[globalIndex] = level;
    }
  }
  reportTiming(onTiming, 'equipmentDirectoryMs', phaseStartedAt);

  phaseStartedAt = timingStart(onTiming);
  const logicalGroupCount = reader.u8();
  if (logicalGroupCount !== MAIN_STATS.length) fail('逻辑主属性索引数异常');
  const gearIndexesByMainStat = {};
  for (const [groupCode, mainStat] of MAIN_STATS.entries()) {
    if (reader.u8() !== groupCode) fail(mainStat + ' 主属性索引代码或顺序错误');
    const count = reader.u32();
    if (count > Math.floor((reader.bytes.byteLength - reader.offset) / 4))
      fail(mainStat + ' 主属性索引被截断');
    const refsOffset = reader.offset;
    reader.slice(count * 4);
    const refs = new Uint32Array(count);
    const view = new DataView(reader.bytes.buffer, reader.bytes.byteOffset, reader.bytes.byteLength);
    for (let index = 0; index < count; index++)
      refs[index] = view.getUint32(refsOffset + index * 4, true);
    gearIndexesByMainStat[mainStat] = refs;
  }
  reportTiming(onTiming, 'mainStatIndexDecodeMs', phaseStartedAt);

  phaseStartedAt = timingStart(onTiming);
  const bodySections = new Array(PHYSICAL_GROUPS.length);
  for (const group of groupDescriptors) {
    const groupBytes = reader.slice(group.byteLength);
    bodySections[PHYSICAL_GROUPS.indexOf(group.name)] = groupBytes;
    if (group.count === 0) {
      if (group.byteLength !== 0) fail(group.name + ' 空物理组包含记录体字节');
      continue;
    }
    const first = entries[group.start];
    if (first.bodyOffset !== 0) fail(group.name + ' 首条记录体偏移必须为零');
    for (let index = 0; index < group.count; index++) {
      const globalIndex = group.start + index;
      const entry = entries[globalIndex];
      const endOffset = index + 1 < group.count
        ? entries[globalIndex + 1].bodyOffset
        : group.byteLength;
      if (entry.bodyOffset >= endOffset || endOffset > group.byteLength)
        fail(group.name + ' 装备记录体偏移无效');
    }
  }
  reader.finish();
  reportTiming(onTiming, 'equipmentRecordRangesMs', phaseStartedAt);

  const gearCache = new Array(recordCount);
  const getGearAtRecordIndex = (index) => {
    if (!Number.isInteger(index) || index < 0 || index >= recordCount)
      fail('装备记录序号越界：' + index);
    if (gearCache[index] === undefined) {
      const entry = entries[index];
      const groupBytes = bodySections[entry.groupIndex];
      const endOffset = index + 1 < gearPhysicalGroupRanges[PHYSICAL_GROUPS[entry.groupIndex]].start +
          gearPhysicalGroupRanges[PHYSICAL_GROUPS[entry.groupIndex]].count
        ? entries[index + 1].bodyOffset
        : groupBytes.byteLength;
      gearCache[index] = decodeGearRecord(
        index, entry, endOffset, groupBytes, strings, templates, jobIds, onTiming,
      );
    }
    return gearCache[index];
  };
  const gears = new Proxy(new Array(recordCount).fill(undefined), {
    get(target, property, receiver) {
      if (typeof property === 'string' && property !== '') {
        const index = Number(property);
        if (Number.isInteger(index) && index >= 0 && index < recordCount && String(index) === property)
          return getGearAtRecordIndex(index);
      }
      return Reflect.get(target, property, receiver);
    },
  });

  return {
    gears,
    gearIndexesByMainStat,
    getGearAtRecordIndex,
    getGearById(id) {
      const index = indexById.get(id);
      return index === undefined ? undefined : getGearAtRecordIndex(index);
    },
    gearLevelByRecordIndex,
    gearMinLevel,
    gearMaxLevel,
    gearStatNames: STAT_NAMES.filter((_, index) => statUnionMask & (1 << index)),
    gearPhysicalGroupRanges,
  };
}
export async function decodeGeneratedData(input, options = undefined) {
  const onTiming = options?.onTiming;
  const startedAt = timingStart(onTiming);
  const sections = readSections(input, onTiming);
  const gameDataStartedAt = timingStart(onTiming);
  const gameData = decodeGenericValue(sections.get(1), 'GAME_DATA_BINARY');
  reportTiming(onTiming, 'nonGearDataBinaryMs', gameDataStartedAt);
  if (!gameData || typeof gameData !== 'object' || Array.isArray(gameData) ||
      Object.hasOwn(gameData, 'gears') || !gameData.jobSchemas ||
      typeof gameData.jobSchemas !== 'object')
    fail('GAME_DATA_BINARY 缺少必要结构');
  const gearCatalogStartedAt = timingStart(onTiming);
  const gearData = decodeGearCatalog(
    sections.get(2), Object.keys(gameData.jobSchemas), onTiming,
  );
  reportTiming(onTiming, 'gearCatalogDirectoryAndIndexesMs', gearCatalogStartedAt);
  reportTiming(onTiming, 'initializationTotalMs', startedAt);
  return { ...gameData, ...gearData };
}
