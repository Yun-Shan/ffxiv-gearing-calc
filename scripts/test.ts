import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { Buffer } from "node:buffer";
import {
  equippedEffects,
  type EquippedEffects,
  type EquippedStats,
} from "./equipped-effects.ts";
import type { Job, JobLevel, Stat } from "../reference/ffxiv-gearing/src/game.ts";

const command = "F:\\Workspace\\VisualStudio\\ffxiv\\mcp\\mcp-ffxiv-lumina\\publish\\mcp-lumina.exe";
const referenceGame = await import("../reference/ffxiv-gearing/src/game.ts");
const supportedJobLevels = new Set<number>(referenceGame.jobLevels);

type Row = Record<string, any> & {
  rowId: number;
  fields: Record<string, any>;
};
type ParamInfo = {
  baseParamId: number;
  value: number;
};
type FoodParam = {
  baseParamId: number;
  multiplier: number;
  maxValue: number;
};
type PendingRequest = {
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
};
type StreamState = {
  chunks: Buffer[];
  totalLen: number;
};
type EquipmentMateriaCombinerConfig = {
  getMateriaAttributeTypes: (jobType: number) => number[];
  getMateriaValue: (attrId: number, materiaLevel: number) => number;
  getAttributeLimit: (itemId: number, attrId: number) => number;
};
type ComparableInfo = {
  key: string;
  baseParams: (ParamInfo | FoodParam)[];
};

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
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
    });

    const handleLine = (line: Buffer): void => {
      let message;
      try {
        message = JSON.parse(line as unknown as string);
      } catch (error: any) {
        this.fail(new Error(`Lumina MCP 返回了无效 JSON-RPC：${error.message}`, { cause: error }));
        return;
      }
      if (message.id === undefined) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(`${message.error.code ?? "MCP"}: ${message.error.message}`));
      else pending.resolve(message.result);
    }

    this.process.stdout.on("data", (chunk) => {
      let start = 0;
      let index;

      while ((index = chunk.indexOf('\n', start)) !== -1) {
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
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }

  request(method: string, params: Record<string, unknown>): Promise<any> {
    const id = this.nextId++;
    return new Promise((resolveRequest, rejectRequest) => {
      this.pending.set(id, { resolve: resolveRequest, reject: rejectRequest });
      this.process.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }

  notify(method: string, params: Record<string, unknown>): void {
    this.process.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
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
    delete row['languagesRequested'];
    delete row['languagesReturned'];
    delete row['fallbackUsed'];
    delete row['gameVersion'];
    delete row['timestamp'];
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
      }
    });
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<any> {
    const result = await this.request("tools/call", { name, arguments: args });
    const text = result?.content?.find((entry: any) => entry.type === "text")?.text;
    if (!text) throw new Error(`MCP 工具 ${name} 未返回文本 JSON`);
    let value;
    try {
      value = JSON.parse(text);
    } catch (error) {
      throw `MCP 工具 ${name} 返回了无法解析的 JSON：${text}`;
    }
    if ('rowId' in value && 'fields' in value) {
      return this.#proxyRow(value);
    } else if ('rows' in value) {
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
let response = await client.callTool("list_rows", { sheet: "EquipSlotCategory", limit: -1 });
const equipSlotMap: Record<number, Row> = response.rows
  .filter((it: Row) => Object.values(it.fields).some(f => f === 1))
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

// 食物因为存在利用率的问题，不能简单等价于装备
type FoodInfo = {
  itemId: number;
  itemLevel: number;
  // 属性列表排序用于去重相同属性的食物
  key: string;
  // 属性id和属性百分比(用于乘法的小数表示，例如增加10%就是1.1，因此可以直接乘)和属性上限值
  baseParams: FoodParam[];
};

response = await client.callTool("list_rows", { sheet: "ItemFood", limit: -1 });
const itemFood: Record<number, Row> = {};
for (const row of response.rows) {
  itemFood[row.rowId] = row;
}

response = await client.callTool("list_rows", { sheet: "ItemAction", limit: -1 });
const itemAction: Record<number, Row> = {};
for (const row of response.rows) {
  itemAction[row.rowId] = row;
}

const foods: FoodInfo[] = [];
for (const item of Object.values(itemMap)) {
  if (item.ItemUICategory === 46 && checkAllowItemLevel(item.LevelItem)) {
    const foodConfig = itemFood[itemAction[item.ItemAction]['DataHQ[1]']];
    const baseParams: FoodParam[] = [];
    for (let i = 0; i < 3; i++) {
      const param = foodConfig[`BaseParam[${i}]`];
      const val = foodConfig[`ValueHQ[${i}]`];
      const max = foodConfig[`MaxHQ[${i}]`];
      baseParams.push({ baseParamId: param, multiplier: 1 + (val / 100), maxValue: max });
    }
    baseParams.sort((a, b) => a.baseParamId - b.baseParamId);
    const food: FoodInfo = {
      itemId: item.rowId,
      itemLevel: item.LevelItem,
      key: `${baseParams.map(it => it.baseParamId).join('-')}`,
      baseParams,
    };
    foods.push(food);
  }
}
foods.sort((a, b) => b.itemLevel - a.itemLevel);
console.log(`过滤后共有${foods.length}个食物`);

type Materia = {
  id: number;
  baseParam: number;
  items: number[];
  values: number[];
  minAllowItemLevel: number[];
};

const materiaGrades: number[][] = [];
const materiaRestrictionGrades: [number, number[]][] = [];
const materiaNonrestrictionGrades: [number, number[]][] = [];
response = await client.callTool("list_rows", { sheet: "MateriaGrade", limit: -1 });
for (const row of response.rows) {
  if (row.rowId !== materiaGrades.length) throw '魔晶石等级异常：非连续'
  const rates = [row['OvermeldHQPercent[0]'], row['OvermeldHQPercent[1]'], row['OvermeldHQPercent[2]'], row['OvermeldHQPercent[3]']];
  materiaGrades.push(rates);
  if (rates.some(it => it === 0)) {
    materiaRestrictionGrades.push([row.rowId, rates]);
  } else {
    materiaNonrestrictionGrades.push([row.rowId, rates]);
  }
}
const chineseNumbers = ['零','壹','贰','叁','肆','伍','陆','柒','捌','玖','拾','拾壹','拾贰'];
console.log(`共有${materiaGrades.length}个等级的魔晶石，其中${JSON.stringify(materiaRestrictionGrades.map(it => chineseNumbers[it[0] + 1]))}是限制等级，${JSON.stringify(materiaNonrestrictionGrades.map(it => chineseNumbers[it[0] + 1]))}是非限制等级。`);
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

response = await client.callTool("list_rows", { sheet: "ClassJobCategory", limit: -1 });
const classJobCategory: Record<number, Row> = {};
for (const row of response.rows) {
  classJobCategory[row.rowId] = row;
}

response = await client.callTool("list_rows", { sheet: "EquipSlotCategory", limit: -1 });
const equipSlotCategory: Record<number, Row> = {};
for (const row of response.rows) {
  equipSlotCategory[row.rowId] = row;
}

response = await client.callTool("describe_sheet", { sheet: "ItemLevel" });
const itemLevelAttrId2AttrName: Record<number, string> = {};
for (const column of response.columns) {
  itemLevelAttrId2AttrName[column.index + 1] = column.name;
}
response = await client.callTool("list_rows", { sheet: "ItemLevel", limit: -1 });
const itemLevel: Record<number, Row> = {};
for (const row of response.rows) {
  itemLevel[row.rowId] = row;
}
function itemLevelAttrVal(lvl: number, attrId: number): any {
  return itemLevel[lvl][itemLevelAttrId2AttrName[attrId]];
}

response = await client.callTool("list_rows", { sheet: "MandervilleWeaponEnhance", limit: -1 });
const mandervilleWeaponEnhance: Record<number, Row> = {};
type EquipInfo = {
  itemId: number;
  itemLevel: number;
  // 属性列表排序用于去重相同属性的装备
  key: string;
  // 属性id和属性值(加上魔晶石后的)
  baseParams: ParamInfo[];
  PDMG: number;
  MDMG: number;
  DLY: number;
};
// key 物品id，value 虚拟武器列表
const mandervilleWeapons: Record<number, EquipInfo[]> = {};
for (const row of response.rows) {
  mandervilleWeaponEnhance[row.rowId] = row;
  const baseParams: ParamInfo[] = [];
  for (let i = 0; i < 6; i++) {
    const param = itemMap[row.rowId][`BaseParam[${i}]`];
    const val = itemMap[row.rowId][`BaseParamValue[${i}]`];
    if (param !== 0 && val !== 0) baseParams.push({ baseParamId: param, value: val });
  }
  baseParams.sort((a, b) => a.baseParamId - b.baseParamId);
  const list: ParamInfo[][] = [];
  // 生成不同属性方案的自定义参数武器
  for (let i = 0; i < 4; i++)
    for (let j = i + 1; j < 4; j++)
      for (let k = 0; k < 4; k++)
        if (k !== i && k !== j) {
          const pA = materiaMap[row[`Materia[${i}]`]].BaseParam;
          const vA = materiaMap[row[`Materia[${i}]`]][`Value[${row[`MateriaBigValueIndex[${i}]`]}]`];
          const pB = materiaMap[row[`Materia[${j}]`]].BaseParam;
          const vB = materiaMap[row[`Materia[${j}]`]][`Value[${row[`MateriaBigValueIndex[${j}]`]}]`];
          const pC = materiaMap[row[`Materia[${k}]`]].BaseParam;
          const vC = materiaMap[row[`Materia[${k}]`]][`Value[${row[`MateriaSmallValueIndex[${k}]`]}]`];
          list.push([
            ...baseParams,
            { baseParamId: pA, value: vA },
            { baseParamId: pB, value: vB },
            { baseParamId: pC, value: vC },
          ].sort((a, b) => a.baseParamId - b.baseParamId));
        }
  const equips: EquipInfo[] = [];
  for (const gen of list) {
    const equip: EquipInfo = {
      itemId: row.rowId,
      itemLevel: row.LevelItem,
      key: `${gen.map(it => it.baseParamId).join('-')}`,
      baseParams: gen,
      PDMG: itemMap[row.rowId].DamagePhys,
      MDMG: itemMap[row.rowId].DamageMag,
      DLY: itemMap[row.rowId].Delayms,
    };
    equips.push(equip);
  }
  mandervilleWeapons[row.rowId] = equips;
}
console.log(`共生成${Object.keys(mandervilleWeapons)}套自定义参数武器，共${Object.values(mandervilleWeapons).map(it => it.length).reduce((a, b) => a + b, 0)}件`);

response = await client.callTool("list_rows", { sheet: "BaseParam", limit: -1 });
const baseParam: Record<number, Row> = {};
const speedBaseParam = new Set<number>();
const specialBaseParam = new Set<number>();
for (const row of response.rows) {
  baseParam[row.rowId] = row;
  if (['咏唱速度', '技能速度'].includes(row.Name)) speedBaseParam.add(row.rowId);
  else if (['坚韧', '信仰'].includes(row.Name)) specialBaseParam.add(row.rowId);
}
const statNameToAbbreviation: Record<string, Stat> = {};
for (const [stat, name] of Object.entries(referenceGame.statNames) as [Stat, string][]) {
  statNameToAbbreviation[name] = stat;
}
const baseParamIdToStat: Record<number, Stat> = {};
for (const row of Object.values(baseParam)) {
  const stat = statNameToAbbreviation[row.Name];
  if (stat !== undefined && stat !== 'main' && stat !== 'secondary') {
    baseParamIdToStat[row.rowId] = stat;
  }
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
    case 1: value = param.OneHandWeaponPercent; break;
    case 2: value = param.OffHandPercent; break;
    case 3: value = param.HeadPercent; break;
    case 4: value = param.ChestPercent; break;
    case 5: value = param.HandsPercent; break;
    case 6: value = param.WaistPercent; break; // 这个实际不会用到，因为腰带已经被移除出游戏了
    case 7: value = param.LegsPercent; break;
    case 8: value = param.FeetPercent; break;
    case 9: value = param.EarringPercent; break;
    case 10: value = param.NecklacePercent; break;
    case 11: value = param.BraceletPercent; break;
    case 12: value = param.RingPercent; break;
    case 13: value = param.TwoHandWeaponPercent; break;
    case 14: value = param.UnderArmorPercent; break; // 游戏中实际不存在这个装备分类的物品，具体是啥也不知道
    case 15: value = param.ChestHeadPercent; break;
    case 16: value = param.ChestHeadLegsFeetPercent; break; // 实际上应该是ChestHandsLegsFeetPercent，可能是Lumina的定义弄错了
    case 17: value = param.Unknown0; break; // 这里是SoulCrystal，Lumina没有命名，但应该是对的(参考的配装器源码)
    case 18: value = param.LegsFeetPercent; break;
    case 19: value = param.HeadChestHandsLegsFeetPercent; break;
    case 20: value = param.ChestLegsGlovesPercent; break; // 这里的Gloves应该是Hands，估计是不同的人进行PR时命名不一致
    case 21: value = param.ChestLegsFeetPercent; break;
    case 22: value = param.Unknown1; break; // 这里应该是ChestPercent + HandsPercent，Lumina没有命名，但应该是对的(参考的配装器源码)
    case 23: value = param.Unknown3; break; // 这里应该是ChestPercent + LegsPercent，Lumina没有命名，但应该是对的(参考的配装器源码)
    default: value = 0; return 0;
  }

  // 检查值是否为有效数字
  if (typeof value !== 'number' || isNaN(value)) {
    throw new TypeError(
      `Invalid value for equipSlotCategory ${equipSlotCategory}: expected number, got ${typeof value}`
    );
  }
  return value;
}

function getAttributeLimit(itemId: number, attrId: number, syncLevel?: number): number {
  const item = itemMap[itemId];
  const level = syncLevel ?? item.LevelItem;
  const iLvlAttr = itemLevelAttrVal(level, attrId);
  if (iLvlAttr == null) throw new Error(`LevelItem ${level} field ${attrId} not found`);
  const baseParamModifier = item.BaseParamModifier;
  const meldParam = baseParamModifier <= 12 ? baseParam[attrId][`MeldParam[${baseParamModifier}]`] : 0;
  return Math.round(
    iLvlAttr * getEquipSlotPercent(baseParam[attrId], item.EquipSlotCategory) * meldParam / 100000.0);
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
  constructor({ getMateriaAttributeTypes, getMateriaValue, getAttributeLimit }: EquipmentMateriaCombinerConfig) {
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
      schemes = this._generateSchemes(attrIds, unrestrictedSlots, restrictedSlots);
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
      maxCounts[i] = value > 0 ? Math.max(0, Math.floor((limit - baseVal) / value)) : 0;
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
          finalMap.set(attrId, (finalMap.get(attrId) || 0) + count * attrValues[i]);
        }
      }

      // 转为数组并排序
      const attributes: ParamInfo[] = Array.from(finalMap.entries()).map(([baseParamId, value]) => ({
        baseParamId,
        value,
      }));
      attributes.sort((a, b) => a.baseParamId - b.baseParamId);
      const key = attributes.map(it => it.baseParamId).join('-');

      if (!seen.has(key)) {
        seen.add(key);
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
        return Object.values(baseParam).filter(it => ['暴击', '信念', '直击', '技能速度', '坚韧'].includes(it.Name)).map(it => it.rowId);
      // 3 近战 4 远敏
      case 3:
      case 4:
        return Object.values(baseParam).filter(it => ['暴击', '信念', '直击', '技能速度'].includes(it.Name)).map(it => it.rowId);
      // 2 纯奶 5 法系输出 6 盾奶
      case 2:
      case 5:
      case 6:
        return Object.values(baseParam).filter(it => ['暴击', '信念', '直击', '咏唱速度'].includes(it.Name)).map(it => it.rowId);
      default: throw new Error(`未知job type: ${jobType}，注意8.0可能会增加7 ST，并把1改为MT`);
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
    group.sort((a, b) => this.#sumAttributes(b.baseParams) - this.#sumAttributes(a.baseParams));

    const paretoFront: T[] = [];

    for (let i = 0; i < group.length; i++) {
      const candidate = group[i];
      let isDominated = false;

      // 只与已接受的Pareto最优解比较
      for (let j = 0; j < paretoFront.length; j++) {
        if (this.#dominates(paretoFront[j].baseParams, candidate.baseParams)) {
          isDominated = true;
          break;
        }
      }

      if (!isDominated) {
        // 移除被candidate支配的已接受解
        const newFront: T[] = [];
        for (let j = 0; j < paretoFront.length; j++) {
          if (!this.#dominates(candidate.baseParams, paretoFront[j].baseParams)) {
            newFront.push(paretoFront[j]);
          }
        }
        newFront.push(candidate);
        paretoFront.length = 0;
        paretoFront.push(...newFront);
      }
    }

    return paretoFront;
  }

  /**
   * 判断装备a是否支配装备b（a的所有属性值都>=b的对应属性值）
   * @param {(ParamInfo | FoodParam)[]} aParams - 装备A的属性数组（已排序）
   * @param {(ParamInfo | FoodParam)[]} bParams - 装备B的属性数组（已排序）
   * @returns {boolean} true表示a支配b
   * @private
   */
  #dominates(aParams: (ParamInfo | FoodParam)[], bParams: (ParamInfo | FoodParam)[]): boolean {
    for (let i = 0; i < aParams.length; i++) {
      if (this.#attributeValue(aParams[i]) < this.#attributeValue(bParams[i])) {
        return false;
      }
    }
    return true;
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
    return "value" in param ? param.value : param.multiplier;
  }
}
const equipInfoPruner = new EquipInfoPruner();

function buildEquipInfo(itemId: number, jobType: number, syncLevel?: number): EquipInfo[] {
  const item = itemMap[itemId];
  const isSynced = syncLevel !== undefined && item.LevelItem > syncLevel;
  const createEquipInfo = (baseParams: ParamInfo[], key: string): EquipInfo => ({
    itemId,
    itemLevel: item.LevelItem,
    key,
    baseParams,
    PDMG: item.DamagePhys,
    MDMG: item.DamageMag,
    DLY: item.Delayms,
  });

  const mandervilleEquips = mandervilleWeapons[itemId];
  if (mandervilleEquips !== undefined) {
    if (!isSynced) return mandervilleEquips;
    return mandervilleEquips.map(equip => createEquipInfo(
      equip.baseParams.map(param => ({
        baseParamId: param.baseParamId,
        value: Math.min(param.value, getAttributeLimit(itemId, param.baseParamId, syncLevel)),
      })),
      equip.key,
    ));
  }

  const baseParams: ParamInfo[] = [];
  for (let i = 0; i < 6; i++) {
    const param = item[`BaseParam[${i}]`];
    const value = item[`BaseParamValue[${i}]`];
    if (param !== 0 && value !== 0) baseParams.push({ baseParamId: param, value });
  }
  baseParams.sort((a, b) => a.baseParamId - b.baseParamId);

  if (isSynced) {
    const syncedBaseParams = baseParams.map(param => ({
      baseParamId: param.baseParamId,
      value: Math.min(param.value, getAttributeLimit(itemId, param.baseParamId, syncLevel)),
    }));
    return [createEquipInfo(
      syncedBaseParams,
      `${syncedBaseParams.map(param => param.baseParamId).join('-')}`,
    )];
  }

  const genResult = equipmentMateriaCombiner.calculate(
    jobType,
    Object.values(materiaByBaseParam)[0].minAllowItemLevel.findLastIndex(level => level <= item.LevelItem),
    item.MateriaSlotCount + (item.IsAdvancedMeldingPermitted ? 1 : 0),
    item.IsAdvancedMeldingPermitted ? (5 - 1 - item.MateriaSlotCount) : 0,
    baseParams,
    itemId,
  );
  return genResult.map(([key, generatedBaseParams]) => createEquipInfo(generatedBaseParams, key));
}

(() => {
  // 赤魔 735品级同步，装备范围730-795
  const minLvl = 730;
  const maxLvl = 795;
  const syncLvl = 735;
  const job = jobs.find(it => it.Name === '赤魔法师') as Row;
  const jobAbbreviation = job.Abbreviation;

  const levels: number[] = [];
  const validEquips: Record<string, Record<number, EquipInfo[]>> = {};
  equipMap.entries()
    .filter(([lvl]) => lvl >= minLvl && lvl <= maxLvl)
    .forEach(([lvl, equips]) => {
      levels.push(lvl);
      // 根据装备物品的职业槽位信息里是否有当前职业判断能否装备
      equips.filter(it => classJobCategory[it.ClassJobCategory][jobAbbreviation])
        .forEach(equipItem => {
          const slot = equipSlotCategory[equipItem.EquipSlotCategory];
          Object.entries(slot.fields)
            .filter(([_, value]) => value === 1)
            .forEach(([slotName]) =>{
              // 合并戒指槽位
              if (slotName === 'FingerL' || slotName === 'FingerR') slotName = 'Finger';
              if (!validEquips[slotName]) validEquips[slotName] = {};
              if (!validEquips[slotName][lvl]) validEquips[slotName][lvl] = [];
              validEquips[slotName][lvl].push(...buildEquipInfo(equipItem.rowId, job.JobType, syncLvl));
            });
        });
    });
  levels.sort((a, b) => b - a);
  // 每个部位只取最高档，如果最高档全是技速/咏速/坚韧/信仰，就多找低一档
  const filterEquips: Record<string, EquipInfo[]> = {};
  Object.entries(validEquips)
    .forEach(([slotName, equipsByLvl]) => {
      const list: EquipInfo[] = [];
      for (const lvl of levels) {
        const equips = equipsByLvl[lvl];
        if (!equips) continue;
        list.push(...equips);
      }
      filterEquips[slotName] = equipInfoPruner.prune(list);
    });
  const availableFoods = equipInfoPruner.prune(
    foods.filter(food => food.itemLevel >= levels[levels.length - 1])
  );
  const allAvailablePreset = Object.values(filterEquips).reduce((acc, it) => acc * it.length, 1) * availableFoods.length;
  console.log(`可用装备组合数量：${String(allAvailablePreset).replaceAll(/\B(?=(\d{3})+$)/g, '_')}`);

  // TODO 参考 https://chat.deepseek.com/a/chat/s/1a546460-50f7-4be1-b78f-c81c7bc32ad2

  // 按槽位的候选数量从小到大排序
  const slotsWithEquips = Object.entries(filterEquips).sort((a, b) => a[1].length - b[1].length);

  const test = () => {
    const representativeEquips = Object.values(filterEquips)
      .map(equips => equips[0])
      .filter((equip): equip is EquipInfo => equip !== undefined);
    const representativeFood = availableFoods[0];
    if (representativeFood !== undefined) {
      const effects = calculateEquippedEffectsProxy(
        job,
        100,
        representativeEquips,
        representativeFood,
      );
      console.log(`测试代理计算结果：${JSON.stringify(effects)}`);
    }
  }
  test();
})();


client.close();


