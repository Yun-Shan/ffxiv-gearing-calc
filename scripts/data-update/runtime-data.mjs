import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { encodeGeneratedData } from "../../src/data/binary/encode.ts";
import { decodeGeneratedData } from "../../src/data/binary/decode.ts";

const defaultOutputPath = resolve(import.meta.dirname, "..", "..", "src", "data", "generated-data.bin");

function withoutFields(value, fields) {
  const result = { ...value };
  for (const field of fields) delete result[field];
  return result;
}

/**
 * Project an already validated, source-rich generation payload into its runtime shape.
 * Source checks must happen before this projection because the audit fields are removed.
 */
export function projectRuntimeData(payload) {
  return {
    ...payload,
    provenance: withoutFields(payload.provenance, ["sources", "sourceFiles", "queryEvidence"]),
    gears: payload.gears.map((gear) => withoutFields(gear, ["sourceFile", "dataSources"])),
    foods: payload.foods.map((food) => withoutFields(food, ["sourceFile", "dataSources"])),
    jobSchemas: Object.fromEntries(Object.entries(payload.jobSchemas).map(([jobId, schema]) => [
      jobId,
      withoutFields(schema, ["dataSources"]),
    ])),
  };
}

function assertRuntimeDataHasNoGenerationAudit(payload) {
  const hasAny = (value, fields) => fields.some((field) => Object.hasOwn(value ?? {}, field));
  if (hasAny(payload?.provenance, ["sources", "sourceFiles", "queryEvidence"]) ||
      payload?.gears?.some((gear) => hasAny(gear, ["sourceFile", "dataSources"])) ||
      payload?.foods?.some((food) => hasAny(food, ["sourceFile", "dataSources"])) ||
      Object.values(payload?.jobSchemas ?? {}).some((schema) => hasAny(schema, ["dataSources"])))
    throw new Error("运行时快照仍包含生成审计字段；请先完成来源校验并投影");
}

/** Write an already validated runtime payload; this boundary does not validate upstream sources. */
export async function writeRuntimeGeneratedData(payload, { outputPath: targetPath = defaultOutputPath } = {}) {
  assertRuntimeDataHasNoGenerationAudit(payload);
  await mkdir(resolve(targetPath, ".."), { recursive: true });
  const generated = await encodeGeneratedData(payload);
  const temporaryPath = `${targetPath}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await writeFile(temporaryPath, generated.bytes);
    const verifiedBytes = new Uint8Array(await readFile(temporaryPath));
    const decoded = await decodeGeneratedData(verifiedBytes);
    if (decoded.version !== payload.version ||
        decoded.provenance.commit !== payload.provenance.commit ||
        decoded.gears.length !== payload.gears.length ||
        decoded.foods.length !== payload.foods.length ||
        Object.keys(decoded.jobs).length !== Object.keys(payload.jobs).length)
      throw new Error("生成二进制解码后与原始 payload 的版本、来源或目录数量不一致");
    const decodedGearIds = new Set();
    for (const gear of decoded.gears) {
      if (!gear || decodedGearIds.has(gear.id) || decoded.getGearById(gear.id)?.id !== gear.id)
        throw new Error(`生成二进制解码后装备记录缺失或重复：${gear?.id}`);
      decodedGearIds.add(gear.id);
    }
    if (decodedGearIds.size !== payload.gears.length ||
        payload.gears.some((gear) => !decodedGearIds.has(gear.id)))
      throw new Error("生成二进制解码后装备 ID 集合与原始 payload 不一致");

    // The decoder validates gear records lazily. Re-encoding its normalized view
    // forces every record through that validation and verifies all wire fields.
    const {
      gearIndexesByMainStat,
      gearLevelByRecordIndex,
      gearPhysicalGroupRanges,
      gearMinLevel,
      gearMaxLevel,
      gearStatNames,
      getGearAtRecordIndex,
      getGearById,
      ...decodedPayload
    } = decoded;
    const reencoded = await encodeGeneratedData(decodedPayload);
    if (reencoded.bytes.byteLength !== verifiedBytes.byteLength ||
        reencoded.bytes.some((byte, index) => byte !== verifiedBytes[index]))
      throw new Error("生成二进制解码后重新编码与临时文件内容不一致");
    await rename(temporaryPath, targetPath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => {});
    throw error;
  }
  return generated;
}
