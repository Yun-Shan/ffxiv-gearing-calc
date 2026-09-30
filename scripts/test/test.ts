import { createDamageGcdVectorEvaluator } from "./equipped-effects-legacy.ts";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { Worker } from "node:worker_threads";
import { Buffer } from "node:buffer";
import {
  equippedAttributeTier,
  equippedEffects,
  equippedSpeedRangeForGcd,
  equippedToughnessForMitigationPercent,
  type EquippedEffects,
  type EquippedStats,
} from "./equipped-effects.ts";
import {
  createFfxivGearingUrl,
  parseFfxivGearingGearset,
  reverseEquipmentForFfxivGearing,
  type FfxivGearingGear,
} from "./ffxiv-gearing-export.ts";
import { applySyncLimit } from "./equipment-sync.ts";
import { equipmentAttributeValuesKey } from "./equipment-candidates.ts";
import {
  type LoadoutFinderV2Options,
  type LoadoutV2Constraints,
  type LoadoutV2Result,
} from "./archived/loadout-finder-v2.ts";
import { buildRingPairEquipInfos, isRingPairEquipInfo } from "./ring-pairs.ts";
import {
  type AttributeVector,
} from "./archived/attribute-combination-counter.ts";
import type {
  Job,
  JobLevel,
  MateriaGrade,
  Stat,
} from "../../reference/ffxiv-gearing/src/game.ts";
import type {
  ComparableInfo,
  EquipmentMateriaCombinerConfig,
  EquipInfo,
  FoodInfo,
  FoodParam,
  Materia,
  ParamInfo,
  PendingRequest,
  Row,
  StreamState,
} from "./types.ts";

const command =
  "F:\\Workspace\\VisualStudio\\ffxiv\\mcp\\mcp-ffxiv-lumina\\publish\\mcp-lumina.exe";
const referenceGame = await import("../../reference/ffxiv-gearing/src/game.ts");
const supportedJobLevels = new Set<number>(referenceGame.jobLevels);

class McpClient {
  nextId: number;
  pending: Map<number, PendingRequest>;
  state: StreamState;
  process: ChildProcessWithoutNullStreams;

  constructor() {
    this.nextId = 1;
    this.pending = new Map();
    this.state = { chunks: [], totalLen: 0 };
    this.process = spawn(command, [], {
      cwd: import.meta.dirname,
      // stdio: ["pipe", "pipe", "inherit"],
      stdio: ["pipe", "pipe"],
    });
    this.process.on("error", (error) => {
      console.error(
        `[Lumina MCP] 进程错误：${error.message}；挂起请求=${JSON.stringify(
          [...this.pending].map(([id, pending]) => ({
            id,
            method: pending.method,
            params: pending.params,
          })),
        )}`,
      );
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
    });

    const handleLine = (line: Buffer): void => {
      let message;
      try {
        message = JSON.parse(line as unknown as string);
      } catch (error: any) {
        this.fail(
          new Error(`Lumina MCP 返回了无效 JSON-RPC：${error.message}`, {
            cause: error,
          }),
        );
        return;
      }
      if (message.id === undefined) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error)
        console.error(
          `[Lumina MCP] JSON-RPC 请求失败：${JSON.stringify({
            id: message.id,
            method: pending.method,
            params: pending.params,
            error: message.error,
          })}`,
        );
      if (message.error)
        pending.reject(
          new Error(`${message.error.code ?? "MCP"}: ${message.error.message}`),
        );
      else pending.resolve(message.result);
    };

    this.process.stdout.on("data", (chunk) => {
      let start = 0;
      let index;

      while ((index = chunk.indexOf("\n", start)) !== -1) {
        // 将换行符前的部分加入片段
        if (index > start) {
          const slice = chunk.slice(start, index);
          this.state.chunks.push(slice);
          this.state.totalLen += slice.length;
        } else {
          // 空行（连续换行符），totalLen不变，但需要记录空行
          // 这里我们仍然push一个空Buffer，以便保持行计数
          this.state.chunks.push(Buffer.alloc(0));
        }

        // 现在组装完整行（合并所有片段）
        const fullLine = Buffer.concat(this.state.chunks, this.state.totalLen);
        // 处理这一行
        handleLine(fullLine);

        // 重置，准备下一行
        this.state.chunks = [];
        this.state.totalLen = 0;

        // 继续扫描剩余部分（跳过换行符）
        start = index + 1;
      }

      // 如果当前chunk还有剩余（不完整行），存入片段等待后续chunk
      if (start < chunk.length) {
        const remain = chunk.slice(start);
        this.state.chunks.push(remain);
        this.state.totalLen += remain.length;
      }
    });
  }

  fail(error: any): void {
    console.error(
      `[Lumina MCP] 请求处理失败：${error?.message ?? String(error)}；挂起请求=${JSON.stringify(
        [...this.pending].map(([id, pending]) => ({
          id,
          method: pending.method,
          params: pending.params,
        })),
      )}`,
    );
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }

  request(method: string, params: Record<string, unknown>): Promise<any> {
    const id = this.nextId++;
    return new Promise((resolveRequest, rejectRequest) => {
      this.pending.set(id, {
        method,
        params,
        resolve: resolveRequest,
        reject: rejectRequest,
      });
      this.process.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
      );
    });
  }

  notify(method: string, params: Record<string, unknown>): void {
    this.process.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`,
    );
  }

  async initialize(): Promise<any> {
    const result = await this.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "ffxiv-gearing-calc", version: "1.0.0" },
    });
    this.notify("notifications/initialized", {});
    return result;
  }

  #proxyRow(row: Row): Row {
    delete row["languagesRequested"];
    delete row["languagesReturned"];
    delete row["fallbackUsed"];
    delete row["gameVersion"];
    delete row["timestamp"];
    Object.freeze(row.fields);
    Object.freeze(row);
    return new Proxy(row, {
      get(obj, prop) {
        // 先检查对象自身是否有该属性
        if (prop in obj) {
          return Reflect.get(obj, prop);
        }
        // 如果自身没有，检查 fields 对象下是否有
        if (obj.fields && prop in obj.fields) {
          return Reflect.get(obj.fields, prop);
        }
        // 都找不到，返回 undefined（和正常行为一致）
        return undefined;
      },
    });
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<any> {
    const result = await this.request("tools/call", { name, arguments: args });
    const text = result?.content?.find(
      (entry: any) => entry.type === "text",
    )?.text;
    if (!text) throw new Error(`MCP 工具 ${name} 未返回文本 JSON`);
    let value;
    try {
      value = JSON.parse(text);
    } catch (error) {
      throw `MCP 工具 ${name} 返回了无法解析的 JSON：${text}`;
    }
    if ("rowId" in value && "fields" in value) {
      return this.#proxyRow(value);
    } else if ("rows" in value) {
      value.rows = value.rows.map((it: Row) => this.#proxyRow(it));
    }
    return value;
  }

  close(): void {
    this.process.stdin.end();
    this.process.kill();
  }
}

const client = new McpClient();
await client.initialize();
const health = await client.callTool("health", {});
console.log(JSON.stringify(health));
let response = await client.callTool("list_rows", {
  sheet: "EquipSlotCategory",
  limit: -1,
});
const equipSlotMap: Record<number, Row> = response.rows
  .filter((it: Row) => Object.values(it.fields).some((f) => f === 1))
  .reduce((acc: Record<number, Row>, it: Row) => {
    acc[it.rowId] = it;
    return acc;
  }, {});
console.log(`已获取${Object.keys(equipSlotMap).length}个有效装备槽位类型`);
response = await client.callTool("list_rows", { sheet: "Item", limit: -1 });
console.log(`已获取${response.rows.length}个物品`);
const itemMap: Record<number, Row> = {};
const validMateriaItems: Record<number, Row> = {};
let equipCount = 0;
const equipMap = new Map<number, Row[]>();
let maxEquipItemLevel = 0;
for (const row of response.rows) {
  itemMap[row.rowId] = row;
  if (row.ItemSortCategory === 9) {
    validMateriaItems[row.rowId] = row;
  } else if (equipSlotMap[row.EquipSlotCategory]) {
    equipCount++;
    const list = equipMap.getOrInsertComputed(row.LevelItem, () => []);
    list.push(row);
    if (row.LevelItem > maxEquipItemLevel) maxEquipItemLevel = row.LevelItem;
  }
}
console.log(`已获取${equipCount}个装备`);
console.log(`已获取${Object.values(validMateriaItems).length}个有效魔晶石`);
function checkAllowItemLevel(level: number): boolean {
  // 只保留低于最高品级装备不超过300的装备，因为高品级装备同步下去属性达到满属性之后的一定比低等级的好
  return maxEquipItemLevel - level <= 300;
}
equipCount = 0;
for (const [key, value] of [...equipMap.entries()]) {
  if (!checkAllowItemLevel(key)) {
    equipMap.delete(key);
    continue;
  }
  equipCount += value.length;
}
console.log(`过滤后共有${equipCount}个装备`);

response = await client.callTool("list_rows", { sheet: "ItemFood", limit: -1 });
const itemFood: Record<number, Row> = {};
for (const row of response.rows) {
  itemFood[row.rowId] = row;
}

response = await client.callTool("list_rows", {
  sheet: "ItemAction",
  limit: -1,
});
const itemAction: Record<number, Row> = {};
for (const row of response.rows) {
  itemAction[row.rowId] = row;
}

const foods: FoodInfo[] = [];
for (const item of Object.values(itemMap)) {
  if (item.ItemUICategory === 46 && checkAllowItemLevel(item.LevelItem)) {
    const foodConfig = itemFood[itemAction[item.ItemAction]["DataHQ[1]"]];
    const baseParams: FoodParam[] = [];
    for (let i = 0; i < 3; i++) {
      const param = foodConfig[`BaseParam[${i}]`];
      const val = foodConfig[`ValueHQ[${i}]`];
      const max = foodConfig[`MaxHQ[${i}]`];
      baseParams.push({
        baseParamId: param,
        multiplier: 1 + val / 100,
        maxValue: max,
      });
    }
    baseParams.sort((a, b) => a.baseParamId - b.baseParamId);
    const food: FoodInfo = {
      itemId: item.rowId,
      itemLevel: item.LevelItem,
      key: `${baseParams.map((it) => it.baseParamId).join("-")}`,
      baseParams,
    };
    foods.push(food);
  }
}
foods.sort((a, b) => b.itemLevel - a.itemLevel);
console.log(`过滤后共有${foods.length}个食物`);

const materiaGrades: number[][] = [];
const materiaRestrictionGrades: [number, number[]][] = [];
const materiaNonrestrictionGrades: [number, number[]][] = [];
response = await client.callTool("list_rows", {
  sheet: "MateriaGrade",
  limit: -1,
});
for (const row of response.rows) {
  if (row.rowId !== materiaGrades.length) throw "魔晶石等级异常：非连续";
  const rates = [
    row["OvermeldHQPercent[0]"],
    row["OvermeldHQPercent[1]"],
    row["OvermeldHQPercent[2]"],
    row["OvermeldHQPercent[3]"],
  ];
  materiaGrades.push(rates);
  if (rates.some((it) => it === 0)) {
    materiaRestrictionGrades.push([row.rowId, rates]);
  } else {
    materiaNonrestrictionGrades.push([row.rowId, rates]);
  }
}
const chineseNumbers = [
  "零",
  "壹",
  "贰",
  "叁",
  "肆",
  "伍",
  "陆",
  "柒",
  "捌",
  "玖",
  "拾",
  "拾壹",
  "拾贰",
];
console.log(
  `共有${materiaGrades.length}个等级的魔晶石，其中${JSON.stringify(materiaRestrictionGrades.map((it) => chineseNumbers[it[0] + 1]))}是限制等级，${JSON.stringify(materiaNonrestrictionGrades.map((it) => chineseNumbers[it[0] + 1]))}是非限制等级。`,
);
response = await client.callTool("list_rows", { sheet: "Materia", limit: -1 });
const materiaMap: Record<number, Row> = {};
const materiaByBaseParam: Record<number, Materia> = {};
for (const row of response.rows) {
  materiaMap[row.rowId] = row;
  const items: number[] = [];
  const values: number[] = [];
  const minAllowItemLevel: number[] = [];
  for (let i = 0; i < materiaGrades.length; i++) {
    const itemId = row[`Item[${i}]`];
    if (itemId === 0) break;
    const item = itemMap[itemId];
    if (item?.ItemSortCategory !== 9) break;
    items.push(itemId);
    values.push(row[`Value[${i}]`]);
    minAllowItemLevel.push(item.LevelItem);
  }
  const materia: Materia = {
    id: row.rowId,
    baseParam: row.BaseParam,
    items,
    values,
    minAllowItemLevel,
  };
  if (materia.items.length === materiaGrades.length) {
    materiaByBaseParam[materia.baseParam] = materia;
  }
}

response = await client.callTool("list_rows", {
  sheet: "ClassJobCategory",
  limit: -1,
});
const classJobCategory: Record<number, Row> = {};
for (const row of response.rows) {
  classJobCategory[row.rowId] = row;
}

response = await client.callTool("list_rows", {
  sheet: "EquipSlotCategory",
  limit: -1,
});
const equipSlotCategory: Record<number, Row> = {};
for (const row of response.rows) {
  equipSlotCategory[row.rowId] = row;
}

response = await client.callTool("describe_sheet", { sheet: "ItemLevel" });
const itemLevelAttrId2AttrName: Record<number, string> = {};
for (const column of response.columns) {
  itemLevelAttrId2AttrName[column.index + 1] = column.name;
}
response = await client.callTool("list_rows", {
  sheet: "ItemLevel",
  limit: -1,
});
const itemLevel: Record<number, Row> = {};
for (const row of response.rows) {
  itemLevel[row.rowId] = row;
}
function itemLevelAttrVal(lvl: number, attrId: number): any {
  return itemLevel[lvl][itemLevelAttrId2AttrName[attrId]];
}

response = await client.callTool("list_rows", {
  sheet: "MandervilleWeaponEnhance",
  limit: -1,
});
const mandervilleWeaponEnhance: Record<number, Row> = {};
// key 物品id，value 虚拟武器列表
const mandervilleWeapons: Record<number, EquipInfo[]> = {};
for (const row of response.rows) {
  mandervilleWeaponEnhance[row.rowId] = row;
  const baseParams: ParamInfo[] = [];
  for (let i = 0; i < 6; i++) {
    const param = itemMap[row.rowId][`BaseParam[${i}]`];
    const val = itemMap[row.rowId][`BaseParamValue[${i}]`];
    if (param !== 0 && val !== 0)
      baseParams.push({ baseParamId: param, value: val });
  }
  baseParams.sort((a, b) => a.baseParamId - b.baseParamId);
  const list: ParamInfo[][] = [];
  // 生成不同属性方案的自定义参数武器
  for (let i = 0; i < 4; i++)
    for (let j = i + 1; j < 4; j++)
      for (let k = 0; k < 4; k++)
        if (k !== i && k !== j) {
          const pA = materiaMap[row[`Materia[${i}]`]].BaseParam;
          const vA =
            materiaMap[row[`Materia[${i}]`]][
              `Value[${row[`MateriaBigValueIndex[${i}]`]}]`
            ];
          const pB = materiaMap[row[`Materia[${j}]`]].BaseParam;
          const vB =
            materiaMap[row[`Materia[${j}]`]][
              `Value[${row[`MateriaBigValueIndex[${j}]`]}]`
            ];
          const pC = materiaMap[row[`Materia[${k}]`]].BaseParam;
          const vC =
            materiaMap[row[`Materia[${k}]`]][
              `Value[${row[`MateriaSmallValueIndex[${k}]`]}]`
            ];
          list.push(
            [
              ...baseParams,
              { baseParamId: pA, value: vA },
              { baseParamId: pB, value: vB },
              { baseParamId: pC, value: vC },
            ].sort((a, b) => a.baseParamId - b.baseParamId),
          );
        }
  const equips: EquipInfo[] = [];
  for (const gen of list) {
    const equip: EquipInfo = {
      itemId: row.rowId,
      itemLevel: row.LevelItem,
      key: `${gen.map((it) => it.baseParamId).join("-")}`,
      baseParams: gen,
      PDMG: itemMap[row.rowId].DamagePhys,
      MDMG: itemMap[row.rowId].DamageMag,
      DLY: itemMap[row.rowId].Delayms,
    };
    equips.push(equip);
  }
  mandervilleWeapons[row.rowId] = equips;
}
console.log(
  `为${Object.keys(mandervilleWeapons)}生成属性枚举自定义参数武器，共${Object.values(
    mandervilleWeapons,
  )
    .map((it) => it.length)
    .reduce((a, b) => a + b, 0)}件`,
);

response = await client.callTool("list_rows", {
  sheet: "BaseParam",
  limit: -1,
});
const baseParam: Record<number, Row> = {};
const speedBaseParam = new Set<number>();
const specialBaseParam = new Set<number>();
for (const row of response.rows) {
  baseParam[row.rowId] = row;
  if (["咏唱速度", "技能速度"].includes(row.Name))
    speedBaseParam.add(row.rowId);
  else if (["坚韧", "信仰"].includes(row.Name)) specialBaseParam.add(row.rowId);
}
const statNameToAbbreviation: Record<string, Stat> = {};
for (const [stat, name] of Object.entries(referenceGame.statNames) as [
  Stat,
  string,
][]) {
  statNameToAbbreviation[name] = stat;
}
statNameToAbbreviation["技能速度"] = "SKS";
statNameToAbbreviation["咏唱速度"] = "SPS";
const baseParamIdToStat: Record<number, Stat> = {};
for (const row of Object.values(baseParam)) {
  const stat = statNameToAbbreviation[row.Name];
  if (stat !== undefined && stat !== "main" && stat !== "secondary") {
    baseParamIdToStat[row.rowId] = stat;
  }
}

function baseParamIdForStat(stat: Stat): number {
  const entry = Object.entries(baseParamIdToStat).find(
    ([, candidate]) => candidate === stat,
  );
  if (entry === undefined) throw new Error(`BaseParam 中缺少属性：${stat}`);
  return Number(entry[0]);
}

response = await client.callTool("list_rows", { sheet: "ClassJob", limit: -1 });
const jobs: Row[] = [];
for (const row of response.rows) {
  // 只支持有灵魂水晶且在战职索引里的(生产采集对应的索引是DohDolJobIndex)，虽然根据实际sheet数据判断索引就可以不用判断水晶
  if (row.ItemSoulCrystal > 0 && row.JobIndex > 0) {
    jobs.push(row);
  }
}

/**
 * 获取装备槽位百分比
 * @param {any} param - BaseParam 对象，包含各个装备槽位的百分比属性
 * @param {number} equipSlotCategory - 装备槽位类别ID
 * @returns {number} 对应槽位的百分比值
 * @throws {TypeError} 当对应属性不存在或不是数字时抛出错误
 */
function getEquipSlotPercent(param: Row, equipSlotCategory: number): number {
  // 这里实际上引用的是BaseParam表从第4列开始的列，参考https://exd.camora.dev/sheet/BaseParam
  let value;

  switch (equipSlotCategory) {
    case 1:
      value = param.OneHandWeaponPercent;
      break;
    case 2:
      value = param.OffHandPercent;
      break;
    case 3:
      value = param.HeadPercent;
      break;
    case 4:
      value = param.ChestPercent;
      break;
    case 5:
      value = param.HandsPercent;
      break;
    case 6:
      value = param.WaistPercent;
      break; // 这个实际不会用到，因为腰带已经被移除出游戏了
    case 7:
      value = param.LegsPercent;
      break;
    case 8:
      value = param.FeetPercent;
      break;
    case 9:
      value = param.EarringPercent;
      break;
    case 10:
      value = param.NecklacePercent;
      break;
    case 11:
      value = param.BraceletPercent;
      break;
    case 12:
      value = param.RingPercent;
      break;
    case 13:
      value = param.TwoHandWeaponPercent;
      break;
    case 14:
      value = param.UnderArmorPercent;
      break; // 游戏中实际不存在这个装备分类的物品，具体是啥也不知道
    case 15:
      value = param.ChestHeadPercent;
      break;
    case 16:
      value = param.ChestHeadLegsFeetPercent;
      break; // 实际上应该是ChestHandsLegsFeetPercent，可能是Lumina的定义弄错了
    case 17:
      value = param.Unknown0;
      break; // 这里是SoulCrystal，Lumina没有命名，但应该是对的(参考的配装器源码)
    case 18:
      value = param.LegsFeetPercent;
      break;
    case 19:
      value = param.HeadChestHandsLegsFeetPercent;
      break;
    case 20:
      value = param.ChestLegsGlovesPercent;
      break; // 这里的Gloves应该是Hands，估计是不同的人进行PR时命名不一致
    case 21:
      value = param.ChestLegsFeetPercent;
      break;
    case 22:
      value = param.Unknown1;
      break; // 这里应该是ChestPercent + HandsPercent，Lumina没有命名，但应该是对的(参考的配装器源码)
    case 23:
      value = param.Unknown3;
      break; // 这里应该是ChestPercent + LegsPercent，Lumina没有命名，但应该是对的(参考的配装器源码)
    default:
      value = 0;
      return 0;
  }

  // 检查值是否为有效数字
  if (typeof value !== "number" || isNaN(value)) {
    throw new TypeError(
      `Invalid value for equipSlotCategory ${equipSlotCategory}: expected number, got ${typeof value}`,
    );
  }
  return value;
}

function getAttributeLimit(
  itemId: number,
  attrId: number,
  syncLevel?: number,
): number {
  const item = itemMap[itemId];
  const level = syncLevel ?? item.LevelItem;
  const iLvlAttr = itemLevelAttrVal(level, attrId);
  if (iLvlAttr == null)
    throw new Error(`LevelItem ${level} field ${attrId} not found`);
  const baseParamModifier = item.BaseParamModifier;
  const meldParam =
    baseParamModifier <= 12
      ? baseParam[attrId][`MeldParam[${baseParamModifier}]`]
      : 0;
  return Math.round(
    (iLvlAttr *
      getEquipSlotPercent(baseParam[attrId], item.EquipSlotCategory) *
      meldParam) /
      100000.0,
  );
}

function calculateEquippedEffectsProxy(
  job: Row,
  jobLevel: number,
  equips: EquipInfo[],
  food: FoodInfo,
): EquippedEffects | undefined {
  if (!supportedJobLevels.has(jobLevel)) {
    throw new Error(`不支持的等级: ${jobLevel}`);
  }

  const gearStats: EquippedStats = {};
  for (const equip of equips) {
    for (const param of equip.baseParams) {
      const stat = baseParamIdToStat[param.baseParamId];
      if (stat === undefined) continue;
      gearStats[stat] = (gearStats[stat] ?? 0) + param.value;
    }
    gearStats.PDMG = (gearStats.PDMG ?? 0) + equip.PDMG;
    gearStats.MDMG = (gearStats.MDMG ?? 0) + equip.MDMG;
    gearStats.DLY = (gearStats.DLY ?? 0) + equip.DLY;
  }

  const equippedStats: EquippedStats = { ...gearStats };
  for (const param of food.baseParams) {
    const stat = baseParamIdToStat[param.baseParamId];
    if (stat === undefined) continue;
    const equippedStat = gearStats[stat] ?? 0;
    const effectiveFoodStat = Math.min(
      param.maxValue,
      Math.trunc(equippedStat * (param.multiplier - 1) + 1e-7),
    );
    equippedStats[stat] = (equippedStats[stat] ?? 0) + effectiveFoodStat;
  }

  return equippedEffects(
    job.Abbreviation as Job,
    jobLevel as JobLevel,
    equippedStats,
  );
}

class EquipmentMateriaCombiner {
  getMateriaAttributeTypes: EquipmentMateriaCombinerConfig["getMateriaAttributeTypes"];
  getMateriaValue: EquipmentMateriaCombinerConfig["getMateriaValue"];
  getAttributeLimit: EquipmentMateriaCombinerConfig["getAttributeLimit"];
  typesCache: Map<number, number[]>;
  schemeCache: Map<string, Uint8Array[]>;

  /**
   * @param {Object} config
   * @param {(jobType: number) => number[]} config.getMateriaAttributeTypes
   *        根据职业类型返回可用的属性id列表（无限制孔和限制孔共用）
   * @param {(attrId: number, materiaLevel: number) => number} config.getMateriaValue
   *        根据属性id和魔晶石等级返回属性值
   * @param {(itemId: number, attrId: number) => number} config.getAttributeLimit
   *        属性上限函数，返回该属性在装备上的最大值
   */
  constructor({
    getMateriaAttributeTypes,
    getMateriaValue,
    getAttributeLimit,
  }: EquipmentMateriaCombinerConfig) {
    this.getMateriaAttributeTypes = getMateriaAttributeTypes;
    this.getMateriaValue = getMateriaValue;
    this.getAttributeLimit = getAttributeLimit;

    // 缓存：职业类型 -> 可用属性id列表（排序后）
    this.typesCache = new Map();
    // 缓存：方案生成。键：`${jobType}|${ur}|${rr}`，值：方案数组
    this.schemeCache = new Map();
  }

  /**
   * 计算所有可行的魔晶石镶嵌组合
   * @param {number} jobType - 职业类型（决定可用魔晶石种类）
   * @param {number} materiaLevel - 魔晶石等级（决定属性值）
   * @param {number} unrestrictedSlots - 无限制孔数量
   * @param {number} restrictedSlots - 限制孔数量
   * @param {ParamInfo[]} baseParams - 基础属性
   * @param {number} itemId - 物品id
   * @returns {[string, ParamInfo[]][]} 每个元素为 [key, 排序后的属性数组]
   */
  calculate(
    jobType: number,
    materiaLevel: number,
    unrestrictedSlots: number,
    restrictedSlots: number,
    baseParams: ParamInfo[],
    itemId: number,
  ): [string, ParamInfo[]][] {
    // 1. 获取该职业可用的属性id列表（缓存）
    let attrIds = this.typesCache.get(jobType);
    if (!attrIds) {
      attrIds = this.getMateriaAttributeTypes(jobType).sort((a, b) => a - b);
      this.typesCache.set(jobType, attrIds);
    }

    // 2. 获取所有可能的镶嵌方案（缓存）
    const schemeKey = `${jobType}|${unrestrictedSlots}|${restrictedSlots}`;
    let schemes = this.schemeCache.get(schemeKey);
    if (!schemes) {
      schemes = this._generateSchemes(
        attrIds,
        unrestrictedSlots,
        restrictedSlots,
      );
      this.schemeCache.set(schemeKey, schemes);
    }

    // 3. 构建基础属性Map（合并重复id）
    const baseMap = new Map<number, number>();
    for (let i = 0; i < baseParams.length; i++) {
      const { baseParamId, value } = baseParams[i];
      baseMap.set(baseParamId, (baseMap.get(baseParamId) || 0) + value);
    }

    // 4. 获取属性值映射
    const attrValues: number[] = new Array(attrIds.length);
    for (let i = 0; i < attrIds.length; i++) {
      attrValues[i] = this.getMateriaValue(attrIds[i], materiaLevel);
    }

    // 5. 计算每个属性id的最大可镶嵌数量
    const maxCounts: number[] = new Array(attrIds.length);
    for (let i = 0; i < attrIds.length; i++) {
      const attrId = attrIds[i];
      const value = attrValues[i];
      const baseVal = baseMap.get(attrId) || 0;
      const limit = this.getAttributeLimit(itemId, attrId);
      maxCounts[i] =
        value > 0 ? Math.max(0, Math.floor((limit - baseVal) / value)) : 0;
    }

    // 6. 遍历方案，生成有效组合并去重
    const results: [string, ParamInfo[]][] = [];
    const seen = new Set<string>();

    for (let s = 0; s < schemes.length; s++) {
      const scheme = schemes[s]; // Uint8Array，长度 = attrIds.length
      let valid = true;
      // 检查是否超过上限
      for (let i = 0; i < scheme.length; i++) {
        if (scheme[i] > maxCounts[i]) {
          valid = false;
          break;
        }
      }
      if (!valid) continue;

      // 构建最终属性
      const finalMap = new Map(baseMap);
      for (let i = 0; i < scheme.length; i++) {
        const count = scheme[i];
        if (count > 0) {
          const attrId = attrIds[i];
          finalMap.set(
            attrId,
            (finalMap.get(attrId) || 0) + count * attrValues[i],
          );
        }
      }

      // 转为数组并排序
      const attributes: ParamInfo[] = Array.from(finalMap.entries()).map(
        ([baseParamId, value]) => ({
          baseParamId,
          value,
        }),
      );
      attributes.sort((a, b) => a.baseParamId - b.baseParamId);
      const key = attributes.map((it) => it.baseParamId).join("-");
      const valuesKey = equipmentAttributeValuesKey(attributes);

      if (!seen.has(valuesKey)) {
        seen.add(valuesKey);
        results.push([key, attributes]);
      }
    }

    return results;
  }

  /**
   * 生成所有可能的镶嵌方案
   * @param {number[]} attrIds - 可用的属性id列表（排序后）
   * @param {number} ur - 无限制孔数量
   * @param {number} rr - 限制孔数量
   * @returns {Uint8Array[]} 每个方案是一个Uint8Array，长度等于 attrIds.length
   */
  _generateSchemes(attrIds: number[], ur: number, rr: number): Uint8Array[] {
    // 生成无限制孔的计数方案
    const uCombos = this._generateCountCombinations(attrIds.length, ur);
    // 生成限制孔的计数方案
    const rCombos = this._generateCountCombinations(attrIds.length, rr);

    const schemes: Uint8Array[] = [];
    for (let u = 0; u < uCombos.length; u++) {
      for (let r = 0; r < rCombos.length; r++) {
        const scheme = new Uint8Array(attrIds.length);
        // 合并无限制孔和限制孔的计数
        for (let i = 0; i < attrIds.length; i++) {
          scheme[i] = uCombos[u][i] + rCombos[r][i];
        }
        schemes.push(scheme);
      }
    }
    return schemes;
  }

  /**
   * 生成从 n 种物品中选取 total 个的所有计数组合
   * @param {number} n - 物品种类数
   * @param {number} total - 总数量
   * @returns {Uint8Array[]} 每个组合是长度 n 的数组，和为 total
   */
  _generateCountCombinations(n: number, total: number): Uint8Array[] {
    if (n === 0) return total === 0 ? [new Uint8Array(0)] : [];
    const res: Uint8Array[] = [];
    const arr = new Uint8Array(n);
    const dfs = (idx: number, remaining: number): void => {
      if (idx === n - 1) {
        arr[idx] = remaining;
        res.push(arr.slice());
        return;
      }
      for (let take = 0; take <= remaining; take++) {
        arr[idx] = take;
        dfs(idx + 1, remaining - take);
      }
    };
    dfs(0, total);
    return res;
  }
}

const equipmentMateriaCombiner = new EquipmentMateriaCombiner({
  getMateriaAttributeTypes: (jobType) => {
    // ClassJob的JobType，1T 2纯奶 3近战 4远敏 5法系输出 6盾奶
    // NOTICE: 注意8.0可能会增加7 ST，并把1改为MT
    switch (jobType) {
      // 1 T
      case 1:
        return Object.values(baseParam)
          .filter((it) =>
            ["暴击", "信念", "直击", "技能速度", "坚韧"].includes(it.Name),
          )
          .map((it) => it.rowId);
      // 3 近战 4 远敏
      case 3:
      case 4:
        return Object.values(baseParam)
          .filter((it) =>
            ["暴击", "信念", "直击", "技能速度"].includes(it.Name),
          )
          .map((it) => it.rowId);
      // 2 纯奶 5 法系输出 6 盾奶
      case 2:
      case 5:
      case 6:
        return Object.values(baseParam)
          .filter((it) =>
            ["暴击", "信念", "直击", "咏唱速度"].includes(it.Name),
          )
          .map((it) => it.rowId);
      default:
        throw new Error(
          `未知job type: ${jobType}，注意8.0可能会增加7 ST，并把1改为MT`,
        );
    }
  },
  getMateriaValue: (attrId, level) => {
    return materiaByBaseParam[attrId].values[level];
  },
  getAttributeLimit,
});

class EquipInfoPruner {
  /**
   * 对EquipInfo数组进行剪枝，移除被支配的装备
   * @param {EquipInfo[]} equipInfos - EquipInfo数组
   * @returns {EquipInfo[]} 剪枝后的装备数组
   */
  prune<T extends ComparableInfo>(equipInfos: T[]): T[] {
    // 按key分组
    const groups = new Map<string, T[]>();

    for (let i = 0; i < equipInfos.length; i++) {
      const equip = equipInfos[i];
      if (!groups.has(equip.key)) {
        groups.set(equip.key, []);
      }
      groups.get(equip.key)!.push(equip);
    }

    // 对每组进行剪枝并合并结果
    const result: T[] = [];
    for (const group of groups.values()) {
      result.push(...this.#pruneSingleGroup(group));
    }

    return result;
  }

  /**
   * 对单个key组内的装备进行剪枝
   * @param {EquipInfo[]} group - 同key的装备数组
   * @returns {EquipInfo[]} 剪枝后的装备数组
   * @private
   */
  #pruneSingleGroup<T extends ComparableInfo>(group: T[]): T[] {
    if (group.length <= 1) return group;

    // 按属性总和降序排序（直接修改原数组）
    group.sort(
      (a, b) =>
        this.#sumAttributes(b.baseParams) - this.#sumAttributes(a.baseParams),
    );

    let paretoFront: T[] = [];

    for (let i = 0; i < group.length; i++) {
      const candidate = group[i];
      let shouldRetainCandidate = true;
      const newFront: T[] = [];

      // 暂存candidate加入后的前沿；一旦发现candidate应被淘汰，就放弃暂存结果。
      for (let j = 0; j < paretoFront.length; j++) {
        const retained = paretoFront[j];
        if (this.#sameAttributes(candidate.baseParams, retained.baseParams)) {
          if (!this.#hasHigherItemPriority(candidate, retained)) {
            shouldRetainCandidate = false;
            break;
          }
          continue;
        }
        const dominance = this.#compareDominance(
          candidate.baseParams,
          retained.baseParams,
        );
        if (dominance < 0) {
          shouldRetainCandidate = false;
          break;
        }
        if (dominance === 0) {
          newFront.push(retained);
        }
      }

      if (shouldRetainCandidate) {
        newFront.push(candidate);
        paretoFront = newFront;
      }
    }

    return paretoFront;
  }

  #sameAttributes(
    aParams: (ParamInfo | FoodParam)[],
    bParams: (ParamInfo | FoodParam)[],
  ): boolean {
    if (aParams.length !== bParams.length) return false;
    for (let i = 0; i < aParams.length; i++) {
      const aParam = aParams[i];
      const bParam = bParams[i];
      if (aParam.baseParamId !== bParam.baseParamId) return false;
      if ("value" in aParam && "value" in bParam) {
        if (aParam.value !== bParam.value) return false;
      } else if ("multiplier" in aParam && "multiplier" in bParam) {
        if (
          aParam.multiplier !== bParam.multiplier ||
          aParam.maxValue !== bParam.maxValue
        )
          return false;
      } else {
        return false;
      }
    }
    return true;
  }

  #hasHigherItemPriority(
    candidate: ComparableInfo,
    retained: ComparableInfo,
  ): boolean {
    return (
      candidate.itemLevel > retained.itemLevel ||
      (candidate.itemLevel === retained.itemLevel &&
        candidate.itemId > retained.itemId)
    );
  }

  /**
   * 比较装备a和装备b的支配关系
   * @param {(ParamInfo | FoodParam)[]} aParams - 装备A的属性数组（已排序）
   * @param {(ParamInfo | FoodParam)[]} bParams - 装备B的属性数组（已排序）
   * @returns {number} 正数表示a支配b，负数表示b支配a，0表示互不支配
   * @private
   */
  #compareDominance(
    aParams: (ParamInfo | FoodParam)[],
    bParams: (ParamInfo | FoodParam)[],
  ): number {
    if (aParams.length !== bParams.length) return 0;
    let dominance = 0;
    for (let i = 0; i < aParams.length; i++) {
      const aParam = aParams[i];
      const bParam = bParams[i];
      if (aParam.baseParamId !== bParam.baseParamId) return 0;
      const current = Math.sign(
        this.#attributeValue(aParam) - this.#attributeValue(bParam),
      );
      if (dominance !== 0 && current !== 0 && dominance !== current) {
        // 互有高低
        return 0;
      }
      if (current !== 0) dominance = current;
    }
    return dominance;
  }

  /**
   * 计算属性总和
   * @param {(ParamInfo | FoodParam)[]} baseParams - 属性数组
   * @returns {number} 属性值总和
   * @private
   */
  #sumAttributes(baseParams: (ParamInfo | FoodParam)[]): number {
    let sum = 0;
    for (let i = 0; i < baseParams.length; i++) {
      sum += this.#attributeValue(baseParams[i]);
    }
    return sum;
  }

  #attributeValue(param: ParamInfo | FoodParam): number {
    return "value" in param ? param.value : param.maxValue;
  }
}
const equipInfoPruner = new EquipInfoPruner();

function buildEquipInfo(
  itemId: number,
  jobType: number,
  syncLevel?: number,
): EquipInfo[] {
  const item = itemMap[itemId];
  const isSynced = syncLevel !== undefined && item.LevelItem > syncLevel;
  const physicalDamageLimit = isSynced
    ? getAttributeLimit(itemId, baseParamIdForStat("PDMG"), syncLevel)
    : undefined;
  const magicalDamageLimit = isSynced
    ? getAttributeLimit(itemId, baseParamIdForStat("MDMG"), syncLevel)
    : undefined;
  const createEquipInfo = (
    baseParams: ParamInfo[],
    key: string,
  ): EquipInfo => ({
    itemId,
    itemLevel: item.LevelItem,
    key,
    baseParams,
    PDMG: applySyncLimit(item.DamagePhys, physicalDamageLimit),
    MDMG: applySyncLimit(item.DamageMag, magicalDamageLimit),
    DLY: item.Delayms,
  });

  const mandervilleEquips = mandervilleWeapons[itemId];
  if (mandervilleEquips !== undefined) {
    if (!isSynced) return mandervilleEquips;
    return mandervilleEquips.map((equip) =>
      createEquipInfo(
        equip.baseParams.map((param) => ({
          baseParamId: param.baseParamId,
          value: Math.min(
            param.value,
            getAttributeLimit(itemId, param.baseParamId, syncLevel),
          ),
        })),
        equip.key,
      ),
    );
  }

  const baseParams: ParamInfo[] = [];
  for (let i = 0; i < 6; i++) {
    const param = item[`BaseParam[${i}]`];
    const value = item[`BaseParamValue[${i}]`];
    if (param !== 0 && value !== 0)
      baseParams.push({ baseParamId: param, value });
  }
  baseParams.sort((a, b) => a.baseParamId - b.baseParamId);

  if (isSynced) {
    const syncedBaseParams = baseParams.map((param) => ({
      baseParamId: param.baseParamId,
      value: Math.min(
        param.value,
        getAttributeLimit(itemId, param.baseParamId, syncLevel),
      ),
    }));
    return [
      createEquipInfo(
        syncedBaseParams,
        `${syncedBaseParams.map((param) => param.baseParamId).join("-")}`,
      ),
    ];
  }

  const genResult = equipmentMateriaCombiner.calculate(
    jobType,
    Object.values(materiaByBaseParam)[0].minAllowItemLevel.findLastIndex(
      (level) => level <= item.LevelItem,
    ),
    item.MateriaSlotCount + (item.IsAdvancedMeldingPermitted ? 1 : 0),
    item.IsAdvancedMeldingPermitted ? 5 - 1 - item.MateriaSlotCount : 0,
    baseParams,
    itemId,
  );
  return genResult.map(([key, generatedBaseParams]) =>
    createEquipInfo(generatedBaseParams, key),
  );
}

client.close();

 (async () => {
  // 赤魔 735品级同步，装备范围730-795
  const minLvl = 730;
  const maxLvl = 795;
  const syncLvl = 735;
  const requestedJob = process.env.DATA_TEST_JOB ?? "RDM";
  const job = jobs.find((it) => it.Abbreviation === requestedJob);
  if (job === undefined) {
    throw new Error(`MCP ClassJob 表中不存在职业缩写：${requestedJob}`);
  }
  const jobAbbreviation = job.Abbreviation;

  const levels: number[] = [];
  const validEquips: Record<string, Record<number, EquipInfo[]>> = {};
  equipMap
    .entries()
    .filter(([lvl]) => lvl >= minLvl && lvl <= maxLvl)
    .forEach(([lvl, equips]) => {
      levels.push(lvl);
      // 根据装备物品的职业槽位信息里是否有当前职业判断能否装备
      equips
        .filter((it) => classJobCategory[it.ClassJobCategory][jobAbbreviation])
        .forEach((equipItem) => {
          const slot = equipSlotCategory[equipItem.EquipSlotCategory];
          Object.entries(slot.fields)
            .filter(([_, value]) => value === 1)
            .forEach(([slotName]) => {
              // 合并戒指槽位
              if (slotName === "FingerL" || slotName === "FingerR")
                slotName = "Finger";
              if (!validEquips[slotName]) validEquips[slotName] = {};
              if (!validEquips[slotName][lvl]) validEquips[slotName][lvl] = [];
              validEquips[slotName][lvl].push(
                ...buildEquipInfo(equipItem.rowId, job.JobType, syncLvl),
              );
            });
        });
    });
  levels.sort((a, b) => b - a);
  // 每个部位只取最高档，如果最高档全是技速/咏速/坚韧/信仰，就多找低一档
  const filterEquips: Record<string, EquipInfo[]> = {};
  Object.entries(validEquips).forEach(([slotName, equipsByLvl]) => {
    const list: EquipInfo[] = [];
    for (const lvl of levels) {
      const equips = equipsByLvl[lvl];
      if (!equips) continue;
      list.push(...equips);
    }
    filterEquips[slotName] = equipInfoPruner.prune(list);
  });
  const singleRingCandidates = filterEquips.Finger;
  if (singleRingCandidates === undefined) {
    throw new Error("当前职业缺少戒指候选");
  }
  const ringPairCandidates = buildRingPairEquipInfos(
    singleRingCandidates,
    (itemId) => Boolean(itemMap[itemId].IsUnique ?? itemMap[itemId].isUnique),
  );
  filterEquips.Finger = equipInfoPruner.prune(ringPairCandidates);
  console.log(
    `双戒指候选：${singleRingCandidates.length}x${singleRingCandidates.length}` +
      ` -> ${ringPairCandidates.length} -> ${filterEquips.Finger.length}`,
  );
  const availableFoods = equipInfoPruner.prune(
    foods.filter((food) => {
      return (
        food.itemLevel >= levels[levels.length - 1] &&
        food.baseParams.some(
          (it) => baseParamIdToStat[it.baseParamId] === "VIT",
        )
      );
    }),
  );
  const allAvailablePreset =
    Object.values(filterEquips).reduce((acc, it) => acc * it.length, 1) *
    availableFoods.length;
  console.log(
    `可用装备组合数量：${String(allAvailablePreset).replaceAll(/\B(?=(\d{3})+$)/g, "_")}`,
  );

  // 按槽位的候选数量从小到大排序
  let slotsWithEquips = Object.entries(filterEquips).sort(
    (a, b) => a[1].length - b[1].length,
  );
  const partitionCount = Number(process.env.DATA_TEST_PARTITION_COUNT ?? 0);
  const partitionIndex = Number(process.env.DATA_TEST_PARTITION_INDEX ?? 0);
  if (
    !Number.isInteger(partitionCount) || partitionCount < 0 ||
    !Number.isInteger(partitionIndex) || partitionIndex < 0 ||
    (partitionCount > 0 && partitionIndex >= partitionCount)
  ) {
    throw new Error("DATA_TEST_PARTITION_COUNT/INDEX 必须是有效的非负整数");
  }
  const configuredPartitionSlot = Number(
    process.env.DATA_TEST_PARTITION_SLOT ?? 8,
  );
  if (
    !Number.isInteger(configuredPartitionSlot) ||
    configuredPartitionSlot < 0 ||
    configuredPartitionSlot >= slotsWithEquips.length
  ) {
    throw new Error("DATA_TEST_PARTITION_SLOT 必须是有效的槽位排序索引");
  }
  if (partitionCount > 1) {
    const partitionCandidateCount = slotsWithEquips[configuredPartitionSlot][1].length;
    if (partitionCount > partitionCandidateCount) {
      throw new Error("分区数不能超过分区槽位候选数");
    }
    slotsWithEquips = slotsWithEquips.map(([slot, equips], index) =>
      index === configuredPartitionSlot
        ? [slot, equips.filter((_, candidateIndex) => candidateIndex % partitionCount === partitionIndex)]
        : [slot, equips],
    );
  }

  const v1Job = job.Abbreviation as Job;
  const v1JobLevel = 100 as JobLevel;
  const jobSchema = referenceGame.jobSchemas[v1Job];
  const primaryStatId = Number(job.PrimaryStat);
  const attackMainStat = baseParamIdToStat[primaryStatId];
  const expectedAttackMainStat =
    jobSchema.mainStat === "VIT" ? "STR" : jobSchema.mainStat;
  if (
    attackMainStat === undefined ||
    attackMainStat !== expectedAttackMainStat
  ) {
    throw new Error(
      `ClassJob.PrimaryStat 与伤害公式不匹配：${job.PrimaryStat}`,
    );
  }
  const speedStat: Stat = jobSchema.stats?.includes("SKS") ? "SKS" : "SPS";
  const criticalHitId = baseParamIdForStat("CRT");
  const determinationId = baseParamIdForStat("DET");
  const directHitId = baseParamIdForStat("DHT");
  const speedAttributeId = baseParamIdForStat(speedStat);
  const spellSpeedId = baseParamIdForStat("SPS");
  const tierStats = [attackMainStat, "CRT", "DHT", "DET", speedStat] as const;
  const tierStatById = new Map<number, Stat>(
    tierStats.map((stat) => [
      stat === attackMainStat ? primaryStatId : baseParamIdForStat(stat),
      stat,
    ]),
  );
  const toughnessAttributeId = jobSchema.stats?.includes("TEN")
    ? baseParamIdForStat("TEN")
    : undefined;
  if (toughnessAttributeId !== undefined) {
    tierStatById.set(toughnessAttributeId, "TEN");
  }
  const weaponDamageId = -1;
  const weaponDamageStat =
    jobSchema.mainStat === "MND" || jobSchema.mainStat === "INT"
      ? "MDMG"
      : "PDMG";
  const v1AttributeIds = [...tierStatById.keys(), weaponDamageId].sort(
    (a, b) => a - b,
  );
  const v1AttributeIndex = new Map(
    v1AttributeIds.map((id, index) => [id, index]),
  );
  if (process.env.DATA_TEST_COUNT_ATTRIBUTE_COMBINATIONS === "true") {
  const { countAttributeCombinationLayers } = await import("./archived/attribute-combination-counter.ts");
    const thresholdStats = ["CRT", "DET", "DHT"] as const;
    const theoreticalMinimumTotal = 7000;
    type TierInterval = [minimum: number, maximum: number];
    const buildTierIntervals = (
      stat: Stat,
      accept: (value: number) => boolean = () => true,
    ): TierInterval[] => {
      const intervals = new Map<number, TierInterval>();
      for (let value = 0; value <= 10000; value++) {
        if (!accept(value)) continue;
        const tier = equippedAttributeTier(v1Job, v1JobLevel, stat, value);
        const interval = intervals.get(tier);
        if (interval === undefined) intervals.set(tier, [value, value]);
        else interval[1] = value;
      }
      return [...intervals.values()];
    };
    const thresholdIntervals = thresholdStats.map((stat) => {
      const intervals = buildTierIntervals(stat);
      console.log(`理论阈值档位：${stat}=${intervals.length}`);
      return intervals;
    });
    const speedGcdBuckets = new Int32Array(20001);
    for (let value = 0; value < speedGcdBuckets.length; value++) {
      const effects = equippedEffects(v1Job, v1JobLevel, {
        [speedStat]: value,
      });
      if (effects === undefined || !Number.isFinite(effects.gcd)) {
        throw new Error(`无法计算速度 ${value} 的 GCD`);
      }
      speedGcdBuckets[value] = Math.round(effects.gcd * 100);
    }
    const speedIntervalsByGcd = new Map<number, TierInterval>();
    for (let value = 0; value <= 10000; value++) {
      const gcdBucket = speedGcdBuckets[value]!;
      if (gcdBucket < 200 || gcdBucket > 250) continue;
      const interval = speedIntervalsByGcd.get(gcdBucket);
      if (interval === undefined) {
        speedIntervalsByGcd.set(gcdBucket, [value, value]);
      } else {
        interval[1] = value;
      }
    }
    const pairIntervals: TierInterval[] = [];
    for (const first of thresholdIntervals[0]!) {
      for (const second of thresholdIntervals[1]!) {
        pairIntervals.push([
          first[0] + second[0],
          first[1] + second[1],
        ]);
      }
    }
    const lowerBound = (values: readonly number[], target: number): number => {
      let left = 0;
      let right = values.length;
      while (left < right) {
        const middle = (left + right) >> 1;
        if (values[middle]! < target) left = middle + 1;
        else right = middle;
      }
      return left;
    };
    const upperBound = (values: readonly number[], target: number): number => {
      let left = 0;
      let right = values.length;
      while (left < right) {
        const middle = (left + right) >> 1;
        if (values[middle]! <= target) left = middle + 1;
        else right = middle;
      }
      return left;
    };
    const countThresholdCombinationsInRange = (
      maximumAttributeValue: number,
      minimumTotal: number,
      maximumTotal: number,
      minimumGcdBucket = Number.NEGATIVE_INFINITY,
      maximumGcdBucket = Number.POSITIVE_INFINITY,
    ): bigint => {
      if (!Number.isInteger(maximumAttributeValue) || maximumAttributeValue < 0) {
        throw new RangeError("理论阈值最大属性必须是非负整数");
      }
      if (
        !Number.isInteger(minimumTotal) ||
        !Number.isInteger(maximumTotal) ||
        minimumTotal < 0 ||
        maximumTotal < minimumTotal
      ) {
        throw new RangeError("理论阈值总属性和范围无效");
      }
      if (maximumAttributeValue >= speedGcdBuckets.length) {
        throw new RangeError(
          `理论阈值速度属性超出 GCD 分桶表范围：${maximumAttributeValue}`,
        );
      }
      const boundedThresholdIntervals = thresholdStats.map((stat) =>
        buildTierIntervals(stat, (value) => value <= maximumAttributeValue),
      );
      const boundedSpeedIntervalsByGcd = new Map<number, TierInterval>();
      for (let value = 0; value <= maximumAttributeValue; value++) {
        const gcdBucket = speedGcdBuckets[value]!;
        if (gcdBucket < minimumGcdBucket || gcdBucket > maximumGcdBucket) {
          continue;
        }
        const interval = boundedSpeedIntervalsByGcd.get(gcdBucket);
        if (interval === undefined) {
          boundedSpeedIntervalsByGcd.set(gcdBucket, [value, value]);
        } else {
          interval[1] = value;
        }
      }
      const boundedPairIntervals: TierInterval[] = [];
      for (const first of boundedThresholdIntervals[0]!) {
        for (const second of boundedThresholdIntervals[1]!) {
          boundedPairIntervals.push([
            first[0] + second[0],
            first[1] + second[1],
          ]);
        }
      }
      const boundedDirectHitMinimums = boundedThresholdIntervals[2]!.map(
        (interval) => interval[0],
      );
      const boundedDirectHitMaximums = boundedThresholdIntervals[2]!.map(
        (interval) => interval[1],
      );
      let result = 0n;
      for (const speedInterval of boundedSpeedIntervalsByGcd.values()) {
        for (const pair of boundedPairIntervals) {
          const right = upperBound(
            boundedDirectHitMinimums,
            maximumTotal - speedInterval[0] - pair[0],
          );
          const left = lowerBound(
            boundedDirectHitMaximums,
            minimumTotal - speedInterval[1] - pair[1],
          );
          if (right > left) result += BigInt(right - left);
        }
      }
      return result;
    };
    const directHitMinimums = thresholdIntervals[2]!.map(
      (interval) => interval[0],
    );
    const directHitMaximums = thresholdIntervals[2]!.map(
      (interval) => interval[1],
    );
    let theoreticalThresholdCombinationCount = 0n;
    for (const [gcdBucket, speedInterval] of speedIntervalsByGcd) {
      for (const pair of pairIntervals) {
        const right = upperBound(
          directHitMinimums,
          10000 - speedInterval[0] - pair[0],
        );
        const left = lowerBound(
          directHitMaximums,
          theoreticalMinimumTotal - speedInterval[1] - pair[1],
        );
        if (right > left) {
          theoreticalThresholdCombinationCount += BigInt(right - left);
        }
      }
      if (gcdBucket < 200 || gcdBucket > 250) {
        throw new Error("GCD 分桶超出理论范围");
      }
    }
    console.log(
      `理论速度 GCD 桶=${speedIntervalsByGcd.size}`,
    );
    console.log(
      `理论四属性阈值组合数（和=${theoreticalMinimumTotal}..10000；GCD=2.00..2.50）：${theoreticalThresholdCombinationCount}`,
    );
    /*
     * Keep a wider table for the preset equipment totals. Its threshold key
     * uses the same GCD calculation, including speeds outside the theoretical
     * 2.00..2.50 filter.
     */

    const nonPrimaryAttributeIds = [
      criticalHitId,
      determinationId,
      directHitId,
      speedAttributeId,
    ];
    const equipmentVector = (equip: EquipInfo): AttributeVector => {
      const values = nonPrimaryAttributeIds.map((attributeId) =>
        equip.baseParams
          .filter((param) => param.baseParamId === attributeId)
          .reduce((sum, param) => sum + param.value, 0),
      );
      return [values[0]!, values[1]!, values[2]!, values[3]!];
    };
    const thresholdTierTables = thresholdStats.map((stat) => {
      const table = new Uint16Array(speedGcdBuckets.length);
      for (let value = 0; value < table.length; value++) {
        table[value] = equippedAttributeTier(
          v1Job,
          v1JobLevel,
          stat,
          value,
        );
      }
      return table;
    });
    for (const [index, table] of thresholdTierTables.entries()) {
      for (let value = 1; value < table.length; value++) {
        if (table[value]! < table[value - 1]!) {
          throw new Error(`理论阈值档位不是单调的：属性索引=${index}；值=${value}`);
        }
      }
    }
    for (let value = 1; value < speedGcdBuckets.length; value++) {
      if (speedGcdBuckets[value]! > speedGcdBuckets[value - 1]!) {
        throw new Error(`理论 GCD 桶不是单调的：值=${value}`);
      }
    }
    const layerResults = countAttributeCombinationLayers({
      slots: slotsWithEquips.map(([name, equips]) => ({
        name,
        candidates: equips.map(equipmentVector),
      })),
      workRoot: `${import.meta.dirname}/.attribute-count-work`,
      blockSize: Number(process.env.DATA_TEST_ATTRIBUTE_BLOCK_SIZE ?? 2_000_000),
      keepTemporaryFiles:
        process.env.DATA_TEST_KEEP_ATTRIBUTE_TEMP === "true",
      thresholdKey: (first, second, third, fourth, output) => {
        if (fourth >= speedGcdBuckets.length) {
          throw new RangeError("预设搜索速度超出 GCD 分桶表范围");
        }
        // 这是阈值键的内部排序值；偏移到非负范围，避免负数参与按位 OR 污染高位。
        const speedRank = 0x8000 - speedGcdBuckets[fourth]!;
        output[0] =
          ((thresholdTierTables[0]![first]! << 16) |
            thresholdTierTables[1]![second]!) >>> 0;
        output[1] =
          ((thresholdTierTables[2]![third]! << 16) | speedRank) >>> 0;
      },
      thresholdUpperBound: (minimumTotal, maximumTotal) =>
        countThresholdCombinationsInRange(
          maximumTotal,
          minimumTotal,
          maximumTotal,
        ),
      thresholdKeysSorted: false,
      onLayerProgress: (progress) => {
        console.log(
          `属性组合进度：槽位=${progress.name}；完成=${progress.percent.toFixed(1)}%`,
        );
      },
      onLayerComplete: (result) => {
        console.log(
          `属性组合去重：槽位=${result.name}；候选=${result.candidateCount}` +
            `；遍历次数=${result.traversalCount}` +
            `；精确总属性=${result.exactCount}` +
            `；阈值截断=${result.thresholdCount}` +
            `；总属性和范围=${result.minimumTotal}..${result.maximumTotal}` +
            `；理论阈值范围上限=${result.thresholdUpperBound}`,
        );
      },
    });
    void layerResults;
    process.exit(0);
  }
  const v1StatIndexes = new Map<Stat, number>();
  for (const [id, index] of v1AttributeIndex) {
    const stat = baseParamIdToStat[id];
    if (stat !== undefined) v1StatIndexes.set(stat, index);
  }
  v1StatIndexes.set(
    weaponDamageStat,
    v1AttributeIndex.get(weaponDamageId)!,
  );
  const maxContributions = v1AttributeIds.map((attributeId) =>
    slotsWithEquips.reduce(
      (total, [, equips]) => total + Math.max(0, ...equips.map((equip) =>
        attributeId === weaponDamageId
          ? equip[weaponDamageStat]
          : equip.baseParams.filter((param) => param.baseParamId === attributeId)
              .reduce((sum, param) => sum + param.value, 0))),
      0,
    ) + Math.max(0, ...availableFoods.map((food) =>
      food.baseParams.find((param) => param.baseParamId === attributeId)?.maxValue ?? 0)),
  );
  if (process.env.DATA_TEST_PRINT_MAX === "true") {
    console.log(`最大属性贡献：${v1AttributeIds.map((id, index) => `${id}=${maxContributions[index]}`).join(",")}`);
  }
  const v1Evaluate = createDamageGcdVectorEvaluator(
    v1Job,
    v1JobLevel,
    v1StatIndexes,
    maxContributions,
  );
  const foodPriorityByIdentity = new Map(
    availableFoods.map((food) => {
      const attributes = new Set(
        food.baseParams.map((param) => param.baseParamId),
      );
      const priority =
        attributes.has(criticalHitId) && attributes.has(determinationId)
          ? 0
          : attributes.has(spellSpeedId)
            ? 2
            : 1;
      return [`${food.itemId}|${food.key}`, priority] as const;
    }),
  );
  const v1Foods = availableFoods.map((food) => ({
    ...food,
    baseParams: food.baseParams.filter((param) =>
      v1AttributeIndex.has(param.baseParamId),
    ),
  }));
  const v1Damage = (attributes: readonly number[]): number => {
    return v1Evaluate(attributes)?.damage ?? Number.NEGATIVE_INFINITY;
  };
  const configuredSuffixFrontierSlotCount = Number(
    process.env.DATA_TEST_SUFFIX_SLOTS ?? 4,
  );
  if (
    !Number.isInteger(configuredSuffixFrontierSlotCount) ||
    configuredSuffixFrontierSlotCount < 0
  ) {
    throw new Error("DATA_TEST_SUFFIX_SLOTS 必须是非负整数");
  }
  const rawSuffixFrontierMaxCombinations =
    process.env.DATA_TEST_SUFFIX_MAX_COMBINATIONS;
  const configuredSuffixFrontierMaxCombinations =
    rawSuffixFrontierMaxCombinations === undefined ||
      rawSuffixFrontierMaxCombinations === ""
      ? undefined
      : Number(rawSuffixFrontierMaxCombinations);
  if (
    configuredSuffixFrontierMaxCombinations !== undefined &&
    (!Number.isSafeInteger(configuredSuffixFrontierMaxCombinations) ||
      configuredSuffixFrontierMaxCombinations < 1)
  ) {
    throw new Error("DATA_TEST_SUFFIX_MAX_COMBINATIONS 必须是正整数");
  }
  const rawSuffixFrontierLeafSize = process.env.DATA_TEST_SUFFIX_LEAF_SIZE;
  const configuredSuffixFrontierLeafSize =
    rawSuffixFrontierLeafSize === undefined
      ? undefined
      : Number(rawSuffixFrontierLeafSize);
  if (
    configuredSuffixFrontierLeafSize !== undefined &&
    (!Number.isInteger(configuredSuffixFrontierLeafSize) ||
      configuredSuffixFrontierLeafSize < 1)
  ) {
    throw new Error("DATA_TEST_SUFFIX_LEAF_SIZE 必须是正整数");
  }
  const useDpsObjective =
    process.env.DATA_TEST_GCD === undefined || process.env.DATA_TEST_GCD === "";
  const abortAfterSearched = Number(
    process.env.DATA_TEST_ABORT_AFTER_SEARCH ?? 0,
  );
  if (!Number.isInteger(abortAfterSearched) || abortAfterSearched < 0) {
    throw new Error("DATA_TEST_ABORT_AFTER_SEARCH 必须是非负整数");
  }
  let searchAbortRequested = false;
  const abortAfterMs = Number(process.env.DATA_TEST_ABORT_AFTER_MS ?? 0);
  if (!Number.isFinite(abortAfterMs) || abortAfterMs < 0) {
    throw new Error("DATA_TEST_ABORT_AFTER_MS 必须是非负有限数字");
  }
  let searchAbortDeadline = Number.POSITIVE_INFINITY;
  const abortFlag = new SharedArrayBuffer(4);
  const abortView = new Int32Array(abortFlag);
  process.on("SIGINT", () => {
    searchAbortRequested = true;
    Atomics.store(abortView, 0, 1);
  });
  const searchOptions: LoadoutFinderV2Options = {
    shouldAbort: () => searchAbortRequested || Date.now() >= searchAbortDeadline,
    debug: process.env.DATA_TEST_DEBUG !== "false",
    compactDominance: process.env.DATA_TEST_COMPACT_DOMINANCE !== "false",
    attributeIds: v1AttributeIds,
    greedyPriorityAttributeIds: [
      primaryStatId,
      criticalHitId,
      determinationId,
      directHitId,
    ],
    foodPriorityComparator: (first, second) =>
      (first === undefined
        ? 1
        : foodPriorityByIdentity.get(`${first.itemId}|${first.key}`)!) -
      (second === undefined
        ? 1
        : foodPriorityByIdentity.get(`${second.itemId}|${second.key}`)!),
    attributeTierProjectors: new Map(
      [...tierStatById].map(([attributeId, stat]) => [
        attributeId,
        (value: number) =>
          equippedAttributeTier(v1Job, v1JobLevel, stat, value),
      ]),
    ),
    equipmentAttributeExtractor: (equip) => [
      ...equip.baseParams.filter((param) =>
        v1AttributeIndex.has(param.baseParamId),
      ),
      { baseParamId: weaponDamageId, value: equip[weaponDamageStat] },
    ],
    suffixPairAttributes:
      process.env.DATA_TEST_SUFFIX_PAIR_INDEX === "false"
        ? undefined
        : [
            v1AttributeIndex.get(weaponDamageId)!,
            v1AttributeIndex.get(primaryStatId)!,
          ] as const,
    suffixPairStride:
      process.env.DATA_TEST_SUFFIX_PAIR_INDEX === "false"
        ? undefined
        : maxContributions[v1AttributeIndex.get(primaryStatId)!]! + 1,
    suffixFrontierSlotCount: configuredSuffixFrontierSlotCount,
    suffixFrontierMaxCombinations: configuredSuffixFrontierMaxCombinations,
    suffixFrontierLeafSize: configuredSuffixFrontierLeafSize,
    slotOrder: (() => {
      const value = process.env.DATA_TEST_SLOT_ORDER;
      if (
        value === undefined ||
        value === "candidate-count-descending" ||
        value === "relaxation-gap" ||
        value === "relaxation-gap-with-small-suffix"
      ) {
        return value;
      }
      throw new Error(
        "DATA_TEST_SLOT_ORDER 必须是 candidate-count-descending、relaxation-gap 或 relaxation-gap-with-small-suffix",
      );
    })(),
    combinedDamageCache:
      process.env.DATA_TEST_COMBINED_CACHE === "true",
    collectTotalSignatures:
      process.env.DATA_TEST_COLLECT_SIGNATURES === "true",
    abortAfterSearched: abortAfterSearched === 0 ? undefined : abortAfterSearched,
    combinedDamageFunction: useDpsObjective
      ? v1Evaluate.combinedDps
      : v1Evaluate.combinedDamage,
    combinedDamageFlatFunction: useDpsObjective
      ? v1Evaluate.combinedDpsFlat
      : v1Evaluate.combinedDamageFlat,
    maxCombinedDamageFlat: useDpsObjective
      ? v1Evaluate.maxCombinedDpsFlat
      : v1Evaluate.maxCombinedDamageFlat,
    maxCombinedDamageFlatColumnsFunction: useDpsObjective
      ? v1Evaluate.maxCombinedDpsFlatColumns
      : v1Evaluate.maxCombinedDamageFlatColumns,
    maxCombinedDamageFlatBatch: useDpsObjective
      ? v1Evaluate.maxCombinedDpsFlatBatch
      : v1Evaluate.maxCombinedDamageFlatBatch,
    // The RDM data set benefits more from per-food incumbent pruning than
    // from sharing one suffix scan across all four food branches. Keep the
    // shared path available for targeted experiments, but disable it by
    // default for the production benchmark.
    shareFoods: process.env.DATA_TEST_SHARE_FOODS !== "false",
    shareFoodsMode: (() => {
      const value = process.env.DATA_TEST_SHARE_FOODS_MODE;
      if (value === undefined || value === "batch" || value === "sequential") {
        return value ?? "sequential";
      }
      throw new Error("DATA_TEST_SHARE_FOODS_MODE 必须是 batch 或 sequential");
    })(),
    prefixUpperBound: (() => {
      const value = process.env.DATA_TEST_PREFIX_UPPER;
      if (value === undefined || value === "true" || value === "false") {
        return value !== "false";
      }
      throw new Error("DATA_TEST_PREFIX_UPPER 必须是 true 或 false");
    })(),
    prefixSuffixBlockUpperBound:
      process.env.DATA_TEST_PREFIX_SUFFIX_BLOCK_UPPER === "true",
    suffixSubblockRefinement: process.env.DATA_TEST_SUFFIX_SUBBLOCK === "true",
    suffixSubblockStateLimit: (() => {
      const value = process.env.DATA_TEST_SUFFIX_SUBBLOCK_SIZE;
      if (value === undefined || value === "") return undefined;
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < 1) {
        throw new Error("DATA_TEST_SUFFIX_SUBBLOCK_SIZE 必须是正整数");
      }
      return parsed;
    })(),
    suffixFlatScan: process.env.DATA_TEST_SUFFIX_FLAT !== "false",
    suffixFlatTree: process.env.DATA_TEST_SUFFIX_FLAT_TREE === "true",
    suffixFlatTreeLeafSize: (() => {
      const value = process.env.DATA_TEST_SUFFIX_TREE_LEAF_SIZE;
      if (value === undefined || value === "") return undefined;
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < 1) {
        throw new Error("DATA_TEST_SUFFIX_TREE_LEAF_SIZE 必须是正整数");
      }
      return parsed;
    })(),
    suffixStateUpperBound: process.env.DATA_TEST_SUFFIX_STATE_UPPER === "true",
    sharedRawPrefixDominance: process.env.DATA_TEST_SHARED_RAW_PREFIX === "true",
    suffixNecessaryLowerBound:
      process.env.DATA_TEST_SUFFIX_NECESSARY_LOWER === "true",
    suffixNecessaryIntersection:
      process.env.DATA_TEST_SUFFIX_NECESSARY_INTERSECTION === "true",
    suffixSumNecessaryBound:
      process.env.DATA_TEST_SUFFIX_SUM_NECESSARY !== "false",
    suffixExactBlockUpperBound:
      process.env.DATA_TEST_SUFFIX_EXACT_BLOCK_UPPER === "true",
    suffixDynamicBlockOrder:
      process.env.DATA_TEST_SUFFIX_DYNAMIC_ORDER === "true",
    suffixPerSlotBounds:
      process.env.DATA_TEST_SUFFIX_PER_SLOT_BOUNDS === "true",
    suffixTotalDamageCache:
      process.env.DATA_TEST_SUFFIX_TOTAL_CACHE === "true",
    suffixTotalDamageTierCache:
      process.env.DATA_TEST_SUFFIX_TOTAL_TIER_CACHE === "true",
    suffixPrefixGridUpperBound:
      process.env.DATA_TEST_SUFFIX_GRID_UPPER === "true",
    suffixPrefixGridStateUpperBound:
      process.env.DATA_TEST_SUFFIX_GRID_STATE_UPPER === "true",
    suffixPrefixTierLookup:
      process.env.DATA_TEST_SUFFIX_PREFIX_TIER_LOOKUP === "true",
    suffixPrefixGridSize: (() => {
      const value = process.env.DATA_TEST_SUFFIX_GRID_SIZE;
      if (value === undefined || value === "") return undefined;
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < 2 || parsed > 16) {
        throw new Error("DATA_TEST_SUFFIX_GRID_SIZE 必须是 2 到 16 之间的整数");
      }
      return parsed;
    })(),
    prefixFrontierBatch: process.env.DATA_TEST_PREFIX_FRONTIER === "true",
    suffixFutureTierCompression:
      process.env.DATA_TEST_SUFFIX_FUTURE_TIER_COMPRESSION === "true",
    combinedDamageUpperBoundFunction:
      process.env.DATA_TEST_DISABLE_UPPER === "true"
        ? undefined
        : useDpsObjective
          ? v1Evaluate.combinedDpsUpperBound
          : v1Evaluate.combinedDamageUpperBound,
  };
  const searchSlots = slotsWithEquips.map(([, equips]) => equips);
  const optionalConstraint = (name: string): number | undefined => {
    const raw = process.env[name];
    if (raw === undefined || raw === "") return undefined;
    const value = Number(raw);
    if (!Number.isFinite(value)) {
      throw new Error(`${name} 必须是有限数字`);
    }
    return value;
  };
  const rawMaxToughnessMode = process.env.DATA_TEST_MAX_TOUGHNESS;
  if (
    rawMaxToughnessMode !== undefined &&
    !["0", "1", "false", "true"].includes(rawMaxToughnessMode.toLowerCase())
  ) {
    throw new Error("DATA_TEST_MAX_TOUGHNESS 必须是 true、false、1 或 0");
  }
  const v2Constraints: LoadoutV2Constraints = {
    gcd: optionalConstraint("DATA_TEST_GCD"),
    speedMin: optionalConstraint("DATA_TEST_SPEED_MIN"),
    speedMax: optionalConstraint("DATA_TEST_SPEED_MAX"),
    toughnessMinPercent: optionalConstraint("DATA_TEST_TOUGH_PERCENT"),
    toughMin: optionalConstraint("DATA_TEST_TOUGH_MIN"),
    maxToughnessMode:
      rawMaxToughnessMode === undefined
        ? undefined
        : ["1", "true"].includes(rawMaxToughnessMode.toLowerCase()),
  };
  if (process.env.DATA_TEST_EXPORT_V3 === "true") {
    const sendCandidate = process.send;
    if (typeof sendCandidate !== "function") {
      throw new Error("DATA_TEST_EXPORT_V3 需要由 scripts/test/run-v3.mjs 通过 IPC 启动");
    }
    const equipmentVariantIdentity = (equipment: EquipInfo): string => {
      const parameters = equipment.baseParams
        .map(({ baseParamId, value }) => [baseParamId, value] as const)
        .sort((first, second) => first[0] - second[0])
        .map(([baseParamId, value]) => `${baseParamId}:${value}`)
        .join(",");
      return [
        equipment.itemId,
        equipment.itemLevel,
        parameters,
        equipment.PDMG,
        equipment.MDMG,
        equipment.DLY,
      ].join("|");
    };
    const fullEquipmentIdentity = (equipment: EquipInfo): string => {
      if (isRingPairEquipInfo(equipment)) {
        return `pair:${equipment.ringEquips
          .map(equipmentVariantIdentity)
          .sort()
          .join("||")}`;
      }
      return equipmentVariantIdentity(equipment);
    };
    const uniqueEquipmentVariants = (equipments: readonly EquipInfo[]): EquipInfo[] => {
      const seen = new Set<string>();
      return equipments.filter((equipment) => {
        const identity = fullEquipmentIdentity(equipment);
        if (seen.has(identity)) return false;
        seen.add(identity);
        return true;
      });
    };
    const rawSingleRingCandidates = Object.values(validEquips.Finger ?? {})
      .flat();
    const estimatedRawRingPairCount = rawSingleRingCandidates.length ** 2;
    if (estimatedRawRingPairCount > 1_000_000) {
      throw new Error(
        `V3 原始戒指候选预计产生 ${estimatedRawRingPairCount} 个有序戒指对，超过候选内存保护线；未导出且不会声称最优`,
      );
    }
    const rawGcdChoices = process.env.DATA_TEST_GCD_CHOICES;
    const v3Constraints = {
      ...v2Constraints,
      ...(rawGcdChoices === undefined || rawGcdChoices.trim() === ""
        ? {}
        : {
            gcdChoices: rawGcdChoices.split(",").map((part) => {
              const gcd = Number(part.trim());
              if (!Number.isFinite(gcd) || gcd <= 0) {
                throw new Error("DATA_TEST_GCD_CHOICES 必须是逗号分隔的正有限数字");
              }
              return gcd;
            }),
          }),
    };
    if (
      v3Constraints.gcdChoices !== undefined &&
      (v3Constraints.gcdChoices.length === 0 ||
        new Set(v3Constraints.gcdChoices).size !== v3Constraints.gcdChoices.length)
    ) {
      throw new Error("DATA_TEST_GCD_CHOICES 不能是空列表或包含重复 GCD");
    }
    const rawRingPairCandidates = uniqueEquipmentVariants(
      buildRingPairEquipInfos(
        rawSingleRingCandidates,
        (itemId) => Boolean(itemMap[itemId].IsUnique ?? itemMap[itemId].isUnique),
      ),
    );
    const rawFoodCandidates = foods
      .filter((food) =>
        food.itemLevel >= levels[levels.length - 1] &&
        food.baseParams.some(
          (param) => baseParamIdToStat[param.baseParamId] === "VIT",
        ),
      );
    const v3Slots = slotsWithEquips.map(([slotName]) => {
      if (slotName === "Finger") return rawRingPairCandidates;
      const rawCandidates = Object.values(validEquips[slotName] ?? {}).flat();
      return uniqueEquipmentVariants(rawCandidates);
    });
    const v3MaxContributions = v1AttributeIds.map((attributeId) =>
      v3Slots.reduce(
        (total, equips) =>
          total +
          Math.max(
            0,
            ...equips.map((equipment) =>
              attributeId === weaponDamageId
                ? equipment[weaponDamageStat]
                : equipment.baseParams
                    .filter((param) => param.baseParamId === attributeId)
                    .reduce((sum, param) => sum + param.value, 0),
            ),
          ),
        0,
      ) +
        Math.max(
          0,
          ...rawFoodCandidates.map(
            (food) =>
              food.baseParams.find((param) => param.baseParamId === attributeId)
                ?.maxValue ?? 0,
          ),
        ),
    );
    const itemNames: Record<number, string> = {};
    const rememberItemName = (itemId: number): void => {
      const name = itemMap[itemId]?.Name;
      if (typeof name === "string") itemNames[itemId] = name;
    };
    for (const slot of v3Slots) {
      for (const equipment of slot) {
        if (isRingPairEquipInfo(equipment)) {
          for (const ring of equipment.ringEquips) rememberItemName(ring.itemId);
        } else {
          rememberItemName(equipment.itemId);
        }
      }
    }
    for (const food of rawFoodCandidates) rememberItemName(food.itemId);
    const candidateCounts = Object.fromEntries(
      slotsWithEquips.map(([slotName, prunedCandidates], index) => [
        slotName,
        {
          beforePruning: slotName === "Finger"
            ? rawSingleRingCandidates.length
            : Object.values(validEquips[slotName] ?? {}).reduce(
                (total, equips) => total + equips.length,
                0,
              ),
          afterPruning: slotName === "Finger"
            ? singleRingCandidates.length
            : prunedCandidates.length,
          v3Candidates: v3Slots[index].length,
          ...(slotName === "Finger"
            ? {
                rawSingleRings: rawSingleRingCandidates.length,
                prunedRingPairs: prunedCandidates.length,
                estimatedOrderedRingPairs: estimatedRawRingPairCount,
                v3RingPairs: rawRingPairCandidates.length,
              }
            : {}),
        },
      ]),
    );
    const candidateExport = {
      job: v1Job,
      jobLevel: v1JobLevel,
      attributeIds: v1AttributeIds,
      statIndexes: [...v1StatIndexes.entries()],
      slots: v3Slots,
      slotNames: slotsWithEquips.map(([name]) => name),
      foods: rawFoodCandidates,
      constraints: v3Constraints,
      speedAttributeId,
      toughnessAttributeId,
      weaponDamageStat,
      weaponDamageId,
      itemNames,
      candidateCounts,
      foodCandidateCounts: {
        beforePruning: rawFoodCandidates.length,
        afterPruning: v1Foods.length,
      },
      maxContributions: v3MaxContributions,
    };
    console.log(`V3候选数量（剪枝前/后/完整输入）：${JSON.stringify(candidateCounts)}`);
    await new Promise<void>((resolve, reject) => {
      sendCandidate!.call(
        process,
        { type: "v3-candidate-export", candidateExport },
        (error) => error ? reject(error) : resolve(),
      );
    });
    if (process.connected && typeof process.disconnect === "function") process.disconnect();
    return;
  }
  const configuredWorkerCount = Number(process.env.DATA_TEST_WORKERS ?? 1);
  if (!Number.isInteger(configuredWorkerCount) || configuredWorkerCount < 1 || configuredWorkerCount > 4) {
    throw new Error("DATA_TEST_WORKERS 必须是 1 到 4 之间的整数");
  }
  const selectedAlgorithm = process.env.DATA_TEST_ALGORITHM ?? "exact";
  if (!new Set(["exact", "v2", "dp"]).has(selectedAlgorithm)) {
    throw new Error("DATA_TEST_ALGORITHM 必须是 exact、v2 或 dp");
  }
  if (configuredWorkerCount > 1 && selectedAlgorithm !== "v2") {
    throw new Error("DATA_TEST_WORKERS > 1 仅支持 DATA_TEST_ALGORITHM=v2");
  }
  const workerData = {
    job: v1Job,
    jobLevel: v1JobLevel,
    attributeIds: v1AttributeIds,
    statIndexes: [...v1StatIndexes.entries()],
    maxContributions,
    slots: searchSlots,
    foods: v1Foods,
    constraints: v2Constraints,
    tierStats: [...tierStatById.entries()],
    primaryStatId,
    speedAttributeId,
    toughnessAttributeId,
    weaponDamageStat,
    weaponDamageId,
    debug: process.env.DATA_TEST_DEBUG !== "false",
    compactDominance: process.env.DATA_TEST_COMPACT_DOMINANCE !== "false",
    suffixPrefixGridUpperBound:
      process.env.DATA_TEST_SUFFIX_GRID_UPPER === "true",
    suffixPrefixGridSize: process.env.DATA_TEST_SUFFIX_GRID_SIZE,
    prefixFrontierBatch: process.env.DATA_TEST_PREFIX_FRONTIER === "true",
    suffixSumNecessaryBound:
      process.env.DATA_TEST_SUFFIX_SUM_NECESSARY !== "false",
    prefixSuffixBlockUpperBound:
      process.env.DATA_TEST_PREFIX_SUFFIX_BLOCK_UPPER === "true",
    suffixPairAttributes:
      process.env.DATA_TEST_SUFFIX_PAIR_INDEX === "false"
        ? undefined
        : [
            v1AttributeIndex.get(weaponDamageId)!,
            v1AttributeIndex.get(primaryStatId)!,
          ],
    suffixPairStride:
      process.env.DATA_TEST_SUFFIX_PAIR_INDEX === "false"
        ? undefined
        : maxContributions[v1AttributeIndex.get(primaryStatId)!]! + 1,
    suffixPrefixTierLookup:
      process.env.DATA_TEST_SUFFIX_PREFIX_TIER_LOOKUP === "true",
    suffixFutureTierCompression:
      process.env.DATA_TEST_SUFFIX_FUTURE_TIER_COMPRESSION === "true",
    suffixFrontierSlotCount: configuredSuffixFrontierSlotCount,
    suffixFrontierMaxCombinations: configuredSuffixFrontierMaxCombinations,
    abortFlag,
  };
  const runWorker = (index: number): Promise<{
    result: LoadoutV2Result | undefined;
    objectiveScore: number;
    statistics: any;
  }> =>
    new Promise((resolveWorker, rejectWorker) => {
      const worker = new Worker(new URL("./archived/v2-worker.mjs", import.meta.url), {
        workerData: { ...workerData, partitionIndex: index, partitionCount: configuredWorkerCount },
      });
      worker.once("message", (message) => {
        resolveWorker(message);
        void worker.terminate();
      });
      worker.once("error", rejectWorker);
    });
  const runExactMipWorker = (
    maxSearchMs: number,
  ): Promise<{
    result: LoadoutV2Result | undefined;
    statistics: Record<string, unknown> | undefined;
    peakRssBytes: number;
  }> =>
    new Promise((resolveWorker, rejectWorker) => {
      const maxWorkerRssBytes = Math.floor(3.5 * 1024 * 1024 * 1024);
      let peakRssBytes = process.memoryUsage.rss();
      let terminatedForMemory = false;
      let terminatedForTime = false;
      let settled = false;
      const worker = new Worker(new URL("./exact-mip-worker.mjs", import.meta.url), {
        workerData: {
          job: v1Job,
          jobLevel: v1JobLevel,
          attributeIds: v1AttributeIds,
          statIndexes: [...v1StatIndexes.entries()],
          maxContributions,
          slots: searchSlots,
          foods: v1Foods,
          constraints: v2Constraints,
          speedAttributeId,
          toughnessAttributeId,
          weaponDamageStat,
          weaponDamageId,
          maxSearchMs,
        },
        resourceLimits: { maxOldGenerationSizeMb: 2560 },
      });
      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        clearInterval(memoryMonitor);
        clearTimeout(timeWatchdog);
        callback();
      };
      const memoryMonitor = setInterval(() => {
        const rss = process.memoryUsage.rss();
        if (rss > peakRssBytes) peakRssBytes = rss;
        if (rss >= maxWorkerRssBytes && !settled) {
          terminatedForMemory = true;
          void worker.terminate();
          finish(() => rejectWorker(new Error(
            `精确搜索进程 RSS 达到内存保护线 ${maxWorkerRssBytes} 字节，已停止且未声称最优`,
          )));
        }
      }, 10);
      const timeWatchdog = setTimeout(() => {
        terminatedForTime = true;
        void worker.terminate();
        finish(() => rejectWorker(new Error("精确 MIP 工作线程达到搜索时限，未完成最优性证明")));
      }, maxSearchMs + 750);
      worker.on("message", (message) => {
        if (message.type === "progress") {
          if (process.env.DATA_TEST_DEBUG !== "false") console.log(message.message);
          return;
        }
        if (message.type === "error") {
          const error = new Error(message.error.message);
          error.name = message.error.name ?? "Error";
          if (message.error.stack) error.stack = message.error.stack;
          finish(() => rejectWorker(error));
          return;
        }
        if (message.type === "result") {
          peakRssBytes = Math.max(peakRssBytes, process.memoryUsage.rss());
          finish(() => resolveWorker({
            result: message.result === undefined ? undefined : {
              damage: message.result.damage,
              selection: message.result.selection,
              food: message.result.food,
              maximumToughness: message.result.maximumToughness,
            },
            statistics: message.result?.statistics,
            peakRssBytes,
          }));
          void worker.terminate();
        }
      });
      worker.once("error", (error) => finish(() => rejectWorker(error)));
      worker.once("exit", (code) => {
        if (settled) return;
        const reason = terminatedForMemory
          ? "RSS 超过保护线"
          : terminatedForTime
            ? "超过搜索时限"
            : `工作线程退出（代码 ${code}）`;
        finish(() => rejectWorker(new Error(`${reason}，未完成最优性证明`)));
      });
    });
  console.log(`搜索约束：${JSON.stringify(v2Constraints)}`);
  const startedAt = performance.now();
  searchAbortDeadline =
    abortAfterMs === 0 ? Number.POSITIVE_INFINITY : Date.now() + abortAfterMs;
  const abortTimer = abortAfterMs === 0
    ? undefined
    : setTimeout(() => {
        searchAbortRequested = true;
        Atomics.store(abortView, 0, 1);
      }, abortAfterMs);
  let searchResult: LoadoutV2Result | undefined;
  let searchObjectiveScore = Number.NEGATIVE_INFINITY;
  let searchMaximumToughness = Number.NEGATIVE_INFINITY;
  let searchStatistics: any;
  if (configuredWorkerCount > 1) {
    let workerResults: {
      result: LoadoutV2Result | undefined;
      objectiveScore: number;
      statistics: any;
    }[];
    try {
      workerResults = await Promise.all(
        Array.from({ length: configuredWorkerCount }, (_, index) => runWorker(index)),
      );
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "V2 搜索已中断，未完成最优性证明") {
        throw error;
      }
      console.error(`V2搜索采样已停止：${String(error)}`);
      process.exitCode = 130;
      if (abortTimer !== undefined) clearTimeout(abortTimer);
      return;
    }
    for (const workerResult of workerResults) {
      const maximumToughness =
        workerResult.result?.maximumToughness ?? Number.NEGATIVE_INFINITY;
      const better =
        maximumToughness > searchMaximumToughness ||
        (maximumToughness === searchMaximumToughness &&
          workerResult.objectiveScore > searchObjectiveScore);
      if (
        workerResult.result !== undefined &&
        (searchResult === undefined || better)
      ) {
        searchResult = workerResult.result;
        searchObjectiveScore = workerResult.objectiveScore;
        searchMaximumToughness = maximumToughness;
      }
    }
    searchStatistics = workerResults.map(({ statistics }) => statistics);
  } else {
    if (selectedAlgorithm === "exact") {
      const configuredExactTimeout = Number(process.env.DATA_TEST_EXACT_TIMEOUT_MS ?? 115_000);
      if (!Number.isFinite(configuredExactTimeout) || configuredExactTimeout <= 0 || configuredExactTimeout > 115_000) {
        throw new Error("DATA_TEST_EXACT_TIMEOUT_MS 必须大于 0 且不超过 115000");
      }
      const effectiveTimeout = abortAfterMs === 0
        ? configuredExactTimeout
        : Math.min(configuredExactTimeout, abortAfterMs);
      try {
        const exact = await runExactMipWorker(effectiveTimeout);
        searchResult = exact.result;
        searchStatistics = {
          ...exact.statistics,
          peakRssBytes: exact.peakRssBytes,
        };
      } catch (error) {
        console.error(`精确搜索已停止：${String(error)}`);
        process.exitCode = 130;
        if (abortTimer !== undefined) clearTimeout(abortTimer);
        return;
      }
    } else if (selectedAlgorithm === "dp") {
      if (v2Constraints.gcd !== undefined || v2Constraints.speedMin !== undefined ||
          v2Constraints.speedMax !== undefined || v2Constraints.toughMin !== undefined ||
          v2Constraints.toughnessMinPercent !== undefined || v2Constraints.maxToughnessMode === true) {
        throw new Error("DATA_TEST_ALGORITHM=dp 仅支持无约束伤害采样");
      }
      const dpDamage = (attributes: readonly number[]): number => {
        const evaluation = v1Evaluate(attributes);
        return evaluation === undefined || evaluation.gcd <= 0
          ? Number.NEGATIVE_INFINITY
          : evaluation.damage / evaluation.gcd;
      };
      const dpFinder = new (await import("./archived/loadout-finder-dp.ts")).LoadoutFinderDp(dpDamage, v1AttributeIds.length, searchOptions);
      try {
        searchResult = dpFinder.findBest(searchSlots, v1Foods);
        searchStatistics = dpFinder.statistics;
      } catch (error) {
        console.error(`DP搜索部分统计：${JSON.stringify(dpFinder.statistics)}`);
        throw error;
      }
    } else {
      const v2Finder = new (await import("./archived/loadout-finder-v2.ts")).LoadoutFinderV2(
        v1Damage,
        v1AttributeIds.length,
        speedAttributeId,
        toughnessAttributeId,
        {
          ...searchOptions,
          evaluationFunction: v1Evaluate,
          gcdToSpeedRange: (gcdSeconds) =>
            equippedSpeedRangeForGcd(v1Job, v1JobLevel, gcdSeconds),
          toughnessPercentToMinimum: (percentage) =>
            equippedToughnessForMitigationPercent(v1Job, v1JobLevel, percentage),
        },
      );
      try {
        searchResult = v2Finder.findBest(searchSlots, v1Foods, v2Constraints);
        searchStatistics = v2Finder.statistics;
      } catch (error) {
        console.error(
          `V2搜索部分统计：${JSON.stringify(v2Finder.statistics)}`,
        );
        if (!(error instanceof Error) || error.message !== "V2 搜索已中断，未完成最优性证明") throw error;
        console.error(`V2搜索采样已停止：${String(error)}`);
        process.exitCode = 130;
        return;
      }
    }
  }
  if (abortTimer !== undefined) clearTimeout(abortTimer);
  const elapsedMs = performance.now() - startedAt;
  if (selectedAlgorithm === "exact") {
    console.log(`精确 MIP 搜索统计：耗时=${elapsedMs.toFixed(0)}ms；并发=1`);
  } else console.log(
      `${selectedAlgorithm === "dp" ? "DP" : selectedAlgorithm === "exact" ? "精确 MIP" : "V2"}搜索统计：耗时=${elapsedMs.toFixed(0)}ms；并发=${configuredWorkerCount}` +
      `；搜索=${Array.isArray(searchStatistics) ? searchStatistics.reduce((sum, stat) => sum + (stat.searched ?? stat.transitions ?? 0), 0) : (searchStatistics.searched ?? searchStatistics.transitions)}` +
      `；叶子=${Array.isArray(searchStatistics) ? searchStatistics.reduce((sum, stat) => sum + (stat.leaves ?? 0), 0) : (searchStatistics.leaves ?? 0)}`,
  );
  if (selectedAlgorithm === "exact") {
    console.log(`精确性与资源统计：${JSON.stringify(searchStatistics)}`);
  }
  const resultAlgorithm = selectedAlgorithm === "exact" ? "精确 MIP" : selectedAlgorithm === "dp" ? "DP" : "V2";
  if (searchResult === undefined || searchResult.food === undefined) {
    throw new Error(`${resultAlgorithm} 未找到可导出的配装结果`);
  }

  const slotNames: Record<string, string> = {
    MainHand: "主手",
    OffHand: "副手",
    Head: "头部",
    Body: "身体",
    Gloves: "手部",
    Legs: "腿部",
    Feet: "脚部",
    Ears: "耳饰",
    Neck: "项链",
    Wrists: "手镯",
    Finger: "戒指",
  };
  const rawBaseParams = (item: Row): ParamInfo[] => {
    const result: ParamInfo[] = [];
    for (let index = 0; index < 6; index++) {
      const baseParamId = item[`BaseParam[${index}]`];
      const value = item[`BaseParamValue[${index}]`];
      if (baseParamId !== 0 && value !== 0) {
        result.push({ baseParamId, value });
      }
    }
    return result.sort(
      (first, second) => first.baseParamId - second.baseParamId,
    );
  };
  const exportEquipment = (equipment: EquipInfo, slot: string) => {
    const item = itemMap[equipment.itemId];
    const isSynced = item.LevelItem > syncLvl;
    const materiaGradeIndex = Object.values(
      materiaByBaseParam,
    )[0].minAllowItemLevel.findLastIndex((level) => level <= item.LevelItem);
    if (!isSynced && materiaGradeIndex < 0) {
      throw new Error(`装备 ${equipment.itemId} 没有可用的魔晶石等级`);
    }
    const customCandidates = mandervilleWeapons[equipment.itemId];
    const gear = reverseEquipmentForFfxivGearing(equipment, {
      rawBaseParams: rawBaseParams(item),
      materiaSlotCount: item.MateriaSlotCount,
      advancedMelding: Boolean(item.IsAdvancedMeldingPermitted),
      materiaGrade: isSynced
        ? undefined
        : ((materiaGradeIndex + 1) as MateriaGrade),
      materiaValue: (baseParamId, grade) =>
        materiaByBaseParam[baseParamId].values[grade - 1],
      statForBaseParam: (baseParamId) => baseParamIdToStat[baseParamId],
      customCandidates,
      projectCustomCandidate:
        customCandidates === undefined
          ? undefined
          : (candidate) =>
              candidate.baseParams.map((param) => ({
                baseParamId: param.baseParamId,
                value: isSynced
                  ? Math.min(
                      param.value,
                      getAttributeLimit(
                        equipment.itemId,
                        param.baseParamId,
                        syncLvl,
                      ),
                    )
                  : param.value,
              })),
    });
    return { slot, equipment, item, gear };
  };
  const exportedEquipment = searchResult.selection.flatMap(
    (equipment, index) => {
      const slot = slotsWithEquips[index][0];
      return isRingPairEquipInfo(equipment)
        ? equipment.ringEquips.map((ring) => exportEquipment(ring, slot))
        : [exportEquipment(equipment, slot)];
    },
  );
  exportedEquipment.sort(
    (first, second) =>
      Number(first.slot === "Finger") - Number(second.slot === "Finger"),
  );
  const exportedRings = exportedEquipment.filter(
    (entry) => entry.slot === "Finger",
  );
  if (exportedRings.length !== 2) {
    throw new Error(
      `${resultAlgorithm} 导出需要两枚戒指，实际为 ${exportedRings.length} 枚`,
    );
  }

  const gears: FfxivGearingGear[] = [
    ...exportedEquipment.map((entry) => entry.gear),
    { id: searchResult.food.itemId, materias: [] },
  ];
  const url = createFfxivGearingUrl({
    job: v1Job,
    jobLevel: v1JobLevel,
    syncLevel: syncLvl,
    gears,
  });
  const parsedGearset = parseFfxivGearingGearset(
    url.slice(url.indexOf("?") + 1),
  );
  if (typeof parsedGearset === "string") {
    throw new Error(`ffxiv-gearing 链接被解析为旧版本：${parsedGearset}`);
  }
  const expectedGearIds = gears.map((gear) => gear.id).sort((a, b) => a - b);
  const parsedGearIds = parsedGearset.gears
    .map((gear) => gear.id)
    .sort((a, b) => a - b);
  if (
    parsedGearset.job !== v1Job ||
    parsedGearset.jobLevel !== v1JobLevel ||
    parsedGearset.syncLevel !== syncLvl ||
    JSON.stringify(parsedGearIds) !== JSON.stringify(expectedGearIds)
  ) {
    throw new Error(
      `ffxiv-gearing 链接往返解析结果与 ${resultAlgorithm} 配装不一致`,
    );
  }
  const resultOutput = {
    职业: v1Job,
    等级: v1JobLevel,
    同步品级: syncLvl,
    每威力伤害期望: searchResult.damage,
    食物: {
      物品ID: searchResult.food.itemId,
      名称: itemMap[searchResult.food.itemId].Name,
    },
    装备: exportedEquipment.map(({ slot, item, gear }) => ({
      槽位: slotNames[slot] ?? slot,
      物品ID: gear.id,
      名称: item.Name,
      品级: item.LevelItem,
      魔晶石: gear.materias.map((materia) =>
        materia === null
          ? null
          : {
              属性: referenceGame.statNames[materia[0]],
              等级: materia[1],
            },
      ),
      自定义属性:
        gear.customStats === undefined
          ? undefined
          : Object.fromEntries(
              Object.entries(gear.customStats).map(([stat, value]) => [
                referenceGame.statNames[stat as Stat],
                value,
              ]),
            ),
    })),
  };
  console.log(
    `${resultAlgorithm}最优配装结果：${JSON.stringify(resultOutput, null, 2)}`,
  );
  console.log(`ffxiv-gearing链接：${url}`);
})();
